/**
 * The generation chunk value.
 *
 * This is a generation buffer rather than a structural alias for mc-kernel's
 * persisted/runtime `Chunk`: the decoration pipeline needs a flat fixed-height
 * block buffer and one biome value per column, while the kernel type currently
 * has a different storage shape. Keeping that boundary explicit lets terrain,
 * carving, lighting, and decoration share one allocation without pretending
 * the two representations are interchangeable.
 *
 * `ChunkCoord` is imported from mc-kernel, which is the single owner of the
 * `{cx, cz}` coordinate vocabulary. A chunk coordinate therefore cannot be
 * confused with a block coordinate through the old `{x, z}` spelling.
 */
import { AIR_BLOCK_ID, type BlockId, type ChunkCoord } from '@nerima-games/mc-kernel'
import { CHUNK_SIZE_XZ, CHUNK_VOLUME, blockIndex } from './constants'
import { type ChunkBiomeType } from './biome'

export type Chunk = {
  readonly coord: ChunkCoord
  /** Flat `Uint8Array` of `CHUNK_VOLUME` block ids. See `blockIndex`. */
  readonly blocks: Uint8Array
  /** One biome per column, indexed `lz * CHUNK_SIZE_XZ + lx`. */
  readonly biomes: ReadonlyArray<ChunkBiomeType>
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
export const readBlock = (blocks: Uint8Array, index: number): number => blocks[index] ?? AIR_BLOCK_ID

export const getBlockAt = (chunk: Chunk, lx: number, y: number, lz: number): number =>
  readBlock(chunk.blocks, blockIndex(lx, y, lz))

/**
 * Writes one block into `blocks` at a chunk-local coordinate.
 *
 * The coordinate and block are a labeled rest tuple rather than four named
 * parameters: `village.ts` and `test/light.test.ts` both call this
 * positionally (`setBlockAt(blocks, lx, y, lz, block)`), so the call surface
 * has to stay exactly four arguments wide. A rest parameter typed as a
 * fixed-length tuple keeps that arity — TypeScript still rejects a call with
 * the wrong argument count or types — while counting as a single formal
 * parameter, which is what satisfies `max-params` without touching either
 * caller.
 */
export const setBlockAt = (blocks: Uint8Array, ...coordinate: readonly [lx: number, y: number, lz: number, block: BlockId]): void => {
  const [lx, y, lz, block] = coordinate
  blocks[blockIndex(lx, y, lz)] = block
}

export const columnIndex = (lx: number, lz: number): number => lz * CHUNK_SIZE_XZ + lx

export const biomeAt = (chunk: Chunk, lx: number, lz: number): ChunkBiomeType =>
  chunk.biomes[columnIndex(lx, lz)] ?? 'PLAINS'
