import {
  BEACH_CONTINENTALNESS_MAX,
  CLIMATE_CENTER,
  CLIMATE_MAX,
  CLIMATE_MIN,
  CLIMATE_VARIANCE_STRETCH,
  CONTINENTALNESS_MOUNTAIN_MIN,
  CONTINENTALNESS_OCEAN_MAX,
  CONTINENTALNESS_RIVER_MAX,
  CONTINENTALNESS_RIVER_MIN,
  CONTINENTALNESS_SWAMP_FOREST_MIN,
  EROSION_FOREST_MAX,
  MOUNTAININESS_EROSION_BASELINE,
  MOUNTAININESS_EROSION_WEIGHT,
  MOUNTAININESS_MOUNTAIN_MIN,
  MOUNTAININESS_PV_WEIGHT,
  MOUNTAININESS_TAIGA_MAX,
  PV_BASE,
  PV_WEIRDNESS_OFFSET,
  PV_WEIRDNESS_SCALE,
  RIVER_CENTER,
  RIVER_FLOWER_FOREST_MIN,
  RIVER_HALF_WIDTH,
  TEMP_COLD,
} from './biome-classifier.config'
import { type BiomeType, classifyBiome } from './biome'

export type ClimateSample = {
  readonly temperature: number
  readonly humidity: number
  readonly continentalness: number
  readonly erosion: number
  readonly pv: number
  readonly riverNoise: number
}

export const peaksAndValleysFromWeirdness = (weirdness: number): number =>
  PV_BASE - Math.abs(PV_WEIRDNESS_SCALE * Math.abs(weirdness) - PV_WEIRDNESS_OFFSET)

const stretchClimateValue = (value: number): number =>
  Math.max(
    CLIMATE_MIN,
    Math.min(CLIMATE_MAX, CLIMATE_CENTER + (value - CLIMATE_CENTER) * CLIMATE_VARIANCE_STRETCH),
  )

const mountaininessAt = (climate: ClimateSample): number =>
  Math.max(CLIMATE_MIN, climate.pv) * MOUNTAININESS_PV_WEIGHT +
  Math.max(CLIMATE_MIN, MOUNTAININESS_EROSION_BASELINE - climate.erosion) * MOUNTAININESS_EROSION_WEIGHT

const isRiverClimate = (climate: ClimateSample, riverDistance: number): boolean =>
  climate.continentalness > CONTINENTALNESS_RIVER_MIN &&
  climate.continentalness < CONTINENTALNESS_RIVER_MAX &&
  riverDistance < RIVER_HALF_WIDTH

const isMountainClimate = (climate: ClimateSample, mountaininess: number): boolean =>
  climate.continentalness > CONTINENTALNESS_MOUNTAIN_MIN &&
  mountaininess > MOUNTAININESS_MOUNTAIN_MIN

const classifyMountainBiome = (climate: ClimateSample): BiomeType => {
  if (climate.temperature < TEMP_COLD) {
    return 'SNOW'
  }

  return 'MOUNTAINS'
}

const refineClimateBiome = (
  baseBiome: BiomeType,
  climate: ClimateSample,
  mountaininess: number,
): BiomeType => {
  if (
    baseBiome === 'SWAMP' &&
    (climate.continentalness > CONTINENTALNESS_SWAMP_FOREST_MIN || climate.erosion < EROSION_FOREST_MAX)
  ) {
    return 'FOREST'
  }

  if (baseBiome === 'MOUNTAINS' && mountaininess < MOUNTAININESS_TAIGA_MAX) {
    return 'TAIGA'
  }

  if (baseBiome === 'FOREST' && climate.riverNoise > RIVER_FLOWER_FOREST_MIN) {
    return 'FLOWER_FOREST'
  }

  return baseBiome
}

const classifyBiomeByContinentalClimate = (baseBiome: BiomeType, climate: ClimateSample): BiomeType => {
  if (climate.continentalness < CONTINENTALNESS_OCEAN_MAX) {
    return 'OCEAN'
  }

  const mountaininess = mountaininessAt(climate)
  if (isMountainClimate(climate, mountaininess)) {
    return classifyMountainBiome(climate)
  }

  return refineClimateBiome(baseBiome, climate, mountaininess)
}

export const classifyBiomeFromClimate = (climate: ClimateSample): BiomeType => {
  const temperature = stretchClimateValue(climate.temperature)
  const humidity = stretchClimateValue(climate.humidity)
  const riverDistance = Math.abs(climate.riverNoise - RIVER_CENTER)

  if (isRiverClimate(climate, riverDistance)) {
    return 'RIVER'
  }

  return classifyBiomeByContinentalClimate(classifyBiome(temperature, humidity), climate)
}

export const refineBeachBiome = (
  biome: BiomeType,
  neighboringBiomes: ReadonlyArray<BiomeType>,
  continentalness: number,
): BiomeType => {
  if (biome === 'OCEAN' || biome === 'DESERT' || biome === 'SWAMP') {
    return biome
  }

  const adjacentOcean = neighboringBiomes.some((neighbor) => neighbor === 'OCEAN')
  if (adjacentOcean && continentalness < BEACH_CONTINENTALNESS_MAX) {
    return 'BEACH'
  }

  return biome
}
