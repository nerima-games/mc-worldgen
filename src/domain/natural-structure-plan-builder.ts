import {
  MAX_NATURAL_STRUCTURE_BLOCKS,
  MAX_NATURAL_STRUCTURE_MARKERS,
  NATURAL_STRUCTURE_GRID,
} from './natural-structure-grid-data.js'
import type {
  NaturalStructureBlockPlacement,
  NaturalStructureKind,
  NaturalStructureMarker,
  NaturalStructurePlan,
  NaturalStructurePosition,
  NaturalStructureRegion,
} from './natural-structure-types.js'
import { channelSeed, latticeValue } from '@nerima-games/mc-noise'
import { CHUNK_HEIGHT } from './constants.js'
import type { Dimension } from './nether-travel.js'
import { Option } from 'effect'

/** Advances a loop counter, or a coordinate offset, by one unit. */
export const UNIT_STEP = 1

export type Candidate = NaturalStructureRegion

export const floorDiv = (value: number, divisor: number): number => Math.floor(value / divisor)

export type MutablePlan = {
  readonly blocks: Map<string, NaturalStructureBlockPlacement>
  readonly markers: Array<NaturalStructureMarker>
}

const keyOf = (x: number, y: number, z: number): string => `${String(x)},${String(y)},${String(z)}`

const PERMILLE_DENOMINATOR = 1000
const CANDIDATE_MARGIN_DIVISOR = 2

export const candidatePresenceChannelSeedFor = (
  seed: number,
  dimension: Dimension,
  kind: NaturalStructureKind,
): number => channelSeed(seed, `${dimension}:${kind}:present`)

export type CandidateChannelSeeds = Readonly<{
  readonly presence: number
  readonly x: number
  readonly z: number
}>

export type CandidateChannelInput = number | CandidateChannelSeeds

export const candidateChannelSeedsFor = (
  seed: number,
  dimension: Dimension,
  kind: NaturalStructureKind,
): CandidateChannelSeeds => Object.freeze({
  presence: candidatePresenceChannelSeedFor(seed, dimension, kind),
  x: channelSeed(seed, `${dimension}:${kind}:x`),
  z: channelSeed(seed, `${dimension}:${kind}:z`),
})

const candidateChannelSeedsForInput = (
  seed: number,
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
  seed: number,
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

export const addBlock = (mutable: MutablePlan, placement: NaturalStructureBlockPlacement): void => {
  const { block, x, y, z } = placement
  if (y < NATURAL_STRUCTURE_WORLD_MIN_Y || y >= CHUNK_HEIGHT) {return}
  const key = keyOf(x, y, z)
  /**
   * UNREACHABLE TODAY, NOT PROVABLY DEAD — weaker than the other guards this
   * repository marks this way, and deliberately not deleted for that reason.
   * `addBlock` is module-private, so the cap can only be approached through
   * the fixed-geometry natural-structure planners. The guard stays live
   * because future structure geometry or a terrain sampler with much more Y
   * variation could raise the block count; the cap is not a type-level
   * invariant.
   *
   * Vitest 4's coverage-v8 provider (ast-v8-to-istanbul) reads its `if`,
   * `next` and `else` ignore hints from the esbuild-transformed code, where
   * esbuild drops a standalone inline ignore-next-style comment entirely
   * (verified empirically: esbuild.transform() strips it even with no
   * minification). The start/stop hint pair is the one this package
   * documents as checked against the ORIGINAL source instead, so it survives
   * the transform — this is why every ignore hint in this repository now
   * uses that form.
   */
  // oxlint-disable-next-line capitalized-comments -- v8 coverage directive, case-sensitive
  /* v8 ignore start */
  if (!mutable.blocks.has(key) && mutable.blocks.size >= MAX_NATURAL_STRUCTURE_BLOCKS) {return}
  // oxlint-disable-next-line capitalized-comments -- v8 coverage directive, case-sensitive
  /* v8 ignore stop */
  if (Object.isFrozen(placement)) {
    mutable.blocks.set(key, placement)
    return
  }
  mutable.blocks.set(key, Object.freeze({ block, x, y, z }))
}

export const addMarker = (mutable: MutablePlan, marker: NaturalStructureMarker): void => {
  /**
   * UNREACHABLE TODAY, NOT PROVABLY DEAD — same reasoning as `addBlock`'s cap
   * above: module-private, only approached through the fixed-geometry
   * natural-structure planners, and kept live because future structure
   * geometry could raise the marker count. See `addBlock` for why this uses
   * the start/stop ignore-hint form.
   */
  // oxlint-disable-next-line capitalized-comments -- v8 coverage directive, case-sensitive
  /* v8 ignore start */
  if (mutable.markers.length < MAX_NATURAL_STRUCTURE_MARKERS) {mutable.markers.push(Object.freeze(marker))}
  // oxlint-disable-next-line capitalized-comments -- v8 coverage directive, case-sensitive
  /* v8 ignore stop */
}

/** Everything about a plan except its accumulated blocks and markers. */
export type NaturalStructureDraftMeta = {
  readonly dimension: Dimension
  readonly id: string
  readonly kind: NaturalStructureKind
  readonly origin: NaturalStructurePosition
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
): Readonly<BoundsAccumulator> => {
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
  return Object.freeze(bounds)
}

export const finishPlan = (meta: NaturalStructureDraftMeta, mutable: MutablePlan): NaturalStructurePlan => {
  const blocks = Object.freeze([...mutable.blocks.values()])
  const markers = Object.freeze([...mutable.markers])
  const bounds = boundsFor(blocks, markers)
  return Object.freeze({
    blocks,
    bounds,
    dimension: meta.dimension,
    id: meta.id,
    kind: meta.kind,
    markers,
    origin: Object.freeze(meta.origin),
    region: Object.freeze(meta.region),
  })
}

export const finishPlanFromValidatedPlacements = (
  meta: NaturalStructureDraftMeta,
  placements: ReadonlyArray<NaturalStructureBlockPlacement>,
  markers: ReadonlyArray<NaturalStructureMarker>,
): NaturalStructurePlan => {
  const blocks = Object.freeze([...placements])
  const frozenMarkers = Object.freeze([...markers])
  const bounds = boundsFor(blocks, frozenMarkers)
  return Object.freeze({
    blocks,
    bounds,
    dimension: meta.dimension,
    id: meta.id,
    kind: meta.kind,
    markers: frozenMarkers,
    origin: Object.freeze(meta.origin),
    region: Object.freeze(meta.region),
  })
}
