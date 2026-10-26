import type { BlockAxis, ChunkCoord } from '@nerima-games/mc-kernel/domain/coordinates'
import {
  type CandidateChannelSeeds,
  type CandidateForRegionContext,
  InvalidNaturalStructureCoordinate,
  UNIT_STEP,
  candidateChannelSeedsForKnownCandidate,
  candidateExistsForRegion,
  floorDiv,
  candidatePresenceChannelSeedFor as genericCandidatePresenceChannelSeedFor,
  validatedCandidateChannelSeedsFor,
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
import {
  strongholdCandidateExistsWithPresenceChannelSeed,
  strongholdPresenceChannelSeedFor,
  villageCandidateExistsWithPresenceChannelSeed,
  villagePresenceChannelSeedFor,
} from './structure-siting.js'
import { CHUNK_SIZE_XZ } from './constants.js'
import { COMPACT_STRUCTURE_KINDS } from './compact-structure-data.js'
import type { Dimension } from '@nerima-games/mc-kernel'
import type { NoiseSeed } from '@nerima-games/mc-noise'
import { blockAxisFromKnownSafeInteger } from './coordinate-compatibility.js'
import { invalidNaturalStructureRegionSpan } from './natural-structure-coordinate-validation.js'
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
const NO_STRUCTURE_PLAN_CONTEXT = Symbol('no structure plan context')

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

const regionSpanForChunk = (
  validatedChunk: ValidatedNaturalStructureChunkCoordinates,
  grid: NaturalStructureGrid,
): RegionSpan => {
  const { minBlockX, minBlockZ } = validatedChunk
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

export type ValidatedNaturalStructureChunkCoordinates = {
  readonly coord: ChunkCoord
  readonly minBlockX: BlockAxis
  readonly minBlockZ: BlockAxis
}

const invalidChunkCoordinate = (
  kind: NaturalStructureKind,
  coord: ChunkCoord,
  axis: 'footprint-x' | 'footprint-z',
  value: number,
): InvalidNaturalStructureCoordinate => new InvalidNaturalStructureCoordinate({
  axis,
  kind,
  region: { x: Number(coord.cx), z: Number(coord.cz) },
  value,
})

const chunkCoordinateFailure = (
  kind: NaturalStructureKind,
  coord: ChunkCoord,
  xStart: number,
  zStart: number,
): InvalidNaturalStructureCoordinate | null => {
  if (!Number.isSafeInteger(coord.cx)) {return invalidChunkCoordinate(kind, coord, 'footprint-x', Number(coord.cx))}
  if (!Number.isSafeInteger(coord.cz)) {return invalidChunkCoordinate(kind, coord, 'footprint-z', Number(coord.cz))}
  if (!Number.isSafeInteger(xStart)) {return invalidChunkCoordinate(kind, coord, 'footprint-x', xStart)}
  if (!Number.isSafeInteger(zStart)) {return invalidChunkCoordinate(kind, coord, 'footprint-z', zStart)}
  return null
}

export const validateNaturalStructureChunkCoordinates = (
  dimension: Dimension,
  coord: ChunkCoord,
): Result.Result<ValidatedNaturalStructureChunkCoordinates, InvalidNaturalStructureCoordinate> => {
  const kind = naturalStructureKindsFor(dimension)[FIRST_NATURAL_STRUCTURE_KIND_INDEX]
  const xStart = coord.cx * CHUNK_SIZE_XZ
  const zStart = coord.cz * CHUNK_SIZE_XZ
  const failure = chunkCoordinateFailure(kind, coord, xStart, zStart)
  if (failure) {return Result.fail(failure)}
  // Safe chunk origins are multiples of 16, so adding the final local offset of 15 stays safe.
  return Result.succeed({
    coord,
    minBlockX: blockAxisFromKnownSafeInteger(xStart),
    minBlockZ: blockAxisFromKnownSafeInteger(zStart),
  })
}

type ChunkPlanContext = {
  readonly dimension: Dimension
  readonly planForRegion: NaturalStructureRegionPlanner
  readonly samplers: NaturalStructureSamplers
  readonly seed: NoiseSeed
  readonly validatedChunk: ValidatedNaturalStructureChunkCoordinates
}

export type NaturalStructurePlanContext = CandidateForRegionContext & {
  readonly kind: NaturalStructureKind
  readonly samplers: NaturalStructureSamplers
}

type StructurePlanContext = ChunkPlanContext & NaturalStructurePlanContext & {
  readonly candidatePresenceChannelSeed: NoiseSeed
}

const candidateRegionCanProducePlan = (
  kind: NaturalStructureKind,
  candidatePresenceChannelSeed: NoiseSeed,
  regionX: number,
  regionZ: number,
): boolean => {
  if (kind === 'stronghold') {
    return strongholdCandidateExistsWithPresenceChannelSeed(candidatePresenceChannelSeed, regionX, regionZ)
  }
  if (kind === 'village') {
    return villageCandidateExistsWithPresenceChannelSeed(candidatePresenceChannelSeed, regionX, regionZ)
  }
  return candidateExistsForRegion(kind, regionX, regionZ, candidatePresenceChannelSeed)
}

const candidatePresenceChannelSeedFor = (
  seed: NoiseSeed,
  dimension: Dimension,
  kind: NaturalStructureKind,
): NoiseSeed => {
  if (kind === 'stronghold') {
    return strongholdPresenceChannelSeedFor(seed)
  }
  if (kind === 'village') {
    return villagePresenceChannelSeedFor(seed)
  }
  return genericCandidatePresenceChannelSeedFor(seed, dimension, kind)
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

const validateCandidateRegionSpan = (
  kind: NaturalStructureKind,
  span: RegionSpan,
): InvalidNaturalStructureCoordinate | null => invalidNaturalStructureRegionSpan(
  kind,
  span,
  NATURAL_STRUCTURE_GRID[kind],
  MAX_NATURAL_STRUCTURE_HORIZONTAL_EXTENT,
)

const appendPlanForRegion = (
  plans: Array<NaturalStructurePlan>,
  context: StructurePlanContext,
  regionX: number,
  regionZ: number,
): InvalidNaturalStructureCoordinate | null => {
  const result = context.planForRegion(context, regionX, regionZ)
  if (Result.isFailure(result)) {return result.failure}
  if (Option.isSome(result.success)) {
    plans.push(result.success.value)
  }
  return null
}

const structureContextForCandidate = (
  context: ChunkPlanContext,
  kind: NaturalStructureKind,
  candidatePresenceChannelSeed: NoiseSeed,
  current: StructurePlanContext | typeof NO_STRUCTURE_PLAN_CONTEXT,
): StructurePlanContext => {
  if (current !== NO_STRUCTURE_PLAN_CONTEXT) {return current}
  const candidateChannelInput = candidateChannelSeedsForKnownCandidate(
    validatedCandidateChannelSeedsFor(context.seed, context.dimension, kind),
  )
  return { ...context, candidateChannelInput, candidatePresenceChannelSeed, kind }
}

const appendPlansInSpan = (
  plans: Array<NaturalStructurePlan>,
  context: ChunkPlanContext,
  kind: NaturalStructureKind,
  candidatePresenceChannelSeed: NoiseSeed,
  span: RegionSpan,
): InvalidNaturalStructureCoordinate | null => {
  const { minRegionX, maxRegionX, minRegionZ, maxRegionZ } = span
  let structureContext: StructurePlanContext | typeof NO_STRUCTURE_PLAN_CONTEXT = NO_STRUCTURE_PLAN_CONTEXT
  for (let regionX = minRegionX; regionX <= maxRegionX; regionX += UNIT_STEP) {
    for (let regionZ = minRegionZ; regionZ <= maxRegionZ; regionZ += UNIT_STEP) {
      if (candidateRegionCanProducePlan(kind, candidatePresenceChannelSeed, regionX, regionZ)) {
        structureContext = structureContextForCandidate(context, kind, candidatePresenceChannelSeed, structureContext)
        const result = appendPlanForRegion(plans, structureContext, regionX, regionZ)
        if (result) {return result}
      }
    }
  }
  return null
}

const appendPlansForKind = (
  plans: Array<NaturalStructurePlan>,
  context: ChunkPlanContext,
  kind: NaturalStructureKind,
): InvalidNaturalStructureCoordinate | null => {
  const span = regionSpanForChunk(context.validatedChunk, NATURAL_STRUCTURE_GRID[kind])
  const spanFailure = validateCandidateRegionSpan(kind, span)
  if (spanFailure) {
    return spanFailure
  }
  const candidatePresenceSeed = candidatePresenceChannelSeedFor(context.seed, context.dimension, kind)
  return appendPlansInSpan(plans, context, kind, candidatePresenceSeed, span)
}

export type NaturalStructureRegionPlanner = (
  context: NaturalStructurePlanContext,
  regionX: number,
  regionZ: number,
) => Result.Result<Option.Option<NaturalStructurePlan>, InvalidNaturalStructureCoordinate>

/**
 * Enumerates only candidate regions that can overlap a chunk. The bounds are
 * derived from the candidate coordinate interval and handle negative
 * coordinates through floor division.
 */
export const naturalStructurePlansForValidatedChunk = (
  seed: NoiseSeed,
  dimension: Dimension,
  validatedChunk: ValidatedNaturalStructureChunkCoordinates,
  samplers: NaturalStructureSamplers,
  planForRegion: NaturalStructureRegionPlanner,
): Result.Result<ReadonlyArray<NaturalStructurePlan>, InvalidNaturalStructureCoordinate> => {
  const plans: Array<NaturalStructurePlan> = []
  const context: ChunkPlanContext = { dimension, planForRegion, samplers, seed, validatedChunk }

  for (const kind of naturalStructureKindsFor(dimension)) {
    const result = appendPlansForKind(plans, context, kind)
    if (result) {return Result.fail(result)}
  }
  return Result.succeed(Object.freeze(plansInStableOrder(plans)))
}
