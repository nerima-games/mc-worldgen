import {
  type CandidateChannelSeeds,
  InvalidNaturalStructureCoordinate,
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
import { Option, Result } from 'effect'
import { CHUNK_SIZE_XZ } from './constants.js'
import { COMPACT_STRUCTURE_KINDS } from './compact-structure-data.js'
import type { Dimension } from '@nerima-games/mc-kernel'
import type { NoiseSeed } from '@nerima-games/mc-noise'
import { plansInStableOrder } from './natural-structure-order.js'

type NonEmptyReadonlyArray<Element> = readonly [Element, ...Array<Element>]

const OVERWORLD_NATURAL_STRUCTURE_KINDS: NonEmptyReadonlyArray<NaturalStructureKind> = Object.freeze([
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
const NETHER_NATURAL_STRUCTURE_KINDS: NonEmptyReadonlyArray<NaturalStructureKind> = Object.freeze([
  'bastion-remnant',
  'ruined-nether-portal',
  'nether-fortress',
])
const END_NATURAL_STRUCTURE_KINDS: NonEmptyReadonlyArray<NaturalStructureKind> = Object.freeze(['end-city'])
const FIRST_NATURAL_STRUCTURE_KIND_INDEX = 0

const naturalStructureKindsFor = (dimension: Dimension): NonEmptyReadonlyArray<NaturalStructureKind> => {
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

export const validateNaturalStructureChunkCoordinates = (
  dimension: Dimension,
  coord: { readonly cx: number; readonly cz: number },
): Result.Result<void, InvalidNaturalStructureCoordinate> => {
  const kind = naturalStructureKindsFor(dimension)[FIRST_NATURAL_STRUCTURE_KIND_INDEX]
  const region = { x: Number(coord.cx), z: Number(coord.cz) }
  const xStart = coord.cx * CHUNK_SIZE_XZ
  const zStart = coord.cz * CHUNK_SIZE_XZ
  const coordinates = [
    ['footprint-x', Number(coord.cx)],
    ['footprint-z', Number(coord.cz)],
    ['footprint-x', xStart],
    ['footprint-x', xStart + CHUNK_SIZE_XZ - CHUNK_LOCAL_LAST_INDEX_OFFSET],
    ['footprint-z', zStart],
    ['footprint-z', zStart + CHUNK_SIZE_XZ - CHUNK_LOCAL_LAST_INDEX_OFFSET],
  ] as const
  for (const [axis, value] of coordinates) {
    if (!Number.isSafeInteger(value)) {
      return Result.fail(new InvalidNaturalStructureCoordinate({ axis, kind, region, value }))
    }
  }
  return Result.void
}

type ChunkPlanContext = {
  readonly coord: { readonly cx: number; readonly cz: number }
  readonly dimension: Dimension
  readonly planForRegion: NaturalStructureRegionPlanner
  readonly samplers: NaturalStructureSamplers
  readonly seed: NoiseSeed
}

type StructurePlanContext = ChunkPlanContext & {
  readonly candidateChannelSeeds: CandidateChannelSeeds
  readonly kind: NaturalStructureKind
}

export type NaturalStructureRegionPlanRequest = {
  readonly candidateChannelSeeds?: CandidateChannelSeeds
  readonly dimension: Dimension
  readonly kind: NaturalStructureKind
  readonly presenceChannelSeed: NoiseSeed
  readonly region: NaturalStructureRegion
  readonly samplers: NaturalStructureSamplers
  readonly seed: NoiseSeed
}

const appendPlanForRegion = (
  plans: Array<NaturalStructurePlan>,
  context: StructurePlanContext,
  regionX: number,
  regionZ: number,
): Result.Result<void, InvalidNaturalStructureCoordinate> => {
  const {
    candidateChannelSeeds,
    dimension,
    kind,
    planForRegion,
    samplers,
    seed,
  } = context
  const result = planForRegion({
    candidateChannelSeeds,
    dimension,
    kind,
    presenceChannelSeed: candidateChannelSeeds.presence,
    region: { x: regionX, z: regionZ },
    samplers,
    seed,
  })
  if (Result.isFailure(result)) {return Result.fail(result.failure)}
  if (Option.isSome(result.success)) {
    plans.push(result.success.value)
  }
  return Result.void
}

const appendPlansForKind = (
  plans: Array<NaturalStructurePlan>,
  context: ChunkPlanContext,
  kind: NaturalStructureKind,
): Result.Result<void, InvalidNaturalStructureCoordinate> => {
  const grid = NATURAL_STRUCTURE_GRID[kind]
  const { minRegionX, maxRegionX, minRegionZ, maxRegionZ } = regionSpanForChunk(context.coord, grid)
  const structureContext: StructurePlanContext = {
    ...context,
    candidateChannelSeeds: candidateChannelSeedsFor(context.seed, context.dimension, kind),
    kind,
  }
  for (let regionX = minRegionX; regionX <= maxRegionX; regionX += UNIT_STEP) {
    for (let regionZ = minRegionZ; regionZ <= maxRegionZ; regionZ += UNIT_STEP) {
      const result = appendPlanForRegion(plans, structureContext, regionX, regionZ)
      if (Result.isFailure(result)) {return Result.fail(result.failure)}
    }
  }
  return Result.void
}

export type NaturalStructureRegionPlanner = (
  request: NaturalStructureRegionPlanRequest,
) => Result.Result<Option.Option<NaturalStructurePlan>, InvalidNaturalStructureCoordinate>

/**
 * Enumerates only candidate regions that can overlap a chunk. The bounds are
 * derived from the candidate coordinate interval and handle negative
 * coordinates through floor division.
 */
export const naturalStructurePlansForChunk = (
  seed: NoiseSeed,
  dimension: Dimension,
  coord: { readonly cx: number; readonly cz: number },
  samplers: NaturalStructureSamplers,
  planForRegion: NaturalStructureRegionPlanner,
): Result.Result<ReadonlyArray<NaturalStructurePlan>, InvalidNaturalStructureCoordinate> => {
  const coordinateValidation = validateNaturalStructureChunkCoordinates(dimension, coord)
  if (Result.isFailure(coordinateValidation)) {return Result.fail(coordinateValidation.failure)}
  const plans: Array<NaturalStructurePlan> = []
  const context: ChunkPlanContext = { coord, dimension, planForRegion, samplers, seed }

  for (const kind of naturalStructureKindsFor(dimension)) {
    const result = appendPlansForKind(plans, context, kind)
    if (Result.isFailure(result)) {return Result.fail(result.failure)}
  }
  return Result.succeed(Object.freeze(plansInStableOrder(plans)))
}
