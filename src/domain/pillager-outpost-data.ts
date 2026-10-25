import { type BlockId, blockIdOf } from '@nerima-games/mc-kernel'
import type { NaturalStructureGrid } from './natural-structure-types.js'

export const PILLAGER_OUTPOST_GRID: NaturalStructureGrid = Object.freeze({
  separation: 128,
  spacing: 320,
  spawnPermille: 120,
})

export const PILLAGER_OUTPOST_LAYOUT: Readonly<{
  baseHalfExtent: number
  floorCount: number
  floorSpacing: number
  maxSurfaceVariation: number
  minDryClearance: number
  roofOverhang: number
  towerBaseYOffset: number
  towerHalfExtent: number
}> = Object.freeze({
  baseHalfExtent: 4,
  floorCount: 3,
  floorSpacing: 4,
  maxSurfaceVariation: 3,
  minDryClearance: 1,
  roofOverhang: 1,
  towerBaseYOffset: 1,
  towerHalfExtent: 2,
})

import { Option } from 'effect'
export const PILLAGER_OUTPOST_BLOCK: Readonly<
  Record<'CHEST' | 'COBBLESTONE' | 'OAK_LOG' | 'OAK_PLANKS' | 'OAK_STAIRS' | 'TORCH', BlockId>
> = Object.freeze({
  CHEST: Option.getOrThrow(blockIdOf('chest')),
  COBBLESTONE: Option.getOrThrow(blockIdOf('cobblestone')),
  OAK_LOG: Option.getOrThrow(blockIdOf('oak_log')),
  OAK_PLANKS: Option.getOrThrow(blockIdOf('oak_planks')),
  OAK_STAIRS: Option.getOrThrow(blockIdOf('oak_stairs')),
  TORCH: Option.getOrThrow(blockIdOf('torch')),
})
