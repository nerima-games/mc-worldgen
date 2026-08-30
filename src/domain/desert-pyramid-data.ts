import type { NaturalStructureGrid } from './natural-structure-types.js'

export const DESERT_PYRAMID_GRID: NaturalStructureGrid = Object.freeze({
  separation: 96,
  spacing: 256,
  spawnPermille: 200,
})

export const DESERT_PYRAMID_LAYOUT: Readonly<
  Record<
    | 'baseHalfExtent'
    | 'baseYClearance'
    | 'chamberFloorYOffset'
    | 'chamberHalfExtent'
    | 'chestOffset'
    | 'levelCount'
    | 'levelInset'
    | 'maxSurfaceVariation'
    | 'minDryClearance'
    | 'tntHalfExtent',
    number
  >
> = Object.freeze({
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
