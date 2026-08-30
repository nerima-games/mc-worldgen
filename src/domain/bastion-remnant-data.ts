import { type BlockId, blockIdOf } from '@nerima-games/mc-kernel'
import type { NaturalStructureGrid } from './natural-structure-types.js'

export const BASTION_REMNANT_GRID: NaturalStructureGrid = Object.freeze({
  separation: 128,
  spacing: 256,
  spawnPermille: 180,
})

export const BASTION_REMNANT_BLOCK: Readonly<
  Record<'CHEST' | 'GOLD_BLOCK' | 'NETHERRACK' | 'NETHER_BRICK' | 'SMOOTH_BASALT', BlockId>
> = Object.freeze({
  CHEST: blockIdOf('chest'),
  GOLD_BLOCK: blockIdOf('gold_block'),
  NETHERRACK: blockIdOf('netherrack'),
  NETHER_BRICK: blockIdOf('nether_brick'),
  SMOOTH_BASALT: blockIdOf('smooth_basalt'),
})

export const BASTION_REMNANT_LAYOUT: Readonly<
  Record<
    | 'bridgeHalfWidth'
    | 'bridgeHeightOffset'
    | 'centralTowerHalfExtent'
    | 'centralTowerHeight'
    | 'chestYOffset'
    | 'halfExtent'
    | 'maxSurfaceVariation'
    | 'minHeadroom'
    | 'outerWallHeight',
    number
  >
> = Object.freeze({
  bridgeHalfWidth: 1,
  bridgeHeightOffset: 2,
  centralTowerHalfExtent: 3,
  centralTowerHeight: 8,
  chestYOffset: 2,
  halfExtent: 10,
  maxSurfaceVariation: 4,
  minHeadroom: 10,
  outerWallHeight: 4,
})
