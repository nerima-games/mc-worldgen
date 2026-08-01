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
 * cleanly through ores and surface cover". Both orderings are reproduced below.
 *
 * RAVINES ARE NOT BEHIND `decorate`, and the flag is the reason the pass sits
 * where it does rather than inside the block above it. `decorate: false` means
 * "no vegetation", not "no terrain" — `placeOres` is already outside it on the
 * same argument, and `test/chunk-golden.test.ts` pins what the flag means by
 * asserting that the two FOREST rows differ ONLY in vegetation and that every
 * difference replaced AIR. A carver inside that block would break both halves:
 * it removes rather than adds, and it would make the flag mean two things.
 *
 * The ordering survives anyway, because the ravine pass runs last either way.
 * It also produces the same cut with the flag on and off: the water guard reads
 * `blocks[surfaceY + 1]`, and a column that holds water there can never carry a
 * plant (`canPlaceGroundPlantAt` demands AIR) or a trunk (`shouldPlaceTree`
 * refuses `surfaceY < seaLevel`), so decoration cannot change the guard's
 * answer. `test/ravine.test.ts` R-6 pins that as a measurement rather than as
 * this paragraph.
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
import { placeOres } from './ore'
import { carveRavines } from './ravine'
import { channelSeed, fbm2D } from './seeded-random'
import { writeStrongholdBlocksForChunk } from './stronghold'
import { writeVillageBlocksForChunk } from './village'
import { shouldPlaceTree, TREE_CROWN_RADIUS } from './tree-placement'
import {
  canPlaceGroundPlantAt,
  groundPlantAt,
  plantGroundCover,
  shouldPlaceGroundPlant,
} from './vegetation'

/** Lowest and highest surface the base terrain shaper will produce. */
export const MIN_SURFACE_Y = 38
export const MAX_SURFACE_Y = 92

/**
 * Contrast applied to raw continentalness before it becomes a height.
 *
 * ---------------------------------------------------------------------------
 * MEASUREMENT — how the numbers below were taken
 * ---------------------------------------------------------------------------
 *
 * Method: the SURVEY scan of `pnpm preview --stats` — a strided sample, every
 * 16th block over 8192 × 8192 blocks centred on the origin, so 262,144 columns
 * spanning ~45 continentalness features at this field's 1/180 frequency.
 * Repeated for seeds 20260726, 1, 4242, 999983 and 77777; the figures below are
 * seed 20260726 and every other seed agrees to within half a point.
 *
 * The sample size is the whole point of this comment. A window has to be many
 * multiples of 1/frequency across before the tails of the distribution appear
 * in it at all — see the previous value's obituary at the bottom.
 *
 *     raw continentalness      [0.053, 0.946]   p5 0.266  p50 0.496  p95 0.733
 *
 * ---------------------------------------------------------------------------
 * THE CHOICE — 1.15
 * ---------------------------------------------------------------------------
 *
 * The field already spans almost the whole unit interval, so it needs almost no
 * stretching. What it does need is the last sliver: at contrast 1.0 the extremes
 * map to heights 40 and 89, and `MIN_SURFACE_Y` / `MAX_SURFACE_Y` are then
 * bounds no column ever reaches — declared limits that are fiction. 1.15 is the
 * smallest value at which both bounds are attained on this sample, and it costs
 * one column in ten thousand:
 *
 *     contrast   flat-clamped   below sea level   observed height range
 *     1.00           0.00%           41.7%              [40, 89]
 *     1.15           0.01%           42.9%              [38, 92]   <- chosen
 *     1.50           1.05%           44.8%              [38, 92]
 *     2.00           8.06%           46.4%              [38, 92]
 *     2.60          19.96%           47.5%              [38, 92]
 *
 * Contrast barely moves the ocean fraction (42% to 47% across that whole range)
 * because sea level sits near the middle of the height range; what it moves is
 * how much of the world is a flat clamped plane. So the design call is cheap:
 * take the ocean fraction the field gives you — 42.9% here, which is ample sea
 * for the carver's water-floor guard to be exercised by (docs/design-notes.md
 * DN-2) — and do not pay 20% of the world's surface for the other five points.
 *
 * The height histogram at 1.15 is a single-peaked hump centred on 64 with thin
 * tails. At 2.6 it was flat between the bounds with a spike at each end: 11.8%
 * of columns in the lowest 4-block bucket and 9.2% in the highest. That spike
 * IS the table-top mesa; a histogram is what it looks like from above.
 *
 * ---------------------------------------------------------------------------
 * WHY IT WAS 2.6 — the mistake, kept because it is instructive
 * ---------------------------------------------------------------------------
 *
 * The previous comment justified 2.6 with two measured numbers, both wrong:
 * that the raw field spans "about [0.40, 0.72]" and that without the stretch
 * "3% of columns fall below sea level". It named its sample: 800 × 800 blocks.
 * At 1/180 that is four terrain features across. Four features are enough to
 * see where the middle of the distribution is (0.496 — that part was right) and
 * nowhere near enough to see its tails. The true unstretched ocean fraction is
 * 41.7%, not 3%.
 *
 * Multiplying a distribution that really does reach 0.05 and 0.95 by 2.6
 * saturates both ends, which is how a fifth of the world became flat. Note the
 * shape of the error: the narrow sample did not produce a wrong-looking answer,
 * it produced a plausible one, and the constant chosen to fix the imaginary
 * problem then created a real one. `pnpm preview --stats` defaults to an 8192
 * block survey for this reason, and docs/testing.md §4-b F-5 records the same
 * trap being walked into a second time, with biomes.
 *
 * Stretching about the midpoint is still the right shape of knob, and is what
 * the reference does in its climate path (`stretchClimate`,
 * `packages/world/domain/biome-classifier.ts:91`, applied at `:104-105`).
 * `test/terrain-distribution.test.ts` pins the clamped fraction so that the
 * next person to reach for this constant has to move a number that was measured
 * rather than a number that was recalled.
 */
export const CONTINENTALNESS_CONTRAST = 1.15

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
  //
  // The radius is `TREE_CROWN_RADIUS` and not a literal because it is one half
  // of the no-fusion inequality `TREE_MIN_SPACING >= 2 * TREE_CROWN_RADIUS + 2`
  // that the placement grid is sized to satisfy. Widening the crown here without
  // widening the grid is exactly how the leaf slab comes back.
  const radius = TREE_CROWN_RADIUS
  const crownY = surfaceY + trunkHeight
  for (let dx = -radius; dx <= radius; dx += 1) {
    for (let dz = -radius; dz <= radius; dz += 1) {
      const x = lx + dx
      const z = lz + dz
      if (x < 0 || x >= CHUNK_SIZE_XZ || z < 0 || z >= CHUNK_SIZE_XZ) {
        continue
      }
      if (Math.abs(dx) === radius && Math.abs(dz) === radius) {
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

  // Ore goes in AFTER carving, so that a cave wall can expose a vein, and it is
  // NOT behind `decorate` — ore is stone, not decoration. See `domain/ore.ts`.
  placeOres(blocks, seed, coord)

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

    // Ground cover runs in a SECOND pass, after every trunk is standing. The
    // support rule refuses a column whose `surfaceY + 1` is not AIR, so a plant
    // can never displace a trunk — but only if every trunk is already there.
    // Fused into the loop above, a plant placed at (lx, lz) before that column's
    // own tree was considered would make the tree's first log overwrite it, and
    // the flower would vanish depending on iteration order.
    for (let lx = 0; lx < CHUNK_SIZE_XZ; lx += 1) {
      for (let lz = 0; lz < CHUNK_SIZE_XZ; lz += 1) {
        const surfaceY = surfaces[columnIndex(lx, lz)] ?? 0
        const biome = biomes[columnIndex(lx, lz)] ?? 'PLAINS'
        const wx = worldX(coord, lx)
        const wz = worldZ(coord, lz)

        if (
          shouldPlaceGroundPlant({ seed, worldX: wx, worldZ: wz, biome, surfaceY }) &&
          canPlaceGroundPlantAt(blocks, lx, surfaceY, lz)
        ) {
          plantGroundCover(blocks, lx, surfaceY, lz, groundPlantAt(seed, wx, wz, biome))
        }
      }
    }
  }

  // Ravines LAST, after ore and after decoration, so their walls cut cleanly
  // through both — the reference's ordering and its stated reason
  // (`generator.ts:141-142`). See the module header for why this is outside the
  // `decorate` block rather than at the end of it.
  carveRavines(blocks, seed, coord, surfaces, biomes)

  // Structures run last so their shell, roads and interiors override carving and vegetation.
  writeVillageBlocksForChunk(blocks, seed, coord, (wx, wz) => {
    const surfaceY = surfaceHeightAt(seed, wx, wz)
    return { biome: biomeFor(seed, wx, wz, surfaceY, levels), surfaceY, seaLevel: levels.seaLevel }
  })
  writeStrongholdBlocksForChunk(blocks, seed, coord)

  return { coord, blocks, biomes }
}

/** Convenience for callers that have plain numbers rather than a `ChunkCoord`. */
export const generateChunkAt = (seed: number, x: number, z: number, options: GenerateOptions = {}): Chunk =>
  generateChunk(seed, chunkCoord(x, z), options)

/** Re-exported so callers need one import to read a generated chunk. */
export { biomeAt }
