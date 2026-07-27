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
 * needs, which is the coordinate vocabulary, the block-id type and TWO COLUMNS
 * of kernel's property table. It does not mirror kernel's capability FLAGS:
 * deciding that a byte falls when unsupported is a rule, and rules are
 * mx-gameplay's (plan.md §2.3-1). A larger mirror would be a larger thing to
 * keep honest.
 *
 * ---------------------------------------------------------------------------
 * The two columns, and why this file used to say there were none
 * ---------------------------------------------------------------------------
 *
 * This paragraph used to read 「it does NOT mirror kernel's block table or its
 * capability lookups: mc-worldgen never asks what a block DOES」. That sentence
 * stopped being true when `domain/light.ts` was built, and it is amended rather
 * than quietly left standing.
 *
 * plan.md §3.7 gives this repository the light grid *as part of the chunk data*,
 * and `application/chunk-store.ts`'s header spends an argument on why the write
 * path lives here BECAUSE 「a block write invalidates light」. A light grid cannot
 * be computed without two facts about a block:
 *
 *   WHICH BLOCKS EMIT   kernel's `lightEmission: 0..15` (`block-properties.ts`).
 *                       Three rows carry a non-zero one: lava 15, torch 14,
 *                       glowstone 15.
 *   WHICH BLOCKS PASS   kernel's `opacity: 'transparentSolid' | 'fluid' |
 *                       'opaque'`, whose own doc comment calls it the 「meshing
 *                       bucket AND LIGHT ATTENUATION CLASS」.
 *
 * So the honest statement of the boundary is not 「this repository never asks
 * what a block does」 — it is that this repository asks kernel exactly the two
 * questions its own noun requires, and asks no others. It still does not know
 * that sand falls, that glass is not a spawn surface, or what anything drops.
 *
 * The alternative was to take the light grid's INPUTS as a parameter, the way
 * `TerrainLevels` is injected rather than baked (`./constants`). It was rejected
 * because the caller would then own kernel's table: mc-render, mx-gameplay and
 * the save path would each have to supply an emission function, and the first
 * two to disagree would produce two different lightings of one chunk — which is
 * the 「two owners of one noun」 failure the store's header is already about.
 *
 * ONE GAP, NAMED RATHER THAN LEFT TO BE FOUND. mc-dev-meta's `pnpm check:mirrors`
 * probes transcribed capability FLAGS by importing kernel's `capabilityOfBlockId`
 * and diffing all 256 ids. `lightEmission` and `opacity` are PROPERTIES, and
 * that probe has no property half — so these two columns are guarded only by
 * `test/kernel-mirror.test.ts` below, which restates kernel's rows. That is a
 * weaker guarantee than the flags get, and it is the same weaker guarantee that
 * let `replaceable` lose lava in mx-gameplay until the cross-repository check
 * was built.
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

// ---------------------------------------------------------------------------
// Light columns — mirrors mc-kernel/domain/block-properties.ts (TWO properties)
// ---------------------------------------------------------------------------

/**
 * The 4-bit ceiling on a light level. Kernel's `LIGHT_LEVEL_MAX`.
 *
 * Fifteen because the grid packs two voxels per byte (`./light.ts`), which is
 * the reference's storage decision and not a taste: 16 × 16 × 256 voxels at one
 * byte each would be 64 KB of light per grid per chunk, and there are two grids.
 */
export const LIGHT_LEVEL_MAX = 15

/** Kernel's floor, restated so that a clamp reads with both ends named. */
export const LIGHT_LEVEL_MIN = 0

/**
 * Kernel's `BlockOpacity` — 「meshing bucket and light attenuation class」.
 *
 * Mirrored in kernel's declaration ORDER, which is plan.md §3.3's render
 * priority (`transparentSolid > fluid > opaque`) rather than an alphabetisation.
 * This repository consumes only the opaque/not-opaque split; mc-render consumes
 * all three, and a two-value local enum would have to be widened on the day it
 * is published.
 */
export const BLOCK_OPACITIES = ['transparentSolid', 'fluid', 'opaque'] as const
export type BlockOpacity = (typeof BLOCK_OPACITIES)[number]

/**
 * The rows of kernel's `BLOCK_REGISTRY` whose `opacity` is not the default.
 *
 * A NEGATIVE transcription, and for kernel's own reason rather than for
 * brevity: `BLOCK_PROPERTY_DEFAULTS.opacity` is `'opaque'`, because audit §7
 * settles every default at 「普通の不透明立方体」. Transcribing the exceptions
 * buys the two properties the positive table would have to remember —
 *
 *   - an id this build cannot name reads as an ordinary opaque cube, exactly as
 *     kernel's `resolveBlockProperties` resolves it;
 *   - adding an ordinary block to kernel's registry needs no edit here.
 *
 * AIR IS IN THIS TABLE and it is the row most likely to look like a mistake.
 * Kernel really does give air `opacity: 'transparentSolid'` rather than a fourth
 * class of its own, and light propagation depends on it: air is the medium, so
 * an air row that fell through to the `'opaque'` default would produce a world
 * in which no light travels at all and every cell below the surface reads 0.
 */
const NON_OPAQUE_BLOCK_OPACITIES: ReadonlyMap<number, BlockOpacity> = new Map([
  [0, 'transparentSolid'], // air
  [6, 'fluid'], // water
  [10, 'transparentSolid'], // oak_leaves
  [11, 'fluid'], // lava
  [13, 'transparentSolid'], // glass
  [14, 'transparentSolid'], // torch
])

/** Total, like kernel's: an id outside the transcription is an ordinary cube. */
export const opacityOfBlockId = (block: number): BlockOpacity =>
  NON_OPAQUE_BLOCK_OPACITIES.get(block) ?? 'opaque'

/**
 * May light cross this cell at all?
 *
 * The opaque/not-opaque split, and DELIBERATELY BINARY. Vanilla attenuates sky
 * light by more than one level through leaves and through water; kernel's
 * `opacity` carries three CLASSES and no attenuation amount, so a per-class
 * number invented here would be this repository owning a column of kernel's
 * table that kernel has not written. `../docs/design-notes.md` DN-7 records the
 * divergence rather than this file guessing at it: when kernel grows a
 * `lightAttenuation` property, this function becomes a lookup of it and
 * `./light.ts`'s two `- 1` steps become `- attenuationOf(block)`.
 *
 * The visible consequence today is that a canopy of oak leaves does not dim the
 * ground beneath it, and a hostile therefore cannot spawn under a tree in
 * daylight that vanilla would allow. That is the CONSERVATIVE direction for the
 * one rule that reads this grid (`mx-gameplay/domain/mob/hostile-spawn.ts`
 * refuses above light 7), which is why it is acceptable to ship and why it is
 * written down.
 */
export const transmitsLight = (block: number): boolean => opacityOfBlockId(block) !== 'opaque'

/**
 * The rows of kernel's `BLOCK_REGISTRY` with a non-zero `lightEmission`.
 *
 * Three, and every one of them is a level rather than a boolean — which is the
 * whole of kernel's audit §5 finding on this column: plan.md §3.1 asked for
 * `emissive: boolean` and the reference implementation ALREADY contradicted it
 * with `EMISSIVE_LEVEL_OVERRIDES` (`light.ts:24-46`). A torch is 14 and
 * glowstone is 15, and the one-level gap is visible in a lit room.
 */
const BLOCK_LIGHT_EMISSION: ReadonlyMap<number, number> = new Map([
  [11, 15], // lava
  [14, 14], // torch
  [15, 15], // glowstone
])

/** Total: kernel's default is `LIGHT_LEVEL_MIN`, so an unknown id emits nothing. */
export const lightEmissionOfBlockId = (block: number): number =>
  BLOCK_LIGHT_EMISSION.get(block) ?? LIGHT_LEVEL_MIN

/** Kernel's `clampLightLevel`. Used where emission and attenuation combine. */
export const clampLightLevel = (value: number): number =>
  Math.min(LIGHT_LEVEL_MAX, Math.max(LIGHT_LEVEL_MIN, Math.trunc(value)))
