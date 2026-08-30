import {
  type Candidate,
  type CandidateChannelInput,
  type MutablePlan,
  UNIT_STEP,
  addBlock,
  addMarker,
  candidateForRegion,
  finishPlan,
} from './natural-structure-plan-builder.js'
import type {
  NaturalStructurePlan,
  NaturalStructureRegion,
  NetherStructureTerrainSampler,
} from './natural-structure-types.js'
import { Option, Predicate } from 'effect'
import { channelSeed, latticeValue } from '@nerima-games/mc-noise'
import { NATURAL_STRUCTURE_BLOCK } from './natural-structure-data.js'

const PORTAL_PROBE_OFFSET = 3
const PORTAL_BASE_Y_CLEARANCE = 1
const PORTAL_MAX_SURFACE_VARIATION = 6
const PORTAL_MIN_CEILING_CLEARANCE = 7

const portalTerrainFits = (
  candidate: Candidate,
  sample: NetherStructureTerrainSampler,
): Option.Option<number> => {
  const probes = [
    sample(candidate.x, candidate.z),
    sample(candidate.x - PORTAL_PROBE_OFFSET, candidate.z),
    sample(candidate.x + PORTAL_PROBE_OFFSET, candidate.z),
    sample(candidate.x, candidate.z - PORTAL_PROBE_OFFSET),
    sample(candidate.x, candidate.z + PORTAL_PROBE_OFFSET),
  ]
  const validProbes = probes.filter(Predicate.isNotUndefined)
  if (validProbes.length !== probes.length) {return Option.none()}

  const surfaces = validProbes.map((probe) => probe.surfaceY)
  const baseY = Math.max(...surfaces) + PORTAL_BASE_Y_CLEARANCE
  if (
    Math.max(...surfaces) - Math.min(...surfaces) > PORTAL_MAX_SURFACE_VARIATION
    || validProbes.some((probe) => probe.ceilingY - baseY < PORTAL_MIN_CEILING_CLEARANCE)
  ) {
    return Option.none()
  }
  return Option.some(baseY)
}

const PORTAL_RUIN_AXIS_CHANCE = 0.5
const PORTAL_RUIN_DAMAGE_VARIANTS = 4
const PORTAL_RUIN_FLOOR_ACROSS_HALF_EXTENT = 3
const PORTAL_RUIN_FLOOR_ALONG_HALF_EXTENT = 2
const PORTAL_RUIN_FLOOR_Y_OFFSET = 1
const PORTAL_RUIN_FRAME_WIDTH = 4
const PORTAL_RUIN_FRAME_HEIGHT = 5
const PORTAL_RUIN_FRAME_FIRST_COLUMN = 0
const PORTAL_RUIN_FRAME_LAST_COLUMN = 3
const PORTAL_RUIN_FRAME_FIRST_ROW = 0
const PORTAL_RUIN_FRAME_LAST_ROW = 4
const PORTAL_RUIN_FRAME_HORIZONTAL_ORIGIN_OFFSET = 1
const PORTAL_RUIN_CHEST_OFFSET_ACROSS = 3
const PORTAL_RUIN_CHEST_OFFSET_ALONG = 2

const naturalAxisFromChance = (chance: number): 'x' | 'z' => {
  if (chance < PORTAL_RUIN_AXIS_CHANCE) {
    return 'x'
  }
  return 'z'
}

/** Rotates an (across, along) offset pair into world (x, z) for the ruin's chosen axis. */
const acrossAlongToXZ = (candidate: Candidate, axis: 'x' | 'z', across: number, along: number): NaturalStructureRegion => {
  if (axis === 'x') {
    return { x: candidate.x + across, z: candidate.z + along }
  }
  return { x: candidate.x + along, z: candidate.z + across }
}

const carvePortalRuinFloor = (mutable: MutablePlan, candidate: Candidate, axis: 'x' | 'z', baseY: number): void => {
  for (let across = -PORTAL_RUIN_FLOOR_ACROSS_HALF_EXTENT; across <= PORTAL_RUIN_FLOOR_ACROSS_HALF_EXTENT; across += UNIT_STEP) {
    for (let along = -PORTAL_RUIN_FLOOR_ALONG_HALF_EXTENT; along <= PORTAL_RUIN_FLOOR_ALONG_HALF_EXTENT; along += UNIT_STEP) {
      const { x, z } = acrossAlongToXZ(candidate, axis, across, along)
      addBlock(mutable, { block: NATURAL_STRUCTURE_BLOCK.NETHERRACK, x, y: baseY - PORTAL_RUIN_FLOOR_Y_OFFSET, z })
    }
  }
}

const portalFrameColumnXZ = (candidate: Candidate, axis: 'x' | 'z', horizontal: number): NaturalStructureRegion => {
  const offset = horizontal - PORTAL_RUIN_FRAME_HORIZONTAL_ORIGIN_OFFSET
  if (axis === 'x') {
    return { x: candidate.x + offset, z: candidate.z }
  }
  return { x: candidate.x, z: candidate.z + offset }
}

const isPortalFrameBorderCell = (horizontal: number, vertical: number): boolean =>
  horizontal === PORTAL_RUIN_FRAME_FIRST_COLUMN ||
  horizontal === PORTAL_RUIN_FRAME_LAST_COLUMN ||
  vertical === PORTAL_RUIN_FRAME_FIRST_ROW ||
  vertical === PORTAL_RUIN_FRAME_LAST_ROW

type PortalRuinFrameParams = {
  readonly axis: 'x' | 'z'
  readonly baseY: number
  readonly missing: number
}

const carvePortalRuinFrame = (mutable: MutablePlan, candidate: Candidate, params: PortalRuinFrameParams): void => {
  const { axis, baseY, missing } = params
  for (let horizontal = 0; horizontal < PORTAL_RUIN_FRAME_WIDTH; horizontal += UNIT_STEP) {
    for (let vertical = 0; vertical < PORTAL_RUIN_FRAME_HEIGHT; vertical += UNIT_STEP) {
      if (isPortalFrameBorderCell(horizontal, vertical) && (horizontal + vertical) % PORTAL_RUIN_DAMAGE_VARIANTS !== missing) {
        const { x, z } = portalFrameColumnXZ(candidate, axis, horizontal)
        addBlock(mutable, { block: NATURAL_STRUCTURE_BLOCK.OBSIDIAN, x, y: baseY + vertical, z })
      }
    }
  }
}

const placePortalRuinLoot = (mutable: MutablePlan, candidate: Candidate, baseY: number, axis: 'x' | 'z'): void => {
  const lootX = candidate.x + PORTAL_RUIN_CHEST_OFFSET_ACROSS
  const lootZ = candidate.z + PORTAL_RUIN_CHEST_OFFSET_ALONG
  addBlock(mutable, { block: NATURAL_STRUCTURE_BLOCK.CHEST, x: lootX, y: baseY, z: lootZ })
  addMarker(mutable, { axis, complete: false, kind: 'portal-frame', x: candidate.x, y: baseY, z: candidate.z })
  addMarker(mutable, { kind: 'loot-chest', lootTable: 'ruined-nether-portal', x: lootX, y: baseY, z: lootZ })
}

type PortalRuinSite = { readonly candidate: Candidate; readonly baseY: number }

const portalRuinSiteForRegion = (
  seed: number,
  region: NaturalStructureRegion,
  sampleTerrain: NetherStructureTerrainSampler,
  presenceChannelSeed?: CandidateChannelInput,
): Option.Option<PortalRuinSite> => {
  const candidateOption = candidateForRegion(seed, 'nether', 'ruined-nether-portal', region, presenceChannelSeed)
  if (Option.isNone(candidateOption)) {return Option.none()}
  const candidate = candidateOption.value
  const baseYOption = portalTerrainFits(candidate, sampleTerrain)
  if (Option.isNone(baseYOption)) {return Option.none()}
  return Option.some({ baseY: baseYOption.value, candidate })
}

/** Plans an intentionally incomplete, unlit Nether portal ruin. */
export const planRuinedNetherPortalForRegion = (
  seed: number,
  regionX: number,
  regionZ: number,
  sampleTerrain: NetherStructureTerrainSampler,
  presenceChannelSeed?: CandidateChannelInput,
): Option.Option<NaturalStructurePlan> => {
  const siteOption = portalRuinSiteForRegion(seed, { x: regionX, z: regionZ }, sampleTerrain, presenceChannelSeed)
  if (Option.isNone(siteOption)) {return Option.none()}
  const { candidate, baseY } = siteOption.value
  const axis = naturalAxisFromChance(latticeValue(channelSeed(seed, 'nether:ruined-nether-portal:axis'), regionX, regionZ))
  const mutable: MutablePlan = { blocks: new Map(), markers: [] }
  carvePortalRuinFloor(mutable, candidate, axis, baseY)
  carvePortalRuinFrame(mutable, candidate, {
    axis,
    baseY,
    missing: Math.floor(
      latticeValue(channelSeed(seed, 'nether:ruined-nether-portal:damage'), regionX, regionZ) * PORTAL_RUIN_DAMAGE_VARIANTS,
    ),
  })
  placePortalRuinLoot(mutable, candidate, baseY, axis)
  return Option.some(finishPlan(
    {
      dimension: 'nether',
      id: `ruined-nether-portal:${String(seed)}:${String(regionX)}:${String(regionZ)}`,
      kind: 'ruined-nether-portal',
      origin: { x: candidate.x, y: baseY, z: candidate.z },
      region: { x: regionX, z: regionZ },
    },
    mutable,
  ))
}
