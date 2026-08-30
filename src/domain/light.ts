/**
 * Public light-grid API.
 *
 * Storage, full propagation, and incremental updates live in focused modules;
 * this façade keeps the existing import path stable for the chunk store and
 * consumers while making each algorithm independently reviewable.
 */
export {
  emptyChunkLight,
  getLightAt,
  LIGHT_BYTE_LENGTH,
  packPosLevel,
  setLightAt,
  unpackLevel,
  unpackX,
  unpackY,
  unpackZ,
} from './light-grid.js'
export type { ChunkLight } from './light-grid.js'

export { computeChunkLight, computeChunkLights } from './light-propagation.js'

export { updateChunkLights } from './light-update.js'
export type { ChunkLightChange } from './light-update.js'
