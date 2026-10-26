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

const taggedError = Data.TaggedError

export const InvalidNaturalStructureCoordinate: new (
  args: InvalidNaturalStructureCoordinateFields,
) => Error & { readonly _tag: 'InvalidNaturalStructureCoordinate' } & Readonly<InvalidNaturalStructureCoordinateFields> =
  taggedError('InvalidNaturalStructureCoordinate')<InvalidNaturalStructureCoordinateFields>

export type InvalidNaturalStructureCoordinate = InstanceType<typeof InvalidNaturalStructureCoordinate>

const CANDIDATE_MARGIN_DIVISOR = 2
const LAST_CANDIDATE_OFFSET = 1

const validateFootprintCoordinates = (
  kind: NaturalStructureKind,
  region: NaturalStructureRegion,
  coordinateBounds: ReadonlyArray<readonly [InvalidNaturalStructureCoordinateFields['axis'], number]>,
): Result.Result<void, InvalidNaturalStructureCoordinate> => {
  for (const [axis, value] of coordinateBounds) {
    if (!Number.isSafeInteger(value)) {
      return Result.fail(new InvalidNaturalStructureCoordinate({ axis, kind, region, value }))
    }
  }
  return Result.void
}

export const validateNaturalStructureRegionCoordinates = (
  kind: NaturalStructureKind,
  region: NaturalStructureRegion,
  grid: Pick<NaturalStructureGrid, 'separation' | 'spacing'>,
  maxHorizontalExtent: number,
): Result.Result<void, InvalidNaturalStructureCoordinate> => {
  if (!Number.isSafeInteger(region.x)) {
    return Result.fail(new InvalidNaturalStructureCoordinate({ axis: 'region-x', kind, region, value: region.x }))
  }
  if (!Number.isSafeInteger(region.z)) {
    return Result.fail(new InvalidNaturalStructureCoordinate({ axis: 'region-z', kind, region, value: region.z }))
  }

  const margin = grid.separation / CANDIDATE_MARGIN_DIVISOR
  const maxCandidateOffset = grid.spacing - margin - LAST_CANDIDATE_OFFSET
  const coordinateBounds = [
    ['footprint-x', region.x * grid.spacing + margin - maxHorizontalExtent],
    ['footprint-x', region.x * grid.spacing + maxCandidateOffset + maxHorizontalExtent],
    ['footprint-z', region.z * grid.spacing + margin - maxHorizontalExtent],
    ['footprint-z', region.z * grid.spacing + maxCandidateOffset + maxHorizontalExtent],
  ] as const
  return validateFootprintCoordinates(kind, region, coordinateBounds)
}
