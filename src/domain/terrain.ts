/**
 * `generateChunk(seed, coord) → Result<NaturalStructureChunk, InvalidNaturalStructureCoordinate | InvalidTerrainLevels>` — the public entry point (plan.md §3.7). The legacy `InvalidTerrainLevels` error channel also carries density and biome-classification failures.
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
 * It produces the same cut with the flag on and off: the water guard reads
 * `blocks[surfaceY + 1]` and treats water, ice, seagrass and kelp there as a
 * submerged column. Land plants and tree trunks cannot occupy that position
 * above a water surface. `test/ravine.test.ts` R-6 measures the result.
 */
import {
  BEDROCK_Y,
  CHUNK_SIZE_XZ,
  DEEPSLATE_CEILING,
  DEFAULT_TERRAIN_LEVELS,
  type TerrainLevels,
  blockIndex,
} from './constants.js'
import { BLOCK, type BiomeType, type KernelBiomeType } from './biome.js'
import { BlockAxis, type ChunkAxis, type ChunkCoord } from '@nerima-games/mc-kernel/domain/coordinates'
import {
  CONTINENTALNESS_CONTRAST,
  MAX_SURFACE_Y,
  MIN_SURFACE_Y,
  TerrainDensityFailure,
  type TerrainDensitySampler,
  createTerrainDensitySampler,
  surfaceHeightAt,
} from './density-function.js'
import { type CarveOptions, carveCaves, validateWaterFloorMargin } from './carver.js'
import {
  type Chunk,
  biomeAt,
  columnIndexForKnownLocalRange,
  emptyBlocks,
  readBlock,
} from './chunk.js'
import { Data, Option, Result, Schema } from 'effect'
import {
  type NaturalStructureChunk,
  applyNaturalStructurePlansToChunk,
  naturalStructurePlansForValidatedChunk,
} from './natural-structure.js'
import type { OverworldTerrainResultSampler, OverworldTerrainSample } from './structure-siting.js'
import {
  TREE_CROWN_RADIUS,
  type TreeBiomeConfiguration,
  UnsupportedTreeBiome,
  cellOf,
  shouldPlaceTreeWithKnownConfiguration,
  treeCellCandidate,
  treeConfigurationForBiome,
  treeTrunkHeightForConfiguration,
} from './tree-placement.js'
import { type TerrainColumnForGeneration, biomeFor, climateAt, resolveTerrainColumnForGenerationValue, surfaceBiomeAt, terrainColumnAt } from './terrain-column.js'
import {
  type ValidatedNaturalStructureChunkCoordinates,
  validateNaturalStructureChunkCoordinates,
} from './natural-structure-chunk-planner.js'
import {
  canPlaceGroundPlantAt,
  groundPlantAt,
  plantGroundCover,
  plantSpecialVegetation,
  shouldPlaceGroundPlant,
} from './vegetation.js'
import { fillWaterAtLevel, shouldFreezeWaterSurface } from './lake-generator.js'
import type { InvalidNaturalStructureCoordinate } from './natural-structure-plan-builder.js'
import type { NoiseSeed } from '@nerima-games/mc-noise'
import type { UnsupportedBiomeCategory } from './biome-classifier.js'
import { blockAxisFromKnownSafeInteger } from './coordinate-compatibility.js'
import { carveRavines } from './ravine.js'
import { createTerrainDensityGrid } from './density-grid.js'
import { placeOres } from './ore.js'
type TerrainDensityGrid = ReturnType<typeof createTerrainDensityGrid>

const taggedError = Data.TaggedError
export {
  CONTINENTALNESS_CONTRAST,
  MAX_SURFACE_Y,
  MIN_SURFACE_Y,
  surfaceHeightAt,
}
export { biomeFor, climateAt, surfaceBiomeAt, terrainColumnAt }
export type { SurfaceBiome, TerrainColumn } from './terrain-column.js'

/** Single-block iteration step for the per-voxel/per-column loops below. */
const AXIS_STEP = 1
const DENSITY_SURFACE_THRESHOLD = 0
/** Sentinel stored for columns whose terrain has no water surface. */
const NO_WATER_LEVEL = -1
const LOCAL_COLUMN_MIN = 0
const CHUNK_COLUMN_COUNT = CHUNK_SIZE_XZ * CHUNK_SIZE_XZ

export type GenerateOptions = {
  readonly terrainLevels?: TerrainLevels
  readonly carve?: CarveOptions
  readonly decorate?: boolean
}

type InvalidTerrainLevelsFields = {
  readonly field: 'options' | 'terrainLevels' | 'waterFloorMargin'
}

export const InvalidTerrainLevels: new (
  args: InvalidTerrainLevelsFields,
) => Error & { readonly _tag: 'InvalidTerrainLevels' } & Readonly<InvalidTerrainLevelsFields> =
  taggedError('InvalidTerrainLevels')<InvalidTerrainLevelsFields>

export type TerrainGenerationError = TerrainDensityFailure | UnsupportedBiomeCategory

/** Keeps the existing ChunkSource error channel while exposing new generation failures. */
export type InvalidTerrainLevels = InstanceType<typeof InvalidTerrainLevels> | TerrainGenerationError | UnsupportedTreeBiome

const TERRAIN_LEVELS_SCHEMA = Schema.Struct({
  lakeLevel: Schema.Number.pipe(Schema.fromBrand('BlockAxis', BlockAxis)),
  seaLevel: Schema.Number.pipe(Schema.fromBrand('BlockAxis', BlockAxis)),
})

type ColumnFill = {
  readonly lx: number
  readonly lz: number
  readonly column: TerrainColumnForGeneration
}

type FilledColumn = Readonly<{
  readonly surfaceY: number
  readonly waterLevel: number | null
}>

/** One block above a Y, used both for "stone starts here" and "water starts here". */
const ONE_BLOCK_ABOVE = 1

const fillBedrockAndClearRaisedSurface = (blocks: Uint16Array, column: ColumnFill, initialSurfaceY: number): void => {
  const { lx, lz, column: terrainColumn } = column
  const { surfaceY } = terrainColumn
  blocks[blockIndex(lx, BEDROCK_Y, lz)] = BLOCK.BEDROCK
  if (surfaceY < initialSurfaceY) {
    for (let y = surfaceY + ONE_BLOCK_ABOVE; y <= initialSurfaceY; y += AXIS_STEP) {
      blocks[blockIndex(lx, y, lz)] = BLOCK.AIR
    }
  }
}

const fillSolidSurface = (blocks: Uint16Array, column: ColumnFill, initialSurfaceY: number): void => {
  const { lx, lz, column: terrainColumn } = column
  const { surface, surfaceY } = terrainColumn
  fillBedrockAndClearRaisedSurface(blocks, column, initialSurfaceY)

  for (let y = Math.max(BEDROCK_Y + ONE_BLOCK_ABOVE, surfaceY - surface.fillerDepth); y < surfaceY; y += AXIS_STEP) {
    const index = blockIndex(lx, y, lz)
    if (readBlock(blocks, index) !== BLOCK.AIR || surfaceY < initialSurfaceY) {
      blocks[index] = surface.filler
    }
  }
  blocks[blockIndex(lx, surfaceY, lz)] = surface.top
}

const fillColumn = (blocks: Uint16Array, column: ColumnFill, initialSurfaceY: number): FilledColumn => {
  const { lx, lz, column: terrainColumn } = column
  const { biome, surfaceY, temperature, waterLevel } = terrainColumn
  fillSolidSurface(blocks, column, initialSurfaceY)

  // Water fills from just above the surface to the resolved body level. This happens
  // BEFORE carving, because the carver's guard probes for these blocks.
  fillWaterAtLevel({
    blocks,
    freezeSurface: shouldFreezeWaterSurface(biome, temperature),
    iceBlockIndex: BLOCK.ICE,
    lx,
    lz,
    surfaceY,
    waterBlockIndex: BLOCK.WATER,
    waterTopY: waterLevel,
  })

  return { surfaceY, waterLevel }
}

const plantTrunk = (blocks: Uint16Array, lx: number, lz: number, surfaceY: number, trunkHeight: number): void => {
  for (let offset = ONE_BLOCK_ABOVE; offset <= trunkHeight; offset += AXIS_STEP) {
    const y = surfaceY + offset
    // The density profile caps the exposed surface at MAX_SURFACE_Y (210), leaving room for the trunk and crown below CHUNK_HEIGHT (256).
    blocks[blockIndex(lx, y, lz)] = BLOCK.LOG
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
 * `Uint16Array` semantics either no-op or, for a negative index, wrap
 * unpredictably) — worse than letting the grid's own test catch it.
 */
const plantCanopyCell = (blocks: Uint16Array, x: number, z: number, crownY: number): void => {
  const index = blockIndex(x, crownY, z)
  if (readBlock(blocks, index) === BLOCK.AIR) {
    blocks[index] = BLOCK.LEAVES
  }
}

// Canopy, clipped to the chunk. Crossing a chunk border correctly needs the neighbour's buffer, which is the chunk manager's job — see docs/porting.md.
const plantCanopy = (blocks: Uint16Array, lx: number, lz: number, crownY: number): void => {
  for (let dx = -TREE_CROWN_RADIUS; dx <= TREE_CROWN_RADIUS; dx += AXIS_STEP) {
    for (let dz = -TREE_CROWN_RADIUS; dz <= TREE_CROWN_RADIUS; dz += AXIS_STEP) {
      if (!isTreeCanopyCorner(dx, dz)) {
        plantCanopyCell(blocks, lx + dx, lz + dz, crownY)
      }
    }
  }
}

const plantTree = (blocks: Uint16Array, lx: number, lz: number, surfaceY: number, trunkHeight: number): void => {
  plantTrunk(blocks, lx, lz, surfaceY, trunkHeight)
  plantCanopy(blocks, lx, lz, surfaceY + trunkHeight)
}

type ChunkBuffers = {
  readonly blocks: Uint16Array
  readonly biomes: Array<KernelBiomeType>
  readonly surfaceBiomes: Array<BiomeType>
  readonly initialSurfaces: Int16Array
  readonly surfaces: Int16Array
  readonly waterLevels: Int16Array
}

const createChunkBuffers = (): ChunkBuffers => ({
  biomes: new Array<KernelBiomeType>(CHUNK_COLUMN_COUNT),
  blocks: emptyBlocks(),
  initialSurfaces: new Int16Array(CHUNK_COLUMN_COUNT),
  surfaceBiomes: new Array<BiomeType>(CHUNK_COLUMN_COUNT),
  surfaces: new Int16Array(CHUNK_COLUMN_COUNT),
  waterLevels: new Int16Array(CHUNK_COLUMN_COUNT).fill(NO_WATER_LEVEL),
})

type ChunkGenerationContext = ChunkBuffers & {
  readonly minBlockX: number
  readonly minBlockZ: number
  readonly seed: NoiseSeed
  readonly coord: ChunkCoord
  readonly validatedChunk: ValidatedNaturalStructureChunkCoordinates
  readonly levels: TerrainLevels
  readonly densitySampler: TerrainDensitySampler
}

type IndexedValues<Value> = {
  readonly [index: number]: Value
}

const readRequired = <Value>(values: IndexedValues<Value>, index: number): Value => Option.getOrThrow(Option.fromNullishOr(values[index]))

const invalidTerrainLevels = (field: InvalidTerrainLevelsFields['field']): Result.Result<never, InvalidTerrainLevels> =>
  Result.fail(new InvalidTerrainLevels({ field }))

const terrainLevelsForGeneration = (options: unknown): Result.Result<TerrainLevels, InvalidTerrainLevels> => {
  if (typeof options !== 'object' || options === null || Array.isArray(options)) {
    return invalidTerrainLevels('options')
  }
  if (!Object.hasOwn(options, 'terrainLevels')) {
    return Result.succeed(DEFAULT_TERRAIN_LEVELS)
  }
  const descriptor = Object.getOwnPropertyDescriptor(options, 'terrainLevels')
  if (!descriptor || !('value' in descriptor)) {
    return invalidTerrainLevels('terrainLevels')
  }
  const decoded = Schema.decodeUnknownResult(TERRAIN_LEVELS_SCHEMA)(descriptor.value)
  return Result.mapError(decoded, () => new InvalidTerrainLevels({ field: 'terrainLevels' }))
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const invalidCarveOptions = (): Result.Result<never, InvalidTerrainLevels> =>
  Result.fail(new InvalidTerrainLevels({ field: 'options' }))

const marginOptionsForGeneration = (carve: Record<string, unknown>): Result.Result<CarveOptions, InvalidTerrainLevels> => {
  const marginDescriptor = Object.getOwnPropertyDescriptor(carve, 'waterFloorMargin')
  if (!marginDescriptor) {
    return Result.succeed({})
  }
  if (!('value' in marginDescriptor)) {
    return Result.fail(new InvalidTerrainLevels({ field: 'waterFloorMargin' }))
  }

  const margin = validateWaterFloorMargin(marginDescriptor.value)
  if (Result.isFailure(margin)) {
    return Result.fail(new InvalidTerrainLevels({ field: 'waterFloorMargin' }))
  }
  return Result.succeed({ waterFloorMargin: margin.success })
}

const carveOptionsFromValue = (carve: unknown): Result.Result<CarveOptions, InvalidTerrainLevels> => {
  if (!isRecord(carve)) {
    return invalidCarveOptions()
  }
  return marginOptionsForGeneration(carve)
}

const carveOptionsForGeneration = (options: GenerateOptions): Result.Result<CarveOptions, InvalidTerrainLevels> => {
  const carveDescriptor = Object.getOwnPropertyDescriptor(options, 'carve')
  if (!carveDescriptor) {
    return Result.succeed({})
  }
  if (!('value' in carveDescriptor)) {
    return invalidCarveOptions()
  }
  return carveOptionsFromValue(carveDescriptor.value)
}

type ResolvedGenerateOptions = Readonly<{
  carve: CarveOptions
  generation: GenerateOptions
  terrainLevels: TerrainLevels
}>

const resolvedGenerateOptionsForGeneration = (
  options: GenerateOptions,
): Result.Result<ResolvedGenerateOptions, InvalidTerrainLevels> => {
  const terrainLevels = terrainLevelsForGeneration(options)
  if (Result.isFailure(terrainLevels)) {
    return Result.fail(terrainLevels.failure)
  }
  const carve = carveOptionsForGeneration(options)
  if (Result.isFailure(carve)) {
    return Result.fail(carve.failure)
  }
  return Result.succeed({ carve: carve.success, generation: options, terrainLevels: terrainLevels.success })
}

const createChunkGenerationContext = (
  seed: NoiseSeed,
  validatedChunk: ValidatedNaturalStructureChunkCoordinates,
  levels: TerrainLevels,
  densitySampler: TerrainDensitySampler,
): ChunkGenerationContext => ({
  ...createChunkBuffers(),
  coord: validatedChunk.coord,
  densitySampler,
  levels,
  minBlockX: validatedChunk.minBlockX,
  minBlockZ: validatedChunk.minBlockZ,
  seed,
  validatedChunk,
})

/**
 * `context.surfaces`, `context.biomes`, and `context.waterLevels` are filled
 * for every local column before these accessors are used. `readRequired`
 * preserves that invariant without inventing a fallback value for an invalid
 * index.
 */
const columnSurfaceY = (context: ChunkGenerationContext, lx: number, lz: number): number =>
  readRequired(context.surfaces, columnIndexForKnownLocalRange(lx, lz))

const columnBiome = (context: ChunkGenerationContext, lx: number, lz: number): BiomeType =>
  readRequired(context.surfaceBiomes, columnIndexForKnownLocalRange(lx, lz))

const columnWaterLevel = (context: ChunkGenerationContext, lx: number, lz: number): number | null => {
  const waterLevel = readRequired(context.waterLevels, columnIndexForKnownLocalRange(lx, lz))
  if (waterLevel === NO_WATER_LEVEL) {
    return null
  }
  return waterLevel
}

const writeColumnBuffers = (
  context: ChunkGenerationContext,
  index: number,
  terrainColumn: TerrainColumnForGeneration,
  filled: FilledColumn,
): void => {
  context.biomes[index] = terrainColumn.kernelBiome
  context.surfaceBiomes[index] = terrainColumn.biome
  context.initialSurfaces[index] = terrainColumn.initialSurfaceY
  context.surfaces[index] = filled.surfaceY
  context.waterLevels[index] = filled.waterLevel ?? NO_WATER_LEVEL
}

type DensityColumnRequest = Readonly<{
  blocks: Uint16Array
  densitySamples: Float64Array
  lx: number
  lz: number
}>

const densityColumnStartIndex = (blocks: Uint16Array, lx: number, lz: number): number => {
  const bedrockIndex = blockIndex(lx, BEDROCK_Y, lz)
  blocks[bedrockIndex] = BLOCK.BEDROCK
  return bedrockIndex + ONE_BLOCK_ABOVE
}

const solidBlockForY = (y: number): number => {
  if (y < DEEPSLATE_CEILING) {
    return BLOCK.DEEPSLATE
  }
  return BLOCK.STONE
}

const fillDensityColumn = ({ blocks, densitySamples, lx, lz }: DensityColumnRequest): number => {
  let initialSurfaceY = BEDROCK_Y + ONE_BLOCK_ABOVE
  let y = initialSurfaceY
  let blockIndexAtY = densityColumnStartIndex(blocks, lx, lz)
  for (const density of densitySamples) {
    if (density > DENSITY_SURFACE_THRESHOLD) {
      blocks[blockIndexAtY] = solidBlockForY(y)
      initialSurfaceY = y
    }
    blockIndexAtY += AXIS_STEP
    y += AXIS_STEP
  }
  return initialSurfaceY
}

const resolveGeneratedTerrainColumn = (
  context: ChunkGenerationContext,
  wx: number,
  wz: number,
  initialSurfaceY: number,
): TerrainColumnForGeneration =>
  resolveTerrainColumnForGenerationValue(
    context.seed,
    blockAxisFromKnownSafeInteger(wx),
    blockAxisFromKnownSafeInteger(wz),
    context.levels,
    blockAxisFromKnownSafeInteger(initialSurfaceY),
  )

type PreparedTerrainColumn = Readonly<{
  column: TerrainColumnForGeneration
  surfaceY: number
}>

const prepareTerrainColumn = (
  context: ChunkGenerationContext,
  densityGrid: TerrainDensityGrid,
  densitySamples: Float64Array,
  lx: number,
  lz: number,
): PreparedTerrainColumn => {
  const wx = context.minBlockX + lx
  const wz = context.minBlockZ + lz
  densityGrid.sampleColumn(lx, lz, densitySamples)
  const initialSurfaceY = fillDensityColumn({
    blocks: context.blocks,
    densitySamples,
    lx,
    lz,
  })
  const column = resolveGeneratedTerrainColumn(context, wx, wz, initialSurfaceY)
  return { column, surfaceY: initialSurfaceY }
}

const generateColumn = (
  context: ChunkGenerationContext,
  densityGrid: TerrainDensityGrid,
  densitySamples: Float64Array,
  lx: number,
  lz: number,
): void => {
  const prepared = prepareTerrainColumn(context, densityGrid, densitySamples, lx, lz)
  const { column, surfaceY } = prepared
  const filled = fillColumn(context.blocks, { column, lx, lz }, surfaceY)
  writeColumnBuffers(context, columnIndexForKnownLocalRange(lx, lz), column, filled)
}

const generateColumns = (
  context: ChunkGenerationContext,
  sampler: TerrainDensitySampler,
): void => {
  const densityGrid = createTerrainDensityGrid(
    sampler.densityAtForGeneration,
    blockAxisFromKnownSafeInteger(context.minBlockX),
    blockAxisFromKnownSafeInteger(context.minBlockZ),
  )
  const densitySamples = new Float64Array(MAX_SURFACE_Y - BEDROCK_Y)
  for (let lx = 0; lx < CHUNK_SIZE_XZ; lx += AXIS_STEP) {
    for (let lz = 0; lz < CHUNK_SIZE_XZ; lz += AXIS_STEP) {
      generateColumn(context, densityGrid, densitySamples, lx, lz)
    }
  }
}

const plantTreeForColumn = (
  context: ChunkGenerationContext,
  lx: number,
  lz: number,
  configuration: TreeBiomeConfiguration,
): void => {
  if (configuration.species === null) {
    return
  }
  const surfaceY = columnSurfaceY(context, lx, lz)
  const worldX = context.minBlockX + lx
  const worldZ = context.minBlockZ + lz
  const candidate = treeCellCandidate(
    cellOf(blockAxisFromKnownSafeInteger(worldX)),
    cellOf(blockAxisFromKnownSafeInteger(worldZ)),
  )
  if (
    shouldPlaceTreeWithKnownConfiguration(
      {
        surfaceY: blockAxisFromKnownSafeInteger(surfaceY),
        terrainLevels: context.levels,
        worldX: blockAxisFromKnownSafeInteger(worldX),
        worldZ: blockAxisFromKnownSafeInteger(worldZ),
      },
      configuration,
      candidate,
    )
  ) {
    const trunkHeight = treeTrunkHeightForConfiguration(configuration, candidate.cellRng)
    plantTree(context.blocks, lx, lz, surfaceY, trunkHeight)
  }
}

const plantTreesPass = (context: ChunkGenerationContext): Result.Result<void, UnsupportedTreeBiome> => {
  for (let lx = 0; lx < CHUNK_SIZE_XZ; lx += AXIS_STEP) {
    for (let lz = 0; lz < CHUNK_SIZE_XZ; lz += AXIS_STEP) {
      const biome = readRequired(context.biomes, columnIndexForKnownLocalRange(lx, lz))
      const configuration = treeConfigurationForBiome(biome)
      if (Result.isFailure(configuration)) {
        return Result.fail(configuration.failure)
      }
      plantTreeForColumn(context, lx, lz, configuration.success)
    }
  }
  return Result.void
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
        worldX: context.minBlockX + lx,
        worldZ: context.minBlockZ + lz,
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
      const wx = context.minBlockX + lx
      const wz = context.minBlockZ + lz

      if (
        shouldPlaceGroundPlant({ biome, seed: context.seed, surfaceY, worldX: wx, worldZ: wz }) &&
        canPlaceGroundPlantAt(context.blocks, lx, surfaceY, lz)
      ) {
        plantGroundCover(context.blocks, { lx, lz, surfaceY }, groundPlantAt(context.seed, wx, wz, biome))
      }
    }
  }
}

const decorateChunk = (context: ChunkGenerationContext): Result.Result<void, UnsupportedTreeBiome> => {
  const trees = plantTreesPass(context)
  if (Result.isFailure(trees)) {
    return Result.fail(trees.failure)
  }
  plantSpecialVegetationPass(context)
  plantGroundCoverPass(context)
  return Result.void
}

type TerrainSampleResult = Result.Result<OverworldTerrainSample, TerrainGenerationError>
type TerrainSampleCache = Map<number, Map<number, TerrainSampleResult>>

const localColumnFor = (
  context: ChunkGenerationContext,
  wx: BlockAxis,
  wz: BlockAxis,
): number | null => {
  const lx = wx - context.minBlockX
  const lz = wz - context.minBlockZ
  if (lx < LOCAL_COLUMN_MIN || lx >= CHUNK_SIZE_XZ || lz < LOCAL_COLUMN_MIN || lz >= CHUNK_SIZE_XZ) {
    return null
  }
  return columnIndexForKnownLocalRange(lx, lz)
}

const localStructureTerrainSample = (
  context: ChunkGenerationContext,
  localColumn: number,
): TerrainSampleResult => Result.succeed({
  biome: readRequired(context.surfaceBiomes, localColumn),
  seaLevel: blockAxisFromKnownSafeInteger(context.levels.seaLevel),
  surfaceY: blockAxisFromKnownSafeInteger(readRequired(context.surfaces, localColumn)),
})

const externalStructureTerrainSample = (
  context: ChunkGenerationContext,
  wx: BlockAxis,
  wz: BlockAxis,
): TerrainSampleResult => {
  const initialSurface = context.densitySampler.surfaceHeightAt(wx, wz)
  if (Result.isFailure(initialSurface)) {
    return Result.fail(initialSurface.failure)
  }
  const resolved = resolveGeneratedTerrainColumn(context, wx, wz, initialSurface.success)
  return Result.succeed({
    biome: resolved.biome,
    seaLevel: blockAxisFromKnownSafeInteger(context.levels.seaLevel),
    surfaceY: blockAxisFromKnownSafeInteger(resolved.surfaceY),
  })
}

const cacheTerrainSample = (
  terrainSamples: TerrainSampleCache,
  wx: number,
  wz: number,
  sample: TerrainSampleResult,
): void => {
  const samplesAtX = terrainSamples.get(wx)
  if (samplesAtX) {
    samplesAtX.set(wz, sample)
  } else {
    terrainSamples.set(wx, new Map([[wz, sample]]))
  }
}

const structureTerrainSampleFor = (
  context: ChunkGenerationContext,
  localColumn: number | null,
  wx: BlockAxis,
  wz: BlockAxis,
): TerrainSampleResult => {
  if (localColumn === null) {
    return externalStructureTerrainSample(context, wx, wz)
  }
  return localStructureTerrainSample(context, localColumn)
}

const structureTerrainSampleAt = (
  context: ChunkGenerationContext,
  terrainSamples: TerrainSampleCache,
  wx: BlockAxis,
  wz: BlockAxis,
): TerrainSampleResult => {
  const cached = terrainSamples.get(wx)?.get(wz)
  if (cached) {return cached}
  const localColumn = localColumnFor(context, wx, wz)
  const sample = structureTerrainSampleFor(context, localColumn, wx, wz)
  cacheTerrainSample(terrainSamples, wx, wz, sample)
  return sample
}

/** Structures run last so their shell, roads and interiors override carving and vegetation. */
const writeStructures = (
  chunk: Chunk,
  context: ChunkGenerationContext,
): Result.Result<NaturalStructureChunk, InvalidNaturalStructureCoordinate | TerrainGenerationError> => {
  const terrainSamples: TerrainSampleCache = new Map()
  const sampleTerrain: OverworldTerrainResultSampler = (wx, wz) =>
    structureTerrainSampleAt(context, terrainSamples, wx, wz)
  const plansResult = naturalStructurePlansForValidatedChunk(context.seed, 'overworld', context.validatedChunk, {
    overworldResult: sampleTerrain,
  })
  return Result.map(plansResult, (plans) => applyNaturalStructurePlansToChunk(chunk, plans))
}

/**
 * Generate a chunk. Total, pure, and a function of `(seed, coord)` alone.
 */
const placeOresAndDecorate = (
  context: ChunkGenerationContext,
  options: GenerateOptions,
): Result.Result<void, UnsupportedTreeBiome> => {
  // Ore goes in AFTER carving, so that a cave wall can expose a vein, and it is
  // NOT behind `decorate` — ore is stone, not decoration. See `domain/ore.ts`.
  placeOres(context.blocks, context.seed, context.coord, context.biomes)

  if (options.decorate !== false) {
    const decoration = decorateChunk(context)
    if (Result.isFailure(decoration)) {
      return Result.fail(decoration.failure)
    }
  }

  // Ravines LAST, after ore and after decoration, so their walls cut cleanly through both — the reference's ordering and its stated reason (`generator.ts:141-142`). See the module header for why this is outside the `decorate` block rather than at the end of it.
  carveRavines({
    biomes: context.surfaceBiomes,
    blocks: context.blocks,
    coord: context.coord,
    seed: context.seed,
    surfaces: context.surfaces,
  })
  return Result.void
}

const runTerrainPassesBeforeStructures = (
  context: ChunkGenerationContext,
  options: GenerateOptions,
  carveOptions: CarveOptions,
  sampler: TerrainDensitySampler,
): Result.Result<void, InvalidTerrainLevels> => {
  generateColumns(context, sampler)
  const caves = carveCaves(context.blocks, context.seed, context.coord, carveOptions)
  if (Result.isFailure(caves)) {
    return Result.fail(new InvalidTerrainLevels({ field: 'waterFloorMargin' }))
  }
  return placeOresAndDecorate(context, options)
}

const generateValidatedChunk = (
  seed: NoiseSeed,
  validatedChunk: ValidatedNaturalStructureChunkCoordinates,
  options: ResolvedGenerateOptions,
  sampler: TerrainDensitySampler,
): Result.Result<NaturalStructureChunk, InvalidNaturalStructureCoordinate | InvalidTerrainLevels> => {
  const context = createChunkGenerationContext(seed, validatedChunk, options.terrainLevels, sampler)
  const passes = runTerrainPassesBeforeStructures(context, options.generation, options.carve, sampler)
  if (Result.isFailure(passes)) {
    return Result.fail(passes.failure)
  }
  return writeStructures({ biomes: context.biomes, blocks: context.blocks, coord: validatedChunk.coord }, context)
}

export const generateChunk = (
  seed: NoiseSeed,
  coord: ChunkCoord,
  options: GenerateOptions = {},
): Result.Result<
  NaturalStructureChunk,
  InvalidNaturalStructureCoordinate | InvalidTerrainLevels
> => {
  const coordinateValidation = validateNaturalStructureChunkCoordinates('overworld', coord)
  if (Result.isFailure(coordinateValidation)) {
    return Result.fail(coordinateValidation.failure)
  }
  const resolvedOptions = resolvedGenerateOptionsForGeneration(options)
  if (Result.isFailure(resolvedOptions)) {
    return Result.fail(resolvedOptions.failure)
  }
  const sampler = createTerrainDensitySampler(seed)
  if (Result.isFailure(sampler)) {
    return Result.fail(sampler.failure)
  }
  return generateValidatedChunk(
    seed,
    coordinateValidation.success,
    resolvedOptions.success,
    sampler.success,
  )
}

/** Convenience for callers that have plain numbers rather than a `ChunkCoord`. */
export const generateChunkAt = (
  seed: NoiseSeed,
  x: ChunkAxis,
  z: ChunkAxis,
  options: GenerateOptions = {},
): ReturnType<typeof generateChunk> =>
  generateChunk(seed, { cx: x, cz: z }, options)

/** Re-exported so callers need one import to read a generated chunk. */
export { biomeAt }
