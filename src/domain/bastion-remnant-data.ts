import type { NaturalStructureGrid } from './natural-structure-types'
import { blockIdOf } from '@nerima-games/mc-kernel'

export const BASTION_REMNANT_GRID: NaturalStructureGrid = Object.freeze({
  separation: 128,
  spacing: 256,
  spawnPermille: 180,
})

export const BASTION_REMNANT_BLOCK = Object.freeze({
  CHEST: blockIdOf('chest'),
  GOLD_BLOCK: blockIdOf('gold_block'),
  NETHERRACK: blockIdOf('netherrack'),
  NETHER_BRICK: blockIdOf('nether_brick'),
  SMOOTH_BASALT: blockIdOf('smooth_basalt'),
})

export const BASTION_REMNANT_LAYOUT = Object.freeze({
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
