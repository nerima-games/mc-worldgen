import type { NaturalStructureGrid, NaturalStructureKind } from './natural-structure-types.js'
import {
  STRONGHOLD_REGION_SIZE,
  STRONGHOLD_REGION_SPAWN_PERMILLE,
  STRONGHOLD_SITE_MARGIN,
  VILLAGE_REGION_SIZE,
  VILLAGE_SITE_MARGIN,
} from './structure-siting.js'
import { BASTION_REMNANT_GRID } from './bastion-remnant-data.js'
import { COMPACT_STRUCTURE_GRID } from './compact-structure-data.js'
import { DESERT_PYRAMID_GRID } from './desert-pyramid-data.js'
import { DESERT_WELL_GRID } from './desert-well-data.js'
import { IGLOO_GRID } from './igloo-data.js'
import { JUNGLE_PYRAMID_GRID } from './jungle-pyramid-data.js'
import { MINESHAFT_GRID } from './mineshaft-data.js'
import { NETHER_FORTRESS_GRID } from './nether-fortress-data.js'
import { OCEAN_MONUMENT_GRID } from './ocean-monument-data.js'
import { OCEAN_RUIN_GRID } from './ocean-ruin-data.js'
import { PILLAGER_OUTPOST_GRID } from './pillager-outpost-data.js'
import { SHIPWRECK_GRID } from './shipwreck-data.js'

const VILLAGE_SEPARATION_MULTIPLIER = 2
const STRONGHOLD_SEPARATION_MULTIPLIER = 2

export const NATURAL_STRUCTURE_GRID: Readonly<Record<NaturalStructureKind, NaturalStructureGrid>> = Object.freeze({
  'bastion-remnant': BASTION_REMNANT_GRID,
  ...COMPACT_STRUCTURE_GRID,
  'desert-pyramid': DESERT_PYRAMID_GRID,
  'desert-well': DESERT_WELL_GRID,
  'end-city': Object.freeze({ separation: 176, spacing: 320, spawnPermille: 350 }),
  igloo: IGLOO_GRID,
  'jungle-pyramid': JUNGLE_PYRAMID_GRID,
  mineshaft: MINESHAFT_GRID,
  'nether-fortress': NETHER_FORTRESS_GRID,
  'ocean-monument': OCEAN_MONUMENT_GRID,
  'ocean-ruin': OCEAN_RUIN_GRID,
  'pillager-outpost': PILLAGER_OUTPOST_GRID,
  'ruined-nether-portal': Object.freeze({ separation: 64, spacing: 192, spawnPermille: 300 }),
  shipwreck: SHIPWRECK_GRID,
  stronghold: Object.freeze({
    separation: STRONGHOLD_SITE_MARGIN * STRONGHOLD_SEPARATION_MULTIPLIER,
    spacing: STRONGHOLD_REGION_SIZE,
    spawnPermille: STRONGHOLD_REGION_SPAWN_PERMILLE,
  }),
  village: Object.freeze({
    separation: VILLAGE_SITE_MARGIN * VILLAGE_SEPARATION_MULTIPLIER,
    spacing: VILLAGE_REGION_SIZE,
    spawnPermille: 120,
  }),
})

/**
 * The widest current horizontal structure footprint around its candidate.
 * Village terrain probing reaches 30 blocks, and End-ship/fortress markers
 * remain inside that envelope; the extra margin keeps this planner guard
 * conservative when a plan is sliced into chunks.
 */
export const MAX_NATURAL_STRUCTURE_HORIZONTAL_EXTENT = 64

export const MAX_NATURAL_STRUCTURE_BLOCKS = 4096
export const MAX_NATURAL_STRUCTURE_MARKERS = 32
