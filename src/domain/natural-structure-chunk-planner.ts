import {
  type CandidateChannelSeeds,
  UNIT_STEP,
  candidateChannelSeedsFor,
  floorDiv,
} from './natural-structure-plan-builder.js'
import { MAX_NATURAL_STRUCTURE_HORIZONTAL_EXTENT, NATURAL_STRUCTURE_GRID } from './natural-structure-grid-data.js'
import type {
  NaturalStructureGrid,
  NaturalStructureKind,
  NaturalStructurePlan,
  NaturalStructureRegion,
  NaturalStructureSamplers,
} from './natural-structure-types.js'
import { CHUNK_SIZE_XZ } from './constants.js'
import { COMPACT_STRUCTURE_KINDS } from './compact-structure-data.js'
import type { Dimension } from './nether-travel.js'
import { Option } from 'effect'
import { plansInStableOrder } from './natural-structure-order.js'

const OVERWORLD_NATURAL_STRUCTURE_KINDS: ReadonlyArray<NaturalStructureKind> = Object.freeze([
  ...COMPACT_STRUCTURE_KINDS,
  'desert-pyramid',
  'desert-well',
  'igloo',
  'jungle-pyramid',
  'mineshaft',
  'ocean-monument',
  'ocean-ruin',
  'pillager-outpost',
  'shipwreck',
  'stronghold',
  'village',
])
const NETHER_NATURAL_STRUCTURE_KINDS: ReadonlyArray<NaturalStructureKind> = Object.freeze([
  'bastion-remnant',
  'ruined-nether-portal',
  'nether-fortress',
])
const END_NATURAL_STRUCTURE_KINDS: ReadonlyArray<NaturalStructureKind> = Object.freeze(['end-city'])

const naturalStructureKindsFor = (dimension: Dimension): ReadonlyArray<NaturalStructureKind> => {
  if (dimension === 'overworld') {
    return OVERWORLD_NATURAL_STRUCTURE_KINDS
  }
  if (dimension === 'nether') {
    return NETHER_NATURAL_STRUCTURE_KINDS
  }
  return END_NATURAL_STRUCTURE_KINDS
}

const CHUNK_LOCAL_LAST_INDEX_OFFSET = 1
const CANDIDATE_MAX_INCLUSIVE_OFFSET = 1
const CANDIDATE_SEPARATION_DIVISOR = 2

type AxisRegionSpan = {
  readonly maxRegion: number
  readonly minRegion: number
}

type RegionSpan = {
  readonly maxRegionX: number
  readonly maxRegionZ: number
  readonly minRegionX: number
  readonly minRegionZ: number
}

/** Every candidate-region coordinate that can contain a candidate overlapping this chunk. */
const candidateRegionSpanForAxis = (
  minBlock: number,
  maxBlock: number,
  grid: NaturalStructureGrid,
): AxisRegionSpan => {
  const margin = grid.separation / CANDIDATE_SEPARATION_DIVISOR
  return {
    maxRegion: floorDiv(maxBlock + MAX_NATURAL_STRUCTURE_HORIZONTAL_EXTENT - margin, grid.spacing),
    minRegion: Math.ceil(
      (minBlock - MAX_NATURAL_STRUCTURE_HORIZONTAL_EXTENT - grid.spacing + margin + CANDIDATE_MAX_INCLUSIVE_OFFSET)
        / grid.spacing,
    ),
  }
}

const regionSpanForChunk = (coord: { readonly cx: number; readonly cz: number }, grid: NaturalStructureGrid): RegionSpan => {
  const minBlockX = coord.cx * CHUNK_SIZE_XZ
  const minBlockZ = coord.cz * CHUNK_SIZE_XZ
  const maxBlockX = minBlockX + CHUNK_SIZE_XZ - CHUNK_LOCAL_LAST_INDEX_OFFSET
  const maxBlockZ = minBlockZ + CHUNK_SIZE_XZ - CHUNK_LOCAL_LAST_INDEX_OFFSET
  const xSpan = candidateRegionSpanForAxis(minBlockX, maxBlockX, grid)
  const zSpan = candidateRegionSpanForAxis(minBlockZ, maxBlockZ, grid)
  return {
    maxRegionX: xSpan.maxRegion,
    maxRegionZ: zSpan.maxRegion,
    minRegionX: xSpan.minRegion,
    minRegionZ: zSpan.minRegion,
  }
}

type ChunkPlanContext = {
  readonly coord: { readonly cx: number; readonly cz: number }
  readonly dimension: Dimension
  readonly planForRegion: NaturalStructureRegionPlanner
  readonly samplers: NaturalStructureSamplers
  readonly seed: number
}

type StructurePlanContext = ChunkPlanContext & {
  readonly candidateChannelSeeds: CandidateChannelSeeds
  readonly kind: NaturalStructureKind
}

export type NaturalStructureRegionPlanRequest = {
  readonly candidateChannelSeeds?: CandidateChannelSeeds
  readonly dimension: Dimension
  readonly kind: NaturalStructureKind
  readonly presenceChannelSeed: number
  readonly region: NaturalStructureRegion
  readonly samplers: NaturalStructureSamplers
  readonly seed: number
}

const appendPlanForRegion = (
  plans: Array<NaturalStructurePlan>,
  context: StructurePlanContext,
  regionX: number,
  regionZ: number,
): void => {
  const {
    candidateChannelSeeds,
    dimension,
    kind,
    planForRegion,
    samplers,
    seed,
  } = context
  const option = planForRegion({
    candidateChannelSeeds,
    dimension,
    kind,
    presenceChannelSeed: candidateChannelSeeds.presence,
    region: { x: regionX, z: regionZ },
    samplers,
    seed,
  })
  if (Option.isSome(option)) {
    plans.push(option.value)
  }
}

const appendPlansForKind = (
  plans: Array<NaturalStructurePlan>,
  context: ChunkPlanContext,
  kind: NaturalStructureKind,
): void => {
  const grid = NATURAL_STRUCTURE_GRID[kind]
  const { minRegionX, maxRegionX, minRegionZ, maxRegionZ } = regionSpanForChunk(context.coord, grid)
  const structureContext: StructurePlanContext = {
    ...context,
    candidateChannelSeeds: candidateChannelSeedsFor(context.seed, context.dimension, kind),
    kind,
  }
  for (let regionX = minRegionX; regionX <= maxRegionX; regionX += UNIT_STEP) {
    for (let regionZ = minRegionZ; regionZ <= maxRegionZ; regionZ += UNIT_STEP) {
      appendPlanForRegion(plans, structureContext, regionX, regionZ)
    }
  }
}

export type NaturalStructureRegionPlanner = (
  request: NaturalStructureRegionPlanRequest,
) => Option.Option<NaturalStructurePlan>

/**
 * Enumerates only candidate regions that can overlap a chunk. The bounds are
 * derived from the candidate coordinate interval and handle negative
 * coordinates through floor division.
 */
export const naturalStructurePlansForChunk = (
  seed: number,
  dimension: Dimension,
  coord: { readonly cx: number; readonly cz: number },
  samplers: NaturalStructureSamplers,
  planForRegion: NaturalStructureRegionPlanner,
): ReadonlyArray<NaturalStructurePlan> => {
  const plans: Array<NaturalStructurePlan> = []
  const context: ChunkPlanContext = { coord, dimension, planForRegion, samplers, seed }

  for (const kind of naturalStructureKindsFor(dimension)) {
    appendPlansForKind(plans, context, kind)
  }
  return Object.freeze(plansInStableOrder(plans))
}
