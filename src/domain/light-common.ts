const AXIS_POSITIVE = 1
const AXIS_NEGATIVE = -1
const AXIS_NONE = 0

export const STEP = AXIS_POSITIVE
export const MIN_CHUNK_COORD = AXIS_NONE
export const LIGHT_DECAY_PER_HOP = STEP

export const axisCrossing = (coord: number, size: number): number => {
  if (coord < MIN_CHUNK_COORD) {
    return AXIS_NEGATIVE
  }
  if (coord >= size) {
    return AXIS_POSITIVE
  }
  return AXIS_NONE
}

export const NEIGHBOUR_OFFSETS: ReadonlyArray<readonly [number, number, number]> = [
  [AXIS_POSITIVE, AXIS_NONE, AXIS_NONE],
  [AXIS_NEGATIVE, AXIS_NONE, AXIS_NONE],
  [AXIS_NONE, AXIS_POSITIVE, AXIS_NONE],
  [AXIS_NONE, AXIS_NEGATIVE, AXIS_NONE],
  [AXIS_NONE, AXIS_NONE, AXIS_POSITIVE],
  [AXIS_NONE, AXIS_NONE, AXIS_NEGATIVE],
]

export const coordKey = (cx: number, cz: number): string => `${String(cx)},${String(cz)}`
