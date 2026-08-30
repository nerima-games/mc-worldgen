import { type BlockId, blockIdOf } from '@nerima-games/mc-kernel'
import type { NaturalStructureGrid } from './natural-structure-types.js'

export const SHIPWRECK_GRID: NaturalStructureGrid = Object.freeze({
  separation: 96,
  spacing: 256,
  spawnPermille: 160,
})

const LOOT_OFFSET_FORWARD = 4
const LOOT_OFFSET_AFT = -LOOT_OFFSET_FORWARD

export const SHIPWRECK_LAYOUT: Readonly<{
  cabinEndX: number
  cabinStartX: number
  cabinWallHeight: number
  deckYOffset: number
  halfLength: number
  halfWidth: number
  lootOffsets: ReadonlyArray<number>
  mastHeight: number
  mastX: number
  maxSurfaceVariation: number
  minWaterDepth: number
}> = Object.freeze({
  cabinEndX: 7,
  cabinStartX: 2,
  cabinWallHeight: 2,
  deckYOffset: 2,
  halfLength: 8,
  halfWidth: 3,
  lootOffsets: Object.freeze([LOOT_OFFSET_AFT, LOOT_OFFSET_FORWARD]),
  mastHeight: 6,
  mastX: -1,
  maxSurfaceVariation: 2,
  minWaterDepth: 2,
})

export const SHIPWRECK_BLOCK: Readonly<Record<'CHEST' | 'OAK_LOG' | 'OAK_PLANKS' | 'OAK_STAIRS', BlockId>> = Object.freeze({
  CHEST: blockIdOf('chest'),
  OAK_LOG: blockIdOf('oak_log'),
  OAK_PLANKS: blockIdOf('oak_planks'),
  OAK_STAIRS: blockIdOf('oak_stairs'),
})
