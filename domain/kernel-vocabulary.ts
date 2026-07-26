/**
 * PROVISIONAL LOCAL MIRROR OF `@nerima-games/mc-kernel`.
 *
 * ---------------------------------------------------------------------------
 * This module is scheduled for deletion. Do not build on it.
 * ---------------------------------------------------------------------------
 *
 * Same mechanism, same reason and same deletion plan as
 * `mc-sim/domain/kernel-vocabulary.ts`: plan.md §6 Step 3 publishes bottom-up,
 * nothing is published yet, and `pnpm check:deps` would reject an import of a
 * package absent from `package.json#dependencies`. Rather than invent a second
 * vocabulary that would have to be reconciled later, the declarations
 * mc-worldgen actually uses are mirrored verbatim in shape and semantics from
 * `mc-kernel/domain/{coordinates,block-registry}.ts`.
 *
 * WHEN mc-kernel IS PUBLISHED:
 *   1. add `@nerima-games/mc-kernel` to `package.json#dependencies`;
 *   2. delete this file;
 *   3. repoint every `from './kernel-vocabulary'` at `'@nerima-games/mc-kernel'`.
 * If step 3 does not typecheck, this file has drifted and the drift is the bug.
 * `test/kernel-mirror.test.ts` restates kernel's shapes and pins them, so a
 * divergence fails CI rather than a frame.
 *
 * The mirror is deliberately MINIMAL — only what this repository's SHIPPED code
 * needs, which is the coordinate vocabulary and the block-id type. In
 * particular it does NOT mirror kernel's block table or its capability lookups:
 * mc-worldgen never asks what a block DOES. It generates chunks, holds them and
 * hands out bytes; deciding that a byte falls when unsupported is a rule, and
 * rules are mx-gameplay's (plan.md §2.3-1). A larger mirror would be a larger
 * thing to keep honest.
 *
 * ---------------------------------------------------------------------------
 * `ChunkCoord` is `{cx, cz}`, and this file is where that was settled
 * ---------------------------------------------------------------------------
 *
 * This repository used to declare its own `ChunkCoord = {x, z}` in
 * `domain/chunk.ts`, whose header already said kernel would own the type. Two
 * spellings of one coordinate is exactly the class of defect plan.md §3.4
 * records as the cause of every "things float" bug in the reference
 * implementation — *「物が浮く」バグ類は例外なく足元原点 vs AABB中心のY規約不一致
 * が原因。座標規約を型で区別する.* With `{x, z}`, `blockPosition.x` and
 * `chunkCoord.x` are the same property name for numbers 16 apart, and passing
 * one where the other belongs is silent. With `{cx, cz}` it is a type error.
 *
 * kernel's spelling therefore wins, and the axes are branded for the same
 * reason.
 */
import { Brand } from 'effect'
import { CHUNK_SIZE_XZ } from './constants'

// ---------------------------------------------------------------------------
// Coordinates — mirrors mc-kernel/domain/coordinates.ts
// ---------------------------------------------------------------------------

/**
 * `CHUNK_SIZE_XZ` is kernel's too (`domain/coordinates.ts`), but this
 * repository already had it in `./constants` alongside `CHUNK_HEIGHT` and
 * `CHUNK_VOLUME`, and two `export *` barrels carrying one name make it
 * AMBIGUOUS — TypeScript then drops the name from the barrel silently. So the
 * mirror consumes the existing constant rather than restating it, and
 * `test/kernel-mirror.test.ts` pins that the two agree on 16.
 */

/** An integral world-space block coordinate on any axis. */
export type BlockAxis = number & Brand.Brand<'BlockAxis'>

export const BlockAxis = Brand.refined<BlockAxis>(
  (value) => Number.isSafeInteger(value),
  (value) => Brand.error(`BlockAxis must be a safe integer, received ${value}`),
)

/** An integral chunk-space coordinate on the X or Z axis. One step = CHUNK_SIZE_XZ blocks. */
export type ChunkAxis = number & Brand.Brand<'ChunkAxis'>

export const ChunkAxis = Brand.refined<ChunkAxis>(
  (value) => Number.isSafeInteger(value),
  (value) => Brand.error(`ChunkAxis must be a safe integer, received ${value}`),
)

/** A chunk-local horizontal coordinate: an integer in [0, CHUNK_SIZE_XZ - 1]. */
export type LocalAxis = number & Brand.Brand<'LocalAxis'>

export const LocalAxis = Brand.refined<LocalAxis>(
  (value) => Number.isInteger(value) && value >= 0 && value < CHUNK_SIZE_XZ,
  (value) => Brand.error(`LocalAxis must be an integer in [0, ${CHUNK_SIZE_XZ - 1}], received ${value}`),
)

/**
 * Collapse `-0` to `0`.
 *
 * `Math.floor(-0)` is `-0`, which compares equal under `===` but not under
 * `Object.is`, and structural equality helpers (including Vitest's
 * `toStrictEqual`) treat it as a different value. Normalising once here keeps
 * every integral coordinate canonical — and, in this repository specifically,
 * keeps `chunkKeyOf` from producing both `"-0,3"` and `"0,3"` for one chunk.
 */
const normalizeZero = (value: number): number => value + 0

/** The horizontal address of a chunk column. */
export type ChunkCoord = {
  readonly cx: ChunkAxis
  readonly cz: ChunkAxis
}

export const chunkCoord = (cx: number, cz: number): ChunkCoord => ({
  cx: ChunkAxis(normalizeZero(cx)),
  cz: ChunkAxis(normalizeZero(cz)),
})

/** A world-space block cell. Every component is an integer. */
export type BlockPosition = {
  readonly x: BlockAxis
  readonly y: BlockAxis
  readonly z: BlockAxis
}

export const blockPosition = (x: number, y: number, z: number): BlockPosition => ({
  x: BlockAxis(normalizeZero(x)),
  y: BlockAxis(normalizeZero(y)),
  z: BlockAxis(normalizeZero(z)),
})

/**
 * A block address relative to its chunk column.
 *
 * `lx` / `lz` are chunk-local and therefore in [0, 15]. `ly` is deliberately a
 * plain `BlockAxis`: chunks are not vertically subdivided by this type, and the
 * legal Y range is a world-generation concern that kernel does not own.
 */
export type LocalBlockCoord = {
  readonly lx: LocalAxis
  readonly ly: BlockAxis
  readonly lz: LocalAxis
}

/** Euclidean floor division — correct for negative operands, unlike `/` + trunc. */
const floorDiv = (value: number, divisor: number): number => Math.floor(value / divisor)

/** Euclidean modulo — always in [0, divisor), unlike `%`. */
const floorMod = (value: number, divisor: number): number => ((value % divisor) + divisor) % divisor

/** The chunk column that owns a block cell. */
export const chunkCoordOfBlock = (value: BlockPosition): ChunkCoord =>
  chunkCoord(floorDiv(value.x, CHUNK_SIZE_XZ), floorDiv(value.z, CHUNK_SIZE_XZ))

/** The chunk-local address of a block cell. */
export const localCoordOfBlock = (value: BlockPosition): LocalBlockCoord => ({
  lx: LocalAxis(normalizeZero(floorMod(value.x, CHUNK_SIZE_XZ))),
  ly: value.y,
  lz: LocalAxis(normalizeZero(floorMod(value.z, CHUNK_SIZE_XZ))),
})

/** Inverse of `chunkCoordOfBlock` + `localCoordOfBlock`. */
export const blockPositionOfChunkLocal = (chunk: ChunkCoord, local: LocalBlockCoord): BlockPosition =>
  blockPosition(chunk.cx * CHUNK_SIZE_XZ + local.lx, local.ly, chunk.cz * CHUNK_SIZE_XZ + local.lz)

// ---------------------------------------------------------------------------
// Block ids — mirrors mc-kernel/domain/block-registry.ts (the TYPE only)
// ---------------------------------------------------------------------------

/**
 * The storage encoding of a block inside a chunk buffer.
 *
 * One byte, because the chunk buffer is a `Uint8Array`. The 256-value ceiling
 * is a fact about the chunk format rather than a pessimism about the roster.
 *
 * Kernel's `block-registry.ts` owns the id ↔ `BlockType` bijection and the
 * table that says what each id DOES; `domain/biome.ts`'s `BLOCK` constant in
 * this repository holds the same numbers for ids 0-10 and
 * `test/kernel-mirror.test.ts` pins the agreement. Kernel adopted THESE
 * numbers, not the other way round: this repository's golden fixtures were
 * generated against them.
 */
export type BlockId = number & Brand.Brand<'BlockId'>

/** Largest representable id, from the `Uint8Array` chunk buffer. */
export const BLOCK_ID_MAX = 255

export const BlockId = Brand.refined<BlockId>(
  (value) => Number.isInteger(value) && value >= 0 && value <= BLOCK_ID_MAX,
  (value) => Brand.error(`BlockId must be an integer in [0, ${BLOCK_ID_MAX}], received ${value}`),
)

/**
 * Air is id 0, and this is load-bearing rather than conventional:
 * `new Uint8Array(n)` is zero-filled, so `emptyBlocks()` needs no
 * initialisation pass to produce a chunk full of air.
 */
export const AIR_BLOCK_ID: BlockId = BlockId(0)
