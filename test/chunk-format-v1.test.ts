/**
 * `CHUNK_FORMAT_V1` and `migrateChunkV1ToV2` — `domain/chunk-format.ts`'s read
 * path for a world saved before the block buffer widened from one byte per
 * block to two.
 *
 * ---------------------------------------------------------------------------
 * Why this is a SEPARATE fixture from `chunk-format.test.ts`'s `ENCODED`
 * ---------------------------------------------------------------------------
 *
 * `ENCODED` there is built by `encodeSave(CHUNK_FORMAT, FIXTURE)` — it is
 * ALREADY a v2 payload, and nothing in this package encodes a v1 payload
 * again (`CHUNK_FORMAT_V1`'s own doc comment says so). A v1 fixture has to be
 * hand-authored in its wire shape instead, exactly as mc-save's own
 * `test/migration.test.ts` does for its toy chunk format: "Nothing here
 * passes through... keeps it independent of any schema this file also uses
 * to read it back."
 *
 * ---------------------------------------------------------------------------
 * What mc-save actually guarantees here, read first
 * ---------------------------------------------------------------------------
 *
 * mc-save's `decodeSave` refuses any envelope whose version is not the
 * format's own — unconditionally, including older ones. CF-V1-1 below pins
 * that `CHUNK_FORMAT` (v2) refuses this v1 envelope directly; CF-V1-2 through
 * CF-V1-4 build and check the consumer-side path
 * `application/chunk-persistence.ts` actually uses: decode under
 * `CHUNK_FORMAT_V1`, widen with `migrateChunkV1ToV2`, then treat the result as
 * an ordinary current-format `Chunk`.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { CHUNK_BIOME_COUNT, CHUNK_FORMAT, CHUNK_FORMAT_NAME, CHUNK_FORMAT_V1, migrateChunkV1ToV2 } from '../src/domain/chunk-format'
import { CHUNK_VOLUME } from '../src/domain/constants'
import { chunkCoord } from '@nerima-games/mc-kernel'
import { decodeSave, encodeSave, saveEnvelope } from '@nerima-games/mc-save'

/**
 * A v1 block buffer as an earlier build actually wrote one: one byte per
 * block, base64 on the wire. Not degenerate (docs/testing.md §6) and pinned
 * at the v1 ceiling (255) at a known index, so migration is checked against a
 * value the widened container can also hold, not just against zeros.
 */
const legacyBlocks = new Uint8Array(CHUNK_VOLUME)
legacyBlocks[0] = 1
legacyBlocks[1] = 255
legacyBlocks[2] = 44

const legacyPayload = {
  biomes: Array.from({ length: CHUNK_BIOME_COUNT }, () => 'PLAINS' as const),
  blocks: Buffer.from(legacyBlocks).toString('base64'),
  coord: { cx: 2, cz: -3 },
}

const legacyEnvelope = saveEnvelope(CHUNK_FORMAT_NAME, CHUNK_FORMAT_V1.version, legacyPayload)

describe('CHUNK_FORMAT_V1: the pre-widening format, read-only', () => {
  it('CF-V1-0: is the same format name as the current format, at version 1', () => {
    expect(CHUNK_FORMAT_V1.name).toBe(CHUNK_FORMAT_NAME)
    expect(CHUNK_FORMAT_V1.name).toBe(CHUNK_FORMAT.name)
    expect(CHUNK_FORMAT_V1.version).toBe(1)
  })

  it.effect('CF-V1-1: the CURRENT format refuses a v1 envelope directly — there is no automatic upgrade', () =>
    Effect.gen(function* () {
      const failure = yield* Effect.flip(decodeSave(CHUNK_FORMAT, legacyEnvelope))

      expect(failure._tag).toBe('SaveDecodeError')
      expect(failure.version).toBe(1)
      expect(failure.reason).toContain('unsupported version')
    }),
  )

  it.effect('CF-V1-2: CHUNK_FORMAT_V1 decodes the v1 envelope as the pre-widening Uint8Array shape', () =>
    Effect.gen(function* () {
      const legacy = yield* decodeSave(CHUNK_FORMAT_V1, legacyEnvelope)

      expect(legacy.blocks).toBeInstanceOf(Uint8Array)
      expect(legacy.blocks.length).toBe(CHUNK_VOLUME)
      expect(legacy.blocks[0]).toBe(1)
      expect(legacy.blocks[1]).toBe(255)
      expect(legacy.blocks[2]).toBe(44)
      expect(legacy.coord).toStrictEqual(chunkCoord(2, -3))
      // Absent in `legacyPayload`, so `CHUNK_STRUCT_V1`'s defaults fill in —
      // the same optional-field behaviour CF-17 pins for the current struct.
      expect(legacy.naturalStructureIds).toStrictEqual([])
      expect(legacy.naturalStructureMarkers).toStrictEqual([])
    }),
  )

  it.effect('CF-V1-3: migrateChunkV1ToV2 widens every legacy id into the current Uint16Array shape, losing nothing', () =>
    Effect.gen(function* () {
      const legacy = yield* decodeSave(CHUNK_FORMAT_V1, legacyEnvelope)
      const migrated = migrateChunkV1ToV2(legacy)

      expect(migrated.blocks).toBeInstanceOf(Uint16Array)
      expect(migrated.blocks.length).toBe(legacy.blocks.length)
      expect([...migrated.blocks]).toStrictEqual([...legacy.blocks])
      expect(migrated.coord).toStrictEqual(legacy.coord)
      expect(migrated.biomes).toStrictEqual(legacy.biomes)
    }),
  )

  it.effect('CF-V1-4: the migrated chunk round-trips through the CURRENT format, stamped with its version', () =>
    Effect.gen(function* () {
      const legacy = yield* decodeSave(CHUNK_FORMAT_V1, legacyEnvelope)
      const migrated = migrateChunkV1ToV2(legacy)

      const envelope = yield* encodeSave(CHUNK_FORMAT, migrated)
      expect(envelope.version).toBe(CHUNK_FORMAT.version)
      expect(envelope.version).not.toBe(CHUNK_FORMAT_V1.version)

      const restored = yield* decodeSave(CHUNK_FORMAT, envelope)
      expect([...restored.blocks]).toStrictEqual([...migrated.blocks])
      expect(restored.coord).toStrictEqual(migrated.coord)
    }),
  )

  /**
   * The same length guard `chunk-format.test.ts` CF-5 pins for the current
   * format, exercised against `CHUNK_FORMAT_V1`'s own one-byte-per-block
   * length check — the branch nothing else in this file's fixture reaches,
   * since `legacyPayload` is always the correct `CHUNK_VOLUME` bytes.
   */
  it.effect('CF-V1-5: a wrong-sized v1 block buffer is refused, not silently accepted', () =>
    Effect.gen(function* () {
      const truncatedPayload = { ...legacyPayload, blocks: legacyPayload.blocks.slice(0, 8) }
      const truncatedEnvelope = saveEnvelope(CHUNK_FORMAT_NAME, CHUNK_FORMAT_V1.version, truncatedPayload)

      const failure = yield* Effect.flip(decodeSave(CHUNK_FORMAT_V1, truncatedEnvelope))

      expect(failure._tag).toBe('SaveDecodeError')
      const cause = String((failure as { readonly cause?: unknown }).cause ?? '')
      expect(cause).toContain(`expected ${String(CHUNK_VOLUME)} block bytes`)
    }),
  )

  /**
   * `CHUNK_FORMAT_V1`'s schema is bidirectional because every `Schema`
   * is — `application/chunk-persistence.ts` never calls its encode side, but
   * the definition still has one, and an untested encode function is a
   * silent way for a schema to be wrong. This checks the schema is
   * self-consistent, not that the application ever exercises this path.
   *
   * A terrain-only value (no `endFeatureIds`/`naturalStructureIds`/etc.),
   * not the already-decoded `legacy` from CF-V1-2 — that value's optional
   * fields are already defaulted to `[]` by `CHUNK_STRUCT_V1`'s decode, which
   * would only ever exercise the "already an array" half of encode's
   * `chunk.endFeatureIds ?? []` fallbacks, never the `undefined` half a real
   * terrain-only v1 chunk hits.
   */
  it.effect('CF-V1-6: the v1 schema round-trips through its own encode direction too', () =>
    Effect.gen(function* () {
      const terrainOnly = { biomes: legacyPayload.biomes, blocks: legacyBlocks, coord: chunkCoord(2, -3) }

      const reencoded = yield* encodeSave(CHUNK_FORMAT_V1, terrainOnly)
      expect(reencoded.version).toBe(CHUNK_FORMAT_V1.version)

      const restored = yield* decodeSave(CHUNK_FORMAT_V1, reencoded)
      expect([...restored.blocks]).toStrictEqual([...legacyBlocks])
      expect(restored.coord).toStrictEqual(terrainOnly.coord)
      // Absent on the way in, defaulted on the way back out.
      expect(restored.naturalStructureIds).toStrictEqual([])
    }),
  )
})
