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
import { AIR_BLOCK_ID, BlockId, type ChunkCoord } from '@nerima-games/mc-kernel'
import type { BlockAxis, LocalAxis } from '@nerima-games/mc-kernel/domain/coordinates'
import {
  type BlockStateCodecFailure,
  defaultBlockState,
  encodeBlockState,
} from '@nerima-games/mc-kernel/domain/block-state'
import { CHUNK_SIZE_XZ, CHUNK_VOLUME, blockIndex } from './constants.js'
import { Option, Result } from 'effect'
import { type ChunkBiomeType } from './biome.js'

export type Chunk = {
  readonly coord: ChunkCoord
  /**
   * Flat `Uint16Array` of `CHUNK_VOLUME` block ids. See `blockIndex`.
   *
   * Widened from `Uint8Array` (255 ceiling) so this buffer can represent
   * every id `@nerima-games/mc-kernel` can hand out — kernel's own block
   * storage (`BlockState`) is two bytes per element and its `BlockId` brand
   * accepts up to `BLOCK_ID_MAX` (`0xffff` = 65535). A `Uint16Array` element
   * assignment still wraps modulo 65536 rather than rejecting an
   * out-of-range write, exactly as the retired `Uint8Array` wrapped modulo
   * 256 — the ceiling moved, the lack of a runtime guard on plain element
   * writes did not.
   */
  readonly blocks: Uint16Array
  /**
   * One kernel block-state code per block, indexed with `blockIndex`.
   * Omitted on newly generated terrain until defaults are materialized.
   */
  readonly blockStates?: Uint32Array | undefined
  /** One biome per column, indexed `lz * CHUNK_SIZE_XZ + lx`. */
  readonly biomes: ReadonlyArray<ChunkBiomeType>
}

/** A chunk whose optional generated-terrain states have been materialized. */
export type ChunkWithBlockStates = Chunk & { readonly blockStates: Uint32Array }

export const emptyBlocks = (): Uint16Array => new Uint16Array(CHUNK_VOLUME)
export const emptyBlockStates = (): Uint32Array => new Uint32Array(CHUNK_VOLUME)

const BLOCK_INDEX_START = 0
const BLOCK_INDEX_STEP = 1

/**
 * Read a block, treating out-of-range as air.
 *
 * `noUncheckedIndexedAccess` makes every `blocks[i]` a `number | undefined`,
 * and this is the single place that fact is handled. The reference solved the
 * same problem with `chunkBlockIndexUnchecked`
 * (`packages/world/domain/terrain/ravine-carver.ts:46` among others); the
 * difference is that this version is total rather than merely unchecked.
 */
export const readBlock = (blocks: ArrayLike<number>, index: number): number => blocks[index] ?? AIR_BLOCK_ID

/**
 * Build the encoded default state for each block id in a chunk buffer. The map
 * avoids repeating kernel codec work for the same block id.
 */
const encodedDefaultStateFor = (blockIdValue: number): Result.Result<number, BlockStateCodecFailure> => {
  // Uint16Array constrains every value to BlockId's representable range.
  const blockId = BlockId(blockIdValue)
  const defaultState = defaultBlockState(blockId)
  if (Result.isFailure(defaultState)) {
    return Result.fail(defaultState.failure)
  }
  return encodeBlockState(blockId, defaultState.success)
}

const encodedDefaultStateFromCache = (
  encodedDefaults: ReadonlyMap<number, number>,
  blockIdValue: number,
): Option.Option<number> => Option.fromNullishOr(encodedDefaults.get(blockIdValue))

const blockStateCodeFor = (
  encodedDefaults: Map<number, number>,
  blockIdValue: number,
): Result.Result<number, BlockStateCodecFailure> => {
  const cached = encodedDefaultStateFromCache(encodedDefaults, blockIdValue)
  if (Option.isSome(cached)) {
    return Result.succeed(cached.value)
  }
  const encoded = encodedDefaultStateFor(blockIdValue)
  if (Result.isFailure(encoded)) {
    return encoded
  }
  encodedDefaults.set(blockIdValue, encoded.success)
  return encoded
}

const fillDefaultStateRun = (
  encodedDefaults: Map<number, number>,
  blockStates: Uint32Array,
  blockIdValue: number,
  runStart: number,
  runEnd: number,
): Result.Result<Uint32Array, BlockStateCodecFailure> =>
  Result.map(blockStateCodeFor(encodedDefaults, blockIdValue), (encoded) => {
    blockStates.fill(encoded, runStart, runEnd)
    return blockStates
  })

const blockIdRunEnd = (blocks: Uint16Array, runStart: number, blockIdValue: number): number => {
  let runEnd = runStart + BLOCK_INDEX_STEP
  while (runEnd < blocks.length && readBlock(blocks, runEnd) === blockIdValue) {
    runEnd += BLOCK_INDEX_STEP
  }
  return runEnd
}

/**
 * Fill adjacent block-id runs so one cached lookup writes several state entries.
 */
const fillDefaultBlockStateRuns = (
  blocks: Uint16Array,
  blockStates: Uint32Array,
  encodedDefaults: Map<number, number>,
): Result.Result<Uint32Array, BlockStateCodecFailure> => {
  let runStart = BLOCK_INDEX_START
  while (runStart < blocks.length) {
    const blockIdValue = readBlock(blocks, runStart)
    const runEnd = blockIdRunEnd(blocks, runStart, blockIdValue)
    const filled = fillDefaultStateRun(encodedDefaults, blockStates, blockIdValue, runStart, runEnd)
    if (Result.isFailure(filled)) {
      return filled
    }
    runStart = runEnd
  }
  return Result.succeed(blockStates)
}

export const defaultBlockStatesFor = (
  blocks: Uint16Array,
): Result.Result<Uint32Array, BlockStateCodecFailure> =>
  fillDefaultBlockStateRuns(
    blocks,
    new Uint32Array(blocks.length),
    new Map<number, number>(),
  )

/** Materialize omitted generated-terrain states using each block's kernel default. */
const hasBlockStates = <ChunkValue extends Chunk>(
  chunk: ChunkValue,
): chunk is ChunkValue & { readonly blockStates: Uint32Array } => chunk.blockStates instanceof Uint32Array

export const withDefaultBlockStates = <ChunkValue extends Chunk>(
  chunk: ChunkValue,
): Result.Result<ChunkValue & { readonly blockStates: Uint32Array }, BlockStateCodecFailure> => {
  if (hasBlockStates(chunk)) {
    return Result.succeed(chunk)
  }
  if (chunk.blockStates === null || Option.isSome(Option.fromNullishOr(chunk.blockStates))) {
    return Result.fail({ _tag: 'BlockStateCodecFailure', reason: 'invalid-encoded-value' })
  }
  return Result.map(defaultBlockStatesFor(chunk.blocks), (blockStates) => ({ ...chunk, blockStates }))
}

export const getBlockAt = (chunk: ReadonlyChunk, lx: LocalAxis, y: BlockAxis, lz: LocalAxis): number =>
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
export const setBlockAt = (blocks: Uint16Array, ...coordinate: readonly [lx: LocalAxis, y: BlockAxis, lz: LocalAxis, block: BlockId]): void => {
  const [lx, y, lz, block] = coordinate
  blocks[blockIndex(lx, y, lz)] = block
}

export const columnIndex = (lx: LocalAxis, lz: LocalAxis): number => lz * CHUNK_SIZE_XZ + lx

/** The caller has already bounded both offsets to the local chunk range. */
export const columnIndexForKnownLocalRange = (lx: number, lz: number): number => lz * CHUNK_SIZE_XZ + lx

/** A typed-array view without writes, callback aliases, or backing-buffer access. */
export type ReadonlyUint16Array = Readonly<
  Omit<
    Uint16Array,
    | 'buffer'
    | 'copyWithin'
    | 'every'
    | 'fill'
    | 'filter'
    | 'find'
    | 'findIndex'
    | 'findLast'
    | 'findLastIndex'
    | 'forEach'
    | 'map'
    | 'reduce'
    | 'reduceRight'
    | 'reverse'
    | 'set'
    | 'some'
    | 'sort'
    | 'subarray'
    | 'valueOf'
  >
>

export type ReadonlyUint32Array = Readonly<
  Omit<
    Uint32Array,
    | 'buffer'
    | 'copyWithin'
    | 'every'
    | 'fill'
    | 'filter'
    | 'find'
    | 'findIndex'
    | 'findLast'
    | 'findLastIndex'
    | 'forEach'
    | 'map'
    | 'reduce'
    | 'reduceRight'
    | 'reverse'
    | 'set'
    | 'some'
    | 'sort'
    | 'subarray'
    | 'valueOf'
  >
>

export type ReadonlyChunk = Readonly<Omit<Chunk, 'blocks' | 'blockStates'> & {
  blocks: ReadonlyUint16Array
  blockStates?: ReadonlyUint32Array | undefined
}>

export type ReadonlyChunkWithBlockStates = Readonly<Omit<ChunkWithBlockStates, 'blocks' | 'blockStates'> & {
  blocks: ReadonlyUint16Array
  blockStates: ReadonlyUint32Array
}>

export const biomeAt = (chunk: ReadonlyChunk, lx: LocalAxis, lz: LocalAxis): ChunkBiomeType =>
  chunk.biomes[columnIndex(lx, lz)] ?? 'PLAINS'
