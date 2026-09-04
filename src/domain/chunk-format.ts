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
 *   `PersistableChunk` (the A side) is PINNED by annotation. It is `Chunk`
 *       plus the optional natural-structure metadata accepted by generation.
 *       Decoding materialises both metadata arrays, while encoding still
 *       accepts terrain-only chunks produced by `generateChunk`.
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
 * `mc-kernel` instead, so the refinement below is kernel's own and
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
import {
  type AppliedNaturalStructureMarker,
  type NaturalStructureChunk,
} from './natural-structure.js'
import {
  BYTES_PER_ELEMENT,
  BlockAxis,
  BlockId,
  type BlockPosition,
  ChunkAxis,
  type ChunkCoord,
} from '@nerima-games/mc-kernel'
import { CHUNK_BIOMES, type ChunkBiomeType } from './biome.js'
import { CHUNK_SIZE_XZ, CHUNK_VOLUME } from './constants.js'
import {
  type EndFeatureChunk,
  type EndFeatureMarker,
} from './end-features.js'
import { FIRST_VERSION, type SaveFormat, defineFormat } from '@nerima-games/mc-save'
import { type Chunk } from './chunk.js'
import { Schema } from 'effect'

/** One biome per column. `domain/chunk.ts` indexes it `lz * CHUNK_SIZE_XZ + lx`. */
export const CHUNK_BIOME_COUNT: number = CHUNK_SIZE_XZ * CHUNK_SIZE_XZ

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
 * `Brand.refined` in `mc-kernel`; `Schema.brand('ChunkAxis')` would
 * declare a rival under the same key. The two predicates agree TODAY — the
 * header records the measurement and why that is not a reason to rely on it.
 */
const ChunkAxisFromNumber = Schema.Number.pipe(Schema.fromBrand(ChunkAxis))
const BlockAxisFromNumber = Schema.Number.pipe(Schema.fromBrand(BlockAxis))
const BlockIdFromNumber = Schema.Number.pipe(Schema.fromBrand(BlockId))

const ChunkCoordSchema: Schema.Schema<ChunkCoord, { readonly cx: number; readonly cz: number }> =
  Schema.Struct({ cx: ChunkAxisFromNumber, cz: ChunkAxisFromNumber })

/**
 * ---------------------------------------------------------------------------
 * VERSION 2: the block buffer widened to two bytes per element
 * ---------------------------------------------------------------------------
 *
 * `domain/chunk.ts`'s `Chunk.blocks` widened from `Uint8Array` to `Uint16Array`
 * so the generation buffer can hold every id `@nerima-games/mc-kernel` can
 * issue — kernel's own block storage (`BlockState`, `block-state.ts:17`) is
 * two bytes per element and its `BlockId` brand tops out at `BLOCK_ID_MAX`
 * (`0xffff` = 65535, `block-registry-types.ts:18`). This package's OWN
 * `Uint8Array` ceiling of 255 was never derived from that constant — the
 * 0.3.1 changeset recorded it as "implicit in the generation buffer's storage
 * type", worth revisiting once the registry passed 256 entries. It has not
 * yet (kernel 0.7.0 tops out at id 122), so no existing save has ever needed
 * an id past 255; the widening is preventive, not a fix for observed
 * corruption.
 *
 * `BYTES_PER_ELEMENT` is imported from kernel rather than hardcoded as `2`,
 * for the same reason `Schema.fromBrand(ChunkAxis)` above reuses kernel's
 * brand constructor instead of declaring a rival: one constant, not two that
 * could quietly disagree if kernel ever widens `BlockId` again.
 *
 * The wire shape stays base64, not a JSON `number[]`, for the reason this
 * file's opening section measured (2.7x on a realistic chunk) — doubling the
 * per-element byte width does not remove that reason, it only doubles the
 * base64 payload alongside it. Packing follows kernel's own `BlockState`
 * convention (`block-state.ts:62-95`): a `DataView` over the raw bytes,
 * little-endian, explicit rather than aliasing a `Uint16Array` view directly
 * over the buffer, since a directly-aliased view reads host-endian and this
 * wire format must not depend on which machine wrote it.
 *
 * ---------------------------------------------------------------------------
 * VERSION 1 IS KEPT, READ-ONLY, BECAUSE mc-save HAS NO AUTOMATIC UPGRADE PATH
 * ---------------------------------------------------------------------------
 *
 * mc-save's `decodeSave` (`format-codec.ts`) accepts exactly one version —
 * `format.version` — and unconditionally refuses every other one, including
 * older ones. mc-save's own `test/migration.test.ts` (added in 4894155,
 * 0.4.2) states this in so many words: "mc-save's own 'migration' capability
 * is therefore NOT an automatic upgrade path... A real migration... has to be
 * assembled by the consumer" from `SaveEnvelopeSchema`, a schema for the OLD
 * version, and `encodeSave` under the CURRENT format. `CHUNK_FORMAT_V1` below
 * is exactly that OLD-version schema, kept forever as a read path so a world
 * saved before this widening still loads. `application/chunk-persistence.ts`
 * is where the consumer-side dispatch on `envelope.version` lives.
 *
 * The alternative — refuse to load a v1 save and force regeneration — was
 * rejected: this file's own header already treats REGENERATING an existing
 * save as the destructive option of last resort, not a routine migration
 * step.
 */
const CHUNK_BLOCK_ELEMENT_BYTES = BYTES_PER_ELEMENT

/**
 * Exported beyond this format's own decode/encode pipeline because it is also
 * the right way to turn a `Chunk.blocks` into bytes for anything that must
 * not depend on host endianness — `scripts/golden-fixture.ts`'s digest is the
 * first such caller. Hashing (or otherwise byte-comparing) a `Uint16Array`
 * directly reads ITS OWN buffer in host-native byte order; two little-endian
 * machines agree by the accident of sharing an architecture, not because
 * anything pins the order. `packBlocksV2` pins it explicitly, the same way
 * kernel's `BlockState` does.
 */
export const packBlocksV2 = (blocks: Uint16Array): Uint8Array => {
  const bytes = new Uint8Array(blocks.length * CHUNK_BLOCK_ELEMENT_BYTES)
  const view = new DataView(bytes.buffer)
  for (const [index, blockId] of blocks.entries()) {
    view.setUint16(index * CHUNK_BLOCK_ELEMENT_BYTES, blockId, true)
  }
  return bytes
}

const unpackBlocksV2 = (bytes: Uint8Array): Uint16Array => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const blocks = new Uint16Array(bytes.length / CHUNK_BLOCK_ELEMENT_BYTES)
  return blocks.map((_unused, index) => view.getUint16(index * CHUNK_BLOCK_ELEMENT_BYTES, true))
}

/**
 * No separate `BLOCK_ID_MAX` filter here: a `Uint16Array` element cannot
 * exceed 65535, which is exactly `BLOCK_ID_MAX` today — pinned by
 * `test/chunk-format.test.ts`'s "BLOCK_ID_MAX still equals the Uint16Array
 * ceiling" assertion, not left an unchecked coincidence. A filter that
 * re-tested `blockId > BLOCK_ID_MAX` here could never fail against a real
 * `Uint16Array` — it would be dead code kept alive only by a contrived test,
 * which proves nothing the pinned assertion does not already prove for free.
 * If kernel ever widens `BlockId` past 16 bits, THAT assertion is what goes
 * red first, and a real range filter belongs here again at that point.
 */
const Uint16ArraySchema = Schema.declare(
  (value: unknown): value is Uint16Array => value instanceof Uint16Array,
)

/**
 * The v2 block buffer, base64 on the wire, with its BYTE LENGTH part of the
 * format — `CHUNK_VOLUME * BYTES_PER_ELEMENT`, not `CHUNK_VOLUME`, now that
 * each element is two bytes. See the section header above for why the length
 * check exists at all: a truncated or doubled payload must fail loudly here
 * rather than decode into a buffer `readBlock` will silently treat as
 * authoritative (`domain/chunk.ts`'s total `readBlock`).
 */
const ChunkBlocksBytesSchema = Schema.Uint8ArrayFromBase64.pipe(
  Schema.filter((bytes) => {
    const expected = CHUNK_VOLUME * CHUNK_BLOCK_ELEMENT_BYTES
    if (bytes.length === expected) {
      return
    }
    return `expected ${String(expected)} block bytes, received ${String(bytes.length)}`
  }),
)

const ChunkBlocksSchema = Schema.transform(ChunkBlocksBytesSchema, Uint16ArraySchema, {
  decode: unpackBlocksV2,
  encode: packBlocksV2,
  strict: true,
})

/**
 * The v1 block buffer: one byte per block, `BLOCK_ID_MAX` was 255 under the
 * `Uint8Array` generation buffer this format shipped alongside. Decode-only —
 * nothing in this package ever encodes a v1 payload again — and kept solely
 * so `CHUNK_FORMAT_V1` below can read a save written before this widening.
 */
const ChunkBlocksV1Schema = Schema.Uint8ArrayFromBase64.pipe(
  Schema.filter((blocks) => {
    if (blocks.length === CHUNK_VOLUME) {
      return
    }
    return `expected ${String(CHUNK_VOLUME)} block bytes, received ${String(blocks.length)}`
  }),
)

/**
 * The biome column, as a closed literal roster.
 *
 * `BIOMES` IS A SAVE FORMAT, just as the block-registry ids returned by
 * `blockIdOf` are: an entry that changes spelling is a world whose deserts
 * load as something else. Encoding the NAME rather than an index is what makes
 * that safe in one direction — reordering `BIOMES` cannot corrupt a save,
 * because nothing here depends on the order.
 *
 * The direction that is NOT safe is removal. Adding a biome leaves every
 * existing save decodable; deleting or renaming one makes saves containing it
 * fail this schema, and THAT is the trigger for a v2 with a migration step
 * mapping the retired name onto its replacement. `Migration` in
 * `mc-save` exists for exactly this and runs on the raw payload
 * before any schema sees it.
 */
const ChunkBiomesSchema = Schema.Array(Schema.Literal(...CHUNK_BIOMES)).pipe(
  Schema.filter((biomes) => {
    if (biomes.length === CHUNK_BIOME_COUNT) {
      return
    }
    return `expected ${String(CHUNK_BIOME_COUNT)} biome columns, received ${String(biomes.length)}`
  }),
)

const NaturalStructureKindSchema = Schema.Literal('ancient-city', 'buried-treasure', 'desert-pyramid', 'desert-well', 'igloo', 'jungle-pyramid', 'mineshaft', 'ocean-monument', 'ocean-ruin', 'pillager-outpost', 'shipwreck', 'stronghold', 'swamp-hut', 'trail-ruins', 'trial-chambers', 'village', 'woodland-mansion', 'ruined-nether-portal', 'nether-fortress', 'bastion-remnant', 'end-city')

const NaturalStructureMarkerFields = {
  structureId: Schema.String,
  structureKind: NaturalStructureKindSchema,
  x: Schema.Number,
  y: Schema.Number,
  z: Schema.Number,
}

/** Closed union of every semantic marker that generation can attach to a chunk. */
const AppliedNaturalStructureMarkerSchema: Schema.Schema<AppliedNaturalStructureMarker> = Schema.Union(
  Schema.Struct({
    ...NaturalStructureMarkerFields,
    kind: Schema.Literal('loot-chest'),
    lootTable: Schema.Literal('ancient-city', 'buried-treasure', 'desert-pyramid', 'igloo', 'jungle-pyramid', 'mineshaft', 'ocean-monument', 'ocean-ruin', 'pillager-outpost', 'shipwreck', 'stronghold', 'swamp-hut', 'trail-ruins', 'trial-chambers', 'village', 'woodland-mansion', 'ruined-nether-portal', 'nether-fortress', 'bastion-remnant', 'end-city', 'end-ship'),
  }),
  Schema.Struct({
    ...NaturalStructureMarkerFields,
    entity: Schema.Literal('villager'),
    kind: Schema.Literal('entity-spawn'),
    profession: Schema.Literal('farmer', 'toolsmith'),
  }),
  Schema.Struct({
    ...NaturalStructureMarkerFields,
    entity: Schema.Literal('zombie-villager'),
    kind: Schema.Literal('entity-spawn'),
  }),
  Schema.Struct({
    ...NaturalStructureMarkerFields,
    entity: Schema.Literal('pillager'),
    kind: Schema.Literal('entity-spawn'),
  }),
  Schema.Struct({
    ...NaturalStructureMarkerFields,
    entity: Schema.Literal('blaze', 'wither-skeleton'),
    kind: Schema.Literal('entity-spawn'),
  }),
  Schema.Struct({
    ...NaturalStructureMarkerFields,
    entity: Schema.Literal('piglin', 'piglin-brute'),
    kind: Schema.Literal('entity-spawn'),
  }),
  Schema.Struct({
    ...NaturalStructureMarkerFields,
    entity: Schema.Literal('shulker', 'blaze'),
    kind: Schema.Literal('spawner'),
  }),
  Schema.Struct({
    ...NaturalStructureMarkerFields,
    axis: Schema.Literal('x', 'z'),
    complete: Schema.Literal(false),
    kind: Schema.Literal('portal-frame'),
  }),
  Schema.Struct({
    ...NaturalStructureMarkerFields,
    eye: Schema.Boolean,
    facing: Schema.Literal('north', 'east', 'south', 'west'),
    kind: Schema.Literal('end-portal-frame'),
  }),
  Schema.Struct({
    ...NaturalStructureMarkerFields,
    kind: Schema.Literal('end-ship'),
  }),
)

const BlockPositionSchema: Schema.Schema<BlockPosition, { readonly x: number; readonly y: number; readonly z: number }> =
  Schema.Struct({ x: BlockAxisFromNumber, y: BlockAxisFromNumber, z: BlockAxisFromNumber })

/** Closed union for entity-like End feature markers attached to a chunk. */
type EndFeatureMarkerEncoded =
  | {
      readonly at: { readonly x: number; readonly y: number; readonly z: number }
      readonly block: number
      readonly featureId: string
      readonly invulnerable: boolean
      readonly kind: 'end-crystal'
    }
  | {
      readonly center: { readonly x: number; readonly y: number; readonly z: number }
      readonly featureId: string
      readonly kind: 'end-crystal-cage'
      readonly material: 'iron_bars'
      readonly maxY: number
      readonly minY: number
      readonly radius: number
    }

const EndFeatureMarkerSchema: Schema.Schema<EndFeatureMarker, EndFeatureMarkerEncoded> = Schema.Union(
  Schema.Struct({
    at: BlockPositionSchema,
    block: BlockIdFromNumber,
    featureId: Schema.String,
    invulnerable: Schema.Boolean,
    kind: Schema.Literal('end-crystal'),
  }),
  Schema.Struct({
    center: BlockPositionSchema,
    featureId: Schema.String,
    kind: Schema.Literal('end-crystal-cage'),
    material: Schema.Literal('iron_bars'),
    maxY: Schema.Number,
    minY: Schema.Number,
    radius: Schema.Number,
  }),
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
const CHUNK_STRUCT: Schema.Schema<
  {
    readonly biomes: ReadonlyArray<ChunkBiomeType>
    readonly blocks: Uint16Array
    readonly coord: ChunkCoord
    readonly endFeatureIds: ReadonlyArray<string>
    readonly endFeatureMarkers: ReadonlyArray<EndFeatureMarker>
    readonly naturalStructureIds: ReadonlyArray<string>
    readonly naturalStructureMarkers: ReadonlyArray<AppliedNaturalStructureMarker>
  },
  {
    readonly biomes: ReadonlyArray<ChunkBiomeType>
    readonly blocks: string
    readonly coord: { readonly cx: number; readonly cz: number }
    readonly endFeatureIds?: ReadonlyArray<string> | undefined
    readonly endFeatureMarkers?: ReadonlyArray<EndFeatureMarkerEncoded> | undefined
    readonly naturalStructureIds?: ReadonlyArray<string> | undefined
    readonly naturalStructureMarkers?: ReadonlyArray<AppliedNaturalStructureMarker> | undefined
  }
> = Schema.Struct({
  biomes: ChunkBiomesSchema,
  blocks: ChunkBlocksSchema,
  coord: ChunkCoordSchema,
  endFeatureIds: Schema.optionalWith(Schema.Array(Schema.String), { default: (): ReadonlyArray<string> => [] }),
  endFeatureMarkers: Schema.optionalWith(Schema.Array(EndFeatureMarkerSchema), {
    default: (): ReadonlyArray<EndFeatureMarker> => [],
  }),
  naturalStructureIds: Schema.optionalWith(Schema.Array(Schema.String), { default: (): ReadonlyArray<string> => [] }),
  naturalStructureMarkers: Schema.optionalWith(Schema.Array(AppliedNaturalStructureMarkerSchema), {
    default: (): ReadonlyArray<AppliedNaturalStructureMarker> => [],
  }),
})

/**
 * The v1 struct: identical to `CHUNK_STRUCT` in every field except `blocks`,
 * which decodes through `ChunkBlocksV1Schema` into the pre-widening
 * `Uint8Array` domain shape. Decode-only — see the section header above
 * `ChunkBlocksV1Schema` for why no encoder ever targets this again — and used
 * by `CHUNK_FORMAT_V1` purely so `application/chunk-persistence.ts` has a
 * `SaveFormat` it can hand to mc-save's own `loadFrom` for a save whose
 * envelope names version 1.
 */
const CHUNK_STRUCT_V1: Schema.Schema<
  {
    readonly biomes: ReadonlyArray<ChunkBiomeType>
    readonly blocks: Uint8Array
    readonly coord: ChunkCoord
    readonly endFeatureIds: ReadonlyArray<string>
    readonly endFeatureMarkers: ReadonlyArray<EndFeatureMarker>
    readonly naturalStructureIds: ReadonlyArray<string>
    readonly naturalStructureMarkers: ReadonlyArray<AppliedNaturalStructureMarker>
  },
  {
    readonly biomes: ReadonlyArray<ChunkBiomeType>
    readonly blocks: string
    readonly coord: { readonly cx: number; readonly cz: number }
    readonly endFeatureIds?: ReadonlyArray<string> | undefined
    readonly endFeatureMarkers?: ReadonlyArray<EndFeatureMarkerEncoded> | undefined
    readonly naturalStructureIds?: ReadonlyArray<string> | undefined
    readonly naturalStructureMarkers?: ReadonlyArray<AppliedNaturalStructureMarker> | undefined
  }
> = Schema.Struct({
  biomes: ChunkBiomesSchema,
  blocks: ChunkBlocksV1Schema,
  coord: ChunkCoordSchema,
  endFeatureIds: Schema.optionalWith(Schema.Array(Schema.String), { default: (): ReadonlyArray<string> => [] }),
  endFeatureMarkers: Schema.optionalWith(Schema.Array(EndFeatureMarkerSchema), {
    default: (): ReadonlyArray<EndFeatureMarker> => [],
  }),
  naturalStructureIds: Schema.optionalWith(Schema.Array(Schema.String), { default: (): ReadonlyArray<string> => [] }),
  naturalStructureMarkers: Schema.optionalWith(Schema.Array(AppliedNaturalStructureMarkerSchema), {
    default: (): ReadonlyArray<AppliedNaturalStructureMarker> => [],
  }),
})

/**
 * Encoding also accepts terrain-only chunks. Decoding always materialises all
 * metadata arrays through `CHUNK_STRUCT`'s defaults.
 */
type PersistableChunk = Chunk &
  Partial<Pick<EndFeatureChunk, 'endFeatureIds' | 'endFeatureMarkers'>> &
  Partial<Pick<NaturalStructureChunk, 'naturalStructureIds' | 'naturalStructureMarkers'>>

const PersistableChunkSchema = Schema.declare(
  (value: unknown): value is PersistableChunk => typeof value === 'object' && value !== null,
)

const ChunkSchema = Schema.transform(CHUNK_STRUCT, PersistableChunkSchema, {
  decode: (chunk) => chunk,
  encode: (chunk) => ({
    biomes: chunk.biomes,
    blocks: chunk.blocks,
    coord: chunk.coord,
    endFeatureIds: chunk.endFeatureIds ?? [],
    endFeatureMarkers: chunk.endFeatureMarkers ?? [],
    naturalStructureIds: chunk.naturalStructureIds ?? [],
    naturalStructureMarkers: chunk.naturalStructureMarkers ?? [],
  }),
})

/**
 * The wire shape, DERIVED from the struct rather than transcribed beside it.
 * See this file's header on why only the decoded side is annotated.
 */
export type ChunkEncoded = Schema.Schema.Encoded<typeof CHUNK_STRUCT>

/**
 * The annotation pins the accepted decoded domain to `PersistableChunk`.
 *
 * `ChunkEncoded` is read off `CHUNK_STRUCT` above, so naming it here asserts
 * nothing about the encoded side and cannot fail for a spelling reason. What it
 * does assert is the half with an independent definition: every value remains
 * a `Chunk`, with natural-structure metadata accepted when present.
 */
export const CHUNK_SCHEMA: Schema.Schema<PersistableChunk, ChunkEncoded> = ChunkSchema

/**
 * Version 2, the widened block buffer. `defineFormat` (`@nerima-games/mc-save`
 * `format-definition.ts`) validates only `name` and `version` at
 * module-evaluation time today — it has carried no `migrations` field, and
 * mc-save has shipped no automatic upgrade path, since mc-save 0.3.0 (this
 * package's own 0.2.0 changeset: "mc-save 0.3.0... no longer provides a
 * migration chain"). An earlier revision of this comment described a
 * migration-chain guarantee `defineFormat` no longer makes; see
 * `CHUNK_FORMAT_V1` below for what actually carries an old save forward now.
 *
 * Light is deliberately absent. `src/domain/light.ts` owns two grids and neither is
 * persisted — mc-save's DN-6 records that the reference recomputed them on load
 * (`chunk-manager-ops-storage.ts:61`) and that decision is kept: the grids are a
 * pure function of the blocks, and a persisted derivative is a second source of
 * truth that can disagree with the first.
 */
/**
 * The widened format's version: one past `FIRST_VERSION` (1), which
 * `CHUNK_FORMAT_V1` below still owns. Written as a literal rather than
 * `FIRST_VERSION + 1` because a save format's version is a fixed identity,
 * not a computed value — the day a v3 exists, this becomes its own literal
 * `3`, not an expression chained off `FIRST_VERSION`.
 */
const CHUNK_FORMAT_VERSION = 2

export const CHUNK_FORMAT: SaveFormat<PersistableChunk, ChunkEncoded> = defineFormat({
  name: CHUNK_FORMAT_NAME,
  schema: CHUNK_SCHEMA,
  version: CHUNK_FORMAT_VERSION,
})

/**
 * The pre-widening domain shape: `PersistableChunk` with `blocks` narrowed
 * back to the `Uint8Array` a v1 save actually decodes to.
 */
type PersistableChunkV1 = Omit<PersistableChunk, 'blocks'> & { readonly blocks: Uint8Array }

const PersistableChunkV1Schema = Schema.declare(
  (value: unknown): value is PersistableChunkV1 => typeof value === 'object' && value !== null,
)

const ChunkSchemaV1 = Schema.transform(CHUNK_STRUCT_V1, PersistableChunkV1Schema, {
  decode: (chunk) => chunk,
  encode: (chunk) => ({
    biomes: chunk.biomes,
    blocks: chunk.blocks,
    coord: chunk.coord,
    endFeatureIds: chunk.endFeatureIds ?? [],
    endFeatureMarkers: chunk.endFeatureMarkers ?? [],
    naturalStructureIds: chunk.naturalStructureIds ?? [],
    naturalStructureMarkers: chunk.naturalStructureMarkers ?? [],
  }),
})

type ChunkEncodedV1 = Schema.Schema.Encoded<typeof CHUNK_STRUCT_V1>

const CHUNK_SCHEMA_V1: Schema.Schema<PersistableChunkV1, ChunkEncodedV1> = ChunkSchemaV1

/**
 * Version 1, the pre-widening format, kept forever as a READ path.
 *
 * Never used with `encodeSave`/`saveTo` — nothing in this package writes a v1
 * envelope again. `application/chunk-persistence.ts` hands this to mc-save's
 * `loadFrom` only when a stored envelope's own `version` field names 1, then
 * widens the result with `migrateChunkV1ToV2` before handing it to a caller
 * that only ever sees the current `Chunk` shape.
 */
export const CHUNK_FORMAT_V1: SaveFormat<PersistableChunkV1, ChunkEncodedV1> = defineFormat({
  name: CHUNK_FORMAT_NAME,
  schema: CHUNK_SCHEMA_V1,
  version: FIRST_VERSION,
})

/**
 * The consumer-side upgrade mc-save does not provide (see `CHUNK_FORMAT`'s
 * comment above and mc-save's `test/migration.test.ts`, which documents
 * `decodeSave` refusing every non-current version unconditionally and states
 * the upgrade is the consumer's to assemble). A v1 block id is a byte,
 * 0-255 — already inside `[0, BLOCK_ID_MAX]` — so widening the container
 * loses nothing: every legacy id is representable as itself in the v2 range.
 */
export const migrateChunkV1ToV2 = (chunk: PersistableChunkV1): PersistableChunk => ({
  ...chunk,
  blocks: Uint16Array.from(chunk.blocks),
})
