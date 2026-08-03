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
 *
 * ---------------------------------------------------------------------------
 * `ChunkCoord` used to be declared here, as `{x, z}`. It is now kernel's.
 * ---------------------------------------------------------------------------
 *
 * Two spellings of one coordinate existed across the roster — kernel's
 * `{cx, cz}` and this repository's `{x, z}` — and this module's header already
 * conceded that kernel would own the type. It now does: `ChunkCoord` comes from
 * `./kernel-vocabulary`, which explains why the `c` prefix is worth having
 * (with `{x, z}`, passing a chunk coordinate where a block coordinate belongs
 * is silent; with `{cx, cz}` it is a type error).
 *
 * `ChunkCoord` is imported rather than re-exported: two `export *` barrels that
 * both carry one name make it AMBIGUOUS, and TypeScript resolves an ambiguous
 * star re-export by silently dropping the name from the barrel. Import it from
 * `./kernel-vocabulary`, which is where it lives.
 */
import { type ChunkBiomeType } from './biome'
import { blockIndex, CHUNK_SIZE_XZ, CHUNK_VOLUME } from './constants'
import { AIR_BLOCK_ID, type BlockId, type ChunkCoord } from './kernel-vocabulary'

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

export const setBlockAt = (blocks: Uint8Array, lx: number, y: number, lz: number, block: BlockId): void => {
  blocks[blockIndex(lx, y, lz)] = block
}

export const columnIndex = (lx: number, lz: number): number => lz * CHUNK_SIZE_XZ + lx

export const biomeAt = (chunk: Chunk, lx: number, lz: number): ChunkBiomeType =>
  chunk.biomes[columnIndex(lx, lz)] ?? 'PLAINS'

/** World-space coordinates of a chunk-local column. */
export const worldX = (coord: ChunkCoord, lx: number): number => coord.cx * CHUNK_SIZE_XZ + lx
export const worldZ = (coord: ChunkCoord, lz: number): number => coord.cz * CHUNK_SIZE_XZ + lz
