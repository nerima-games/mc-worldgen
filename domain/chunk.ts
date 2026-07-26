/**
 * The chunk value.
 *
 * PRE-AUDIT FIRST CUT (叩き台).
 *
 * plan.md §3.1 puts the `Chunk` data structure in mc-kernel, and this module
 * will be deleted in favour of that once kernel is publishable (plan.md §6
 * Step 0 defers publishing until the interfaces settle). It is here so
 * mc-worldgen can be built and tested today; the shape deliberately matches
 * what kernel is expected to define, so the swap is an import change.
 */
import { BLOCK, type BiomeType, type BlockId } from './biome'
import { blockIndex, CHUNK_SIZE_XZ, CHUNK_VOLUME } from './constants'

export type ChunkCoord = {
  readonly x: number
  readonly z: number
}

export const chunkCoord = (x: number, z: number): ChunkCoord => ({ x, z })

export type Chunk = {
  readonly coord: ChunkCoord
  /** Flat `Uint8Array` of `CHUNK_VOLUME` block ids. See `blockIndex`. */
  readonly blocks: Uint8Array
  /** One biome per column, indexed `lz * CHUNK_SIZE_XZ + lx`. */
  readonly biomes: ReadonlyArray<BiomeType>
}

export const emptyBlocks = (): Uint8Array => new Uint8Array(CHUNK_VOLUME)

/**
 * Read a block, treating out-of-range as air.
 *
 * `noUncheckedIndexedAccess` makes every `blocks[i]` a `number | undefined`,
 * and this is the single place that fact is handled. The reference solved the
 * same problem with `chunkBlockIndexUnchecked`
 * (`packages/world/domain/terrain/ravine-carver.ts:46` among others); the
 * difference is that this version is total rather than merely unchecked.
 */
export const readBlock = (blocks: Uint8Array, index: number): number => blocks[index] ?? BLOCK.AIR

export const getBlockAt = (chunk: Chunk, lx: number, y: number, lz: number): number =>
  readBlock(chunk.blocks, blockIndex(lx, y, lz))

export const setBlockAt = (blocks: Uint8Array, lx: number, y: number, lz: number, block: BlockId): void => {
  blocks[blockIndex(lx, y, lz)] = block
}

export const columnIndex = (lx: number, lz: number): number => lz * CHUNK_SIZE_XZ + lx

export const biomeAt = (chunk: Chunk, lx: number, lz: number): BiomeType =>
  chunk.biomes[columnIndex(lx, lz)] ?? 'PLAINS'

/** World-space coordinates of a chunk-local column. */
export const worldX = (coord: ChunkCoord, lx: number): number => coord.x * CHUNK_SIZE_XZ + lx
export const worldZ = (coord: ChunkCoord, lz: number): number => coord.z * CHUNK_SIZE_XZ + lz
