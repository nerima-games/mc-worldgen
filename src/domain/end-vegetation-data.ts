/* oxlint-disable no-magic-numbers */

import { blockIdOf } from '@nerima-games/mc-kernel'

/** Block roster used by the deterministic End vegetation pass. */
export const END_VEGETATION_BLOCK = Object.freeze({
  CHORUS_FLOWER: blockIdOf('chorus_flower'),
  CHORUS_PLANT: blockIdOf('chorus_plant'),
  END_STONE: blockIdOf('end_stone'),
})

/** Candidate columns are kept away from chunk edges so a branch stays local. */
export const END_CHORUS_CANDIDATE_OFFSETS: ReadonlyArray<number> = Object.freeze([3, 7, 11])

export const END_CHORUS_PLACEMENT_CHANCE = 0.2
export const END_CHORUS_MIN_HEIGHT = 2
export const END_CHORUS_HEIGHT_VARIATION = 4
export const END_CHORUS_BRANCH_CHANCE = 0.4

export const END_CHORUS_BRANCH_DIRECTIONS: ReadonlyArray<readonly [number, number]> = Object.freeze([
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
])
