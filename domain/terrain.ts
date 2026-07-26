/**
 * `generateChunk(seed, coords) → Chunk` — the public entry point (plan.md §3.7).
 *
 * PRE-AUDIT FIRST CUT (叩き台).
 *
 * ---------------------------------------------------------------------------
 * Pure and deterministic, and those are two different claims
 * ---------------------------------------------------------------------------
 *
 * Pure: no clock, no I/O, no global state. `pnpm check:deps` enforces the clock
 * half mechanically — `Date.now()`, `new Date()` and `performance.now()` are
 * banned repository-wide.
 *
 * Deterministic: the same `(seed, coord)` always produces byte-identical
 * output, on any machine, in any order, in a worker or on the main thread. This
 * is the property everything downstream rests on. A save file stores a seed and
 * not the terrain, so a drift in generation is retroactive world corruption for
 * every existing save.
 *
 * The sampling is position-absolute, never chunk-relative, which is what makes
 * chunk borders seamless: two neighbouring chunks asking about the same world
 * column get the same answer. The reference does the same
 * (`packages/world/domain/terrain/generator.ts:39-40`).
 *
 * ---------------------------------------------------------------------------
 * Pass order matters
 * ---------------------------------------------------------------------------
 *
 * Water is filled BEFORE caves are carved, because the carver's water-floor
 * guard works by probing for water blocks (see `domain/carver.ts`). Carving
 * first would leave nothing for it to find, and the guard would silently do
 * nothing — the failure mode being a subtly hollow lake rather than an error.
 *
 * The reference's ordering is more intricate still: caves are carved before
 * decoration (`generator.ts:102`) but ravines after trees and plants
 * (`generator.ts:155`), the stated reason being that ravine walls should "cut
 * cleanly through ores and surface cover". Recorded in docs/porting.md; ravines
 * are not implemented here yet.
 */
import {
  BIOME_SURFACES,
  BLOCK,
  classifyBiome,
  type BiomeType,
} from './biome'
import { carveCaves, type CarveOptions } from './carver'
import {
  biomeAt,
  columnIndex,
  emptyBlocks,
  readBlock,
  worldX,
  worldZ,
  type Chunk,
} from './chunk'
import {
  BEDROCK_Y,
  blockIndex,
  CHUNK_HEIGHT,
  CHUNK_SIZE_XZ,
  DEFAULT_TERRAIN_LEVELS,
  type TerrainLevels,
} from './constants'
import { chunkCoord, type ChunkCoord } from './kernel-vocabulary'
import { channelSeed, fbm2D } from './seeded-random'
import { shouldPlaceTree } from './tree-placement'

/** Lowest and highest surface the base terrain shaper will produce. */
export const MIN_SURFACE_Y = 38
export const MAX_SURFACE_Y = 92

/**
 * Contrast applied to raw continentalness before it becomes a height.
 *
 * Averaged octaves of noise cluster hard around 0.5 — measured over a
 * 800 × 800 block sample, the raw field spanned only about [0.40, 0.72]. Mapped
 * straight onto a height range that produces a world of gentle hills with
 * essentially no ocean: 3% of columns fell below sea level, and none deep enough
 * for a cave to reach. A generator that cannot produce an ocean also cannot
 * produce the hollow-lake bug the carver guard exists to prevent, so the guard
 * would have been untestable — which is how a guard quietly stops working.
 *
 * Stretching about the midpoint is the standard fix and is what the reference
 * does too, in its climate path (`stretchClimate`,
 * `packages/world/domain/biome-classifier.ts:91`, applied at `:104-105`).
 */
export const CONTINENTALNESS_CONTRAST = 2.6

const stretch = (value: number): number =>
  Math.min(1, Math.max(0, (value - 0.5) * CONTINENTALNESS_CONTRAST + 0.5))

/** Depth of the biome-specific filler beneath the top block. */
const FILLER_DEPTH = 4

export type GenerateOptions = {
  readonly terrainLevels?: TerrainLevels
  readonly carve?: CarveOptions
  readonly decorate?: boolean
}

/**
 * Surface height for a world column.
 *
 * Exported because it is the cheapest possible query about the world and the
 * chunk manager needs it for spawn selection without generating a whole chunk.
 * It must agree exactly with what `generateChunk` produces — `test/terrain.test.ts`
 * pins that.
 */
export const surfaceHeightAt = (seed: number, wx: number, wz: number): number => {
  const continentalness = fbm2D(channelSeed(seed, 'continentalness'), wx, wz, {
    octaves: 4,
    frequency: 1 / 180,
    persistence: 0.5,
  })

  return Math.floor(MIN_SURFACE_Y + (MAX_SURFACE_Y - MIN_SURFACE_Y) * stretch(continentalness))
}

export const climateAt = (
  seed: number,
  wx: number,
  wz: number,
): { readonly temperature: number; readonly humidity: number } => ({
  temperature: fbm2D(channelSeed(seed, 'temperature'), wx, wz, {
    octaves: 3,
    frequency: 1 / 320,
    persistence: 0.5,
  }),
  humidity: fbm2D(channelSeed(seed, 'humidity'), wx, wz, {
    octaves: 3,
    frequency: 1 / 280,
    persistence: 0.5,
  }),
})

/**
 * Biome for a column, after the submerged and shoreline overrides.
 *
 * The overrides run after climate classification, not instead of it: a desert
 * that happens to dip below sea level is an ocean there, whatever its climate
 * says. The reference applies its OCEAN override the same way, downstream of
 * `classifyBiome` (`biome-classifier.ts:113`).
 */
export const biomeFor = (
  seed: number,
  wx: number,
  wz: number,
  surfaceY: number,
  levels: TerrainLevels,
): BiomeType => {
  if (surfaceY < levels.seaLevel - 2) {
    return 'OCEAN'
  }
  if (surfaceY <= levels.seaLevel + 1) {
    return 'BEACH'
  }
  return classifyBiome(climateAt(seed, wx, wz))
}

const fillColumn = (
  blocks: Uint8Array,
  lx: number,
  lz: number,
  surfaceY: number,
  biome: BiomeType,
  levels: TerrainLevels,
): void => {
  const surface = BIOME_SURFACES[biome]
  const submerged = surfaceY < levels.seaLevel

  blocks[blockIndex(lx, BEDROCK_Y, lz)] = BLOCK.BEDROCK

  for (let y = BEDROCK_Y + 1; y < surfaceY - FILLER_DEPTH; y += 1) {
    blocks[blockIndex(lx, y, lz)] = BLOCK.STONE
  }

  for (let y = Math.max(BEDROCK_Y + 1, surfaceY - FILLER_DEPTH); y < surfaceY; y += 1) {
    blocks[blockIndex(lx, y, lz)] = surface.filler
  }

  blocks[blockIndex(lx, surfaceY, lz)] = submerged ? surface.underwaterTop : surface.top

  // Water fills from just above the surface up to sea level. This happens
  // BEFORE carving, because the carver's guard probes for these blocks.
  for (let y = surfaceY + 1; y <= levels.seaLevel && y < CHUNK_HEIGHT; y += 1) {
    blocks[blockIndex(lx, y, lz)] = BLOCK.WATER
  }
}

const plantTree = (blocks: Uint8Array, lx: number, lz: number, surfaceY: number): void => {
  const trunkHeight = 5

  for (let offset = 1; offset <= trunkHeight; offset += 1) {
    const y = surfaceY + offset
    if (y < CHUNK_HEIGHT) {
      blocks[blockIndex(lx, y, lz)] = BLOCK.LOG
    }
  }

  // Canopy, clipped to the chunk. Crossing a chunk border correctly needs the
  // neighbour's buffer, which is the chunk manager's job — see docs/porting.md.
  const crownY = surfaceY + trunkHeight
  for (let dx = -2; dx <= 2; dx += 1) {
    for (let dz = -2; dz <= 2; dz += 1) {
      const x = lx + dx
      const z = lz + dz
      if (x < 0 || x >= CHUNK_SIZE_XZ || z < 0 || z >= CHUNK_SIZE_XZ) {
        continue
      }
      if (Math.abs(dx) === 2 && Math.abs(dz) === 2) {
        continue
      }
      const index = blockIndex(x, crownY, z)
      if (readBlock(blocks, index) === BLOCK.AIR) {
        blocks[index] = BLOCK.LEAVES
      }
    }
  }
}

/**
 * Generate a chunk. Total, pure, and a function of `(seed, coord)` alone.
 */
export const generateChunk = (seed: number, coord: ChunkCoord, options: GenerateOptions = {}): Chunk => {
  const levels = options.terrainLevels ?? DEFAULT_TERRAIN_LEVELS
  const blocks = emptyBlocks()
  const biomes: Array<BiomeType> = Array.from<BiomeType>({ length: CHUNK_SIZE_XZ * CHUNK_SIZE_XZ }).fill('PLAINS')
  const surfaces = new Int16Array(CHUNK_SIZE_XZ * CHUNK_SIZE_XZ)

  for (let lx = 0; lx < CHUNK_SIZE_XZ; lx += 1) {
    for (let lz = 0; lz < CHUNK_SIZE_XZ; lz += 1) {
      const wx = worldX(coord, lx)
      const wz = worldZ(coord, lz)
      const surfaceY = surfaceHeightAt(seed, wx, wz)
      const biome = biomeFor(seed, wx, wz, surfaceY, levels)

      biomes[columnIndex(lx, lz)] = biome
      surfaces[columnIndex(lx, lz)] = surfaceY

      fillColumn(blocks, lx, lz, surfaceY, biome, levels)
    }
  }

  carveCaves(blocks, seed, coord, options.carve ?? {})

  if (options.decorate !== false) {
    for (let lx = 0; lx < CHUNK_SIZE_XZ; lx += 1) {
      for (let lz = 0; lz < CHUNK_SIZE_XZ; lz += 1) {
        const surfaceY = surfaces[columnIndex(lx, lz)] ?? 0
        const biome = biomes[columnIndex(lx, lz)] ?? 'PLAINS'

        if (
          shouldPlaceTree({
            worldX: worldX(coord, lx),
            worldZ: worldZ(coord, lz),
            surfaceY,
            biome,
            terrainLevels: levels,
          })
        ) {
          plantTree(blocks, lx, lz, surfaceY)
        }
      }
    }
  }

  return { coord, blocks, biomes }
}

/** Convenience for callers that have plain numbers rather than a `ChunkCoord`. */
export const generateChunkAt = (seed: number, x: number, z: number, options: GenerateOptions = {}): Chunk =>
  generateChunk(seed, chunkCoord(x, z), options)

/** Re-exported so callers need one import to read a generated chunk. */
export { biomeAt }
