import { type BlockId, blockIdOf } from '@nerima-games/mc-kernel'
import type { NaturalStructureGrid } from './natural-structure-types.js'

export const IGLOO_GRID: NaturalStructureGrid = Object.freeze({
  separation: 64,
  spacing: 128,
  spawnPermille: 200,
})

export const IGLOO_LAYOUT: Readonly<{
  basementDepth: number
  basementHalfExtent: number
  domeHalfExtent: number
  domeLevelCount: number
  domeLevelRadiusStep: number
  doorHeight: number
  doorOffsetZ: number
  entityHeightOffset: number
  interior: Readonly<
    Record<
      'bed' | 'cauldron' | 'chest' | 'craftingTable' | 'furnace' | 'villager' | 'zombieVillager',
      Readonly<{ x: number; z: number }>
    >
  >
  maxSurfaceVariation: number
  minDryClearance: number
  shaftTopOffset: number
}> = Object.freeze({
  basementDepth: 5,
  basementHalfExtent: 3,
  domeHalfExtent: 4,
  domeLevelCount: 7,
  domeLevelRadiusStep: 2,
  doorHeight: 3,
  doorOffsetZ: 4,
  entityHeightOffset: 1,
  interior: Object.freeze({
    bed: Object.freeze({ x: -2, z: 1 }),
    cauldron: Object.freeze({ x: 2, z: -1 }),
    chest: Object.freeze({ x: 2, z: 1 }),
    craftingTable: Object.freeze({ x: -1, z: -1 }),
    furnace: Object.freeze({ x: 1, z: -1 }),
    villager: Object.freeze({ x: -1, z: 1 }),
    zombieVillager: Object.freeze({ x: 1, z: 1 }),
  }),
  maxSurfaceVariation: 3,
  minDryClearance: 1,
  shaftTopOffset: 2,
})

/** Registry-backed palette for the supported igloo geometry. */
export const IGLOO_BLOCK: Readonly<
  Record<
    | 'AIR'
    | 'BED'
    | 'CAULDRON'
    | 'CHEST'
    | 'COBBLESTONE'
    | 'CRAFTING_TABLE'
    | 'FURNACE'
    | 'LADDER'
    | 'OAK_PLANKS'
    | 'SNOW',
    BlockId
  >
> = Object.freeze({
  AIR: blockIdOf('air'),
  BED: blockIdOf('bed'),
  CAULDRON: blockIdOf('cauldron'),
  CHEST: blockIdOf('chest'),
  COBBLESTONE: blockIdOf('cobblestone'),
  CRAFTING_TABLE: blockIdOf('crafting_table'),
  FURNACE: blockIdOf('furnace'),
  LADDER: blockIdOf('ladder'),
  OAK_PLANKS: blockIdOf('oak_planks'),
  SNOW: blockIdOf('snow'),
})
