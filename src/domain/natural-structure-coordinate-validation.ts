import { Data, Result } from 'effect'
import type { NaturalStructureGrid, NaturalStructureKind, NaturalStructureRegion } from './natural-structure-types.js'

/**
 * The widest current horizontal structure footprint around its candidate.
 * Village terrain probing reaches 30 blocks, and End-ship/fortress markers
 * remain inside that envelope; the extra margin keeps this planner guard
 * conservative when a plan is sliced into chunks.
 */
export const MAX_NATURAL_STRUCTURE_HORIZONTAL_EXTENT = 64

type InvalidNaturalStructureCoordinateFields = {
  readonly axis: 'region-x' | 'region-z' | 'footprint-x' | 'footprint-y' | 'footprint-z'
  readonly kind: NaturalStructureKind
  readonly region: NaturalStructureRegion
  readonly value: number
}

export type NaturalStructureRegionSpan = {
  readonly maxRegionX: number
  readonly maxRegionZ: number
  readonly minRegionX: number
  readonly minRegionZ: number
}

const taggedError = Data.TaggedError

export const InvalidNaturalStructureCoordinate: new (
  args: InvalidNaturalStructureCoordinateFields,
) => Error & { readonly _tag: 'InvalidNaturalStructureCoordinate' } & Readonly<InvalidNaturalStructureCoordinateFields> =
  taggedError('InvalidNaturalStructureCoordinate')<InvalidNaturalStructureCoordinateFields>

export type InvalidNaturalStructureCoordinate = InstanceType<typeof InvalidNaturalStructureCoordinate>

const invalidSpanCoordinate = (
  axis: InvalidNaturalStructureCoordinateFields['axis'],
  kind: NaturalStructureKind,
  regionX: number,
  regionZ: number,
  value: number,
): InvalidNaturalStructureCoordinate => new InvalidNaturalStructureCoordinate({
  axis,
  kind,
  region: { x: regionX, z: regionZ },
  value,
})

const CANDIDATE_MARGIN_DIVISOR = 2
const LAST_CANDIDATE_OFFSET = 1

const invalidCoordinate = (
  axis: InvalidNaturalStructureCoordinateFields['axis'],
  kind: NaturalStructureKind,
  region: NaturalStructureRegion,
  value: number,
): InvalidNaturalStructureCoordinate | null => {
  if (Number.isSafeInteger(value)) {return null}
  return new InvalidNaturalStructureCoordinate({ axis, kind, region, value })
}

const invalidRegionFootprintCoordinate = (
  kind: NaturalStructureKind,
  region: NaturalStructureRegion,
  grid: Pick<NaturalStructureGrid, 'separation' | 'spacing'>,
  maxHorizontalExtent: number,
): InvalidNaturalStructureCoordinate | null => {
  const margin = grid.separation / CANDIDATE_MARGIN_DIVISOR
  const maxCandidateOffset = grid.spacing - margin - LAST_CANDIDATE_OFFSET
  const minFootprintX = region.x * grid.spacing + margin - maxHorizontalExtent
  const maxFootprintX = region.x * grid.spacing + maxCandidateOffset + maxHorizontalExtent
  const minFootprintZ = region.z * grid.spacing + margin - maxHorizontalExtent
  const maxFootprintZ = region.z * grid.spacing + maxCandidateOffset + maxHorizontalExtent
  return invalidCoordinate('footprint-x', kind, region, minFootprintX) ??
    invalidCoordinate('footprint-x', kind, region, maxFootprintX) ??
    invalidCoordinate('footprint-z', kind, region, minFootprintZ) ??
    invalidCoordinate('footprint-z', kind, region, maxFootprintZ)
}

/** Checks the extrema because footprint bounds move monotonically with region indices. */
const invalidRegionSpanIndices = (
  kind: NaturalStructureKind,
  span: NaturalStructureRegionSpan,
): InvalidNaturalStructureCoordinate | null => {
  const { maxRegionX, maxRegionZ, minRegionX, minRegionZ } = span
  if (!Number.isSafeInteger(minRegionX)) {
    return invalidSpanCoordinate('region-x', kind, minRegionX, minRegionZ, minRegionX)
  }
  if (!Number.isSafeInteger(maxRegionX)) {
    return invalidSpanCoordinate('region-x', kind, maxRegionX, minRegionZ, maxRegionX)
  }
  if (!Number.isSafeInteger(minRegionZ)) {
    return invalidSpanCoordinate('region-z', kind, minRegionX, minRegionZ, minRegionZ)
  }
  if (!Number.isSafeInteger(maxRegionZ)) {
    return invalidSpanCoordinate('region-z', kind, minRegionX, maxRegionZ, maxRegionZ)
  }
  return null
}

const invalidRegionFootprintXSpan = (
  kind: NaturalStructureKind,
  span: NaturalStructureRegionSpan,
  grid: Pick<NaturalStructureGrid, 'separation' | 'spacing'>,
  maxHorizontalExtent: number,
): InvalidNaturalStructureCoordinate | null => {
  const margin = grid.separation / CANDIDATE_MARGIN_DIVISOR
  const maxCandidateOffset = grid.spacing - margin - LAST_CANDIDATE_OFFSET
  const minFootprint = span.minRegionX * grid.spacing + margin - maxHorizontalExtent
  const maxFootprint = span.maxRegionX * grid.spacing + maxCandidateOffset + maxHorizontalExtent
  if (!Number.isSafeInteger(minFootprint)) {
    return invalidSpanCoordinate('footprint-x', kind, span.minRegionX, span.minRegionZ, minFootprint)
  }
  if (!Number.isSafeInteger(maxFootprint)) {
    return invalidSpanCoordinate('footprint-x', kind, span.maxRegionX, span.minRegionZ, maxFootprint)
  }
  return null
}

const invalidRegionFootprintZSpan = (
  kind: NaturalStructureKind,
  span: NaturalStructureRegionSpan,
  grid: Pick<NaturalStructureGrid, 'separation' | 'spacing'>,
  maxHorizontalExtent: number,
): InvalidNaturalStructureCoordinate | null => {
  const margin = grid.separation / CANDIDATE_MARGIN_DIVISOR
  const maxCandidateOffset = grid.spacing - margin - LAST_CANDIDATE_OFFSET
  const minFootprint = span.minRegionZ * grid.spacing + margin - maxHorizontalExtent
  const maxFootprint = span.maxRegionZ * grid.spacing + maxCandidateOffset + maxHorizontalExtent
  if (!Number.isSafeInteger(minFootprint)) {
    return invalidSpanCoordinate('footprint-z', kind, span.minRegionX, span.minRegionZ, minFootprint)
  }
  if (!Number.isSafeInteger(maxFootprint)) {
    return invalidSpanCoordinate('footprint-z', kind, span.minRegionX, span.maxRegionZ, maxFootprint)
  }
  return null
}

export const invalidNaturalStructureRegionSpan = (
  kind: NaturalStructureKind,
  span: NaturalStructureRegionSpan,
  grid: Pick<NaturalStructureGrid, 'separation' | 'spacing'>,
  maxHorizontalExtent: number,
): InvalidNaturalStructureCoordinate | null => {
  const invalidIndex = invalidRegionSpanIndices(kind, span)
  if (invalidIndex) {return invalidIndex}
  const invalidX = invalidRegionFootprintXSpan(kind, span, grid, maxHorizontalExtent)
  if (invalidX) {return invalidX}
  return invalidRegionFootprintZSpan(kind, span, grid, maxHorizontalExtent)
}

export const validateNaturalStructureRegionCoordinates = (
  kind: NaturalStructureKind,
  region: NaturalStructureRegion,
  grid: Pick<NaturalStructureGrid, 'separation' | 'spacing'>,
  maxHorizontalExtent: number,
): Result.Result<void, InvalidNaturalStructureCoordinate> => {
  const invalidRegion = invalidCoordinate('region-x', kind, region, region.x) ??
    invalidCoordinate('region-z', kind, region, region.z)
  if (invalidRegion) {return Result.fail(invalidRegion)}
  const invalidFootprint = invalidRegionFootprintCoordinate(kind, region, grid, maxHorizontalExtent)
  if (invalidFootprint) {return Result.fail(invalidFootprint)}
  return Result.void
}
