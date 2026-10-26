import {
  InvalidNaturalStructureCoordinate as InvalidNaturalStructureCoordinateTag,
  type InvalidNaturalStructureCoordinate as InvalidNaturalStructureCoordinateType,
  validateNaturalStructureRegionCoordinates,
} from './natural-structure-coordinate-validation.js'
import { MAX_NATURAL_STRUCTURE_HORIZONTAL_EXTENT, NATURAL_STRUCTURE_GRID } from './natural-structure-grid-data.js'
import type {
  NaturalStructureBlockPlacement,
  NaturalStructureBlockPlacementDraft,
  NaturalStructureBounds,
  NaturalStructureKind,
  NaturalStructureMarker,
  NaturalStructureMarkerDraft,
  NaturalStructurePlan,
  NaturalStructurePosition,
  NaturalStructurePositionDraft,
  NaturalStructureRegion,
} from './natural-structure-types.js'
import { Option, Result } from 'effect'
import { channelSeed, latticeValue } from './noise-compatibility.js'
import { CHUNK_HEIGHT } from './constants.js'
import type { Dimension } from '@nerima-games/mc-kernel'
import type { NoiseSeed } from '@nerima-games/mc-noise'
import { blockAxisFromKnownSafeInteger } from './coordinate-compatibility.js'

/** Advances a loop counter, or a coordinate offset, by one unit. */
export const UNIT_STEP = 1

export type Candidate = NaturalStructureRegion

export const InvalidNaturalStructureCoordinate: typeof InvalidNaturalStructureCoordinateTag =
  InvalidNaturalStructureCoordinateTag
export type InvalidNaturalStructureCoordinate = InvalidNaturalStructureCoordinateType

export const validateNaturalStructureRegion = (
  kind: NaturalStructureKind,
  region: NaturalStructureRegion,
): Result.Result<void, InvalidNaturalStructureCoordinate> => validateNaturalStructureRegionCoordinates(
  kind,
  region,
  NATURAL_STRUCTURE_GRID[kind],
  MAX_NATURAL_STRUCTURE_HORIZONTAL_EXTENT,
)

export const floorDiv = (value: number, divisor: number): number => Math.floor(value / divisor)

export type MutablePlan = {
  readonly blocks: Map<string, NaturalStructureBlockPlacementDraft>
  readonly markers: Array<NaturalStructureMarkerDraft>
}

const keyOf = (x: number, y: number, z: number): string => `${String(x)},${String(y)},${String(z)}`

const PERMILLE_DENOMINATOR = 1000
const CANDIDATE_MARGIN_DIVISOR = 2

export const candidatePresenceChannelSeedFor = (
  seed: NoiseSeed,
  dimension: Dimension,
  kind: NaturalStructureKind,
): NoiseSeed => channelSeed(seed, `${dimension}:${kind}:present`)

export type CandidateChannelSeeds = Readonly<{
  readonly presence: NoiseSeed
  readonly x: NoiseSeed
  readonly z: NoiseSeed
}>

export type CandidateChannelInput = NoiseSeed | CandidateChannelSeeds

export const candidateChannelSeedsFor = (
  seed: NoiseSeed,
  dimension: Dimension,
  kind: NaturalStructureKind,
): CandidateChannelSeeds => Object.freeze({
  presence: candidatePresenceChannelSeedFor(seed, dimension, kind),
  x: channelSeed(seed, `${dimension}:${kind}:x`),
  z: channelSeed(seed, `${dimension}:${kind}:z`),
})

const candidateChannelSeedsForInput = (
  seed: NoiseSeed,
  dimension: Dimension,
  kind: NaturalStructureKind,
  channelInput?: CandidateChannelInput,
): CandidateChannelSeeds => {
  if (typeof channelInput === 'number') {
    return Object.freeze({
      presence: channelInput,
      x: channelSeed(seed, `${dimension}:${kind}:x`),
      z: channelSeed(seed, `${dimension}:${kind}:z`),
    })
  }
  if (channelInput) {
    return channelInput
  }
  return candidateChannelSeedsFor(seed, dimension, kind)
}

export const candidateForRegion = (
  seed: NoiseSeed,
  dimension: Dimension,
  kind: NaturalStructureKind,
  region: NaturalStructureRegion,
  channelInput?: CandidateChannelInput,
): Option.Option<Candidate> => {
  const grid = NATURAL_STRUCTURE_GRID[kind]
  const channelSeeds = candidateChannelSeedsForInput(seed, dimension, kind, channelInput)
  if (latticeValue(channelSeeds.presence, region.x, region.z) >= grid.spawnPermille / PERMILLE_DENOMINATOR) {
    return Option.none()
  }
  const margin = grid.separation / CANDIDATE_MARGIN_DIVISOR
  const span = grid.spacing - grid.separation
  return Option.some(Object.freeze({
    x: region.x * grid.spacing + margin + Math.floor(latticeValue(channelSeeds.x, region.x, region.z) * span),
    z: region.z * grid.spacing + margin + Math.floor(latticeValue(channelSeeds.z, region.x, region.z) * span),
  }))
}

const NATURAL_STRUCTURE_WORLD_MIN_Y = 0

export const addBlock = (mutable: MutablePlan, placement: NaturalStructureBlockPlacementDraft): void => {
  const { block, x, y, z } = placement
  if (y < NATURAL_STRUCTURE_WORLD_MIN_Y || y >= CHUNK_HEIGHT) {return}
  mutable.blocks.set(keyOf(x, y, z), Object.freeze({ block, x, y, z }))
}

export const addMarker = (mutable: MutablePlan, marker: NaturalStructureMarkerDraft): void => {
  mutable.markers.push(Object.freeze(marker))
}

/** Everything about a plan except its accumulated blocks and markers. */
export type NaturalStructureDraftMeta = {
  readonly dimension: Dimension
  readonly id: string
  readonly kind: NaturalStructureKind
  readonly origin: NaturalStructurePositionDraft
  readonly region: NaturalStructureRegion
}

type BoundsAccumulator = {
  maxX: number
  maxY: number
  maxZ: number
  minX: number
  minY: number
  minZ: number
}

const extendBounds = (bounds: BoundsAccumulator, positions: ReadonlyArray<NaturalStructurePosition>): void => {
  for (const position of positions) {
    bounds.maxX = Math.max(bounds.maxX, position.x)
    bounds.maxY = Math.max(bounds.maxY, position.y)
    bounds.maxZ = Math.max(bounds.maxZ, position.z)
    bounds.minX = Math.min(bounds.minX, position.x)
    bounds.minY = Math.min(bounds.minY, position.y)
    bounds.minZ = Math.min(bounds.minZ, position.z)
  }
}

const boundsFor = (
  blocks: ReadonlyArray<NaturalStructureBlockPlacement>,
  markers: ReadonlyArray<NaturalStructureMarker>,
): NaturalStructureBounds => {
  const bounds: BoundsAccumulator = {
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
    maxZ: Number.NEGATIVE_INFINITY,
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    minZ: Number.POSITIVE_INFINITY,
  }
  extendBounds(bounds, blocks)
  extendBounds(bounds, markers)
  return Object.freeze({
    maxX: blockAxisFromKnownSafeInteger(bounds.maxX),
    maxY: blockAxisFromKnownSafeInteger(bounds.maxY),
    maxZ: blockAxisFromKnownSafeInteger(bounds.maxZ),
    minX: blockAxisFromKnownSafeInteger(bounds.minX),
    minY: blockAxisFromKnownSafeInteger(bounds.minY),
    minZ: blockAxisFromKnownSafeInteger(bounds.minZ),
  })
}

const brandPlan = (
  meta: NaturalStructureDraftMeta,
  draftBlocks: ReadonlyArray<NaturalStructureBlockPlacementDraft>,
  draftMarkers: ReadonlyArray<NaturalStructureMarkerDraft>,
): NaturalStructurePlan => {
  const blocks = Object.freeze(draftBlocks.map((placement): NaturalStructureBlockPlacement => Object.freeze({
    ...placement,
    x: blockAxisFromKnownSafeInteger(placement.x),
    y: blockAxisFromKnownSafeInteger(placement.y),
    z: blockAxisFromKnownSafeInteger(placement.z),
  })))
  const markers = Object.freeze(draftMarkers.map((marker): NaturalStructureMarker => Object.freeze({
    ...marker,
    x: blockAxisFromKnownSafeInteger(marker.x),
    y: blockAxisFromKnownSafeInteger(marker.y),
    z: blockAxisFromKnownSafeInteger(marker.z),
  })))
  return Object.freeze({
    blocks,
    bounds: boundsFor(blocks, markers),
    dimension: meta.dimension,
    id: meta.id,
    kind: meta.kind,
    markers,
    origin: Object.freeze({
      x: blockAxisFromKnownSafeInteger(meta.origin.x),
      y: blockAxisFromKnownSafeInteger(meta.origin.y),
      z: blockAxisFromKnownSafeInteger(meta.origin.z),
    }),
    region: Object.freeze(meta.region),
  })
}

export const finishPlan = (
  meta: NaturalStructureDraftMeta,
  mutable: MutablePlan,
): Result.Result<NaturalStructurePlan, InvalidNaturalStructureCoordinate> => {
  const draftBlocks = [...mutable.blocks.values()]
  const draftMarkers = [...mutable.markers]
  return Result.succeed(brandPlan(meta, draftBlocks, draftMarkers))
}

export const finishPlanFromValidatedPlacements = (
  meta: NaturalStructureDraftMeta,
  placements: ReadonlyArray<NaturalStructureBlockPlacementDraft>,
  markers: ReadonlyArray<NaturalStructureMarkerDraft>,
): Result.Result<NaturalStructurePlan, InvalidNaturalStructureCoordinate> => Result.succeed(brandPlan(meta, placements, markers))
