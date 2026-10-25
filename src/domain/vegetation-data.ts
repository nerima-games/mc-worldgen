import { type BlockId, blockIdOf } from '@nerima-games/mc-kernel'
import type { BiomeType } from './biome.js'

/** Block ids that can be written by the vegetation passes. */
export const PLANT: Readonly<
  Record<
    | 'BROWN_MUSHROOM'
    | 'CACTUS'
    | 'DANDELION'
    | 'FERN'
    | 'KELP'
    | 'LILY_PAD'
    | 'POPPY'
    | 'RED_MUSHROOM'
    | 'SEAGRASS'
    | 'SUGAR_CANE'
    | 'TALL_GRASS',
    BlockId
  >
> = {
  BROWN_MUSHROOM: Option.getOrThrow(blockIdOf('brown_mushroom')),
  CACTUS: Option.getOrThrow(blockIdOf('cactus')),
  DANDELION: Option.getOrThrow(blockIdOf('dandelion')),
  FERN: Option.getOrThrow(blockIdOf('fern')),
  KELP: Option.getOrThrow(blockIdOf('kelp')),
  LILY_PAD: Option.getOrThrow(blockIdOf('lily_pad')),
  POPPY: Option.getOrThrow(blockIdOf('poppy')),
  RED_MUSHROOM: Option.getOrThrow(blockIdOf('red_mushroom')),
  SEAGRASS: Option.getOrThrow(blockIdOf('seagrass')),
  SUGAR_CANE: Option.getOrThrow(blockIdOf('sugar_cane')),
  TALL_GRASS: Option.getOrThrow(blockIdOf('tall_grass')),
} as const

export const PLANT_IDS: ReadonlyArray<number> = Object.values(PLANT)

export const GROUND_COVER_IDS: ReadonlyArray<number> = [
  PLANT.DANDELION,
  PLANT.POPPY,
  PLANT.TALL_GRASS,
  PLANT.FERN,
]

export const MUSHROOM_IDS: ReadonlyArray<number> = [PLANT.BROWN_MUSHROOM, PLANT.RED_MUSHROOM]

import { Option } from 'effect'
export const AQUATIC_PLANT_IDS: ReadonlyArray<number> = [PLANT.SEAGRASS, PLANT.KELP, PLANT.LILY_PAD]

export const STACKED_PLANT_IDS: ReadonlyArray<number> = [PLANT.CACTUS, PLANT.SUGAR_CANE, PLANT.KELP]

/** Per-column probability for the single-block ground-cover pass. */
export const GROUND_PLANT_DENSITY: Readonly<Record<BiomeType, number>> = {
  BEACH: 0.02,
  DESERT: 0,
  FLOWER_FOREST: 0.42,
  FOREST: 0.14,
  JUNGLE: 0.18,
  MOUNTAINS: 0,
  OCEAN: 0,
  PLAINS: 0.22,
  RIVER: 0,
  SAVANNA: 0.08,
  SNOW: 0,
  SWAMP: 0.1,
  TAIGA: 0.12,
}

export const MUSHROOM_BIOMES: ReadonlySet<BiomeType> = new Set([
  'FLOWER_FOREST',
  'FOREST',
  'JUNGLE',
  'SWAMP',
  'TAIGA',
])
