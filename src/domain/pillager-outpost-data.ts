import type { NaturalStructureGrid } from './natural-structure-types'
import { blockIdOf } from '@nerima-games/mc-kernel'

export const PILLAGER_OUTPOST_GRID: NaturalStructureGrid = Object.freeze({
  separation: 128,
  spacing: 320,
  spawnPermille: 120,
})

export const PILLAGER_OUTPOST_LAYOUT = Object.freeze({
  baseHalfExtent: 4,
  floorCount: 3,
  floorSpacing: 4,
  maxSurfaceVariation: 3,
  minDryClearance: 1,
  roofOverhang: 1,
  towerBaseYOffset: 1,
  towerHalfExtent: 2,
})

export const PILLAGER_OUTPOST_BLOCK = Object.freeze({
  CHEST: blockIdOf('chest'),
  COBBLESTONE: blockIdOf('cobblestone'),
  OAK_LOG: blockIdOf('oak_log'),
  OAK_PLANKS: blockIdOf('oak_planks'),
  OAK_STAIRS: blockIdOf('oak_stairs'),
  TORCH: blockIdOf('torch'),
})
