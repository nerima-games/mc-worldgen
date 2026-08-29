import type { NaturalStructureGrid } from './natural-structure-types'
import { blockIdOf } from '@nerima-games/mc-kernel'

export const JUNGLE_PYRAMID_GRID: NaturalStructureGrid = Object.freeze({
  separation: 96,
  spacing: 256,
  spawnPermille: 160,
})

export const JUNGLE_PYRAMID_LAYOUT = Object.freeze({
  baseHalfExtent: 5,
  baseYClearance: 1,
  chamberFloorYOffset: 4,
  chamberHalfExtent: 2,
  chamberHeight: 3,
  chestOffset: 1,
  maxSurfaceVariation: 3,
  minDryClearance: 1,
  roofHalfExtent: 4,
  templeWallHeight: 3,
})

export const JUNGLE_PYRAMID_BLOCK = Object.freeze({
  CHEST: blockIdOf('chest'),
  COBBLESTONE: blockIdOf('cobblestone'),
  OAK_PLANKS: blockIdOf('oak_planks'),
  SANDSTONE: blockIdOf('sandstone'),
  STONE: blockIdOf('stone'),
  TNT: blockIdOf('tnt'),
  TORCH: blockIdOf('torch'),
})
