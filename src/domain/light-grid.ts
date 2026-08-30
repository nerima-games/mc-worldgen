import { CHUNK_VOLUME } from './constants.js'
import { clampLightLevel } from '@nerima-games/mc-kernel'

/** Two voxels share one packed light byte, low nibble first. */
const VOXELS_PER_BYTE = 2
const BYTE_TO_VOXEL_SHIFT = 1
const PARITY_MASK = 1
const EVEN_VOXEL_REMAINDER = 0
const NIBBLE_MASK = 0x0f
const HIGH_NIBBLE_MASK = 0xf0
const NIBBLE_BITS = 4
const EMPTY_BYTE = 0

export const LIGHT_BYTE_LENGTH: number = CHUNK_VOLUME / VOXELS_PER_BYTE

/** Read one voxel's packed light nibble. Out-of-range reads are dark. */
export const getLightAt = (grid: Uint8Array, voxel: number): number => {
  const byte = grid[voxel >> BYTE_TO_VOXEL_SHIFT] ?? EMPTY_BYTE
  if ((voxel & PARITY_MASK) === EVEN_VOXEL_REMAINDER) {
    return byte & NIBBLE_MASK
  }
  return (byte >> NIBBLE_BITS) & NIBBLE_MASK
}

/** Write one voxel's packed light nibble, clamped to the kernel's range. */
export const setLightAt = (grid: Uint8Array, voxel: number, level: number): void => {
  const index = voxel >> BYTE_TO_VOXEL_SHIFT
  const clamped = clampLightLevel(level)
  const byte = grid[index] ?? EMPTY_BYTE

  if ((voxel & PARITY_MASK) === EVEN_VOXEL_REMAINDER) {
    grid[index] = (byte & HIGH_NIBBLE_MASK) | clamped
  } else {
    grid[index] = (byte & NIBBLE_MASK) | (clamped << NIBBLE_BITS)
  }
}

export type ChunkLight = {
  readonly sky: Uint8Array
  readonly block: Uint8Array
}

export const emptyChunkLight = (): ChunkLight => ({
  block: new Uint8Array(LIGHT_BYTE_LENGTH),
  sky: new Uint8Array(LIGHT_BYTE_LENGTH),
})

/** Pack a local coordinate and light level into one queue entry. */
const QUEUE_Z_SHIFT = 9
const QUEUE_X_SHIFT = 13
const QUEUE_LEVEL_SHIFT = 17
const QUEUE_Y_MASK = 0x1ff
const QUEUE_XZ_MASK = 0x0f
const QUEUE_LEVEL_MASK = 0x1f

export const packPosLevel = (x: number, y: number, z: number, level: number): number =>
  (x << QUEUE_X_SHIFT) | (z << QUEUE_Z_SHIFT) | y | (level << QUEUE_LEVEL_SHIFT)

export const unpackY = (packed: number): number => packed & QUEUE_Y_MASK
export const unpackZ = (packed: number): number => (packed >> QUEUE_Z_SHIFT) & QUEUE_XZ_MASK
export const unpackX = (packed: number): number => (packed >> QUEUE_X_SHIFT) & QUEUE_XZ_MASK
export const unpackLevel = (packed: number): number => (packed >> QUEUE_LEVEL_SHIFT) & QUEUE_LEVEL_MASK
