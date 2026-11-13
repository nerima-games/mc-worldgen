/**
 * Reproducible WG2 before/after profile. Run with:
 * `node --expose-gc --import tsx scripts/wg2-profile.ts <before-root> <after-root> [output-dir]`.
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const SEED_BASE = 20260726
const SEED_STEP = 104729
const SEED_COUNT = 100
const CHUNK_VOLUME_MINIMUM = 1
const BIOME_COUNT_MINIMUM = 1
const PROFILE_CHUNK_COORDINATES = [
  { cx: -2, cz: -2 },
  { cx: -1, cz: -2 },
  { cx: -2, cz: -1 },
  { cx: -1, cz: -1 },
] as const
const IMAGE_SEED = SEED_BASE
const IMAGE_CHUNK_RADIUS = 2
const IMAGE_CHUNK_MIN = -IMAGE_CHUNK_RADIUS
const IMAGE_CHUNK_MAX = IMAGE_CHUNK_RADIUS
const HEIGHT_PERCENTILE = 0.95
const TIMING_WARMUP_PAIRS = 2
const TIMING_MEASURED_PAIRS = 15
const TIMING_BATCH = [
  { seed: SEED_BASE, cx: -2, cz: -2 },
  { seed: SEED_BASE, cx: -1, cz: -2 },
  { seed: SEED_BASE + SEED_STEP, cx: -2, cz: -1 },
  { seed: SEED_BASE + SEED_STEP, cx: -1, cz: -1 },
] as const
const PROFILE_OUTPUT_DIRECTORY = 'artifacts/wg2-profile/'

type ChunkCoordinate = Readonly<{ cx: number; cz: number }>
type ChunkData = Readonly<{ blocks: Uint16Array; biomes: ReadonlyArray<string> }>
type TerrainModule = Readonly<{
  generateChunk: (seed: number, coordinate: ChunkCoordinate, options?: Readonly<{ decorate?: boolean }>) => unknown
}>
type ConstantsModule = Readonly<{
  BEDROCK_Y: number
  CHUNK_HEIGHT: number
  CHUNK_SIZE_XZ: number
  blockIndex: (x: number, y: number, z: number) => number
}>
type BiomeModule = Readonly<{ BLOCK: Readonly<Record<string, number>> }>
type Worldgen = Readonly<{
  terrain: TerrainModule
  constants: ConstantsModule
  blocks: BiomeModule['BLOCK']
}>
type SampleChunk = Readonly<{
  readonly seed: number
  readonly cx: number
  readonly cz: number
  readonly chunk: ChunkData
}>
type Profile = Readonly<{
  readonly surfaceHeights: ReadonlyArray<number>
  readonly biomeCounts: Readonly<Record<string, number>>
  readonly chunkCount: number
}>
type SurfaceMetrics = Readonly<{ min: number; median: number; p95: number; max: number }>
type TimingSample = Readonly<{ milliseconds: number; signature: string }>
type SourceIdentity = Readonly<{ commitSha: string; sourceTreeHash: string }>

const sourceIdentity = (root: string): SourceIdentity => {
  const dirtyTrackedFiles = execFileSync(
    'git',
    ['-C', root, 'status', '--porcelain', '--untracked-files=no'],
    { encoding: 'utf8' },
  )
  if (dirtyTrackedFiles.length > 0) {
    throw new Error(`cannot identify a dirty tracked source tree: ${root}`)
  }

  const commitSha = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  const treeEntries = execFileSync('git', ['-C', root, 'ls-tree', '-r', '-z', 'HEAD'], { encoding: 'utf8' })
  const hash = createHash('sha256')

  for (const entry of treeEntries.split('\0').sort()) {
    if (entry.length === 0) {
      continue
    }
    const separator = entry.indexOf('\t')
    const metadata = entry.slice(0, separator)
    const path = entry.slice(separator + 1)
    if (!path.startsWith(PROFILE_OUTPUT_DIRECTORY)) {
      hash.update(metadata).update('\t').update(path).update('\0')
    }
  }

  return { commitSha, sourceTreeHash: hash.digest('hex') }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const unwrapResult = <Value>(value: unknown, context: string): Value => {
  if (isRecord(value) && value['_tag'] === 'Failure' && 'failure' in value) {
    throw new Error(`${context} failed: ${String(value['failure'])}`)
  }
  if (isRecord(value) && value['_tag'] === 'Success' && 'success' in value) {
    return value['success'] as Value
  }
  throw new TypeError(`${context} did not return an Effect Result`)
}

const loadWorldgen = async (root: string): Promise<Worldgen> => {
  const terrainPath = resolve(root, 'src/domain/terrain.ts')
  const constantsPath = resolve(root, 'src/domain/constants.ts')
  const biomePath = resolve(root, 'src/domain/biome.ts')
  await Promise.all([terrainPath, constantsPath, biomePath].map((path) => stat(path)))
  const [terrain, constants, biome] = await Promise.all([
    import(pathToFileURL(terrainPath).href) as Promise<TerrainModule>,
    import(pathToFileURL(constantsPath).href) as Promise<ConstantsModule>,
    import(pathToFileURL(biomePath).href) as Promise<BiomeModule>,
  ])
  return { terrain, constants, blocks: biome.BLOCK }
}

const checkedChunk = (worldgen: Worldgen, seed: number, coordinate: ChunkCoordinate, decorate: boolean): ChunkData => {
  const generated = unwrapResult<unknown>(
    worldgen.terrain.generateChunk(seed, coordinate, { decorate }),
    `generateChunk(${String(seed)}, ${String(coordinate.cx)}, ${String(coordinate.cz)})`,
  )
  if (!isRecord(generated)) {
    throw new TypeError('generated chunk must contain a Uint16Array of blocks and a biome array')
  }
  const blocks = generated['blocks']
  const biomes = generated['biomes']
  if (!(blocks instanceof Uint16Array) || !Array.isArray(biomes)) {
    throw new TypeError('generated chunk must contain a Uint16Array of blocks and a biome array')
  }
  if (blocks.length < CHUNK_VOLUME_MINIMUM || biomes.length < BIOME_COUNT_MINIMUM) {
    throw new Error('generated chunk output must not be empty')
  }
  return { blocks, biomes: biomes as ReadonlyArray<string> }
}

const surfaceHeight = (worldgen: Worldgen, blocks: Uint16Array, lx: number, lz: number): number => {
  const { BEDROCK_Y, CHUNK_HEIGHT, blockIndex } = worldgen.constants
  const { AIR, BEDROCK, ICE, LEAVES, LOG, WATER } = worldgen.blocks
  for (let y = CHUNK_HEIGHT - 1; y > BEDROCK_Y; y -= 1) {
    const id = blocks[blockIndex(lx, y, lz)]
    if (id !== AIR && id !== BEDROCK && id !== WATER && id !== ICE && id !== LOG && id !== LEAVES) {
      return y
    }
  }
  return BEDROCK_Y + 1
}

const summarizeWorld = (worldgen: Worldgen): Profile => {
  const size = worldgen.constants.CHUNK_SIZE_XZ
  const heights: Array<number> = []
  const biomes = new Map<string, number>()

  for (let seedIndex = 0; seedIndex < SEED_COUNT; seedIndex += 1) {
    const seed = SEED_BASE + seedIndex * SEED_STEP
    for (const coordinate of PROFILE_CHUNK_COORDINATES) {
      const chunk = checkedChunk(worldgen, seed, coordinate, false)
      if (chunk.biomes.length !== size * size) {
        throw new Error(`expected ${String(size * size)} biome entries, got ${String(chunk.biomes.length)}`)
      }
      for (let lx = 0; lx < size; lx += 1) {
        for (let lz = 0; lz < size; lz += 1) {
          heights.push(surfaceHeight(worldgen, chunk.blocks, lx, lz))
          const biome = chunk.biomes[lz * size + lx]
          if (typeof biome !== 'string' || biome.length === 0) {
            throw new Error('generated biome entries must be non-empty strings')
          }
          biomes.set(biome, (biomes.get(biome) ?? 0) + 1)
        }
      }
    }
  }

  return {
    biomeCounts: Object.fromEntries([...biomes.entries()].sort(([left], [right]) => left.localeCompare(right))),
    chunkCount: SEED_COUNT * PROFILE_CHUNK_COORDINATES.length,
    surfaceHeights: heights,
  }
}

const median = (values: ReadonlyArray<number>): number => {
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  const lower = sorted[middle - 1]
  const upper = sorted[middle]
  if (sorted.length === 0 || lower === undefined || upper === undefined) {
    throw new Error('cannot compute metrics from an empty sample')
  }
  return sorted.length % 2 === 0 ? (lower + upper) / 2 : upper
}

const metrics = (values: ReadonlyArray<number>): SurfaceMetrics => {
  if (values.length === 0) {
    throw new Error('cannot compute surface metrics from an empty sample')
  }
  const sorted = [...values].sort((left, right) => left - right)
  const first = sorted[0]
  const last = sorted.at(-1)
  const p95 = sorted[Math.ceil(HEIGHT_PERCENTILE * sorted.length) - 1]
  if (first === undefined || last === undefined || p95 === undefined) {
    throw new Error('surface metric sample unexpectedly became empty')
  }
  return { max: last, median: median(sorted), min: first, p95 }
}

const representativeRegion = (worldgen: Worldgen): ReadonlyArray<SampleChunk> => {
  const chunks: Array<SampleChunk> = []
  for (let cx = IMAGE_CHUNK_MIN; cx < IMAGE_CHUNK_MAX; cx += 1) {
    for (let cz = IMAGE_CHUNK_MIN; cz < IMAGE_CHUNK_MAX; cz += 1) {
      chunks.push({
        seed: IMAGE_SEED,
        cx,
        cz,
        chunk: checkedChunk(worldgen, IMAGE_SEED, { cx, cz }, false),
      })
    }
  }
  if (chunks.length !== (IMAGE_CHUNK_MAX - IMAGE_CHUNK_MIN) ** 2) {
    throw new Error('representative SVG region was not fully sampled')
  }
  return chunks.map(({ chunk, ...location }) => ({ ...location, chunk: { ...chunk, biomes: [...chunk.biomes] } }))
}

const regionGrid = (worldgen: Worldgen, chunks: ReadonlyArray<SampleChunk>): Readonly<{
  width: number
  heights: ReadonlyArray<number>
  biomes: ReadonlyArray<string>
}> => {
  const chunkSize = worldgen.constants.CHUNK_SIZE_XZ
  const chunksPerAxis = IMAGE_CHUNK_MAX - IMAGE_CHUNK_MIN
  const width = chunkSize * chunksPerAxis
  const heights = new Array<number>(width * width)
  const biomes = new Array<string>(width * width)
  for (const { cx, cz, chunk } of chunks) {
    const chunkX = (cx - IMAGE_CHUNK_MIN) * chunkSize
    const chunkZ = (cz - IMAGE_CHUNK_MIN) * chunkSize
    for (let lx = 0; lx < chunkSize; lx += 1) {
      for (let lz = 0; lz < chunkSize; lz += 1) {
        const x = chunkX + lx
        const z = chunkZ + lz
        const index = z * width + x
        heights[index] = surfaceHeight(worldgen, chunk.blocks, lx, lz)
        const biome = chunk.biomes[lz * chunkSize + lx]
        if (typeof biome !== 'string') {
          throw new Error('representative region contains an invalid biome')
        }
        biomes[index] = biome
      }
    }
  }
  return { width, heights, biomes }
}

const biomeColor = (biome: string): string => {
  let hash = 2166136261
  for (let index = 0; index < biome.length; index += 1) {
    hash = Math.imul(hash ^ biome.charCodeAt(index), 16777619)
  }
  const hue = (hash >>> 0) % 360
  return `hsl(${String(hue)} 48% 62%)`
}

const topDownSvg = (
  profile: ReturnType<typeof regionGrid>,
  x: number,
  y: number,
  title: string,
  cellSize: number,
): string => {
  const cells: Array<string> = []
  const biomeIds = [...new Set(profile.biomes)].sort((left, right) => left.localeCompare(right))
  for (let z = 0; z < profile.width; z += 1) {
    for (let wx = 0; wx < profile.width; wx += 1) {
      const biome = profile.biomes[z * profile.width + wx]
      if (biome === undefined) {
        throw new Error('top-down SVG input contains an empty cell')
      }
      cells.push(`<rect x="${String(x + wx * cellSize)}" y="${String(y + z * cellSize)}" width="${String(cellSize)}" height="${String(cellSize)}" fill="${biomeColor(biome)}"/>`)
    }
  }
  const legendX = x + profile.width * cellSize + 12
  const legend = biomeIds.map((biome, index) => {
    const rowY = y + index * 16
    return `<rect x="${String(legendX)}" y="${String(rowY)}" width="10" height="10" fill="${biomeColor(biome)}"/><text x="${String(legendX + 15)}" y="${String(rowY + 9)}" font-size="11">${biome}</text>`
  })
  return `<text x="${String(x)}" y="${String(y - 16)}" class="title">${title}</text>${cells.join('')}${legend.join('')}`
}

const crossSectionSvg = (
  profile: ReturnType<typeof regionGrid>,
  x: number,
  y: number,
  width: number,
  height: number,
  chunkHeight: number,
  title: string,
): string => {
  const middleZ = Math.floor(profile.width / 2)
  const points: Array<string> = []
  for (let wx = 0; wx < profile.width; wx += 1) {
    const surfaceY = profile.heights[middleZ * profile.width + wx]
    if (surfaceY === undefined) {
      throw new Error('cross-section SVG input contains an empty column')
    }
    const plotY = y + height - (surfaceY / chunkHeight) * height
    points.push(`${String(x + (wx / (profile.width - 1)) * width)},${String(plotY)}`)
  }
  const first = points[0]
  const last = points.at(-1)
  if (first === undefined || last === undefined) {
    throw new Error('cross-section SVG requires at least one point')
  }
  const baseline = y + height
  return `<text x="${String(x)}" y="${String(y - 16)}" class="title">${title}</text><path d="M ${first} L ${points.slice(1).join(' L ')} L ${String(x + width)},${String(baseline)} L ${String(x)},${String(baseline)} Z" fill="#789977" stroke="#263b32" stroke-width="2"/>`
}

const comparisonSvg = (
  before: ReadonlyArray<SampleChunk>,
  after: ReadonlyArray<SampleChunk>,
  beforeWorld: Worldgen,
  afterWorld: Worldgen,
): string => {
  const beforeGrid = regionGrid(beforeWorld, before)
  const afterGrid = regionGrid(afterWorld, after)
  const cellSize = 6
  const gridPixels = beforeGrid.width * cellSize
  const panelLeft = 48
  const panelRight = 646
  const topY = 102
  const chartY = 570
  const chartWidth = gridPixels
  const chartHeight = 150
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 760">',
    '<style>text{font-family:system-ui,sans-serif;fill:#1e2933}.title{font-size:17px;font-weight:650}.subtitle{font-size:13px}</style>',
    '<rect width="1200" height="760" fill="#f8fafc"/>',
    '<text x="48" y="38" class="title">WG2 terrain profile · top-down biome map and center cross-section</text>',
    `<text x="48" y="65" class="subtitle">Seed ${String(IMAGE_SEED)} · chunks (${String(IMAGE_CHUNK_MIN)},${String(IMAGE_CHUNK_MIN)}) through (${String(IMAGE_CHUNK_MAX - 1)},${String(IMAGE_CHUNK_MAX - 1)})</text>`,
    topDownSvg(beforeGrid, panelLeft, topY, 'Before · biome ids', cellSize),
    topDownSvg(afterGrid, panelRight, topY, 'After · biome ids', cellSize),
    crossSectionSvg(beforeGrid, panelLeft, chartY, chartWidth, chartHeight, beforeWorld.constants.CHUNK_HEIGHT, 'Before · surface Y'),
    crossSectionSvg(afterGrid, panelRight, chartY, chartWidth, chartHeight, afterWorld.constants.CHUNK_HEIGHT, 'After · surface Y'),
    '<text x="48" y="748" class="subtitle">Top-down colors are deterministic biome labels; cross-sections scan generated blocks and omit water, ice, logs, leaves, and bedrock.</text>',
    '</svg>',
  ].join('\n')
}

const hashChunks = (chunks: ReadonlyArray<ChunkData>): string => {
  const hash = createHash('sha256')
  let blockCount = 0
  let biomeCount = 0
  for (const chunk of chunks) {
    blockCount += chunk.blocks.length
    biomeCount += chunk.biomes.length
    hash.update(Buffer.from(chunk.blocks.buffer, chunk.blocks.byteOffset, chunk.blocks.byteLength))
    hash.update(JSON.stringify(chunk.biomes))
  }
  if (blockCount === 0 || biomeCount === 0) {
    throw new Error('timing arm produced an empty chunk batch')
  }
  return hash.digest('hex')
}

const globalGc = (): (() => void) => {
  const gc = Reflect.get(globalThis, 'gc')
  if (typeof gc !== 'function') {
    throw new Error('run Node with --expose-gc to use the paired WG2 timing protocol')
  }
  return () => {
    Reflect.apply(gc, globalThis, [])
  }
}

const timeArm = (worldgen: Worldgen, gc: () => void): TimingSample => {
  gc()
  const start = performance.now()
  const chunks = TIMING_BATCH.map(({ seed, cx, cz }) => checkedChunk(worldgen, seed, { cx, cz }, true))
  const milliseconds = performance.now() - start
  const signature = hashChunks(chunks)
  return { milliseconds, signature }
}

const assertStableSignature = (expected: Map<string, string>, label: string, signature: string): void => {
  if (signature.length === 0) {
    throw new Error(`${label} output hash must not be empty`)
  }
  const previous = expected.get(label)
  if (previous !== undefined && previous !== signature) {
    throw new Error(`${label} produced different output hashes for the fixed timing batch`)
  }
  expected.set(label, signature)
}

const pairedTiming = (before: Worldgen, after: Worldgen): Readonly<{
  readonly aaNoiseFloor: Readonly<{ medianAbsoluteDifferenceMs: number; p95AbsoluteDifferenceMs: number; secondArmWins: number }>
  readonly ab: Readonly<{
    medianAfterMinusBeforeMs: number
    medianBeforeBatchMs: number
    medianAfterBatchMs: number
    medianBeforePerChunkMs: number
    medianAfterPerChunkMs: number
    afterWins: number
    measuredPairs: number
  }>
}> => {
  const gc = globalGc()
  const stable = new Map<string, string>()
  for (let pair = 0; pair < TIMING_WARMUP_PAIRS; pair += 1) {
    const first = timeArm(before, gc)
    const second = timeArm(before, gc)
    assertStableSignature(stable, 'before', first.signature)
    assertStableSignature(stable, 'before', second.signature)
  }

  const aaDifferences: Array<number> = []
  for (let pair = 0; pair < TIMING_MEASURED_PAIRS; pair += 1) {
    const first = timeArm(before, gc)
    const second = timeArm(before, gc)
    assertStableSignature(stable, 'before', first.signature)
    assertStableSignature(stable, 'before', second.signature)
    if (first.signature !== second.signature) {
      throw new Error('A/A pair output hashes must match')
    }
    aaDifferences.push(second.milliseconds - first.milliseconds)
  }

  for (let pair = 0; pair < TIMING_WARMUP_PAIRS; pair += 1) {
    const firstIsBefore = pair % 2 === 0
    const first = timeArm(firstIsBefore ? before : after, gc)
    const second = timeArm(firstIsBefore ? after : before, gc)
    assertStableSignature(stable, firstIsBefore ? 'before' : 'after', first.signature)
    assertStableSignature(stable, firstIsBefore ? 'after' : 'before', second.signature)
  }

  const abDifferences: Array<number> = []
  const beforeTimes: Array<number> = []
  const afterTimes: Array<number> = []
  let afterWins = 0
  for (let pair = 0; pair < TIMING_MEASURED_PAIRS; pair += 1) {
    const firstIsBefore = pair % 2 === 0
    const first = timeArm(firstIsBefore ? before : after, gc)
    const second = timeArm(firstIsBefore ? after : before, gc)
    const beforeSample = firstIsBefore ? first : second
    const afterSample = firstIsBefore ? second : first
    assertStableSignature(stable, 'before', beforeSample.signature)
    assertStableSignature(stable, 'after', afterSample.signature)
    beforeTimes.push(beforeSample.milliseconds)
    afterTimes.push(afterSample.milliseconds)
    if (afterSample.milliseconds < beforeSample.milliseconds) {
      afterWins += 1
    }
    abDifferences.push(afterSample.milliseconds - beforeSample.milliseconds)
  }

  const absoluteNoise = aaDifferences.map(Math.abs).sort((left, right) => left - right)
  const p95Index = Math.ceil(HEIGHT_PERCENTILE * absoluteNoise.length) - 1
  const p95AbsoluteDifferenceMs = absoluteNoise[p95Index]
  if (p95AbsoluteDifferenceMs === undefined) {
    throw new Error('A/A timing sample unexpectedly became empty')
  }
  return {
    aaNoiseFloor: {
      medianAbsoluteDifferenceMs: median(absoluteNoise),
      p95AbsoluteDifferenceMs,
      secondArmWins: aaDifferences.filter((difference) => difference < 0).length,
    },
    ab: {
      afterWins,
      medianAfterMinusBeforeMs: median(abDifferences),
      medianBeforeBatchMs: median(beforeTimes),
      medianAfterBatchMs: median(afterTimes),
      medianBeforePerChunkMs: median(beforeTimes) / TIMING_BATCH.length,
      medianAfterPerChunkMs: median(afterTimes) / TIMING_BATCH.length,
      measuredPairs: TIMING_MEASURED_PAIRS,
    },
  }
}

const reportProfile = (profile: Profile): Readonly<{
  readonly chunkCount: number
  readonly columnCount: number
  readonly surfaceHeights: SurfaceMetrics
  readonly biomeCounts: Readonly<Record<string, number>>
}> => ({
  biomeCounts: profile.biomeCounts,
  chunkCount: profile.chunkCount,
  columnCount: profile.surfaceHeights.length,
  surfaceHeights: metrics(profile.surfaceHeights),
})

const main = async (): Promise<void> => {
  const args = process.argv.slice(2)
  if (args[0] === '--identity') {
    process.stdout.write(`${JSON.stringify(sourceIdentity(resolve(args[1] ?? '.')), null, 2)}\n`)
    return
  }

  const [beforeRootArg, afterRootArg, outputDirArg] = args
  if (!beforeRootArg || !afterRootArg || args.length > 3) {
    throw new Error('usage: node --expose-gc --import tsx scripts/wg2-profile.ts <before-root> <after-root> [output-dir]')
  }
  const outputDir = resolve(outputDirArg ?? 'wg2-profile-output')
  const beforeIdentity = sourceIdentity(resolve(beforeRootArg))
  const afterIdentity = sourceIdentity(resolve(afterRootArg))
  const [before, after] = await Promise.all([
    loadWorldgen(resolve(beforeRootArg)),
    loadWorldgen(resolve(afterRootArg)),
  ])

  const timing = pairedTiming(before, after)
  const afterIdentityAfterMeasurement = sourceIdentity(resolve(afterRootArg))
  if (
    afterIdentityAfterMeasurement.commitSha !== afterIdentity.commitSha ||
    afterIdentityAfterMeasurement.sourceTreeHash !== afterIdentity.sourceTreeHash
  ) {
    throw new Error('the after source tree changed during the performance measurement')
  }
  const [beforeProfile, afterProfile] = [summarizeWorld(before), summarizeWorld(after)]
  const [beforeRegion, afterRegion] = [representativeRegion(before), representativeRegion(after)]
  const svg = comparisonSvg(beforeRegion, afterRegion, before, after)
  const report = {
    biomeDistribution: {
      before: reportProfile(beforeProfile),
      after: reportProfile(afterProfile),
    },
    profileInputs: {
      chunkCoordinates: PROFILE_CHUNK_COORDINATES,
      seedBase: SEED_BASE,
      seedCount: SEED_COUNT,
      seedStep: SEED_STEP,
      columnsPerChunk: before.constants.CHUNK_SIZE_XZ ** 2,
      surfaceHeightMethod: 'highest generated non-water terrain block; excludes ice, logs, leaves, bedrock',
    },
    sourceIdentity: {
      before: beforeIdentity,
      after: afterIdentity,
      hashDescription: 'SHA-256 of sorted HEAD tree entries (mode, path, blob object ID), excluding artifacts/wg2-profile/',
    },
    timing: {
      armOutputHashesStable: true,
      batch: TIMING_BATCH,
      forceGcBeforeEveryArm: true,
      noiseFloor: timing.aaNoiseFloor,
      paired: timing.ab,
      protocol: {
        aaMeasuredPairs: TIMING_MEASURED_PAIRS,
        aaWarmupPairsExcluded: TIMING_WARMUP_PAIRS,
        abMeasuredPairs: TIMING_MEASURED_PAIRS,
        abOrder: 'alternating before/after, after/before',
        abWarmupPairsExcluded: TIMING_WARMUP_PAIRS,
        measuredDifference: 'after minus before, paired median; afterWins counts faster after arms',
        timedOperation: 'four generateChunk calls with decorate=true; block and biome hashing is outside the timed interval',
      },
    },
  }

  await mkdir(outputDir, { recursive: true })
  await Promise.all([
    writeFile(resolve(outputDir, 'wg2-profile.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8'),
    writeFile(resolve(outputDir, 'wg2-terrain-comparison.svg'), svg, 'utf8'),
  ])
  process.stdout.write(`${JSON.stringify({ ...report, outputDir }, null, 2)}\n`)
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exitCode = 1
})
