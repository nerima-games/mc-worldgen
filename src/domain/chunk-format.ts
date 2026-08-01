/**
 * The chunk save format — plan.md §3.7's 「永続化は mc-save のツールキットで
 * チャンクフォーマットを定義」.
 *
 * This is the DEFINITION only. Where the bytes go is `StoragePort`'s and
 * therefore mc-save's (docs/responsibility.md §2: 「永続化の機構 → mc-save」),
 * and `ChunkStore.unload` still does not persist — §5 records that as waiting
 * on the medium, which this file does not supply.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE FORMAT IS FOR, stated before what it contains
 * ---------------------------------------------------------------------------
 *
 * The reference implementation persisted a chunk by handing the raw
 * `Uint8Array` to IndexedDB and letting structured clone do the rest. Nothing
 * was written alongside it: no format name, no version, no length. mc-save's
 * `domain/envelope.ts` header lists what that cost, and the item this file is
 * the direct answer to is the last one:
 *
 *     a stored buffer of the wrong size could only be detected by comparing it
 *     against a hard-coded expected length, and the only available recovery was
 *     to throw the save away
 *     (`chunk-manager-ops-storage.ts:47-50`: "has invalid buffer length ...
 *     regenerating")
 *
 * Below, a wrong-sized buffer is a `SaveDecodeError` naming the format, the
 * version and the two lengths. That is not a nicety — REGENERATING is the
 * destructive option, and the reference reached for it because a raw buffer
 * carries nothing else to reason about.
 *
 * ---------------------------------------------------------------------------
 * THE ENCODED FORM: mc-save's DN-6 asked for a decision, and this is it
 * ---------------------------------------------------------------------------
 *
 * `mc-save/docs/design-notes.md` DN-6 declines to choose and says so out loud —
 * 「structured clone は `Uint8Array` をそのまま通すので、エンベロープの
 * `payload` に `Uint8Array` を入れる設計は IndexedDB では成立する。ただし JSON
 * 化する経路（エクスポート、ネットワーク）では成立しない。**どちらを正とするか
 * を decide してから schema を書くこと。**」
 *
 * The decision is JSON, and mc-save had already made it everywhere except in
 * that paragraph. `test/binary-roundtrip.test.ts` states the rule at its own
 * toy chunk schema — 「`Schema.Uint8Array` and not `Schema.Uint8ArrayFromSelf`:
 * the encoded payload is the WIRE shape ... A save file that can only be read
 * by a JavaScript runtime is the reference's mistake, not a constraint」 — and
 * `test/format-roundtrip.test.ts` says the same about `Date`.
 *
 * So `Schema.Uint8ArrayFromSelf` is out. What is NOT settled by that rule is
 * WHICH wire shape, and here mc-save's toy and this format part company.
 * `Schema.Uint8Array` encodes to `ReadonlyArray<number>`. On a four-byte
 * fixture that is invisible. A chunk is `CHUNK_VOLUME` = 65,536 bytes, and
 * measured on this repository's own `effect` build:
 *
 *     JSON bytes, terrain-like chunk    number[]  233,985     base64   87,386
 *     JSON bytes, all-air chunk         number[]  131,073     base64   87,386
 *
 * — 2.7x on a realistic chunk, and that is before the in-memory cost of a
 * 65,536-element `Array` of boxed numbers against one string. `base64` is also
 * the shape with a fixed size, which matters for a format whose failure mode
 * this file exists to make legible.
 *
 * The divergence from mc-save's toy is therefore in the SIZE argument only, not
 * in the rule: both are wire shapes, both survive `JSON.stringify` and
 * structured clone, and neither ties a save file to a JavaScript runtime.
 *
 * ---------------------------------------------------------------------------
 * `Schema.Schema` IS INVARIANT IN BOTH PARAMETERS, and that decides the shape
 * of the two declarations below
 * ---------------------------------------------------------------------------
 *
 * `mc-save/domain/registry.ts:23-32` is where this is written down: a registry
 * cannot hold `SaveFormat<unknown, unknown>` because `Schema.Schema` is
 * invariant, so `AnySaveFormat` is `SaveFormat<any, any>` and callers 「recover
 * the real type by holding onto the `SaveFormat` value they defined」.
 *
 * Holding onto it is what `CHUNK_FORMAT` below does, and invariance is the
 * reason its two type parameters are handled in OPPOSITE directions:
 *
 *   `Chunk` (the A side) is PINNED by annotation. `CHUNK_SCHEMA` is declared
 *       `Schema.Schema<Chunk, ChunkEncoded>`, so if `domain/chunk.ts` gains a
 *       field, loses one, or renames one, this file stops compiling. Under
 *       invariance an annotation is a two-way assertion rather than an upper
 *       bound, which is exactly the strength wanted: a schema that decodes to
 *       MORE than `Chunk` is as wrong as one that decodes to less, because the
 *       extra field is one nothing writes and nothing reads.
 *
 *   `ChunkEncoded` (the I side) is DERIVED with `Schema.Schema.Encoded`. Hand
 *       writing it would be a transcription of the schema sitting beside it,
 *       and under invariance the two would have to agree EXACTLY — every
 *       `readonly`, every optionality — so the annotation would fail for
 *       spelling reasons far more often than for real ones, and the pressure
 *       would be to loosen it until it meant nothing. The encoded shape has no
 *       independent definition to check against; it is whatever the schema
 *       says, and saying it twice does not make it truer.
 *
 * The one place invariance genuinely costs something is the brand.
 * `ChunkCoord.cx` is `ChunkAxis = number & Brand.Brand<'ChunkAxis'>`, and the
 * obvious `Schema.Number.pipe(Schema.int(), Schema.brand('ChunkAxis'))` would
 * DECLARE A SECOND CONSTRUCTOR FOR THAT BRAND KEY. mc-dev-meta's
 * `domain/mirror-contract.ts` names that exact defect among the four this
 * project has already shipped — 「`DeltaTimeSecs` refined to `[0.001, 0.05]` in
 * one repository and `>= 0` in another, under the same brand key」 — and it is
 * invisible to every compiler involved, because two declarations sharing a key
 * are one nominal type to `tsc` and two unrelated refinements at runtime.
 *
 * `Schema.fromBrand` takes the EXISTING `Brand.Constructor` from
 * `./kernel-vocabulary` instead, so the refinement below is kernel's own and
 * there is only ever one of it.
 *
 * THE ARGUMENT IS STRUCTURAL, AND IT HAS TO BE, because today the two spellings
 * BEHAVE IDENTICALLY. That was measured rather than assumed: writing the rival
 * brand in and running `test/chunk-format.test.ts` leaves all sixteen green,
 * because `Schema.int()` refines on `Number.isSafeInteger` — not
 * `Number.isInteger`, which is the reasonable guess and is wrong — and so does
 * kernel's `ChunkAxis`. They agree on every value including
 * `MAX_SAFE_INTEGER + 1`.
 *
 * So no test in this repository pins this choice, and CF-15 should not be read
 * as pinning it: CF-15 passes under both spellings. What makes `fromBrand` the
 * right one anyway is that the agreement is a COINCIDENCE OF TWO PREDICATES
 * NOBODY IS HOLDING TOGETHER. Kernel is free to narrow `ChunkAxis` — to the
 * legal chunk range, say — and `Schema.int()` would not follow it, in silence,
 * under a brand key that claims they are the same type. Reusing the constructor
 * means there is no second predicate to drift.
 */
import { Schema } from 'effect'
import { CHUNK_BIOMES } from './biome'
import { type Chunk } from './chunk'
import { CHUNK_SIZE_XZ, CHUNK_VOLUME } from './constants'
import { ChunkAxis, type ChunkCoord } from './kernel-vocabulary'
import { defineFormat, FIRST_VERSION, type SaveFormat } from './save-format-port'

/** One biome per column. `domain/chunk.ts` indexes it `lz * CHUNK_SIZE_XZ + lx`. */
export const CHUNK_BIOME_COUNT = CHUNK_SIZE_XZ * CHUNK_SIZE_XZ

/**
 * The format's identity in the envelope, and it is a PERMANENT string.
 *
 * `decodeSave` refuses an envelope whose `format` differs, which is what stops
 * a key collision between two formats from decoding as success. Renaming this
 * makes every existing save foreign — not corrupt, but unreadable with no
 * migration able to help, because the chain is only consulted after the name
 * matches. Spelled like the `ChunkStore` tag (`application/chunk-store.ts:207`)
 * so that one repository's persisted things share one prefix.
 */
export const CHUNK_FORMAT_NAME = '@nerima-games/mc-worldgen/chunk'

/**
 * `ChunkAxis`, refined by kernel's OWN constructor rather than a second one.
 *
 * See this file's header. `Schema.fromBrand(ChunkAxis)` reuses the
 * `Brand.refined` in `./kernel-vocabulary`; `Schema.brand('ChunkAxis')` would
 * declare a rival under the same key. The two predicates agree TODAY — the
 * header records the measurement and why that is not a reason to rely on it.
 */
const ChunkAxisFromNumber = Schema.Number.pipe(Schema.fromBrand(ChunkAxis))

const ChunkCoordSchema: Schema.Schema<ChunkCoord, { readonly cx: number; readonly cz: number }> =
  Schema.Struct({ cx: ChunkAxisFromNumber, cz: ChunkAxisFromNumber })

/**
 * The block buffer, base64 on the wire, with its LENGTH part of the format.
 *
 * The length check is the whole reason this is a format rather than a buffer.
 * Without it a truncated or doubled payload decodes into a `Uint8Array` that
 * every later read treats as authoritative — `readBlock` is total and answers
 * `AIR_BLOCK_ID` past the end (`domain/chunk.ts:51`), so a chunk half the right
 * size is not an error anywhere, it is a world with the bottom missing.
 */
const ChunkBlocksSchema = Schema.Uint8ArrayFromBase64.pipe(
  Schema.filter((blocks) =>
    blocks.length === CHUNK_VOLUME
      ? undefined
      : `expected ${String(CHUNK_VOLUME)} block bytes, received ${String(blocks.length)}`,
  ),
)

/**
 * The biome column, as a closed literal roster.
 *
 * `BIOMES` IS A SAVE FORMAT, in the same way `test/kernel-mirror.test.ts` says
 * the block ids are: an entry that changes spelling is a world whose deserts
 * load as something else. Encoding the NAME rather than an index is what makes
 * that safe in one direction — reordering `BIOMES` cannot corrupt a save,
 * because nothing here depends on the order.
 *
 * The direction that is NOT safe is removal. Adding a biome leaves every
 * existing save decodable; deleting or renaming one makes saves containing it
 * fail this schema, and THAT is the trigger for a v2 with a migration step
 * mapping the retired name onto its replacement. `Migration` in
 * `./save-format-port` exists for exactly this and runs on the raw payload
 * before any schema sees it.
 */
const ChunkBiomesSchema = Schema.Array(Schema.Literal(...CHUNK_BIOMES)).pipe(
  Schema.filter((biomes) =>
    biomes.length === CHUNK_BIOME_COUNT
      ? undefined
      : `expected ${String(CHUNK_BIOME_COUNT)} biome columns, received ${String(biomes.length)}`,
  ),
)

/**
 * `coord` is stored even though the storage KEY already carries it.
 *
 * That redundancy is the point. mc-save's `domain/storage-port.ts` leaves the
 * key to the caller, so nothing but this field can tell a chunk read under the
 * wrong key from a chunk read under the right one — and the reference
 * implementation, which built its key inside the adapter
 * (`storage-idb-model.ts:27-28`), had no way to notice either. Two integers per
 * save buys a check that the block buffer cannot perform on itself.
 */
const CHUNK_STRUCT = Schema.Struct({
  coord: ChunkCoordSchema,
  blocks: ChunkBlocksSchema,
  biomes: ChunkBiomesSchema,
})

/**
 * The wire shape, DERIVED from the struct rather than transcribed beside it.
 * See this file's header on why only the `Chunk` side is annotated.
 */
export type ChunkEncoded = Schema.Schema.Encoded<typeof CHUNK_STRUCT>

/**
 * The annotation is the pin, and it points at `Chunk` ALONE.
 *
 * `ChunkEncoded` is read off `CHUNK_STRUCT` above, so naming it here asserts
 * nothing about the encoded side and cannot fail for a spelling reason. What it
 * does assert is the half with an independent definition: that this schema
 * decodes to `domain/chunk.ts`'s `Chunk` and to nothing wider or narrower.
 */
export const CHUNK_SCHEMA: Schema.Schema<Chunk, ChunkEncoded> = CHUNK_STRUCT

/**
 * Version 1, with an EMPTY migration chain, and `defineFormat` is what makes
 * that assertable rather than merely true: it throws at module-evaluation time
 * on a chain with a gap, so the first version that forgets a step is a build
 * that does not start rather than a player whose world will not load.
 *
 * Light is deliberately absent. `domain/light.ts` owns two grids and neither is
 * persisted — mc-save's DN-6 records that the reference recomputed them on load
 * (`chunk-manager-ops-storage.ts:61`) and that decision is kept: the grids are a
 * pure function of the blocks, and a persisted derivative is a second source of
 * truth that can disagree with the first.
 */
export const CHUNK_FORMAT: SaveFormat<Chunk, ChunkEncoded> = defineFormat({
  name: CHUNK_FORMAT_NAME,
  version: FIRST_VERSION,
  schema: CHUNK_SCHEMA,
})
