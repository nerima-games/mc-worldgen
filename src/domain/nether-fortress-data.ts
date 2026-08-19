import type { NaturalStructureGrid } from './natural-structure'
import { blockIdOf } from '@nerima-games/mc-kernel'

/** Candidate spacing and terrain-independent block data for Nether fortresses. */
export const NETHER_FORTRESS_GRID: NaturalStructureGrid = Object.freeze({
  separation: 128,
  spacing: 256,
  spawnPermille: 300,
})

/** The reference layout's nominal floor; terrain validation may raise it. */
export const FORTRESS_FLOOR_Y = 48
export const FORTRESS_REGION_SIZE = NETHER_FORTRESS_GRID.spacing
export const FORTRESS_REGION_SPAWN_PERMILLE = NETHER_FORTRESS_GRID.spawnPermille

export const NETHER_FORTRESS_BLOCK = Object.freeze({
  AIR: blockIdOf('air'),
  BREWING_STAND: blockIdOf('brewing_stand'),
  CHEST: blockIdOf('chest'),
  NETHER_BRICK: blockIdOf('nether_brick'),
  NETHER_WART_CROP: blockIdOf('nether_wart_crop'),
  SOUL_SAND: blockIdOf('soul_sand'),
  WITHER_SKELETON_SKULL: blockIdOf('wither_skeleton_skull'),
})

/** Geometry data kept separate from the deterministic placement algorithm. */
export const FORTRESS_LAYOUT = Object.freeze({
  corridorHalfLength: 24,
  corridorHalfWidth: 2,
  pillarInterval: 8,
  wallHeight: 3,
  windowInterval: 4,
})

const FORTRESS_HEADROOM_OFFSET = 2
const FORTRESS_SITE_MARGIN_DIVISOR = 2

export const FORTRESS_BLAZE_RADIUS = 48
export const FORTRESS_MIN_HEADROOM = FORTRESS_LAYOUT.wallHeight + FORTRESS_HEADROOM_OFFSET
export const FORTRESS_SITE_MARGIN = NETHER_FORTRESS_GRID.separation / FORTRESS_SITE_MARGIN_DIVISOR
