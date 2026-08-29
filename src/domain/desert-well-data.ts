import type { NaturalStructureGrid } from './natural-structure-types'
import { blockIdOf } from '@nerima-games/mc-kernel'

export const DESERT_WELL_GRID: NaturalStructureGrid = Object.freeze({
  separation: 64,
  spacing: 128,
  spawnPermille: 200,
})

export const DESERT_WELL_LAYOUT = Object.freeze({
  baseHalfExtent: 2,
  baseYClearance: 1,
  maxSurfaceVariation: 3,
  minDryClearance: 1,
  pillarTopOffset: 3,
  roofOffsetY: 4,
  waterHalfExtent: 1,
})

export const DESERT_WELL_BLOCK = Object.freeze({
  SANDSTONE: blockIdOf('sandstone'),
  WATER: blockIdOf('water'),
})
