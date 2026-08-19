import { CHUNK_SIZE_XZ, type ChunkCoord } from '@nerima-games/mc-kernel'

/** Convert a chunk-local horizontal coordinate into an absolute block coordinate. */
export const worldX = (coord: ChunkCoord, lx: number): number => coord.cx * CHUNK_SIZE_XZ + lx

/** Convert a chunk-local horizontal coordinate into an absolute block coordinate. */
export const worldZ = (coord: ChunkCoord, lz: number): number => coord.cz * CHUNK_SIZE_XZ + lz
