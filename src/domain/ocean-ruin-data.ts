import { type BlockId, blockIdOf } from '@nerima-games/mc-kernel'
import type { NaturalStructureGrid } from './natural-structure-types.js'

export const OCEAN_RUIN_GRID: NaturalStructureGrid = Object.freeze({
  separation: 64,
  spacing: 192,
  spawnPermille: 180,
})

export const OCEAN_RUIN_LAYOUT: Readonly<{
  halfExtent: number
  maxSurfaceVariation: number
  minWaterDepth: number
  wallHeight: number
}> = Object.freeze({
  halfExtent: 5,
  maxSurfaceVariation: 2,
  minWaterDepth: 2,
  wallHeight: 4,
})

export const OCEAN_RUIN_BLOCK: Readonly<
  Record<'CHEST' | 'COBBLESTONE' | 'GRAVEL' | 'PRISMARINE' | 'SAND' | 'SANDSTONE' | 'STONE', BlockId>
> = Object.freeze({
  CHEST: blockIdOf('chest'),
  COBBLESTONE: blockIdOf('cobblestone'),
  GRAVEL: blockIdOf('gravel'),
  PRISMARINE: blockIdOf('prismarine'),
  SAND: blockIdOf('sand'),
  SANDSTONE: blockIdOf('sandstone'),
  STONE: blockIdOf('stone'),
})
