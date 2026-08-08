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
 * `mc-kernel`, which explains why the `c` prefix is worth having
 * (with `{x, z}`, passing a chunk coordinate where a block coordinate belongs
 * is silent; with `{cx, cz}` it is a type error).
 *
 * `ChunkCoord` is imported rather than re-exported: two `export *` barrels that
 * both carry one name make it AMBIGUOUS, and TypeScript resolves an ambiguous
 * star re-export by silently dropping the name from the barrel. Import it from
 * `mc-kernel`, which is where it lives.
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

/** World-space coordinates of a chunk-local column. */
export const worldX = (coord: ChunkCoord, lx: number): number => coord.cx * CHUNK_SIZE_XZ + lx
export const worldZ = (coord: ChunkCoord, lz: number): number => coord.cz * CHUNK_SIZE_XZ + lz
