import { channelSeed, fbm2D } from './noise-compatibility.js'
import type { BlockAxis } from '@nerima-games/mc-kernel/domain/coordinates'
import type { NoiseSeed } from '@nerima-games/mc-noise'
import { blockAxis } from './coordinate-compatibility.js'

/** Lowest and highest surface the local terrain shaper produces. */
export const MIN_SURFACE_Y = 38
export const MAX_SURFACE_Y = 92

/**
 * Contrast applied to raw continentalness before it becomes a height.
 *
 * The value was measured with the terrain survey rather than inferred from a
 * short sample. The field already spans almost the whole unit interval, so a
 * small stretch reaches both declared bounds without turning the world into
 * broad clamped plateaus.
 */
export const CONTINENTALNESS_CONTRAST = 1.15

const UNIT_INTERVAL_MIN = 0
const UNIT_INTERVAL_MAX = 1
const UNIT_INTERVAL_MIDPOINT = 0.5
const NOISE_FREQUENCY_UNIT = 1
const CONTINENTALNESS_WAVELENGTH_BLOCKS = 180
const SURFACE_HEIGHT_INCLUSIVE_END = 1
const SURFACE_HEIGHT_COUNT = MAX_SURFACE_Y - MIN_SURFACE_Y + SURFACE_HEIGHT_INCLUSIVE_END
const VALID_SURFACE_HEIGHTS = Array.from({ length: SURFACE_HEIGHT_COUNT }, (_unused, surfaceHeightOffset) =>
  blockAxis(MIN_SURFACE_Y + surfaceHeightOffset),
)

const stretch = (value: number): number =>
  Math.min(
    UNIT_INTERVAL_MAX,
    Math.max(UNIT_INTERVAL_MIN, (value - UNIT_INTERVAL_MIDPOINT) * CONTINENTALNESS_CONTRAST + UNIT_INTERVAL_MIDPOINT),
  )

/** Sample the position-absolute continentalness field used by terrain generation. */
export const continentalnessAt = (seed: NoiseSeed, wx: number, wz: number): number =>
  fbm2D(channelSeed(seed, 'continentalness'), wx, wz, {
    frequency: NOISE_FREQUENCY_UNIT / CONTINENTALNESS_WAVELENGTH_BLOCKS,
    octaves: 4,
    persistence: 0.5,
  })

/** Convert one sampled continentalness value into the generated surface Y. */
export const surfaceHeightFromContinentalness = (continentalness: number): BlockAxis => {
  const height = Math.floor(MIN_SURFACE_Y + (MAX_SURFACE_Y - MIN_SURFACE_Y) * stretch(continentalness))
  if (Number.isNaN(height)) {
    return blockAxis(height)
  }
  return VALID_SURFACE_HEIGHTS[height - MIN_SURFACE_Y] ?? blockAxis(height)
}

/**
 * Cheap column query used by callers that need terrain height without a chunk.
 * It is the same two pure operations used by the column generation pass.
 */
export const surfaceHeightAt = (seed: NoiseSeed, wx: BlockAxis, wz: BlockAxis): BlockAxis =>
  surfaceHeightFromContinentalness(continentalnessAt(seed, wx, wz))
