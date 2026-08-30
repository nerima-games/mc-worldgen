import { type BlockId, blockIdOf } from '@nerima-games/mc-kernel'
import type { NaturalStructureGrid } from './natural-structure-types.js'

export const OCEAN_MONUMENT_GRID: NaturalStructureGrid = Object.freeze({
  separation: 160,
  spacing: 512,
  spawnPermille: 80,
})

export const OCEAN_MONUMENT_LAYOUT: Readonly<{
  centralTowerHalfExtent: number
  centralTowerHeight: number
  chestYOffset: number
  halfExtent: number
  interiorWaterHeight: number
  maxSurfaceVariation: number
  minWaterDepth: number
  outerWallHeight: number
}> = Object.freeze({
  centralTowerHalfExtent: 3,
  centralTowerHeight: 8,
  chestYOffset: 2,
  halfExtent: 8,
  interiorWaterHeight: 4,
  maxSurfaceVariation: 2,
  minWaterDepth: 10,
  outerWallHeight: 5,
})

export const OCEAN_MONUMENT_BLOCK: Readonly<
  Record<'CHEST' | 'PRISMARINE' | 'STONE' | 'WATER', BlockId>
> = Object.freeze({
  CHEST: blockIdOf('chest'),
  PRISMARINE: blockIdOf('prismarine'),
  STONE: blockIdOf('stone'),
  WATER: blockIdOf('water'),
})
