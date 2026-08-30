/**
 * Pure climate, biome, and terrain-column resolution.
 *
 * Chunk generation consumes this result, while callers that need one world
 * column can use the same coordinate-absolute resolver directly.
 */
import {
  type ClimateSample,
  classifyBiomeFromClimate,
  peaksAndValleysFromWeirdness,
} from './biome-classifier.js'
import { DEFAULT_TERRAIN_LEVELS, type TerrainLevels } from './constants.js'
import { LAKE_NOISE_SCALE, LAKE_WORLD_OFFSET } from './lake-config.js'
import { RIVER_NOISE_SCALE, RIVER_WORLD_OFFSET } from './biome-classifier.config.js'
import { type ResolvedSurfaceMaterial, resolveSurfaceMaterial } from './surface-resolver.js'
import { channelSeed, fbm2D, valueNoise2D } from '@nerima-games/mc-noise'
import {
  computeLakeBasin,
  determineWaterLevel,
  isLakeShoreColumn,
  resolveSurfaceY,
} from './lake-generator.js'
import { continentalnessAt, surfaceHeightFromContinentalness } from './density-function.js'
import type { BiomeType } from './biome.js'
import { Option } from 'effect'

/** Shared "one" numerator for every `frequency: 1 / wavelength` noise call. */
const NOISE_FREQUENCY_UNIT = 1
/** Temperature noise wavelength, in blocks. */
const TEMPERATURE_WAVELENGTH_BLOCKS = 320
/** Humidity noise wavelength, in blocks. */
const HUMIDITY_WAVELENGTH_BLOCKS = 280
/** Erosion noise wavelength, in blocks. */
const EROSION_WAVELENGTH_BLOCKS = 220
/** Weirdness noise wavelength, in blocks. */
const WEIRDNESS_WAVELENGTH_BLOCKS = 160
/** The river field's coordinates are pre-scaled, so this call samples at unit frequency. */
const RIVER_NOISE_UNIT_FREQUENCY = 1
/** Scale factor of the `[0, 1] -> [-1, 1]` remap. */
const BIPOLAR_SCALE = 2
/** Offset of the `[0, 1] -> [-1, 1]` remap. */
const BIPOLAR_OFFSET = 1
/** Unit frequency for the lake field after its world-space coordinates are scaled. */
const LAKE_NOISE_UNIT_FREQUENCY = 1

/** Remaps a `[0, 1]` sample to `[-1, 1]`. */
const toBipolar = (unitValue: number): number => unitValue * BIPOLAR_SCALE - BIPOLAR_OFFSET

const climateAtWithContinentalness = (
  seed: number,
  wx: number,
  wz: number,
  continentalness: number = toBipolar(continentalnessAt(seed, wx, wz)),
): ClimateSample => {
  const temperature = fbm2D(channelSeed(seed, 'temperature'), wx, wz, {
    frequency: NOISE_FREQUENCY_UNIT / TEMPERATURE_WAVELENGTH_BLOCKS,
    octaves: 2,
    persistence: 0.5,
  })
  const humidity = fbm2D(channelSeed(seed, 'humidity'), wx, wz, {
    frequency: NOISE_FREQUENCY_UNIT / HUMIDITY_WAVELENGTH_BLOCKS,
    octaves: 2,
    persistence: 0.5,
  })
  const erosion = toBipolar(
    valueNoise2D(channelSeed(seed, 'erosion'), wx, wz, NOISE_FREQUENCY_UNIT / EROSION_WAVELENGTH_BLOCKS),
  )
  const weirdness = toBipolar(
    valueNoise2D(channelSeed(seed, 'weirdness'), wx, wz, NOISE_FREQUENCY_UNIT / WEIRDNESS_WAVELENGTH_BLOCKS),
  )
  const riverNoise = valueNoise2D(
    channelSeed(seed, 'river'),
    wx * RIVER_NOISE_SCALE + RIVER_WORLD_OFFSET,
    wz * RIVER_NOISE_SCALE + RIVER_WORLD_OFFSET,
    RIVER_NOISE_UNIT_FREQUENCY,
  )

  return {
    continentalness,
    erosion,
    humidity,
    pv: peaksAndValleysFromWeirdness(weirdness),
    riverNoise,
    temperature,
  }
}

export const climateAt = (seed: number, wx: number, wz: number): ClimateSample =>
  climateAtWithContinentalness(seed, wx, wz)

/** How far below sea level a column must sit before the OCEAN override applies. */
const OCEAN_BELOW_SEA_LEVEL_MARGIN = 2
/** How far above sea level a column may sit and still take the BEACH override. */
const BEACH_ABOVE_SEA_LEVEL_MARGIN = 1

type BiomeQuery = {
  readonly seed: number
  readonly wx: number
  readonly wz: number
  readonly surfaceY: number
  readonly levels: TerrainLevels
  readonly continentalness: number
}

/**
 * Biome for a column, after the submerged and shoreline overrides.
 *
 * The overrides run after climate classification, not instead of it: a desert
 * that happens to dip below sea level is an ocean there, whatever its climate
 * says.
 */
const biomeForWithClimate = (query: BiomeQuery, climate: ClimateSample): BiomeType => {
  const { surfaceY, levels } = query

  if (surfaceY < levels.seaLevel - OCEAN_BELOW_SEA_LEVEL_MARGIN) {
    return 'OCEAN'
  }
  if (surfaceY <= levels.seaLevel + BEACH_ABOVE_SEA_LEVEL_MARGIN) {
    return 'BEACH'
  }
  return classifyBiomeFromClimate(climate)
}

const biomeForWithContinentalness = (query: BiomeQuery): BiomeType =>
  biomeForWithClimate(
    query,
    climateAtWithContinentalness(query.seed, query.wx, query.wz, toBipolar(query.continentalness)),
  )

export type SurfaceBiome = Readonly<{
  readonly biome: BiomeType
  readonly surfaceY: number
}>

/** Resolve the raw surface and its biome while sharing one continentalness sample. */
export const surfaceBiomeAt = (
  seed: number,
  wx: number,
  wz: number,
  levels: TerrainLevels,
): SurfaceBiome => {
  const continentalness = continentalnessAt(seed, wx, wz)
  const surfaceY = surfaceHeightFromContinentalness(continentalness)
  return {
    biome: biomeForWithContinentalness({ continentalness, levels, seed, surfaceY, wx, wz }),
    surfaceY,
  }
}

/** Resolve a public biome query using the fixed five-argument API. */
export const biomeFor = (
  seed: number,
  wx: number,
  wz: number,
  surfaceY: number,
  levels: TerrainLevels,
): BiomeType =>
  biomeForWithContinentalness({ continentalness: continentalnessAt(seed, wx, wz), levels, seed, surfaceY, wx, wz })

export type TerrainColumn = Readonly<{
  readonly biome: BiomeType
  readonly initialSurfaceY: number
  readonly lakeBasinY: Option.Option<number>
  readonly surface: ResolvedSurfaceMaterial
  readonly surfaceY: number
  readonly temperature: number
  readonly waterLevel: number | null
}>

const lakeNoiseAt = (seed: number, wx: number, wz: number): number =>
  valueNoise2D(
    channelSeed(seed, 'lake'),
    wx * LAKE_NOISE_SCALE + LAKE_WORLD_OFFSET,
    wz * LAKE_NOISE_SCALE + LAKE_WORLD_OFFSET,
    LAKE_NOISE_UNIT_FREQUENCY,
  )

const resolveTerrainColumn = (
  seed: number,
  wx: number,
  wz: number,
  levels: TerrainLevels,
): TerrainColumn => {
  const continentalness = continentalnessAt(seed, wx, wz)
  const initialSurfaceY = surfaceHeightFromContinentalness(continentalness)
  const climate = climateAtWithContinentalness(seed, wx, wz, toBipolar(continentalness))
  const biome = biomeForWithClimate(
    {
      continentalness,
      levels,
      seed,
      surfaceY: initialSurfaceY,
      wx,
      wz,
    },
    climate,
  )
  const lakeNoiseValue = lakeNoiseAt(seed, wx, wz)
  const lakeBasinY = computeLakeBasin(biome, lakeNoiseValue, initialSurfaceY, levels)
  const surfaceY = resolveSurfaceY(biome, initialSurfaceY, lakeBasinY)
  const waterLevel = Option.getOrNull(determineWaterLevel(biome, surfaceY, lakeBasinY, levels))
  const surface = resolveSurfaceMaterial(biome, surfaceY, waterLevel ?? levels.seaLevel, {
    hasLakeBasin: Option.isSome(lakeBasinY),
    isShore: isLakeShoreColumn(lakeBasinY, lakeNoiseValue, surfaceY, levels),
  })

  return {
    biome,
    initialSurfaceY,
    lakeBasinY,
    surface,
    surfaceY,
    temperature: climate.temperature,
    waterLevel,
  }
}

export const terrainColumnAt = (
  seed: number,
  wx: number,
  wz: number,
  levels: TerrainLevels = DEFAULT_TERRAIN_LEVELS,
): TerrainColumn => resolveTerrainColumn(seed, wx, wz, levels)
