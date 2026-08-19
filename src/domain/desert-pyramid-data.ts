import type { NaturalStructureGrid } from './natural-structure'

export const DESERT_PYRAMID_GRID: NaturalStructureGrid = Object.freeze({
  separation: 96,
  spacing: 256,
  spawnPermille: 200,
})

export const DESERT_PYRAMID_LAYOUT = Object.freeze({
  baseHalfExtent: 10,
  baseYClearance: 1,
  chamberFloorYOffset: 5,
  chamberHalfExtent: 3,
  chestOffset: 2,
  levelCount: 5,
  levelInset: 2,
  maxSurfaceVariation: 6,
  minDryClearance: 1,
  tntHalfExtent: 1,
})
