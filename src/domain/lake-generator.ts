import { DEFAULT_TERRAIN_LEVELS, type TerrainLevels, blockIndex } from './constants.js'
import {
  ICE_FREEZE_TEMPERATURE,
  LAKE_MAX_DEPTH,
  LAKE_SHORE_WIDTH,
  LAKE_THRESHOLD,
  RIVER_MAX_CUT,
  RIVER_MIN_CUT,
  RIVER_WATER_LEVEL,
} from './lake-config.js'
import type { BiomeType } from './biome.js'
import type { BlockAxis } from '@nerima-games/mc-kernel/domain/coordinates'
import { Option } from 'effect'
import { blockAxisFromKnownSafeInteger } from './coordinate-compatibility.js'

const NORMALIZED_MIN = 0
const NORMALIZED_MAX = 1
const SMOOTHSTEP_CUBIC_FACTOR = 3
const SMOOTHSTEP_LINEAR_FACTOR = 2
const BASIN_SURFACE_OFFSET = 1
const RIVER_SURFACE_CEILING_OFFSET = 2
const LAKE_SHORE_HEIGHT_MARGIN = 4
const BLOCK_STEP = 1

const smoothstep01 = (value: number): number => {
  const normalized = Math.max(NORMALIZED_MIN, Math.min(NORMALIZED_MAX, value))
  return normalized * normalized * (SMOOTHSTEP_CUBIC_FACTOR - SMOOTHSTEP_LINEAR_FACTOR * normalized)
}

const computeLakeBasinY = (
  biome: BiomeType,
  lakeNoiseValue: number,
  initialSurfaceY: number,
  terrainLevels: TerrainLevels,
): number | null => {
  const { lakeLevel } = terrainLevels
  if (biome === 'OCEAN' || lakeNoiseValue <= LAKE_THRESHOLD || initialSurfaceY < lakeLevel) {
    return null
  }

  const blend = smoothstep01((lakeNoiseValue - LAKE_THRESHOLD) / (NORMALIZED_MAX - LAKE_THRESHOLD))
  const carveTarget = lakeLevel - BASIN_SURFACE_OFFSET - blend * (LAKE_MAX_DEPTH - BASIN_SURFACE_OFFSET)
  const basinY = Math.round(initialSurfaceY + blend * (carveTarget - initialSurfaceY))
  if (basinY >= initialSurfaceY) {
    return null
  }
  return basinY
}

export const computeLakeBasin = (
  biome: BiomeType,
  lakeNoiseValue: number,
  initialSurfaceY: number,
  terrainLevels: TerrainLevels = DEFAULT_TERRAIN_LEVELS,
): Option.Option<BlockAxis> => {
  const basinY = computeLakeBasinY(biome, lakeNoiseValue, initialSurfaceY, terrainLevels)
  if (basinY === null) {
    return Option.none()
  }
  return Option.some(blockAxisFromKnownSafeInteger(basinY))
}

const resolveSurfaceYFromBasin = (biome: BiomeType, initialSurfaceY: number, lakeBasinY: number | null): number => {
  let riverSurfaceY = initialSurfaceY
  if (biome === 'RIVER') {
    riverSurfaceY = Math.max(
      RIVER_WATER_LEVEL - RIVER_MAX_CUT,
      Math.min(initialSurfaceY - RIVER_MIN_CUT, RIVER_WATER_LEVEL - RIVER_SURFACE_CEILING_OFFSET),
    )
  }

  return lakeBasinY ?? riverSurfaceY
}

const determineWaterLevelValue = (
  biome: BiomeType,
  surfaceY: number,
  lakeBasinY: number | null,
  terrainLevels: TerrainLevels,
): number | null => {
  const { seaLevel, lakeLevel } = terrainLevels
  if (biome === 'RIVER') {
    return RIVER_WATER_LEVEL
  }
  if (lakeBasinY !== null) {
    return lakeLevel
  }
  if (surfaceY < seaLevel) {
    return seaLevel
  }
  return null
}

export const resolveSurfaceY = (
  biome: BiomeType,
  initialSurfaceY: number,
  lakeBasinY: Option.Option<BlockAxis>,
): BlockAxis => blockAxisFromKnownSafeInteger(resolveSurfaceYFromBasin(biome, initialSurfaceY, Option.getOrNull(lakeBasinY)))

export const determineWaterLevel = (
  biome: BiomeType,
  surfaceY: number,
  lakeBasinY: Option.Option<number>,
  terrainLevels: TerrainLevels = DEFAULT_TERRAIN_LEVELS,
): Option.Option<BlockAxis> => {
  const waterLevel = determineWaterLevelValue(biome, surfaceY, Option.getOrNull(lakeBasinY), terrainLevels)
  if (waterLevel === null) {
    return Option.none()
  }
  return Option.some(blockAxisFromKnownSafeInteger(waterLevel))
}

export type LakeColumnValues = Readonly<{
  readonly lakeBasinY: number | null
  readonly surfaceY: number
  readonly waterLevel: number | null
  readonly isShore: boolean
}>

export const resolveLakeColumnValues = (
  biome: BiomeType,
  lakeNoiseValue: number,
  initialSurfaceY: number,
  terrainLevels: TerrainLevels,
): LakeColumnValues => {
  const lakeBasinY = computeLakeBasinY(biome, lakeNoiseValue, initialSurfaceY, terrainLevels)
  const surfaceY = resolveSurfaceYFromBasin(biome, initialSurfaceY, lakeBasinY)
  const waterLevel = determineWaterLevelValue(biome, surfaceY, lakeBasinY, terrainLevels)
  const isShore = lakeBasinY === null
    && lakeNoiseValue > LAKE_THRESHOLD - LAKE_SHORE_WIDTH
    && surfaceY < terrainLevels.lakeLevel + LAKE_SHORE_HEIGHT_MARGIN

  return { isShore, lakeBasinY, surfaceY, waterLevel }
}

export const shouldFreezeWaterSurface = (biome: BiomeType, temperature: number): boolean =>
  biome === 'SNOW' || temperature <= ICE_FREEZE_TEMPERATURE

type WaterColumnFill = {
  readonly blocks: Uint16Array
  readonly lx: number
  readonly lz: number
  readonly biome: BiomeType
  readonly surfaceY: number
  readonly lakeBasinY: Option.Option<BlockAxis>
  readonly waterBlockIndex: number
  readonly iceBlockIndex: number
  readonly freezeSurface: boolean
  readonly terrainLevels?: TerrainLevels
}

type WaterColumnAtLevel = Readonly<{
  readonly blocks: Uint16Array
  readonly lx: number
  readonly lz: number
  readonly surfaceY: number
  readonly waterTopY: number | null
  readonly waterBlockIndex: number
  readonly iceBlockIndex: number
  readonly freezeSurface: boolean
}>

export const fillWaterAtLevel = ({
  blocks,
  lx,
  lz,
  surfaceY,
  waterTopY,
  waterBlockIndex,
  iceBlockIndex,
  freezeSurface,
}: WaterColumnAtLevel): void => {
  if (waterTopY === null) {
    return
  }

  for (let y = surfaceY + BLOCK_STEP; y <= waterTopY; y += BLOCK_STEP) {
    const index = blockIndex(lx, y, lz)
    if (freezeSurface && y === waterTopY) {
      blocks[index] = iceBlockIndex
    } else {
      blocks[index] = waterBlockIndex
    }
  }
}

export const fillWaterForColumn = ({
  blocks,
  lx,
  lz,
  biome,
  surfaceY,
  lakeBasinY,
  waterBlockIndex,
  iceBlockIndex,
  freezeSurface,
  terrainLevels = DEFAULT_TERRAIN_LEVELS,
}: WaterColumnFill): void => {
  const waterTopY = determineWaterLevelValue(biome, surfaceY, Option.getOrNull(lakeBasinY), terrainLevels)
  fillWaterAtLevel({
    blocks,
    freezeSurface,
    iceBlockIndex,
    lx,
    lz,
    surfaceY,
    waterBlockIndex,
    waterTopY,
  })
}

export const isLakeShoreColumn = (
  lakeBasinY: Option.Option<BlockAxis>,
  lakeNoiseValue: number,
  surfaceY: number,
  terrainLevels: TerrainLevels,
): boolean =>
  Option.isNone(lakeBasinY)
  && lakeNoiseValue > LAKE_THRESHOLD - LAKE_SHORE_WIDTH
  && surfaceY < terrainLevels.lakeLevel + LAKE_SHORE_HEIGHT_MARGIN
