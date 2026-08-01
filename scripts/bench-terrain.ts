/**
 * bench-terrain.ts — per-chunk terrain generation, measured.
 *
 * Run: `pnpm bench`. Also `--update-baseline`, `--guard-tolerance=`, `--workload-tolerance=`.
 * NOT part of `pnpm verify`: CI runs on every pull request in a public
 * repository and wall-clock there is a shared resource. See docs/testing.md.
 *
 * ---------------------------------------------------------------------------
 * Why the terrain benchmark lives HERE and not in mc-noise
 * ---------------------------------------------------------------------------
 *
 * The reference implementation's `scripts/bench-terrain.ts` times
 * `generateTerrainBlocks({coord, seaLevel, lakeLevel, seed})` — a function that
 * returns a chunk's block array. mc-noise cannot host that measurement, because
 * mc-noise has no chunk, no block ids, no sea level and no biomes; it is a
 * `(seed, coordinate) -> number` library and nothing else. `generateChunk` here
 * IS the reference's `generateTerrainBlocks`: same unit of work, same inputs,
 * same 16 x 16 x 256 output, so the port is a port and not an analogy.
 *
 * mc-noise gets its own benchmark for the octave loop and for per-column
 * sampling throughput. The two are complementary and the split follows what the
 * code actually does: mc-noise owns the sampler, mc-worldgen owns the chunk.
 *
 * ---------------------------------------------------------------------------
 * The breakdown, and why it is a breakdown
 * ---------------------------------------------------------------------------
 *
 * The reference printed two lines — a one-time-per-seed cost and a per-chunk
 * cost — and multiplied the second by 81 chunks (renderDistance=4). The same
 * framing is kept, with the per-chunk figure decomposed into the passes
 * `generateChunk` actually runs, because "1.4 ms/chunk" tells you nothing about
 * WHERE to look when it becomes 4 ms/chunk. The passes are measured in the
 * order `domain/terrain.ts` runs them, and their sum should approximate the
 * whole; where it does not, the gap is the allocation of the 64 KB buffer.
 *
 * ---------------------------------------------------------------------------
 * The guard
 * ---------------------------------------------------------------------------
 *
 * `domain/seeded-random.ts` carries its own copy of the plan.md §5.2 octave
 * exception: `fbm2D` is `let` + `for` and its comment says the state thread is
 * deliberate, "written that way here so the convention is established before
 * mc-noise inherits it". A convention established by a comment is a convention
 * one refactor from being lost, so the same shipped-vs-frozen gate mc-noise
 * uses is applied here to `fbm2D`.
 *
 * Everything below is seeded and deterministic. `SEED` is a constant.
 */
import {
  carveCaves,
  channelSeed,
  chunkCoord,
  CHUNK_SIZE_XZ,
  climateAt,
  DEFAULT_TERRAIN_LEVELS,
  emptyBlocks,
  fbm2D,
  generateChunk,
  surfaceHeightAt,
  valueNoise2D,
  worldX,
  worldZ,
  type ChunkCoord,
} from '../src/index'
import {
  checkGuards,
  checkWorkloads,
  formatCheck,
  formatGuard,
  formatWorkload,
  guardRatio,
  measure,
  readBaseline,
  SHIPPED_VS_FROZEN_TOLERANCE,
  tolerancesFrom,
  wantsBaselineUpdate,
  writeBaseline,
  type Baseline,
  type Guard,
  type MeasureOptions,
  type Workload,
} from './bench-harness'

const BASELINE_PATH = new URL('./bench-baseline.json', import.meta.url).pathname

/** The reference's run count for the terrain workload. */
const RUNS = 9

const SEED = 20260726

/** Columns in a chunk. The unit the sampling workloads are quoted per. */
const COLUMNS_PER_CHUNK = CHUNK_SIZE_XZ * CHUNK_SIZE_XZ

/**
 * Spread the coordinates so each call generates a DIFFERENT chunk.
 *
 * Straight from the reference's `bench-terrain.ts`, comment and all: "Spread
 * coords so each call generates a distinct chunk (avoids any incidental
 * caching)." Generating chunk (0,0) two hundred times would measure a warm
 * lattice-hash cache rather than terrain generation.
 */
const coordFor = (index: number): ChunkCoord => chunkCoord((index % 64) - 32, ((index >> 6) % 64) - 32)

/** Anything a measured loop computes has to be observed, or the JIT may delete it. */
let sink = 0

let counter = 0
const nextCoord = (): ChunkCoord => {
  counter += 1
  return coordFor(counter)
}

// ---------------------------------------------------------------------------
// The yardstick
// ---------------------------------------------------------------------------

/**
 * A fixed pass of integer hashing and smoothstep interpolation — the arithmetic
 * shape of `valueNoise2D` without being it, over a fixed lattice.
 *
 * The machine-speed reference for the `workloads` ratios, sized so that one
 * pass costs the same order as one chunk. It is deliberately not `valueNoise2D`
 * itself: that is part of the workload, and a yardstick that moves with the
 * thing it measures normalises the regression away. See the harness header on
 * why workload ratios carry a looser tolerance than guard ratios do.
 */
const YARDSTICK_OPS = 8192

const yardstick = (): void => {
  let total = 0
  let hash = 0x9e3779b9
  for (let index = 0; index < YARDSTICK_OPS; index += 1) {
    hash = Math.imul(hash ^ index, 0x85ebca6b) >>> 0
    const t = (hash >>> 8) / 16777216
    total += t * t * (3 - 2 * t)
  }
  sink += total
}

// ---------------------------------------------------------------------------
// Guard — the octave loop of domain/seeded-random.ts
// ---------------------------------------------------------------------------

/**
 * A frozen copy of `fbm2D` as it is written today.
 *
 * The gate, for the same reason as in mc-noise: timing the shipped function
 * against a REWRITE proves nothing on its own, because the ratio moves the same
 * way whichever side changes. Timing it against a copy of its own current shape
 * pins the shipped function, and the ratio collapses if it gets slower.
 */
const fbm2DFrozen = (
  seed: number,
  x: number,
  z: number,
  options: { readonly octaves: number; readonly frequency: number; readonly persistence: number },
): number => {
  let total = 0
  let amplitude = 1
  let frequency = options.frequency
  let normalisation = 0

  for (let octave = 0; octave < options.octaves; octave += 1) {
    total += valueNoise2D(channelSeed(seed, `octave-${String(octave)}`), x, z, frequency) * amplitude
    normalisation += amplitude
    amplitude *= options.persistence
    frequency *= 2
  }

  return normalisation === 0 ? 0 : total / normalisation
}

/**
 * The fold `domain/seeded-random.ts` exists to forbid. Same result, and
 * `fbmEquivalence` checks that before anything is timed.
 */
const fbm2DArrayReduce = (
  seed: number,
  x: number,
  z: number,
  options: { readonly octaves: number; readonly frequency: number; readonly persistence: number },
): number => {
  const folded = Array.from({ length: options.octaves }).reduce<{
    readonly total: number
    readonly amplitude: number
    readonly frequency: number
    readonly normalisation: number
    readonly octave: number
  }>(
    (accumulator) => ({
      total:
        accumulator.total +
        valueNoise2D(
          channelSeed(seed, `octave-${String(accumulator.octave)}`),
          x,
          z,
          accumulator.frequency,
        ) *
          accumulator.amplitude,
      normalisation: accumulator.normalisation + accumulator.amplitude,
      amplitude: accumulator.amplitude * options.persistence,
      frequency: accumulator.frequency * 2,
      octave: accumulator.octave + 1,
    }),
    { total: 0, amplitude: 1, frequency: options.frequency, normalisation: 0, octave: 0 },
  )
  return folded.normalisation === 0 ? 0 : folded.total / folded.normalisation
}

const FBM_OPTIONS = { octaves: 4, frequency: 1 / 180, persistence: 0.5 } as const

type FbmImplementation = typeof fbm2D

const FBM_SAMPLES = 100_000

const fbmArm = (implementation: FbmImplementation) => (): void => {
  let total = 0
  for (let index = 0; index < FBM_SAMPLES; index += 1) {
    total += implementation(SEED, index * 1.7, index * 0.9, FBM_OPTIONS)
  }
  sink += total
}

const fbmEquivalence = (): string => {
  const disagreements: Array<string> = []
  for (let index = 0; index < 1024; index += 1) {
    const expected = fbm2D(SEED, index * 1.7, index * 0.9, FBM_OPTIONS)
    if (fbm2DFrozen(SEED, index * 1.7, index * 0.9, FBM_OPTIONS) !== expected) {
      disagreements.push('frozen copy')
    }
    if (fbm2DArrayReduce(SEED, index * 1.7, index * 0.9, FBM_OPTIONS) !== expected) {
      disagreements.push('Array.from().reduce')
    }
  }
  return disagreements.length === 0
    ? 'all three fbm2D spellings agree bit-for-bit over 1024 coordinates'
    : `DISAGREE: ${[...new Set(disagreements)].join(', ')} — the ratios below are meaningless`
}

// ---------------------------------------------------------------------------
// Workloads — the passes generateChunk runs, in the order it runs them
// ---------------------------------------------------------------------------

const surfaceOnly = (): void => {
  const coord = nextCoord()
  let total = 0
  for (let lx = 0; lx < CHUNK_SIZE_XZ; lx += 1) {
    for (let lz = 0; lz < CHUNK_SIZE_XZ; lz += 1) {
      total += surfaceHeightAt(SEED, worldX(coord, lx), worldZ(coord, lz))
    }
  }
  sink += total
}

const climateOnly = (): void => {
  const coord = nextCoord()
  let total = 0
  for (let lx = 0; lx < CHUNK_SIZE_XZ; lx += 1) {
    for (let lz = 0; lz < CHUNK_SIZE_XZ; lz += 1) {
      total += climateAt(SEED, worldX(coord, lx), worldZ(coord, lz)).temperature
    }
  }
  sink += total
}

/**
 * The carve pass alone, over buffers generated once before timing starts.
 *
 * Read the caveat, because this number is a LOWER BOUND and not the carve
 * cost. `carveCaves` mutates in place and `generateChunk` already carves, so
 * these buffers are re-carved: `computeWaterFloorYs` still scans every column,
 * and the density field is still evaluated per column, but the inner writes
 * mostly find air where they would have found stone and skip. The scan and the
 * noise — which is where the time goes — are unchanged; the writes are not.
 *
 * Generating a fresh chunk inside the timed call instead would have measured
 * generation plus carving and called it carving, which is worse.
 */
const CARVE_POOL_SIZE = 32

const carvePool: ReadonlyArray<{ readonly coord: ChunkCoord; readonly blocks: Uint8Array }> = Array.from(
  { length: CARVE_POOL_SIZE },
  (_unused, index) => {
    const coord = coordFor(index)
    const blocks = emptyBlocks()
    blocks.set(generateChunk(SEED, coord, { decorate: false }).blocks)
    return { coord, blocks }
  },
)

let carveCursor = 0

const carveOnly = (): void => {
  carveCursor = (carveCursor + 1) % CARVE_POOL_SIZE
  const entry = carvePool[carveCursor]
  if (entry === undefined) {
    return
  }
  carveCaves(entry.blocks, SEED, entry.coord, {})
  sink += entry.blocks[0] ?? 0
}

const options = (iterations: number, warmupIterations = iterations): MeasureOptions => ({
  iterations,
  warmupIterations,
  runs: RUNS,
})

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const main = async (): Promise<number> => {
  const tolerances = tolerancesFrom(process.argv)

  console.log('mc-worldgen benchmark — median of 9 timed runs after warmup, per the reference implementation\n')
  console.log(`  seed:              ${String(SEED)} (constant; check:deps bans every clock read repository-wide)`)
  console.log(`  chunk:             ${String(CHUNK_SIZE_XZ)} x ${String(CHUNK_SIZE_XZ)} x 256, sea level ${String(DEFAULT_TERRAIN_LEVELS.seaLevel)}`)
  console.log(`  load-time framing: x81 chunks at renderDistance=4`)
  console.log(`  distinct coords:   each timed call generates a different chunk (the reference's rule)\n`)
  console.log(`  equivalence check: ${fbmEquivalence()}\n`)

  const shippedFbmMs = measure(fbmArm(fbm2D), options(3, 6))
  const frozenFbmMs = measure(fbmArm(fbm2DFrozen), options(3, 6))
  const foldFbmMs = measure(fbmArm(fbm2DArrayReduce), options(3, 6))

  const guards: ReadonlyArray<Guard> = [
    {
      name: 'fbm-octave-loop/shipped-vs-frozen-imperative',
      regression: 'the plan.md §5.2 octave exception restated in domain/seeded-random.ts',
      fastLabel: 'fbm2D (shipped)',
      slowLabel: 'frozen let + for copy',
      fastMs: shippedFbmMs,
      slowMs: frozenFbmMs,
      tolerance: SHIPPED_VS_FROZEN_TOLERANCE,
    },
    {
      name: 'fbm-octave-loop/array-from-reduce-vs-imperative',
      regression: 'the plan.md §5.2 octave exception restated in domain/seeded-random.ts',
      fastLabel: 'let + for',
      slowLabel: 'Array.from().reduce',
      fastMs: shippedFbmMs,
      slowMs: foldFbmMs,
    },
  ]

  console.log('the octave exception of domain/seeded-random.ts, as A/B ratios — machine-independent:\n')
  for (const guard of guards) {
    console.log(formatGuard(guard))
  }
  console.log('')

  const yardstickMs = measure(yardstick, options(400, 800))

  const workloads: ReadonlyArray<Workload> = [
    {
      name: 'sample/surfaceHeightAt-per-chunk-columns',
      msPerUnit: measure(surfaceOnly, options(40, 80)),
      unit: 'chunk',
      detail: `${String(COLUMNS_PER_CHUNK)} columns x 4-octave continentalness`,
    },
    {
      name: 'sample/climateAt-per-chunk-columns',
      msPerUnit: measure(climateOnly, options(40, 80)),
      unit: 'chunk',
      detail: `${String(COLUMNS_PER_CHUNK)} columns x 2 channels x 3 octaves`,
    },
    {
      name: 'generateChunk/no-decorate',
      msPerUnit: measure(() => {
        sink += generateChunk(SEED, nextCoord(), { decorate: false }).blocks[0] ?? 0
      }, options(40, 80)),
      unit: 'chunk',
      detail: 'height + biome + column fill + carve; carving is not optional in generateChunk',
    },
    {
      name: 'carveCaves/re-carve-warm-buffer',
      msPerUnit: measure(carveOnly, options(30, 60)),
      unit: 'chunk',
      detail: 'LOWER BOUND on the carve pass — scan and noise are full cost, writes are not',
    },
    {
      name: 'generateChunk/full',
      msPerUnit: measure(() => {
        sink += generateChunk(SEED, nextCoord()).blocks[0] ?? 0
      }, options(30, 60)),
      unit: 'chunk',
      detail: 'the reference implementation\'s generateTerrainBlocks equivalent',
    },
  ]

  console.log('end-to-end workloads — absolute figures are indicative only (see harness header):\n')
  console.log(`  ${'yardstick/hash-and-smoothstep'.padEnd(44)} ${yardstickMs.toFixed(4)} ms/pass`)
  for (const workload of workloads) {
    console.log(formatWorkload(workload))
  }
  console.log('')

  if (wantsBaselineUpdate(process.argv)) {
    const recorded: Baseline = {
      version: 1,
      recordedOn: process.env['BENCH_MACHINE'] ?? 'unrecorded machine',
      note:
        'guards are slow/fast A/B ratios measured in one process and are machine-independent; ' +
        'workloads are workload/yardstick ratios and are only approximately so. ' +
        'Regenerate with `pnpm bench --update-baseline` and say in the commit message what moved and why.',
      guards: Object.fromEntries(guards.map((guard) => [guard.name, Number(guardRatio(guard).toPrecision(4))])),
      workloads: Object.fromEntries(
        workloads.map((workload) => [workload.name, Number((workload.msPerUnit / yardstickMs).toPrecision(4))]),
      ),
    }
    await writeBaseline(BASELINE_PATH, recorded)
    console.log(`baseline written to scripts/bench-baseline.json  (sink ${sink.toFixed(3)})`)
    return 0
  }

  const baseline = await readBaseline(BASELINE_PATH)
  const results = [
    ...checkGuards(guards, baseline, tolerances.guard),
    ...checkWorkloads(workloads, yardstickMs, baseline, tolerances.workload),
  ]

  console.log(
    `baseline comparison (guard tolerance ${tolerances.guard.toFixed(2)}x, ` +
      `workload tolerance ${tolerances.workload.toFixed(2)}x):\n`,
  )
  for (const result of results) {
    console.log(formatCheck(result))
  }
  console.log('')

  const regressed = results.filter((result) => result.status === 'regressed')
  if (regressed.length > 0) {
    console.error(`${String(regressed.length)} regression(s) against scripts/bench-baseline.json.`)
    console.error('If the change is intended, re-record with `pnpm bench --update-baseline`.')
    return 1
  }

  console.log(`no regressions  (sink ${sink.toFixed(3)})`)
  return 0
}

process.exit(await main())
