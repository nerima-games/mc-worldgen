import { type BlockId, blockIdOf } from '@nerima-games/mc-kernel'

import type { BiomeType } from './biome.js'

export const COMPACT_STRUCTURE_KINDS = [
  'ancient-city',
  'buried-treasure',
  'swamp-hut',
  'trail-ruins',
  'trial-chambers',
  'woodland-mansion',
  'woodland-mansion-single-chunk',
] as const

export type CompactStructureKind = (typeof COMPACT_STRUCTURE_KINDS)[number]

export type CompactStructureGrid = Readonly<{
  separation: number
  spacing: number
  spawnPermille: number
}>

export type CompactStructureDescriptor = Readonly<{
  allowedBiomes: ReadonlyArray<BiomeType>
  baseOffset: number
  foundation: BlockId
  height: number
  minSurfaceDelta: number
  radius: number
  roof: BlockId
  wall: BlockId
}>

import { Option } from 'effect'
export const COMPACT_STRUCTURE_BLOCK: Readonly<
  Record<
    | 'CALCITE'
    | 'CHEST'
    | 'COBBLESTONE'
    | 'DEEPSLATE'
    | 'GRAVEL'
    | 'IRON_BLOCK'
    | 'OAK_LOG'
    | 'OAK_PLANKS'
    | 'OAK_STAIRS'
    | 'SANDSTONE'
    | 'STONE',
    BlockId
  >
> = Object.freeze({
  CALCITE: Option.getOrThrow(blockIdOf('calcite')),
  CHEST: Option.getOrThrow(blockIdOf('chest')),
  COBBLESTONE: Option.getOrThrow(blockIdOf('cobblestone')),
  DEEPSLATE: Option.getOrThrow(blockIdOf('deepslate')),
  GRAVEL: Option.getOrThrow(blockIdOf('gravel')),
  IRON_BLOCK: Option.getOrThrow(blockIdOf('iron_block')),
  OAK_LOG: Option.getOrThrow(blockIdOf('oak_log')),
  OAK_PLANKS: Option.getOrThrow(blockIdOf('oak_planks')),
  OAK_STAIRS: Option.getOrThrow(blockIdOf('oak_stairs')),
  SANDSTONE: Option.getOrThrow(blockIdOf('sandstone')),
  STONE: Option.getOrThrow(blockIdOf('stone')),
})

export const COMPACT_STRUCTURE_GRID: Readonly<
  Record<CompactStructureKind, CompactStructureGrid>
> = Object.freeze({
  'ancient-city': { separation: 256, spacing: 512, spawnPermille: 80 },
  'buried-treasure': { separation: 128, spacing: 256, spawnPermille: 100 },
  'swamp-hut': { separation: 128, spacing: 256, spawnPermille: 80 },
  'trail-ruins': { separation: 256, spacing: 512, spawnPermille: 80 },
  'trial-chambers': { separation: 256, spacing: 512, spawnPermille: 80 },
  'woodland-mansion': { separation: 512, spacing: 1024, spawnPermille: 40 },
  'woodland-mansion-single-chunk': { separation: 512, spacing: 1024, spawnPermille: 40 },
})

export const COMPACT_STRUCTURE_DESCRIPTORS: Readonly<
  Record<CompactStructureKind, CompactStructureDescriptor>
> = Object.freeze({
  'ancient-city': {
    allowedBiomes: ['PLAINS', 'FOREST', 'TAIGA', 'MOUNTAINS', 'SNOW'],
    baseOffset: -8,
    foundation: COMPACT_STRUCTURE_BLOCK.DEEPSLATE,
    height: 3,
    minSurfaceDelta: 1,
    radius: 5,
    roof: COMPACT_STRUCTURE_BLOCK.CALCITE,
    wall: COMPACT_STRUCTURE_BLOCK.DEEPSLATE,
  },
  'buried-treasure': {
    allowedBiomes: ['BEACH'],
    baseOffset: -4,
    foundation: COMPACT_STRUCTURE_BLOCK.SANDSTONE,
    height: 1,
    minSurfaceDelta: -1,
    radius: 2,
    roof: COMPACT_STRUCTURE_BLOCK.SANDSTONE,
    wall: COMPACT_STRUCTURE_BLOCK.SANDSTONE,
  },
  'swamp-hut': {
    allowedBiomes: ['SWAMP'],
    baseOffset: 0,
    foundation: COMPACT_STRUCTURE_BLOCK.OAK_PLANKS,
    height: 2,
    minSurfaceDelta: -1,
    radius: 3,
    roof: COMPACT_STRUCTURE_BLOCK.OAK_PLANKS,
    wall: COMPACT_STRUCTURE_BLOCK.OAK_LOG,
  },
  'trail-ruins': {
    allowedBiomes: ['FOREST', 'TAIGA', 'PLAINS', 'MOUNTAINS'],
    baseOffset: -2,
    foundation: COMPACT_STRUCTURE_BLOCK.GRAVEL,
    height: 2,
    minSurfaceDelta: 1,
    radius: 4,
    roof: COMPACT_STRUCTURE_BLOCK.STONE,
    wall: COMPACT_STRUCTURE_BLOCK.COBBLESTONE,
  },
  'trial-chambers': {
    allowedBiomes: ['PLAINS', 'FOREST', 'MOUNTAINS', 'TAIGA', 'SNOW', 'DESERT'],
    baseOffset: -12,
    foundation: COMPACT_STRUCTURE_BLOCK.DEEPSLATE,
    height: 3,
    minSurfaceDelta: 1,
    radius: 5,
    roof: COMPACT_STRUCTURE_BLOCK.CALCITE,
    wall: COMPACT_STRUCTURE_BLOCK.IRON_BLOCK,
  },
  'woodland-mansion': {
    allowedBiomes: ['FOREST', 'FLOWER_FOREST', 'TAIGA'],
    baseOffset: 0,
    foundation: COMPACT_STRUCTURE_BLOCK.OAK_PLANKS,
    height: 4,
    minSurfaceDelta: 1,
    radius: 5,
    roof: COMPACT_STRUCTURE_BLOCK.OAK_STAIRS,
    wall: COMPACT_STRUCTURE_BLOCK.OAK_LOG,
  },
  'woodland-mansion-single-chunk': {
    allowedBiomes: ['FOREST', 'FLOWER_FOREST', 'TAIGA'],
    baseOffset: 0,
    foundation: COMPACT_STRUCTURE_BLOCK.OAK_PLANKS,
    height: 4,
    minSurfaceDelta: 1,
    radius: 5,
    roof: COMPACT_STRUCTURE_BLOCK.OAK_STAIRS,
    wall: COMPACT_STRUCTURE_BLOCK.OAK_LOG,
  },
})
