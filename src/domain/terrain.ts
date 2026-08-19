/**
 * `generateChunk(seed, coords) → NaturalStructureChunk` — the public entry point (plan.md §3.7).
 *
 * This module implements the current deterministic terrain pipeline.
 *
 * ---------------------------------------------------------------------------
 * Pure and deterministic, and those are two different claims
 * ---------------------------------------------------------------------------
 *
 * Pure: no clock, no I/O, no global state. The verification suite guards this
 * boundary; generation code itself has no time source.
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
  BEDROCK_Y,
  CHUNK_HEIGHT,
  CHUNK_SIZE_XZ,
  DEEPSLATE_CEILING,
  DEFAULT_TERRAIN_LEVELS,
  type TerrainLevels,
  blockIndex,
} from './constants'
import {
  BLOCK,
  type BiomeType,
} from './biome'
import {
  CONTINENTALNESS_CONTRAST,
  MAX_SURFACE_Y,
  MIN_SURFACE_Y,
  surfaceHeightAt,
} from './density-function'
import { type CarveOptions, carveCaves } from './carver'
import {
  type Chunk,
  biomeAt,
  columnIndex,
  emptyBlocks,
  readBlock,
} from './chunk'
import { type ChunkCoord, chunkCoord } from '@nerima-games/mc-kernel'
import {
  type NaturalStructureChunk,
  applyNaturalStructurePlansToChunk,
  naturalStructurePlansForChunk,
} from './natural-structure'
import { TREE_CROWN_RADIUS, shouldPlaceTree } from './tree-placement'
import { type TerrainColumn, biomeFor, climateAt, terrainColumnAt } from './terrain-column'
import {
  canPlaceGroundPlantAt,
  groundPlantAt,
  plantGroundCover,
  plantSpecialVegetation,
  shouldPlaceGroundPlant,
} from './vegetation'
import {
  fillWaterForColumn,
  shouldFreezeWaterSurface,
} from './lake-generator'
import { worldX, worldZ } from './generator-coordinates'
import { carveRavines } from './ravine'
import { placeOres } from './ore'
import { writeStrongholdBlocksForChunk } from './stronghold'
export {
  CONTINENTALNESS_CONTRAST,
  MAX_SURFACE_Y,
  MIN_SURFACE_Y,
  surfaceHeightAt,
}
export { biomeFor, climateAt, terrainColumnAt }
export type { TerrainColumn } from './terrain-column'

/** Single-block iteration step for the per-voxel/per-column loops below. */
const AXIS_STEP = 1
/** Sentinel stored for columns whose terrain has no water surface. */
const NO_WATER_LEVEL = -1

export type GenerateOptions = {
  readonly terrainLevels?: TerrainLevels
  readonly carve?: CarveOptions
  readonly decorate?: boolean
}

type ColumnFill = {
  readonly lx: number
  readonly lz: number
  readonly column: TerrainColumn
  readonly levels: TerrainLevels
}

type FilledColumn = Readonly<{
  readonly surfaceY: number
  readonly waterLevel: number | null
}>

/** One block above a Y, used both for "stone starts here" and "water starts here". */
const ONE_BLOCK_ABOVE = 1

const fillStoneCore = (blocks: Uint8Array, lx: number, lz: number, surfaceY: number, fillerDepth: number): void => {
  for (let y = BEDROCK_Y + ONE_BLOCK_ABOVE; y < surfaceY - fillerDepth; y += AXIS_STEP) {
    const index = blockIndex(lx, y, lz)
    if (y < DEEPSLATE_CEILING) {
      blocks[index] = BLOCK.DEEPSLATE
    } else {
      blocks[index] = BLOCK.STONE
    }
  }
}

const fillColumn = (blocks: Uint8Array, column: ColumnFill): FilledColumn => {
  const { levels, lx, lz, column: terrainColumn } = column
  const { biome, lakeBasinY, surface, surfaceY, temperature, waterLevel } = terrainColumn

  blocks[blockIndex(lx, BEDROCK_Y, lz)] = BLOCK.BEDROCK
  fillStoneCore(blocks, lx, lz, surfaceY, surface.fillerDepth)

  for (let y = Math.max(BEDROCK_Y + ONE_BLOCK_ABOVE, surfaceY - surface.fillerDepth); y < surfaceY; y += AXIS_STEP) {
    blocks[blockIndex(lx, y, lz)] = surface.filler
  }
  blocks[blockIndex(lx, surfaceY, lz)] = surface.top

  // Water fills from just above the surface to the resolved body level. This happens
  // BEFORE carving, because the carver's guard probes for these blocks.
  fillWaterForColumn({
    biome,
    blocks,
    freezeSurface: shouldFreezeWaterSurface(biome, temperature),
    iceBlockIndex: BLOCK.ICE,
    lakeBasinY,
    lx,
    lz,
    surfaceY,
    terrainLevels: levels,
    waterBlockIndex: BLOCK.WATER,
  })

  return { surfaceY, waterLevel }
}

/** Trunk height for a planted tree, in blocks above the surface. */
const TREE_TRUNK_HEIGHT = 5

const plantTrunk = (blocks: Uint8Array, lx: number, lz: number, surfaceY: number): void => {
  for (let offset = ONE_BLOCK_ABOVE; offset <= TREE_TRUNK_HEIGHT; offset += AXIS_STEP) {
    const y = surfaceY + offset
    if (y < CHUNK_HEIGHT) {
      blocks[blockIndex(lx, y, lz)] = BLOCK.LOG
    }
  }
}

/**
 * The radius is `TREE_CROWN_RADIUS` and not a literal because it is one half
 * of the no-fusion inequality `TREE_MIN_SPACING >= 2 * TREE_CROWN_RADIUS + 2`
 * that the placement grid is sized to satisfy. Widening the crown here without
 * widening the grid is exactly how the leaf slab comes back.
 */
const isTreeCanopyCorner = (dx: number, dz: number): boolean =>
  Math.abs(dx) === TREE_CROWN_RADIUS && Math.abs(dz) === TREE_CROWN_RADIUS

/**
 * No chunk-bounds guard here, and that is a proven fact about the tree
 * placement grid rather than an oversight: `plantCanopyCell` is only ever
 * reached through `plantTree`, itself only called from `plantTreesPass` when
 * `shouldPlaceTree` (`tree-placement.ts`) returns true. `shouldPlaceTree`'s
 * first gate requires the column to be `cellOf(worldX)`/`cellOf(worldZ)`'s
 * single jittered grid candidate, whose offset inside its cell is
 * `TREE_CELL_JITTER_ORIGIN + [0, TREE_CELL_JITTER_SPAN)`. With
 * `TREE_GRID_SIZE = 8`, `TREE_CELL_JITTER_ORIGIN = 2`,
 * `TREE_CELL_JITTER_SPAN = 3` and `CHUNK_SIZE_XZ = 16` (two grid cells per
 * chunk per axis), the only reachable local trunk coordinates are
 * `{2, 3, 4, 10, 11, 12}` on each axis — every one at least
 * `TREE_CROWN_RADIUS` (2) away from both chunk edges (0 and 15), so a canopy
 * cell can never fall outside `[0, CHUNK_SIZE_XZ)`. This is not a local
 * assumption: `test/tree-canopy.test.ts` ("leaves no clipped crowns...")
 * already pins the general form as `TREE_CELL_JITTER_ORIGIN >=
 * TREE_CROWN_RADIUS` and `TREE_CELL_JITTER_ORIGIN + TREE_CELL_JITTER_SPAN - 1
 * + TREE_CROWN_RADIUS < TREE_GRID_SIZE`, so a future constant change that
 * broke this fails loudly there before it could reach `plantCanopyCell`.
 * A dead bounds check here would only have hidden that failure behind a
 * silently dropped `blockIndex` write (`blockIndex` does not itself bounds
 * check, and an out-of-chunk index writes into `blocks` where the JS
 * `Uint8Array` semantics either no-op or, for a negative index, wrap
 * unpredictably) — worse than letting the grid's own test catch it.
 */
const plantCanopyCell = (blocks: Uint8Array, x: number, z: number, crownY: number): void => {
  const index = blockIndex(x, crownY, z)
  if (readBlock(blocks, index) === BLOCK.AIR) {
    blocks[index] = BLOCK.LEAVES
  }
}

// Canopy, clipped to the chunk. Crossing a chunk border correctly needs the neighbour's buffer, which is the chunk manager's job — see docs/porting.md.
const plantCanopy = (blocks: Uint8Array, lx: number, lz: number, crownY: number): void => {
  for (let dx = -TREE_CROWN_RADIUS; dx <= TREE_CROWN_RADIUS; dx += AXIS_STEP) {
    for (let dz = -TREE_CROWN_RADIUS; dz <= TREE_CROWN_RADIUS; dz += AXIS_STEP) {
      if (!isTreeCanopyCorner(dx, dz)) {
        plantCanopyCell(blocks, lx + dx, lz + dz, crownY)
      }
    }
  }
}

const plantTree = (blocks: Uint8Array, lx: number, lz: number, surfaceY: number): void => {
  plantTrunk(blocks, lx, lz, surfaceY)
  plantCanopy(blocks, lx, lz, surfaceY + TREE_TRUNK_HEIGHT)
}

/** Seed value for the buffer; `generateColumns` writes each column before decoration reads it. */
const FALLBACK_DECORATION_BIOME: BiomeType = 'PLAINS'

type ChunkBuffers = {
  readonly blocks: Uint8Array
  readonly biomes: Array<BiomeType>
  readonly surfaces: Int16Array
  readonly waterLevels: Int16Array
}

const createChunkBuffers = (): ChunkBuffers => ({
  biomes: Array.from<BiomeType>({ length: CHUNK_SIZE_XZ * CHUNK_SIZE_XZ }).fill(FALLBACK_DECORATION_BIOME),
  blocks: emptyBlocks(),
  surfaces: new Int16Array(CHUNK_SIZE_XZ * CHUNK_SIZE_XZ),
  waterLevels: new Int16Array(CHUNK_SIZE_XZ * CHUNK_SIZE_XZ).fill(NO_WATER_LEVEL),
})

type ChunkGenerationContext = ChunkBuffers & {
  readonly seed: number
  readonly coord: ChunkCoord
  readonly levels: TerrainLevels
}

/**
 * Asserted rather than defaulted with `?? fallback`: `context.surfaces` and
 * `context.biomes` are only ever read from `plantTreesPass` /
 * `plantGroundCoverPass`, both only called (via `decorateChunk`) from
 * `generateChunk` — and only AFTER `generateColumns` has already written
 * every `(lx, lz)` in `[0, CHUNK_SIZE_XZ) x [0, CHUNK_SIZE_XZ)` (see
 * `generateChunk`'s call order below). `columnIndex(lx, lz) = lz *
 * CHUNK_SIZE_XZ + lx` never exceeds `CHUNK_SIZE_XZ * CHUNK_SIZE_XZ - 1` for
 * lx, lz in that range, which is exactly `surfaces.length - 1` /
 * `biomes.length - 1`. A `?? fallback` here would be an untested,
 * unreachable branch rather than real defensive code.
 * `noUncheckedIndexedAccess` still types both reads as possibly `undefined`,
 * hence the assertions.
 */
const columnSurfaceY = (context: ChunkGenerationContext, lx: number, lz: number): number =>
  context.surfaces[columnIndex(lx, lz)]!

const columnBiome = (context: ChunkGenerationContext, lx: number, lz: number): BiomeType =>
  context.biomes[columnIndex(lx, lz)]!

const columnWaterLevel = (context: ChunkGenerationContext, lx: number, lz: number): number | null => {
  const waterLevel = context.waterLevels[columnIndex(lx, lz)]!
  if (waterLevel === NO_WATER_LEVEL) {
    return null
  }
  return waterLevel
}

const generateColumns = (context: ChunkGenerationContext): void => {
  for (let lx = 0; lx < CHUNK_SIZE_XZ; lx += AXIS_STEP) {
    for (let lz = 0; lz < CHUNK_SIZE_XZ; lz += AXIS_STEP) {
      const wx = worldX(context.coord, lx)
      const wz = worldZ(context.coord, lz)
      const terrainColumn = terrainColumnAt(context.seed, wx, wz, context.levels)
      const filled = fillColumn(context.blocks, {
        column: terrainColumn,
        levels: context.levels,
        lx,
        lz,
      })

      context.biomes[columnIndex(lx, lz)] = terrainColumn.biome
      context.surfaces[columnIndex(lx, lz)] = filled.surfaceY
      context.waterLevels[columnIndex(lx, lz)] = filled.waterLevel ?? NO_WATER_LEVEL
    }
  }
}

const plantTreesPass = (context: ChunkGenerationContext): void => {
  for (let lx = 0; lx < CHUNK_SIZE_XZ; lx += AXIS_STEP) {
    for (let lz = 0; lz < CHUNK_SIZE_XZ; lz += AXIS_STEP) {
      const surfaceY = columnSurfaceY(context, lx, lz)
      const biome = columnBiome(context, lx, lz)

      if (
        shouldPlaceTree({
          biome,
          surfaceY,
          terrainLevels: context.levels,
          worldX: worldX(context.coord, lx),
          worldZ: worldZ(context.coord, lz),
        })
      ) {
        plantTree(context.blocks, lx, lz, surfaceY)
      }
    }
  }
}

const plantSpecialVegetationPass = (context: ChunkGenerationContext): void => {
  for (let lx = 0; lx < CHUNK_SIZE_XZ; lx += AXIS_STEP) {
    for (let lz = 0; lz < CHUNK_SIZE_XZ; lz += AXIS_STEP) {
      const surfaceY = columnSurfaceY(context, lx, lz)
      const biome = columnBiome(context, lx, lz)
      const waterLevel = columnWaterLevel(context, lx, lz) ?? context.levels.seaLevel

      plantSpecialVegetation({
        biome,
        blocks: context.blocks,
        lx,
        lz,
        seed: context.seed,
        surfaceY,
        waterLevel,
        worldX: worldX(context.coord, lx),
        worldZ: worldZ(context.coord, lz),
      })
    }
  }
}

/**
 * Ground cover runs after trees and special vegetation. The
 * support rule refuses a column whose `surfaceY + 1` is not AIR, so a plant
 * can never displace a trunk — but only if every trunk is already there.
 * Fused into the tree pass, a plant placed at (lx, lz) before that column's
 * own tree was considered would make the tree's first log overwrite it, and
 * the flower would vanish depending on iteration order.
 */
const plantGroundCoverPass = (context: ChunkGenerationContext): void => {
  for (let lx = 0; lx < CHUNK_SIZE_XZ; lx += AXIS_STEP) {
    for (let lz = 0; lz < CHUNK_SIZE_XZ; lz += AXIS_STEP) {
      const surfaceY = columnSurfaceY(context, lx, lz)
      const biome = columnBiome(context, lx, lz)
      const wx = worldX(context.coord, lx)
      const wz = worldZ(context.coord, lz)

      if (
        shouldPlaceGroundPlant({ biome, seed: context.seed, surfaceY, worldX: wx, worldZ: wz }) &&
        canPlaceGroundPlantAt(context.blocks, lx, surfaceY, lz)
      ) {
        plantGroundCover(context.blocks, { lx, lz, surfaceY }, groundPlantAt(context.seed, wx, wz, biome))
      }
    }
  }
}

const decorateChunk = (context: ChunkGenerationContext): void => {
  plantTreesPass(context)
  plantSpecialVegetationPass(context)
  plantGroundCoverPass(context)
}

/** Structures run last so their shell, roads and interiors override carving and vegetation. */
const writeStructures = (
  chunk: Chunk,
  seed: number,
  coord: ChunkCoord,
  levels: TerrainLevels,
): NaturalStructureChunk => {
  const plans = naturalStructurePlansForChunk(seed, 'overworld', coord, {
    overworld: (wx, wz) => {
      const surfaceY = surfaceHeightAt(seed, wx, wz)
      return { biome: biomeFor(seed, wx, wz, surfaceY, levels), seaLevel: levels.seaLevel, surfaceY }
    },
  })
  const structuredChunk = applyNaturalStructurePlansToChunk(chunk, plans)
  writeStrongholdBlocksForChunk(structuredChunk.blocks, seed, coord)
  return structuredChunk
}

/**
 * Generate a chunk. Total, pure, and a function of `(seed, coord)` alone.
 */
export const generateChunk = (
  seed: number,
  coord: ChunkCoord,
  options: GenerateOptions = {},
): NaturalStructureChunk => {
  const context: ChunkGenerationContext = {
    ...createChunkBuffers(),
    coord,
    levels: options.terrainLevels ?? DEFAULT_TERRAIN_LEVELS,
    seed,
  }

  generateColumns(context)
  carveCaves(context.blocks, seed, coord, options.carve ?? {})

  // Ore goes in AFTER carving, so that a cave wall can expose a vein, and it is
  // NOT behind `decorate` — ore is stone, not decoration. See `domain/ore.ts`.
  placeOres(context.blocks, seed, coord)

  if (options.decorate !== false) {
    decorateChunk(context)
  }

  // Ravines LAST, after ore and after decoration, so their walls cut cleanly through both — the reference's ordering and its stated reason (`generator.ts:141-142`). See the module header for why this is outside the `decorate` block rather than at the end of it.
  carveRavines({ biomes: context.biomes, blocks: context.blocks, coord, seed, surfaces: context.surfaces })

  return writeStructures(
    { biomes: context.biomes, blocks: context.blocks, coord },
    seed,
    coord,
    context.levels,
  )
}

/** Convenience for callers that have plain numbers rather than a `ChunkCoord`. */
export const generateChunkAt = (
  seed: number,
  x: number,
  z: number,
  options: GenerateOptions = {},
): NaturalStructureChunk =>
  generateChunk(seed, chunkCoord(x, z), options)

/** Re-exported so callers need one import to read a generated chunk. */
export { biomeAt }
