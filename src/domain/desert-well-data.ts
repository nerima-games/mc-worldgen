import { type BlockId, blockIdOf } from '@nerima-games/mc-kernel'
import type { NaturalStructureGrid } from './natural-structure-types.js'

export const DESERT_WELL_GRID: NaturalStructureGrid = Object.freeze({
  separation: 64,
  spacing: 128,
  spawnPermille: 200,
})

export const DESERT_WELL_LAYOUT: Readonly<
  Record<
    | 'baseHalfExtent'
    | 'baseYClearance'
    | 'maxSurfaceVariation'
    | 'minDryClearance'
    | 'pillarTopOffset'
    | 'roofOffsetY'
    | 'waterHalfExtent',
    number
  >
> = Object.freeze({
  baseHalfExtent: 2,
  baseYClearance: 1,
  maxSurfaceVariation: 3,
  minDryClearance: 1,
  pillarTopOffset: 3,
  roofOffsetY: 4,
  waterHalfExtent: 1,
})

import { Option } from 'effect'
export const DESERT_WELL_BLOCK: Readonly<Record<'SANDSTONE' | 'WATER', BlockId>> = Object.freeze({
  SANDSTONE: Option.getOrThrow(blockIdOf('sandstone')),
  WATER: Option.getOrThrow(blockIdOf('water')),
})
