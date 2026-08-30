/**
 * Deterministic vegetation placement for surface and aquatic columns.
 *
 * The block roster lives in `vegetation-data.ts`; this module owns placement
 * rules and keeps the terrain pass independent from the data table.
 */
import { BEDROCK_Y, CHUNK_HEIGHT, CHUNK_SIZE_XZ, blockIndex } from './constants'
import { BIOME_SURFACES, BLOCK, type BiomeType } from './biome'
import { type BlockId, canBlockStaySupported } from '@nerima-games/mc-kernel'
import {
  GROUND_PLANT_DENSITY,
  MUSHROOM_BIOMES,
  PLANT,
} from './vegetation-data'
import { channelSeed, latticeValue } from '@nerima-games/mc-noise'
import { readBlock } from './chunk'

export {
  AQUATIC_PLANT_IDS,
  GROUND_COVER_IDS,
  GROUND_PLANT_DENSITY,
  MUSHROOM_BIOMES,
  MUSHROOM_IDS,
  PLANT,
  PLANT_IDS,
  STACKED_PLANT_IDS,
} from './vegetation-data'

const PLACEMENT_CHANNEL = 'ground-plant-placement'
const VARIANT_CHANNEL = 'ground-plant-variant'
const SPECIAL_PLACEMENT_CHANNEL = 'special-vegetation-placement'
const AQUATIC_VARIANT_CHANNEL = 'aquatic-plant-variant'
const SPECIAL_HEIGHT_CHANNEL = 'special-plant-height'
const MUSHROOM_VARIANT_CHANNEL = 'mushroom-variant'

const NO_GROUND_PLANT_DENSITY = 0
const MIN_LOCAL_COLUMN = 0
const ABOVE_SURFACE_OFFSET = 1
const TOP_Y_INDEX_OFFSET = 1
const SPECIAL_PLANT_CHANCE = 0.08
const MUSHROOM_CHANCE = 0.05
const LILY_PAD_CHANCE = 0.14
const AQUATIC_VARIANT_THRESHOLD = 0.5
const MAX_NATURAL_PLANT_HEIGHT = 3

const AQUATIC_SUPPORTS: ReadonlyArray<BlockId> = [BLOCK.DIRT, BLOCK.GRASS, BLOCK.SAND, BLOCK.GRAVEL]
const HORIZONTAL_DELTAS: ReadonlyArray<readonly [number, number]> = [
  [-ABOVE_SURFACE_OFFSET, MIN_LOCAL_COLUMN],
  [ABOVE_SURFACE_OFFSET, MIN_LOCAL_COLUMN],
  [MIN_LOCAL_COLUMN, -ABOVE_SURFACE_OFFSET],
  [MIN_LOCAL_COLUMN, ABOVE_SURFACE_OFFSET],
]

/** A deterministic, seeded, independent draw in [0, 1) for one world column. */
export const plantRoll = (seed: number, wx: number, wz: number, channel: string): number =>
  latticeValue(channelSeed(seed, channel), wx, wz)

/** Does the density roll pass for this column? */
export const shouldPlaceGroundPlant = (input: {
  readonly seed: number
  readonly worldX: number
  readonly worldZ: number
  readonly biome: BiomeType
  readonly surfaceY: number
}): boolean => {
  const density = GROUND_PLANT_DENSITY[input.biome]

  if (
    density <= NO_GROUND_PLANT_DENSITY ||
    input.surfaceY <= BEDROCK_Y ||
    input.surfaceY >= CHUNK_HEIGHT - TOP_Y_INDEX_OFFSET
  ) {
    return false
  }

  return plantRoll(input.seed, input.worldX, input.worldZ, PLACEMENT_CHANNEL) < density
}

type VariantThreshold = readonly [threshold: number, plant: BlockId]

const TAIGA_FERN_THRESHOLD = 0.65
const JUNGLE_FERN_THRESHOLD = 0.55
const FOREST_DANDELION_THRESHOLD = 0.12
const FOREST_POPPY_THRESHOLD = 0.2
const FOREST_FERN_THRESHOLD = 0.55
const FLOWER_FOREST_DANDELION_THRESHOLD = 0.4
const FLOWER_FOREST_POPPY_THRESHOLD = 0.75
const SWAMP_FERN_THRESHOLD = 0.4
const PLAINS_SAVANNA_DANDELION_THRESHOLD = 0.12
const PLAINS_SAVANNA_POPPY_THRESHOLD = 0.22

const PLAINS_SAVANNA_VARIANT_TABLE: ReadonlyArray<VariantThreshold> = [
  [PLAINS_SAVANNA_DANDELION_THRESHOLD, PLANT.DANDELION],
  [PLAINS_SAVANNA_POPPY_THRESHOLD, PLANT.POPPY],
]

const GROUND_PLANT_VARIANT_TABLE: Partial<Record<BiomeType, ReadonlyArray<VariantThreshold>>> = {
  FLOWER_FOREST: [
    [FLOWER_FOREST_DANDELION_THRESHOLD, PLANT.DANDELION],
    [FLOWER_FOREST_POPPY_THRESHOLD, PLANT.POPPY],
  ],
  FOREST: [
    [FOREST_DANDELION_THRESHOLD, PLANT.DANDELION],
    [FOREST_POPPY_THRESHOLD, PLANT.POPPY],
    [FOREST_FERN_THRESHOLD, PLANT.FERN],
  ],
  JUNGLE: [[JUNGLE_FERN_THRESHOLD, PLANT.FERN]],
  PLAINS: PLAINS_SAVANNA_VARIANT_TABLE,
  SAVANNA: PLAINS_SAVANNA_VARIANT_TABLE,
  SWAMP: [[SWAMP_FERN_THRESHOLD, PLANT.FERN]],
  TAIGA: [[TAIGA_FERN_THRESHOLD, PLANT.FERN]],
}

/** Select the single-block ground-cover variant for a world column. */
export const groundPlantAt = (seed: number, wx: number, wz: number, biome: BiomeType): BlockId => {
  const variant = plantRoll(seed, wx, wz, VARIANT_CHANNEL)
  const table = GROUND_PLANT_VARIANT_TABLE[biome] ?? []

  for (const [threshold, plant] of table) {
    if (variant < threshold) {
      return plant
    }
  }

  return PLANT.TALL_GRASS
}

/** Is a ground-cover cell supported and empty? */
export const canPlaceGroundPlantAt = (blocks: Uint8Array, lx: number, surfaceY: number, lz: number): boolean => {
  const support = readBlock(blocks, blockIndex(lx, surfaceY, lz))

  return (
    (support === BLOCK.GRASS || support === BLOCK.DIRT) &&
    readBlock(blocks, blockIndex(lx, surfaceY + ABOVE_SURFACE_OFFSET, lz)) === BLOCK.AIR
  )
}

/** Whether the biome surface and density table can grow ground cover. */
export const biomeCanGrowGroundPlants = (biome: BiomeType): boolean => {
  const { top } = BIOME_SURFACES[biome]
  return GROUND_PLANT_DENSITY[biome] > NO_GROUND_PLANT_DENSITY && (top === BLOCK.GRASS || top === BLOCK.DIRT)
}

/** Place one ground-cover block above its support. */
export const plantGroundCover = (
  blocks: Uint8Array,
  column: { readonly lx: number; readonly surfaceY: number; readonly lz: number },
  plant: BlockId,
): void => {
  blocks[blockIndex(column.lx, column.surfaceY + ABOVE_SURFACE_OFFSET, column.lz)] = plant
}

export type SpecialVegetationInput = {
  readonly blocks: Uint8Array
  readonly biome: BiomeType
  readonly lx: number
  readonly lz: number
  readonly surfaceY: number
  readonly waterLevel: number
  readonly seed: number
  readonly worldX: number
  readonly worldZ: number
}

const isValidColumn = (value: number): boolean => Number.isInteger(value) && value >= MIN_LOCAL_COLUMN && value < CHUNK_SIZE_XZ

const isValidY = (value: number): boolean => Number.isInteger(value) && value >= BEDROCK_Y && value < CHUNK_HEIGHT

const readLocalBlock = (blocks: Uint8Array, lx: number, y: number, lz: number): BlockId => {
  if (!isValidColumn(lx) || !isValidColumn(lz) || !isValidY(y)) {
    return BLOCK.AIR
  }

  return readBlock(blocks, blockIndex(lx, y, lz)) as BlockId
}

const hasHorizontalBlock = (
  blocks: Uint8Array,
  lx: number,
  y: number,
  lz: number,
  expected: BlockId,
): boolean => {
  for (const [dx, dz] of HORIZONTAL_DELTAS) {
    const neighborX = lx + dx
    const neighborZ = lz + dz

    if (!isValidColumn(neighborX) || !isValidColumn(neighborZ) || readLocalBlock(blocks, neighborX, y, neighborZ) !== expected) {
      return false
    }
  }

  return true
}

const hasHorizontalWater = (blocks: Uint8Array, lx: number, y: number, lz: number): boolean => {
  for (const [dx, dz] of HORIZONTAL_DELTAS) {
    if (readLocalBlock(blocks, lx + dx, y, lz + dz) === BLOCK.WATER) {
      return true
    }
  }

  return false
}

type SupportedPlantPlacement = {
  readonly above?: BlockId
  readonly blocks: Uint8Array
  readonly isSupported: (support: BlockId) => boolean
  readonly lx: number
  readonly lz: number
  readonly surfaceY: number
}

const canPlaceSupportedPlantAt = ({ above = BLOCK.AIR, blocks, isSupported, lx, lz, surfaceY }: SupportedPlantPlacement): boolean =>
  isValidColumn(lx) &&
  isValidColumn(lz) &&
  isValidY(surfaceY) &&
  isValidY(surfaceY + ABOVE_SURFACE_OFFSET) &&
  isSupported(readLocalBlock(blocks, lx, surfaceY, lz)) &&
  readLocalBlock(blocks, lx, surfaceY + ABOVE_SURFACE_OFFSET, lz) === above

const supportsCactus = (support: BlockId): boolean => canBlockStaySupported(PLANT.CACTUS, support)

const supportsSugarCane = (support: BlockId): boolean => canBlockStaySupported(PLANT.SUGAR_CANE, support)

const supportsAquaticPlant = (support: BlockId): boolean => AQUATIC_SUPPORTS.includes(support)

const supportsMushroom = (support: BlockId): boolean => support === BLOCK.DIRT || support === BLOCK.GRASS

/** Can a cactus start on this column without touching a neighboring block? */
export const canPlaceCactusAt = (blocks: Uint8Array, lx: number, surfaceY: number, lz: number): boolean =>
  canPlaceSupportedPlantAt({ blocks, isSupported: supportsCactus, lx, lz, surfaceY }) &&
  hasHorizontalBlock(blocks, lx, surfaceY + ABOVE_SURFACE_OFFSET, lz, BLOCK.AIR)

/** Can sugar cane start on this column beside at least one water block? */
export const canPlaceSugarCaneAt = (blocks: Uint8Array, lx: number, surfaceY: number, lz: number): boolean =>
  canPlaceSupportedPlantAt({ blocks, isSupported: supportsSugarCane, lx, lz, surfaceY }) &&
  hasHorizontalWater(blocks, lx, surfaceY, lz)

/** Can an aquatic plant occupy the first water cell above this floor? */
export const canPlaceAquaticPlantAt = (blocks: Uint8Array, lx: number, surfaceY: number, lz: number): boolean =>
  canPlaceSupportedPlantAt({ above: BLOCK.WATER, blocks, isSupported: supportsAquaticPlant, lx, lz, surfaceY })

/** Can a swamp lily pad occupy the water surface? */
type LilyPadPlacement = {
  readonly biome: BiomeType
  readonly blocks: Uint8Array
  readonly lx: number
  readonly lz: number
  readonly waterLevel: number
  readonly surfaceY: number
}

export const canPlaceLilyPadAt = ({ biome, blocks, lx, lz, waterLevel, surfaceY }: LilyPadPlacement): boolean =>
  biome === 'SWAMP' &&
  surfaceY < waterLevel &&
  isValidColumn(lx) &&
  isValidColumn(lz) &&
  isValidY(waterLevel) &&
  isValidY(waterLevel + ABOVE_SURFACE_OFFSET) &&
  readLocalBlock(blocks, lx, waterLevel, lz) === BLOCK.WATER &&
  readLocalBlock(blocks, lx, waterLevel + ABOVE_SURFACE_OFFSET, lz) === BLOCK.AIR

type AirStackOptions = {
  readonly blocks: Uint8Array
  readonly clearNeighbors: boolean
  readonly height: number
  readonly lx: number
  readonly lz: number
  readonly plant: BlockId
  readonly surfaceY: number
}

const placeAirStack = ({ blocks, clearNeighbors, height, lx, lz, plant, surfaceY }: AirStackOptions): number => {
  let placed = 0

  for (let offset = ABOVE_SURFACE_OFFSET; offset <= height; offset += ABOVE_SURFACE_OFFSET) {
    const y = surfaceY + offset

    if (!isValidY(y) || readLocalBlock(blocks, lx, y, lz) !== BLOCK.AIR) {
      break
    }

    if (clearNeighbors && !hasHorizontalBlock(blocks, lx, y, lz, BLOCK.AIR)) {
      break
    }

    blocks[blockIndex(lx, y, lz)] = plant
    placed += ABOVE_SURFACE_OFFSET
  }

  return placed
}

type WaterStackOptions = Omit<AirStackOptions, 'clearNeighbors'>

const placeWaterStack = ({ blocks, height, lx, lz, plant, surfaceY }: WaterStackOptions): number => {
  let placed = 0

  for (let offset = ABOVE_SURFACE_OFFSET; offset <= height; offset += ABOVE_SURFACE_OFFSET) {
    const y = surfaceY + offset

    if (!isValidY(y) || readLocalBlock(blocks, lx, y, lz) !== BLOCK.WATER) {
      break
    }

    blocks[blockIndex(lx, y, lz)] = plant
    placed += ABOVE_SURFACE_OFFSET
  }

  return placed
}

const specialPlantHeight = (seed: number, wx: number, wz: number): number =>
  Math.floor(plantRoll(seed, wx, wz, SPECIAL_HEIGHT_CHANNEL) * MAX_NATURAL_PLANT_HEIGHT) + ABOVE_SURFACE_OFFSET

const plantAquaticColumn = (input: SpecialVegetationInput): void => {
  if (!canPlaceAquaticPlantAt(input.blocks, input.lx, input.surfaceY, input.lz)) {
    return
  }

  const variant = plantRoll(input.seed, input.worldX, input.worldZ, AQUATIC_VARIANT_CHANNEL)

  if (variant < AQUATIC_VARIANT_THRESHOLD) {
    input.blocks[blockIndex(input.lx, input.surfaceY + ABOVE_SURFACE_OFFSET, input.lz)] = PLANT.SEAGRASS
    return
  }

  placeWaterStack({
    blocks: input.blocks,
    height: specialPlantHeight(input.seed, input.worldX, input.worldZ),
    lx: input.lx,
    lz: input.lz,
    plant: PLANT.KELP,
    surfaceY: input.surfaceY,
  })
}

const plantLilyPad = (input: SpecialVegetationInput): void => {
  if (
    canPlaceLilyPadAt(input) &&
    plantRoll(input.seed, input.worldX, input.worldZ, SPECIAL_PLACEMENT_CHANNEL) < LILY_PAD_CHANCE
  ) {
    input.blocks[blockIndex(input.lx, input.waterLevel + ABOVE_SURFACE_OFFSET, input.lz)] = PLANT.LILY_PAD
  }
}

const plantDryCactusOrSugar = (input: SpecialVegetationInput): boolean => {
  const isCactusBiome = input.biome === 'DESERT' || input.biome === 'BEACH'

  if (
    isCactusBiome &&
    canPlaceCactusAt(input.blocks, input.lx, input.surfaceY, input.lz) &&
    plantRoll(input.seed, input.worldX, input.worldZ, SPECIAL_PLACEMENT_CHANNEL) < SPECIAL_PLANT_CHANCE
  ) {
    placeAirStack({
      blocks: input.blocks,
      clearNeighbors: true,
      height: specialPlantHeight(input.seed, input.worldX, input.worldZ),
      lx: input.lx,
      lz: input.lz,
      plant: PLANT.CACTUS,
      surfaceY: input.surfaceY,
    })
    return true
  }

  if (
    canPlaceSugarCaneAt(input.blocks, input.lx, input.surfaceY, input.lz) &&
    plantRoll(input.seed, input.worldX, input.worldZ, SPECIAL_PLACEMENT_CHANNEL) < SPECIAL_PLANT_CHANCE
  ) {
    placeAirStack({
      blocks: input.blocks,
      clearNeighbors: false,
      height: specialPlantHeight(input.seed, input.worldX, input.worldZ),
      lx: input.lx,
      lz: input.lz,
      plant: PLANT.SUGAR_CANE,
      surfaceY: input.surfaceY,
    })
    return true
  }

  return false
}

const plantDryMushroom = (input: SpecialVegetationInput): void => {

  if (
    MUSHROOM_BIOMES.has(input.biome) &&
    canPlaceSupportedPlantAt({
      blocks: input.blocks,
      isSupported: supportsMushroom,
      lx: input.lx,
      lz: input.lz,
      surfaceY: input.surfaceY,
    }) &&
    plantRoll(input.seed, input.worldX, input.worldZ, SPECIAL_PLACEMENT_CHANNEL) < MUSHROOM_CHANCE
  ) {
    let mushroom = PLANT.RED_MUSHROOM
    if (plantRoll(input.seed, input.worldX, input.worldZ, MUSHROOM_VARIANT_CHANNEL) < AQUATIC_VARIANT_THRESHOLD) {
      mushroom = PLANT.BROWN_MUSHROOM
    }
    input.blocks[blockIndex(input.lx, input.surfaceY + ABOVE_SURFACE_OFFSET, input.lz)] = mushroom
  }
}

const plantDrySpecialColumn = (input: SpecialVegetationInput): void => {
  if (plantDryCactusOrSugar(input)) {
    return
  }

  plantDryMushroom(input)
}

/** Place the special vegetation whose support rules differ from ground cover. */
export const plantSpecialVegetation = (input: SpecialVegetationInput): void => {
  if (input.surfaceY <= BEDROCK_Y || input.surfaceY >= CHUNK_HEIGHT - TOP_Y_INDEX_OFFSET) {
    return
  }

  if (input.surfaceY < input.waterLevel) {
    plantAquaticColumn(input)
    plantLilyPad(input)
    return
  }

  plantDrySpecialColumn(input)
}
