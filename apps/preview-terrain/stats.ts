/**
 * The numbers behind the picture.
 *
 * A dev application, not shipped API.
 *
 * ---------------------------------------------------------------------------
 * Why a preview needs a report mode
 * ---------------------------------------------------------------------------
 *
 * "The terrain looks right" is not a finding. A screenshot cannot distinguish a
 * world with eight biomes from a world with three, cannot tell a hill from a
 * plateau clamped at `MAX_SURFACE_Y`, and cannot show that a chunk border is
 * seamless — it can only show that no seam happened to be in frame.
 *
 * Every number below is the measurable form of one of the six checks
 * docs/testing.md §3 asks the preview to support, so that `pnpm preview --stats`
 * either agrees with what the eye sees or contradicts it. When it contradicts
 * it, the eye is wrong.
 *
 * ---------------------------------------------------------------------------
 * Two scans, because one window cannot answer both kinds of question
 * ---------------------------------------------------------------------------
 *
 * The continentalness field is sampled at frequency 1/180, so ONE terrain
 * feature is 180 blocks across. A dense 384 × 384 survey therefore spans about
 * two features and, at the lowest octave, touches roughly nine lattice points.
 * Any distribution read off it — "what fraction of the world is ocean", "which
 * biomes are reachable" — is a description of those nine points and not of the
 * generator. The first version of this report made exactly that mistake.
 *
 * So there are two scans and they are labelled:
 *
 *   SURVEY — sparse and wide (default: every 16th block over 8192 blocks). Used
 *            for every distribution: heights, climate, biome mix. Strided
 *            sampling is fine here precisely because the field is smooth at
 *            this frequency.
 *
 *   LOCAL  — dense and small. Used for the two things that need adjacency and
 *            are meaningless when strided: chunk seams (needs neighbouring
 *            columns) and tree spacing (needs every candidate column).
 *
 * These are diagnostics, not tests: they print, they do not assert. Anything
 * here that turns out to pin a real invariant belongs in `test/`, where it can
 * fail the build.
 */
import type { BiomeType } from '../../domain/biome'
import { BIOMES, BLOCK } from '../../domain/biome'
import { CAVE_CEILING_Y, CAVE_FLOOR_Y } from '../../domain/carver'
import { blockIndex, CHUNK_HEIGHT, CHUNK_SIZE_XZ, WATER_FLOOR_MARGIN } from '../../domain/constants'
import { readBlock } from '../../domain/chunk'
import {
  climateAt,
  CONTINENTALNESS_CONTRAST,
  MAX_SURFACE_Y,
  MIN_SURFACE_Y,
  surfaceHeightAt,
} from '../../domain/terrain'
import { channelSeed, fbm2D } from '../../domain/seeded-random'
import { TREE_GRID_SIZE } from '../../domain/tree-placement'
import { chunkFor, sampleColumn, type ChunkCache, type WorldParams } from './sampler'

export type StatsOptions = {
  /** SURVEY: side length in blocks of the wide, strided distribution scan. */
  readonly surveySpan: number
  /** SURVEY: blocks between samples. */
  readonly surveyStride: number
  /** LOCAL: side length in blocks of the dense adjacency scan. */
  readonly columnSpan: number
  /** Side length in chunks of the square of chunks generated for the block report. */
  readonly chunkSpan: number
  readonly originX: number
  readonly originZ: number
}

/** The continentalness sampling frequency in `surfaceHeightAt`, as a wavelength. */
const CONTINENTALNESS_WAVELENGTH = 180

const percent = (part: number, whole: number): string =>
  whole === 0 ? '  n/a' : `${(100 * (part / whole)).toFixed(1).padStart(5, ' ')}%`

const fixed = (value: number, digits = 1): string => value.toFixed(digits)

const quantile = (sorted: ReadonlyArray<number>, fraction: number): number => {
  if (sorted.length === 0) {
    return 0
  }
  const index = Math.max(0, Math.min(sorted.length - 1, Math.floor(fraction * (sorted.length - 1))))
  return sorted[index] ?? 0
}

const bar = (fraction: number, width = 24): string => {
  const filled = Math.max(0, Math.min(width, Math.round(fraction * width)))
  return '#'.repeat(filled) + '.'.repeat(width - filled)
}

const describeSpread = (values: ReadonlyArray<number>, digits = 3): string => {
  const sorted = [...values].sort((left, right) => left - right)
  return (
    `range ${fixed(quantile(sorted, 0), digits)}..${fixed(quantile(sorted, 1), digits)}` +
    `   p5 ${fixed(quantile(sorted, 0.05), digits)}` +
    `   p50 ${fixed(quantile(sorted, 0.5), digits)}` +
    `   p95 ${fixed(quantile(sorted, 0.95), digits)}`
  )
}

const rawContinentalness = (seed: number, wx: number, wz: number): number =>
  fbm2D(channelSeed(seed, 'continentalness'), wx, wz, {
    octaves: 4,
    frequency: 1 / CONTINENTALNESS_WAVELENGTH,
    persistence: 0.5,
  })

// ---------------------------------------------------------------------------
// SURVEY: sparse and wide. Distributions only.
// ---------------------------------------------------------------------------

const surveyReport = (params: WorldParams, options: StatsOptions): ReadonlyArray<string> => {
  const heights: Array<number> = []
  const continentalness: Array<number> = []
  const temperatures: Array<number> = []
  const humidities: Array<number> = []
  const biomeCounts = new Map<BiomeType, number>()
  let submerged = 0
  let pinnedHigh = 0
  let pinnedLow = 0

  const stride = Math.max(1, Math.floor(options.surveyStride))

  for (let dz = 0; dz < options.surveySpan; dz += stride) {
    for (let dx = 0; dx < options.surveySpan; dx += stride) {
      const wx = options.originX + dx - Math.floor(options.surveySpan / 2)
      const wz = options.originZ + dz - Math.floor(options.surveySpan / 2)
      const sample = sampleColumn(params, wx, wz)
      const climate = climateAt(params.seed, wx, wz)

      heights.push(sample.surfaceY)
      continentalness.push(rawContinentalness(params.seed, wx, wz))
      temperatures.push(climate.temperature)
      humidities.push(climate.humidity)
      biomeCounts.set(sample.biome, (biomeCounts.get(sample.biome) ?? 0) + 1)

      if (sample.submerged) {
        submerged += 1
      }
      if (sample.surfaceY >= MAX_SURFACE_Y) {
        pinnedHigh += 1
      }
      if (sample.surfaceY <= MIN_SURFACE_Y) {
        pinnedLow += 1
      }
    }
  }

  const total = heights.length
  const mean = total === 0 ? 0 : heights.reduce((sum, value) => sum + value, 0) / total
  const features = Math.round(options.surveySpan / CONTINENTALNESS_WAVELENGTH)

  const lines: Array<string> = []
  lines.push(
    `SURVEY — ${String(total)} columns, every ${String(stride)} blocks over ` +
      `${String(options.surveySpan)}x${String(options.surveySpan)} blocks ` +
      `(~${String(features)} continentalness features wide)`,
  )
  lines.push('')

  lines.push('surface height')
  lines.push(`  ${describeSpread(heights, 0)}   mean ${fixed(mean)}`)
  lines.push(
    `  shaper bounds MIN_SURFACE_Y=${String(MIN_SURFACE_Y)} MAX_SURFACE_Y=${String(MAX_SURFACE_Y)}` +
      `   sea level ${String(params.levels.seaLevel)}`,
  )
  lines.push(
    `  pinned at MAX_SURFACE_Y ${percent(pinnedHigh, total)}` +
      `   pinned at MIN_SURFACE_Y ${percent(pinnedLow, total)}` +
      `   total flat-clamped ${percent(pinnedHigh + pinnedLow, total)}`,
  )
  lines.push(`  below sea level ${percent(submerged, total)}`)
  lines.push('')

  const lowClamp = 0.5 - 0.5 / CONTINENTALNESS_CONTRAST
  const highClamp = 0.5 + 0.5 / CONTINENTALNESS_CONTRAST
  lines.push(`raw continentalness, before the CONTINENTALNESS_CONTRAST=${fixed(CONTINENTALNESS_CONTRAST, 1)} stretch`)
  lines.push(`  ${describeSpread(continentalness)}`)
  lines.push(
    `  the stretch clamps below ${fixed(lowClamp, 4)} to MIN_SURFACE_Y and above ${fixed(highClamp, 4)} to MAX_SURFACE_Y`,
  )
  lines.push('  domain/terrain.ts records a measured raw span of about [0.40, 0.72] clustering "hard around 0.5"')

  // The counterfactual the CONTINENTALNESS_CONTRAST comment rests on. It states
  // that mapping the raw field straight onto the height range gives "essentially
  // no ocean: 3% of columns fell below sea level". That is checkable from the
  // very samples above, so it is checked rather than believed.
  const unstretchedThreshold = (params.levels.seaLevel - MIN_SURFACE_Y) / (MAX_SURFACE_Y - MIN_SURFACE_Y)
  const unstretchedOcean = continentalness.filter((value) => value < unstretchedThreshold).length
  lines.push(
    `  counterfactual — with NO stretch, columns below sea level would be ${percent(unstretchedOcean, total)}` +
      `; domain/terrain.ts records 3%`,
  )
  lines.push('')

  lines.push('climate channels (the two inputs classifyBiome receives; NOT stretched)')
  lines.push(`  temperature  ${describeSpread(temperatures)}`)
  lines.push(`  humidity     ${describeSpread(humidities)}`)
  lines.push('  BIOME_RULES thresholds: SNOW t<0.20  TAIGA t<0.35  DESERT t>0.75 & h<0.30')
  lines.push('                          SAVANNA t>0.65 & h<0.50  FOREST h>0.55  else PLAINS')
  lines.push('')

  lines.push('biome mix')
  for (const biome of BIOMES) {
    const count = biomeCounts.get(biome) ?? 0
    lines.push(
      `  ${biome.padEnd(8, ' ')} ${percent(count, total)}  ${bar(total === 0 ? 0 : count / total)}`,
    )
  }
  lines.push(
    `  reachable biomes: ${String([...biomeCounts.keys()].length)} of ${String(BIOMES.length)}` +
      `   (OCEAN and BEACH are height overrides in biomeFor, not climate results)`,
  )

  return lines
}

// ---------------------------------------------------------------------------
// LOCAL: dense and small. Adjacency only.
// ---------------------------------------------------------------------------

/** Chebyshev distance from each tree to its nearest neighbour, via a coarse spatial hash. */
const nearestTreeSpacing = (
  trees: ReadonlyArray<readonly [number, number]>,
): ReadonlyArray<number> => {
  const bucketSize = 8
  const buckets = new Map<string, Array<readonly [number, number]>>()

  for (const tree of trees) {
    const key = `${String(Math.floor(tree[0] / bucketSize))},${String(Math.floor(tree[1] / bucketSize))}`
    const bucket = buckets.get(key)
    if (bucket === undefined) {
      buckets.set(key, [tree])
    } else {
      bucket.push(tree)
    }
  }

  const distances: Array<number> = []

  for (const tree of trees) {
    const bx = Math.floor(tree[0] / bucketSize)
    const bz = Math.floor(tree[1] / bucketSize)
    let nearest = Number.POSITIVE_INFINITY

    for (let dz = -1; dz <= 1; dz += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        for (const other of buckets.get(`${String(bx + dx)},${String(bz + dz)}`) ?? []) {
          if (other[0] === tree[0] && other[1] === tree[1]) {
            continue
          }
          nearest = Math.min(nearest, Math.max(Math.abs(other[0] - tree[0]), Math.abs(other[1] - tree[1])))
        }
      }
    }

    if (Number.isFinite(nearest)) {
      distances.push(nearest)
    }
  }

  return distances
}

/**
 * Largest group of trees joined by overlapping radius-2 crowns.
 *
 * The pairwise "within 4 blocks" count cannot tell two touching trees from a
 * thicket, and it is the thicket that becomes a walkable leaf slab. Union by
 * flood fill over a position set.
 */
const largestCanopyCluster = (trees: ReadonlyArray<readonly [number, number]>): number => {
  const key = (x: number, z: number): string => `${String(x)},${String(z)}`
  const remaining = new Set(trees.map((tree) => key(tree[0], tree[1])))
  const positions = new Map<string, readonly [number, number]>()
  for (const tree of trees) {
    positions.set(key(tree[0], tree[1]), tree)
  }

  let largest = 0

  for (const start of trees) {
    const startKey = key(start[0], start[1])
    if (!remaining.has(startKey)) {
      continue
    }

    const queue: Array<readonly [number, number]> = [start]
    remaining.delete(startKey)
    let size = 0

    while (queue.length > 0) {
      const current = queue.pop()
      if (current === undefined) {
        break
      }
      size += 1

      for (let dz = -4; dz <= 4; dz += 1) {
        for (let dx = -4; dx <= 4; dx += 1) {
          const neighbourKey = key(current[0] + dx, current[1] + dz)
          const neighbour = positions.get(neighbourKey)
          if (neighbour !== undefined && remaining.has(neighbourKey)) {
            remaining.delete(neighbourKey)
            queue.push(neighbour)
          }
        }
      }
    }

    largest = Math.max(largest, size)
  }

  return largest
}

const localReport = (params: WorldParams, options: StatsOptions): ReadonlyArray<string> => {
  const treePositions: Array<readonly [number, number]> = []
  const treesByBiome = new Map<BiomeType, number>()
  let trees = 0

  // Mean |Δheight| between horizontally adjacent columns, split by whether the
  // pair straddles a chunk boundary. Equal means seamless; a spike at the
  // boundary is the seam that position-absolute sampling exists to prevent.
  let borderDeltaSum = 0
  let borderDeltaCount = 0
  let interiorDeltaSum = 0
  let interiorDeltaCount = 0

  for (let dz = 0; dz < options.columnSpan; dz += 1) {
    for (let dx = 0; dx < options.columnSpan; dx += 1) {
      const wx = options.originX + dx
      const wz = options.originZ + dz
      const sample = sampleColumn(params, wx, wz)

      if (sample.hasTree) {
        trees += 1
        treePositions.push([wx, wz])
        treesByBiome.set(sample.biome, (treesByBiome.get(sample.biome) ?? 0) + 1)
      }

      const delta = Math.abs(sample.surfaceY - surfaceHeightAt(params.seed, wx + 1, wz))
      if (((((wx + 1) % CHUNK_SIZE_XZ) + CHUNK_SIZE_XZ) % CHUNK_SIZE_XZ) === 0) {
        borderDeltaSum += delta
        borderDeltaCount += 1
      } else {
        interiorDeltaSum += delta
        interiorDeltaCount += 1
      }
    }
  }

  const total = options.columnSpan * options.columnSpan
  const spacing = nearestTreeSpacing(treePositions)
  const sortedSpacing = [...spacing].sort((left, right) => left - right)
  const overlapping = spacing.filter((distance) => distance <= 4).length

  const lines: Array<string> = []
  lines.push(
    `LOCAL — dense ${String(options.columnSpan)}x${String(options.columnSpan)} blocks at ` +
      `(${String(options.originX)}, ${String(options.originZ)})`,
  )
  lines.push('')

  lines.push('chunk seams (mean |dY| between horizontally adjacent columns)')
  lines.push(
    `  across a chunk border ${fixed(borderDeltaCount === 0 ? 0 : borderDeltaSum / borderDeltaCount, 3)}` +
      `   inside a chunk ${fixed(interiorDeltaCount === 0 ? 0 : interiorDeltaSum / interiorDeltaCount, 3)}`,
  )
  lines.push('  these two should be indistinguishable; a spike at the border is a seam')
  lines.push('')

  lines.push('trees')
  lines.push(
    `  ${String(trees)} placed, effective density ${fixed(total === 0 ? 0 : trees / total, 4)} per column` +
      `   (grid ${String(TREE_GRID_SIZE)}x${String(TREE_GRID_SIZE)})`,
  )
  for (const biome of BIOMES) {
    const count = treesByBiome.get(biome) ?? 0
    if (count > 0) {
      lines.push(`    ${biome.padEnd(8, ' ')} ${String(count)}`)
    }
  }
  lines.push(
    `  nearest-neighbour spacing (Chebyshev): min ${String(quantile(sortedSpacing, 0))}` +
      `  p50 ${String(quantile(sortedSpacing, 0.5))}  max ${String(quantile(sortedSpacing, 1))}`,
  )
  lines.push(
    `  trees whose radius-2 crown overlaps a neighbour's: ${percent(overlapping, spacing.length)}` +
      `   largest connected canopy: ${String(largestCanopyCluster(treePositions))} trees`,
  )
  lines.push('  a jittered grid bounds tree DENSITY; it does not bound minimum spacing —')
  lines.push('  two candidates in adjacent cells can land 1 block apart. See domain/tree-placement.ts.')

  return lines
}

// ---------------------------------------------------------------------------
// BLOCKS: real generateChunk output.
// ---------------------------------------------------------------------------

/**
 * Largest 4-connected patch of LEAVES at a single Y inside one chunk.
 *
 * This is the real form of "is the canopy a walkable slab". The column-space
 * spacing metric above cannot answer it, because two trees four blocks apart on
 * a hillside have crowns at different heights and do not fuse into a surface.
 * Only the block buffer knows.
 *
 * One crown is a 5x5 square minus its four corners = 21 blocks, so 21 is one
 * tree and anything materially above it is two crowns that have merged.
 *
 * Measured per chunk, so a slab straddling a chunk border is undercounted —
 * which biases this number DOWN. `plantTree` clips its canopy at the chunk edge
 * anyway (domain/terrain.ts notes that crossing a border needs the neighbour's
 * buffer, which is the chunk manager's job), so the real world will be at least
 * this bad and probably worse.
 */
const largestLeafSheet = (blocks: Uint8Array): number => {
  let largest = 0
  const seen = new Uint8Array(CHUNK_SIZE_XZ * CHUNK_SIZE_XZ)
  const stack: Array<number> = []

  for (let y = 0; y < CHUNK_HEIGHT; y += 1) {
    seen.fill(0)
    let anyLeaves = false

    for (let lx = 0; lx < CHUNK_SIZE_XZ; lx += 1) {
      for (let lz = 0; lz < CHUNK_SIZE_XZ; lz += 1) {
        if (readBlock(blocks, blockIndex(lx, y, lz)) !== BLOCK.LEAVES) {
          continue
        }
        anyLeaves = true
        const start = lz * CHUNK_SIZE_XZ + lx
        if (seen[start] === 1) {
          continue
        }

        seen[start] = 1
        stack.length = 0
        stack.push(start)
        let size = 0

        while (stack.length > 0) {
          const cell = stack.pop()
          if (cell === undefined) {
            break
          }
          size += 1
          const cx = cell % CHUNK_SIZE_XZ
          const cz = Math.floor(cell / CHUNK_SIZE_XZ)

          const neighbours = [
            [cx - 1, cz],
            [cx + 1, cz],
            [cx, cz - 1],
            [cx, cz + 1],
          ]
          for (const neighbour of neighbours) {
            const nx = neighbour[0] ?? -1
            const nz = neighbour[1] ?? -1
            if (nx < 0 || nz < 0 || nx >= CHUNK_SIZE_XZ || nz >= CHUNK_SIZE_XZ) {
              continue
            }
            const index = nz * CHUNK_SIZE_XZ + nx
            if (seen[index] === 1 || readBlock(blocks, blockIndex(nx, y, nz)) !== BLOCK.LEAVES) {
              continue
            }
            seen[index] = 1
            stack.push(index)
          }
        }

        largest = Math.max(largest, size)
      }
    }

    if (!anyLeaves) {
      continue
    }
  }

  return largest
}

/**
 * Block-level facts that only real `generateChunk` output can answer: the water
 * surface, the hollow-lake signature, and how much of the cave band is carved.
 */
const blockReport = (
  cache: ChunkCache,
  params: WorldParams,
  options: StatsOptions,
): ReadonlyArray<string> => {
  let waterBlocks = 0
  let waterTopMin = Number.POSITIVE_INFINITY
  let waterTopMax = Number.NEGATIVE_INFINITY
  let waterOverAir = 0
  let waterColumns = 0
  let caveBandBlocks = 0
  let caveBandAir = 0
  let airInsideShell = 0
  let caveNearWaterFloor = 0
  let biggestLeafSheet = 0

  // The observation window is the CONSTANT `WATER_FLOOR_MARGIN`, never the
  // configured margin.
  //
  // Using the configured margin was the first version of this check and it was
  // worthless: under `--no-guard` the margin is 0, so the window `[floor-0,
  // floor)` is empty and the check reported "0 violations" by arithmetic rather
  // than by observation. It scored a perfect result on the run that is
  // deliberately broken.
  //
  // The question is "is there air in the three blocks under this water", and
  // three is a property of the reference implementation
  // (`CAVE_WATER_FLOOR_MARGIN = 3`), not of how this run was configured.
  const shellWindow = WATER_FLOOR_MARGIN
  const configuredMargin = params.carve.waterFloorMargin ?? WATER_FLOOR_MARGIN
  const observationWindow = 8

  const originChunkX = Math.floor(options.originX / CHUNK_SIZE_XZ)
  const originChunkZ = Math.floor(options.originZ / CHUNK_SIZE_XZ)

  for (let cz = 0; cz < options.chunkSpan; cz += 1) {
    for (let cx = 0; cx < options.chunkSpan; cx += 1) {
      const chunk = chunkFor(cache, params, originChunkX + cx, originChunkZ + cz)
      biggestLeafSheet = Math.max(biggestLeafSheet, largestLeafSheet(chunk.blocks))

      for (let lx = 0; lx < CHUNK_SIZE_XZ; lx += 1) {
        for (let lz = 0; lz < CHUNK_SIZE_XZ; lz += 1) {
          let columnHasWater = false
          let columnWaterTop = -1
          let columnWaterFloor = -1

          for (let y = 0; y < CHUNK_HEIGHT; y += 1) {
            const block = readBlock(chunk.blocks, blockIndex(lx, y, lz))

            if (y >= CAVE_FLOOR_Y && y <= CAVE_CEILING_Y) {
              caveBandBlocks += 1
              if (block === BLOCK.AIR) {
                caveBandAir += 1
              }
            }

            if (block !== BLOCK.WATER) {
              continue
            }

            waterBlocks += 1
            columnHasWater = true
            columnWaterTop = y
            if (columnWaterFloor < 0) {
              columnWaterFloor = y
            }

            const below = y === 0 ? BLOCK.BEDROCK : readBlock(chunk.blocks, blockIndex(lx, y - 1, lz))
            if (below === BLOCK.AIR) {
              waterOverAir += 1
            }
          }

          if (!columnHasWater) {
            continue
          }

          waterColumns += 1
          waterTopMin = Math.min(waterTopMin, columnWaterTop)
          waterTopMax = Math.max(waterTopMax, columnWaterTop)

          // The black-void signature: air INSIDE the shell the guard promises
          // to keep solid.
          for (let y = Math.max(0, columnWaterFloor - shellWindow); y < columnWaterFloor; y += 1) {
            if (readBlock(chunk.blocks, blockIndex(lx, y, lz)) === BLOCK.AIR) {
              airInsideShell += 1
              break
            }
          }

          // Informational: a cave that came close and was turned away. A zero
          // here would make the zero above vacuous.
          for (
            let y = Math.max(0, columnWaterFloor - observationWindow);
            y < columnWaterFloor - shellWindow;
            y += 1
          ) {
            if (readBlock(chunk.blocks, blockIndex(lx, y, lz)) === BLOCK.AIR) {
              caveNearWaterFloor += 1
              break
            }
          }
        }
      }
    }
  }

  const chunks = options.chunkSpan * options.chunkSpan
  const columns = chunks * CHUNK_SIZE_XZ * CHUNK_SIZE_XZ

  const lines: Array<string> = []
  lines.push(
    `BLOCKS — ${String(chunks)} generated chunks (${String(options.chunkSpan)}x${String(options.chunkSpan)}), ${String(columns)} columns`,
  )
  lines.push('')
  lines.push(
    `  water blocks ${String(waterBlocks)} in ${String(waterColumns)} columns (${percent(waterColumns, columns)} of columns)`,
  )
  lines.push(
    `  water surface Y: min ${String(waterColumns === 0 ? 0 : waterTopMin)}` +
      ` max ${String(waterColumns === 0 ? 0 : waterTopMax)}` +
      `   expected exactly ${String(params.levels.seaLevel)} (SEA_LEVEL, docs/design-notes.md DN-1)`,
  )
  lines.push(
    `  cave band y=${String(CAVE_FLOOR_Y)}..${String(CAVE_CEILING_Y)} carved to air: ${percent(caveBandAir, caveBandBlocks)}`,
  )
  lines.push(
    `  largest 4-connected LEAVES patch at one Y in one chunk: ${String(biggestLeafSheet)} blocks` +
      `   (one crown is 21; more means fused canopies)`,
  )
  lines.push('')
  lines.push('hollow-lake check (docs/design-notes.md DN-2)')
  lines.push(
    `  carver waterFloorMargin in effect: ${String(configuredMargin)}` +
      `${params.carve.waterFloorMargin === undefined ? ' (WATER_FLOOR_MARGIN)' : ' (--no-guard: the bug is switched ON)'}`,
  )
  lines.push(
    `  water blocks sitting directly on air: ${String(waterOverAir)}   (expected 0 — the floating-sheet signature)`,
  )
  lines.push(
    `  submerged columns with air inside the ${String(shellWindow)}-block shell: ${String(airInsideShell)}   (expected 0 with the guard on)`,
  )
  lines.push(
    `  submerged columns with a cave ${String(shellWindow + 1)}..${String(observationWindow)} blocks below the water floor: ${String(caveNearWaterFloor)}`,
  )
  lines.push('    ^ informational, and NOT a bug: the shell held. A zero here would mean the')
  lines.push('      carver never came near a lake bed, which would make the zeros above vacuous.')
  lines.push('  run with --no-guard to confirm these numbers can be non-zero')

  return lines
}

export const buildStatsReport = (
  cache: ChunkCache,
  params: WorldParams,
  options: StatsOptions,
): ReadonlyArray<string> => [
  `seed ${String(params.seed)}   centre (${String(options.originX)}, ${String(options.originZ)})` +
    `   trees ${params.decorate ? 'on' : 'off'}` +
    `   sea level ${String(params.levels.seaLevel)}`,
  '',
  ...surveyReport(params, options),
  '',
  ...localReport(params, options),
  '',
  ...blockReport(cache, params, options),
]
