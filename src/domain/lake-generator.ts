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
import { Option } from 'effect'

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

export const computeLakeBasin = (
  biome: BiomeType,
  lakeNoiseValue: number,
  initialSurfaceY: number,
  terrainLevels: TerrainLevels = DEFAULT_TERRAIN_LEVELS,
): Option.Option<number> => {
  const { lakeLevel } = terrainLevels
  if (biome === 'OCEAN' || lakeNoiseValue <= LAKE_THRESHOLD || initialSurfaceY < lakeLevel) {
    return Option.none()
  }

  const blend = smoothstep01((lakeNoiseValue - LAKE_THRESHOLD) / (NORMALIZED_MAX - LAKE_THRESHOLD))
  const carveTarget = lakeLevel - BASIN_SURFACE_OFFSET - blend * (LAKE_MAX_DEPTH - BASIN_SURFACE_OFFSET)
  const basinY = Math.round(initialSurfaceY + blend * (carveTarget - initialSurfaceY))
  if (basinY >= initialSurfaceY) {
    return Option.none()
  }
  return Option.some(basinY)
}

export const resolveSurfaceY = (
  biome: BiomeType,
  initialSurfaceY: number,
  lakeBasinY: Option.Option<number>,
): number => {
  let riverSurfaceY = initialSurfaceY
  if (biome === 'RIVER') {
    riverSurfaceY = Math.max(
      RIVER_WATER_LEVEL - RIVER_MAX_CUT,
      Math.min(initialSurfaceY - RIVER_MIN_CUT, RIVER_WATER_LEVEL - RIVER_SURFACE_CEILING_OFFSET),
    )
  }

  return Option.getOrElse(lakeBasinY, () => riverSurfaceY)
}

export const determineWaterLevel = (
  biome: BiomeType,
  surfaceY: number,
  lakeBasinY: Option.Option<number>,
  terrainLevels: TerrainLevels = DEFAULT_TERRAIN_LEVELS,
): Option.Option<number> => {
  const { seaLevel, lakeLevel } = terrainLevels
  if (biome === 'RIVER') {
    return Option.some(RIVER_WATER_LEVEL)
  }
  if (Option.isSome(lakeBasinY)) {
    return Option.some(lakeLevel)
  }
  if (surfaceY < seaLevel) {
    return Option.some(seaLevel)
  }
  return Option.none()
}

export const shouldFreezeWaterSurface = (biome: BiomeType, temperature: number): boolean =>
  biome === 'SNOW' || temperature <= ICE_FREEZE_TEMPERATURE

type WaterColumnFill = {
  readonly blocks: Uint8Array
  readonly lx: number
  readonly lz: number
  readonly biome: BiomeType
  readonly surfaceY: number
  readonly lakeBasinY: Option.Option<number>
  readonly waterBlockIndex: number
  readonly iceBlockIndex: number
  readonly freezeSurface: boolean
  readonly terrainLevels?: TerrainLevels
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
  const waterTopY = Option.getOrNull(determineWaterLevel(biome, surfaceY, lakeBasinY, terrainLevels))
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

export const isLakeShoreColumn = (
  lakeBasinY: Option.Option<number>,
  lakeNoiseValue: number,
  surfaceY: number,
  terrainLevels: TerrainLevels,
): boolean =>
  Option.isNone(lakeBasinY)
  && lakeNoiseValue > LAKE_THRESHOLD - LAKE_SHORE_WIDTH
  && surfaceY < terrainLevels.lakeLevel + LAKE_SHORE_HEIGHT_MARGIN
