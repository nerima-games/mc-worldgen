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
} from './biome-classifier.config.js'
import { BIOMES, type BiomeType, type KernelBiomeType, classifyBiome } from './biome.js'
import { Data, Result } from 'effect'

const TEMPERATURE_COLD_VARIANT = 0.2
const TEMPERATURE_MOUNTAIN_COLD = 0.3
const TEMPERATURE_WARM_OCEAN = 0.8
const TEMPERATURE_LUKEWARM_OCEAN = 0.55
const TEMPERATURE_COLD_OCEAN = 0.35
const TEMPERATURE_CHERRY_GROVE = 0.55
const HUMIDITY_DARK_FOREST = 0.82
const TEMPERATURE_BIRCH_FOREST = 0.62
const HUMIDITY_BAMBOO_JUNGLE = 0.88
const HUMIDITY_SPARSE_JUNGLE = 0.72
const HUMIDITY_CHERRY_GROVE = 0.7
const HUMIDITY_WINDSWEPT_FOREST = 0.58
const TEMPERATURE_COLD_GROVE = 0.35
const HUMIDITY_SNOWY_TAIGA = 0.67
const PEAKS_AND_VALLEYS_ICE_SPIKES = 0.6
const HIGH_MOUNTAIN_SURFACE_Y = 180
const MID_MOUNTAIN_SURFACE_Y = 150
const LOWER_MOUNTAIN_SURFACE_Y = 120
const HIGH_SNOWY_SURFACE_Y = 175
const MID_SNOWY_SURFACE_Y = 145
const LOW_SNOWY_SURFACE_Y = 110
const DEEP_OCEAN_SURFACE_Y = 30
const HIGH_SAVANNA_SURFACE_Y = 120
const PLATEAU_SAVANNA_SURFACE_Y = 100
const FLOWER_FOREST_PEAKS_AND_VALLEYS = 0.72
const MANGROVE_TEMPERATURE = 0.75
const MANGROVE_HUMIDITY = 0.8
const SNOWY_TAIGA_TEMPERATURE = 0.18
const TAIGA_HUMIDITY = 0.72
const OLD_GROWTH_TAIGA_PEAKS_AND_VALLEYS = 0.7
const MOUNTAIN_GRAVELLY_EROSION_THRESHOLD = 0.45

export type ClimateSample = {
  readonly temperature: number
  readonly humidity: number
  readonly continentalness: number
  readonly erosion: number
  readonly pv: number
  readonly riverNoise: number
}

type UnsupportedBiomeCategoryFields = {
  readonly category: string
  readonly receivedType: string
}

export const UnsupportedBiomeCategory: new (
  args: UnsupportedBiomeCategoryFields,
) => Error & { readonly _tag: 'UnsupportedBiomeCategory' } & Readonly<UnsupportedBiomeCategoryFields> =
  // Effect's TaggedError is a factory, so its PascalCase API is called directly.
  // oxlint-disable-next-line new-cap
  Data.TaggedError('UnsupportedBiomeCategory')<UnsupportedBiomeCategoryFields>

export type UnsupportedBiomeCategory = InstanceType<typeof UnsupportedBiomeCategory>

const isBiomeCategory = (value: unknown): value is BiomeType =>
  typeof value === 'string' && BIOMES.some((biome) => biome === value)

const unsupportedCategory = (value: unknown): UnsupportedBiomeCategory => {
  let receivedType: string = typeof value
  if (value === null) {
    receivedType = 'null'
  }
  let category = `<${receivedType}>`
  if (typeof value === 'string') {
    category = value
  }
  return new UnsupportedBiomeCategory({ category, receivedType })
}

const highMountainBiomeFor = (climate: ClimateSample): KernelBiomeType => {
  if (climate.temperature < TEMPERATURE_MOUNTAIN_COLD) {
    return 'frozen_peaks'
  }
  return 'jagged_peaks'
}

const midMountainBiomeFor = (climate: ClimateSample): KernelBiomeType => {
  if (climate.temperature < TEMPERATURE_MOUNTAIN_COLD) {
    return 'snowy_slopes'
  }
  if (climate.erosion < MOUNTAIN_GRAVELLY_EROSION_THRESHOLD) {
    return 'windswept_gravelly_hills'
  }
  return 'stony_peaks'
}

const lowerMountainBiomeFor = (climate: ClimateSample): KernelBiomeType => {
  if (climate.humidity > HUMIDITY_CHERRY_GROVE && climate.temperature > TEMPERATURE_CHERRY_GROVE) {
    return 'cherry_grove'
  }
  if (climate.humidity > HUMIDITY_WINDSWEPT_FOREST) {
    return 'windswept_forest'
  }
  if (climate.temperature < TEMPERATURE_COLD_GROVE) {
    return 'grove'
  }
  return 'windswept_hills'
}

const mountainBiomeFor = (climate: ClimateSample, surfaceY: number): KernelBiomeType => {
  if (surfaceY >= HIGH_MOUNTAIN_SURFACE_Y) {
    return highMountainBiomeFor(climate)
  }
  if (surfaceY >= MID_MOUNTAIN_SURFACE_Y) {
    return midMountainBiomeFor(climate)
  }
  if (surfaceY >= LOWER_MOUNTAIN_SURFACE_Y) {
    return lowerMountainBiomeFor(climate)
  }
  if (climate.temperature < TEMPERATURE_MOUNTAIN_COLD) {
    return 'grove'
  }
  return 'meadow'
}

const lowerSnowyBiomeFor = (climate: ClimateSample): KernelBiomeType => {
  if (climate.humidity > HUMIDITY_SNOWY_TAIGA) {
    return 'snowy_taiga'
  }
  if (climate.pv > PEAKS_AND_VALLEYS_ICE_SPIKES) {
    return 'ice_spikes'
  }
  return 'snowy_plains'
}

const snowyBiomeFor = (climate: ClimateSample, surfaceY: number): KernelBiomeType => {
  if (surfaceY >= HIGH_SNOWY_SURFACE_Y) {
    return 'frozen_peaks'
  }
  if (surfaceY >= MID_SNOWY_SURFACE_Y) {
    return 'snowy_slopes'
  }
  if (surfaceY >= LOW_SNOWY_SURFACE_Y) {
    return 'grove'
  }
  return lowerSnowyBiomeFor(climate)
}

const deepOceanBiomeFor = (climate: ClimateSample): KernelBiomeType => {
  if (climate.temperature < TEMPERATURE_COLD_VARIANT) {
    return 'deep_frozen_ocean'
  }
  if (climate.temperature < TEMPERATURE_COLD_OCEAN) {
    return 'deep_cold_ocean'
  }
  return 'deep_ocean'
}

const shallowOceanBiomeFor = (climate: ClimateSample): KernelBiomeType => {
  if (climate.temperature < TEMPERATURE_COLD_VARIANT) {
    return 'cold_ocean'
  }
  if (climate.temperature > TEMPERATURE_WARM_OCEAN) {
    return 'warm_ocean'
  }
  if (climate.temperature > TEMPERATURE_LUKEWARM_OCEAN) {
    return 'lukewarm_ocean'
  }
  return 'ocean'
}

const oceanBiomeFor = (climate: ClimateSample, surfaceY: number): KernelBiomeType => {
  if (surfaceY <= DEEP_OCEAN_SURFACE_Y) {
    return deepOceanBiomeFor(climate)
  }
  return shallowOceanBiomeFor(climate)
}

const kernelBiomeForCategory: Readonly<Record<BiomeType, (climate: ClimateSample, surfaceY: number) => KernelBiomeType>> = {
  BEACH: (climate) => {
    if (climate.temperature < TEMPERATURE_COLD_VARIANT) {
      return 'snowy_beach'
    }
    return 'beach'
  },
  DESERT: () => 'desert',
  FLOWER_FOREST: () => 'flower_forest',
  FOREST: (climate) => {
    if (climate.humidity > HUMIDITY_DARK_FOREST) {
      return 'dark_forest'
    }
    if (climate.temperature > TEMPERATURE_BIRCH_FOREST) {
      return 'birch_forest'
    }
    return 'forest'
  },
  JUNGLE: (climate) => {
    if (climate.humidity > HUMIDITY_BAMBOO_JUNGLE) {
      return 'bamboo_jungle'
    }
    if (climate.humidity < HUMIDITY_SPARSE_JUNGLE) {
      return 'sparse_jungle'
    }
    return 'jungle'
  },
  MOUNTAINS: mountainBiomeFor,
  OCEAN: oceanBiomeFor,
  PLAINS: (climate) => {
    if (climate.pv > FLOWER_FOREST_PEAKS_AND_VALLEYS) {
      return 'sunflower_plains'
    }
    return 'plains'
  },
  RIVER: (climate) => {
    if (climate.temperature < SNOWY_TAIGA_TEMPERATURE) {
      return 'frozen_river'
    }
    return 'river'
  },
  SAVANNA: (_climate, surfaceY) => {
    if (surfaceY >= HIGH_SAVANNA_SURFACE_Y) {
      return 'windswept_savanna'
    }
    if (surfaceY >= PLATEAU_SAVANNA_SURFACE_Y) {
      return 'savanna_plateau'
    }
    return 'savanna'
  },
  SNOW: snowyBiomeFor,
  SWAMP: (climate) => {
    if (climate.temperature > MANGROVE_TEMPERATURE && climate.humidity > MANGROVE_HUMIDITY) {
      return 'mangrove_swamp'
    }
    return 'swamp'
  },
  TAIGA: (climate) => {
    if (climate.temperature < SNOWY_TAIGA_TEMPERATURE) {
      return 'snowy_taiga'
    }
    if (climate.humidity > TAIGA_HUMIDITY) {
      return 'old_growth_spruce_taiga'
    }
    if (climate.pv > OLD_GROWTH_TAIGA_PEAKS_AND_VALLEYS) {
      return 'old_growth_pine_taiga'
    }
    return 'taiga'
  },
}

/**
 * Refine mc-noise's coarse category into a concrete biome registered by
 * mc-kernel. Unknown runtime categories fail with a tag so upgrades cannot
 * silently select a nearby biome.
 */
export const refineBiomeCategoryForKernel = (
  category: unknown,
  climate: ClimateSample,
  surfaceY: number,
): Result.Result<KernelBiomeType, UnsupportedBiomeCategory> => {
  if (!isBiomeCategory(category)) {
    return Result.fail(unsupportedCategory(category))
  }
  return Result.succeed(kernelBiomeForCategory[category](climate, surfaceY))
}

/** Map an accepted mc-noise category to the legacy material/vegetation category. */
export const biomeCategoryFromNoise = (category: unknown): Result.Result<BiomeType, UnsupportedBiomeCategory> => {
  if (isBiomeCategory(category)) {
    return Result.succeed(category)
  }
  return Result.fail(unsupportedCategory(category))
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
