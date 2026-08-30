import { type BlockId, blockIdOf } from '@nerima-games/mc-kernel'
import type { NaturalStructureGrid } from './natural-structure-types.js'

export const MINESHAFT_GRID: NaturalStructureGrid = Object.freeze({
  separation: 96,
  spacing: 256,
  spawnPermille: 150,
})

const BRANCH_OFFSET_NONE = 0
const BRANCH_OFFSET_STEP = 8

export const MINESHAFT_LAYOUT: Readonly<{
  branchHalfExtent: number
  branchOffsets: ReadonlyArray<number>
  corridorHalfWidth: number
  depthBelowSurface: number
  frameHalfWidth: number
  frameHeight: number
  lootBranchOffset: number
  lootOffsetZ: number
  maxSurfaceVariation: number
  minimumBaseY: number
  supportSpacing: number
}> = Object.freeze({
  branchHalfExtent: 10,
  branchOffsets: Object.freeze([-BRANCH_OFFSET_STEP, BRANCH_OFFSET_NONE, BRANCH_OFFSET_STEP]),
  corridorHalfWidth: 1,
  depthBelowSurface: 18,
  frameHalfWidth: 2,
  frameHeight: 4,
  lootBranchOffset: -8,
  lootOffsetZ: 8,
  maxSurfaceVariation: 6,
  minimumBaseY: 5,
  supportSpacing: 4,
})

export const MINESHAFT_BLOCK: Readonly<
  Record<
    'AIR' | 'CHEST' | 'COBWEB' | 'OAK_LOG' | 'OAK_PLANKS' | 'POWERED_RAIL' | 'RAIL' | 'TORCH',
    BlockId
  >
> = Object.freeze({
  AIR: blockIdOf('air'),
  CHEST: blockIdOf('chest'),
  COBWEB: blockIdOf('cobweb'),
  OAK_LOG: blockIdOf('oak_log'),
  OAK_PLANKS: blockIdOf('oak_planks'),
  POWERED_RAIL: blockIdOf('powered_rail'),
  RAIL: blockIdOf('rail'),
  TORCH: blockIdOf('torch'),
})
