/**
 * The chunk save format — `domain/chunk-format.ts`.
 *
 * ---------------------------------------------------------------------------
 * What has to be true of a save format, and why a round trip alone is not it
 * ---------------------------------------------------------------------------
 *
 * `decode(encode(x)) === x` is necessary and close to worthless on its own: it
 * is satisfied by a format whose encoded form is the value itself, which is
 * precisely the reference implementation's design and precisely the one
 * mc-save's `domain/envelope.ts` header exists to replace. So CF-1 is paired
 * here with claims a pass-through format would FAIL:
 *
 *   CF-2  the encoded payload is the WIRE shape — a base64 string, biome NAMES
 *         and plain numbers. A `Uint8Array` payload passes CF-1 and fails this.
 *   CF-3  the payload survives `JSON.parse(JSON.stringify(...))` and still
 *         decodes. This is the load-bearing test of the encoding decision
 *         mc-save's DN-6 asked for and `domain/chunk-format.ts` records; a
 *         `Schema.Uint8ArrayFromSelf` format passes CF-1 and comes back from
 *         JSON as `{"0":1,"1":2,...}`.
 *   CF-12 the fixture is not degenerate. A chunk of all air round-trips
 *         perfectly under a format that drops every byte it does not
 *         understand.
 *
 * ---------------------------------------------------------------------------
 * The length tests are the REGRESSION, and they are the reason for the file
 * ---------------------------------------------------------------------------
 *
 * `packages/world/application/chunk-manager-ops-storage.ts:47-50` in the
 * reference reads
 *
 *     "has invalid buffer length ... regenerating"
 *
 * — the only detection was a comparison against a hard-coded length, and the
 * only recovery was to DESTROY the player's chunk. CF-5 through CF-7 pin that a
 * wrong-sized payload is now a `SaveDecodeError` carrying the format, the
 * recorded version and both lengths. mc-save's own docs/design-notes.md DN-6
 * lists this as a regression test to write and assigns it to whoever defines
 * the format; this is that test.
 *
 * CF-6 is the direction that is easy to leave out and is the more dangerous of
 * the two: `readBlock` is TOTAL and answers `AIR_BLOCK_ID` past the end
 * (`domain/chunk.ts:51`), so a SHORT buffer produces no error anywhere — it
 * produces a world with the bottom missing. Nothing downstream can notice, so
 * the schema is the only place it can be caught.
 *
 * Regression names (docs/design-notes.md): worldgen-chunk-format-length,
 * worldgen-chunk-format-wire-shape.
 */
import { describe, expect, it } from '@effect/vitest'
import * as fc from 'fast-check'
import * as validated from './fixtures/validated-inputs'
import { Effect, Option, Result, Schema, SchemaIssue } from 'effect'
import { BIOMES, CHUNK_BIOMES } from '../src/domain/biome'
import {
  chunkIntegrityFailureFromSaveDecodeError,
  CHUNK_BIOME_COUNT,
  CHUNK_FORMAT,
  CHUNK_FORMAT_NAME,
  CHUNK_SCHEMA,
  chunkIntegrityMetadataFor,
  type ChunkIntegrityFailure,
  type ChunkIntegritySection,
  type ChunkEncoded,
} from '../src/domain/chunk-format'
import { CHUNK_VOLUME } from '../src/domain/constants'
import { endSurfaceHeightAt, generateEndChunk } from './helpers/unwrapped-worldgen'
import { AIR_BLOCK_ID, BLOCK_IDS, BLOCK_ID_MAX, blockTypeOfId } from '@nerima-games/mc-kernel'
import {
  BLOCK_STATE_CODEC_VERSION,
  decodeBlockState,
  defaultBlockState,
  encodeBlockState,
} from '@nerima-games/mc-kernel/domain/block-state'
import { withDefaultBlockStates } from '../src/domain/chunk'
import { END_FEATURE_BLOCK, type EndFeatureMarker } from '../src/domain/end-features'
import { planEndCityForRegion, type NaturalStructureChunk } from './helpers/unwrapped-worldgen'
import {
  decodeSave,
  encodeSave,
  SaveDecodeError,
  saveEnvelope,
  type SaveEnvelopeDraft,
} from '@nerima-games/mc-save'
import { generateChunk } from './helpers/unwrapped-worldgen'

const SEED = validated.noiseSeed(20260728)

/**
 * One generated chunk, at a coordinate with a NEGATIVE component.
 *
 * Negative on purpose: `chunkCoord` normalises `-0` (`mc-kernel:153`)
 * and a coordinate that only ever gets tested at the origin cannot show that the
 * sign survives base64's neighbours in the same struct.
 *
 * Memoised because a chunk is 64KB and docs/testing.md §6 says so.
 */
const FIXTURE = Result.getOrThrow(withDefaultBlockStates(generateChunk(SEED, validated.validatedChunkCoord(3, -5))))

/** The encoded payload of `FIXTURE`, built once and treated as read-only. */
const ENCODED: ChunkEncoded = Effect.runSync(
  Effect.map(encodeSave(CHUNK_FORMAT, FIXTURE), (envelope) => envelope.payload as ChunkEncoded),
)

const INTEGRITY_STRUCTURE_ID = 'integrity-0'
const INTEGRITY_MARKER: NaturalStructureChunk['naturalStructureMarkers'][number] = {
  structureId: INTEGRITY_STRUCTURE_ID,
  structureKind: 'village',
  kind: 'loot-chest',
  lootTable: 'village',
  ...validated.validatedBlockPosition(1, 64, 1),
}
const INTEGRITY_ENCODED: ChunkEncoded = Effect.runSync(
  Effect.map(encodeSave(CHUNK_FORMAT, {
    ...FIXTURE,
    naturalStructureIds: [INTEGRITY_STRUCTURE_ID],
    naturalStructureMarkers: [INTEGRITY_MARKER],
  }), (envelope) => envelope.payload as ChunkEncoded),
)

const integrityForMarkerData = (data: {
  readonly endFeatureIds: ReadonlyArray<string>
  readonly endFeatureMarkers: ReadonlyArray<EndFeatureMarker>
  readonly naturalStructureIds: ReadonlyArray<string>
  readonly naturalStructureMarkers: NaturalStructureChunk['naturalStructureMarkers']
}) => chunkIntegrityMetadataFor({
  biomes: FIXTURE.biomes,
  blockStates: FIXTURE.blockStates,
  blocks: FIXTURE.blocks,
  ...data,
})

type ChunkMetadataData = {
  readonly endFeatureIds: ReadonlyArray<string>
  readonly endFeatureMarkers: ReadonlyArray<EndFeatureMarker>
  readonly naturalStructureIds: ReadonlyArray<string>
  readonly naturalStructureMarkers: NaturalStructureChunk['naturalStructureMarkers']
}

const payloadWithMetadata = (patch: Partial<ChunkMetadataData>): ChunkEncoded => {
  const data: ChunkMetadataData = {
    endFeatureIds: patch.endFeatureIds ?? [],
    endFeatureMarkers: patch.endFeatureMarkers ?? [],
    naturalStructureIds: patch.naturalStructureIds ?? [],
    naturalStructureMarkers: patch.naturalStructureMarkers ?? [],
  }
  return {
    ...ENCODED,
    ...data,
    integrity: integrityForMarkerData(data),
  }
}

const MAX_CHUNK_PAYLOAD_BYTES = 1024 * 1024
const MAX_CHUNK_METADATA_ITEMS = 512
const MAX_CHUNK_METADATA_STRING_LENGTH = 256

const makeIdentifier = (prefix: string, index: number, length: number): string => {
  const stem = `${prefix}${index.toString(36).padStart(3, '0')}`
  return `${stem}${'x'.repeat(length - stem.length)}`
}

const largeMetadataData = (identifierLength: number): ChunkMetadataData => {
  const naturalStructureIds = Array.from({ length: MAX_CHUNK_METADATA_ITEMS }, (_, index) =>
    makeIdentifier('s', index, identifierLength),
  )
  const endFeatureIds = Array.from({ length: MAX_CHUNK_METADATA_ITEMS }, (_, index) =>
    makeIdentifier('e', index, identifierLength),
  )
  const naturalStructureMarkers = naturalStructureIds.slice(0, 400).map((structureId) => ({
    ...INTEGRITY_MARKER,
    structureId,
  }))
  const endFeatureMarkers: ReadonlyArray<EndFeatureMarker> = endFeatureIds.slice(0, 400).map((featureId) => ({
    at: validated.validatedBlockPosition(1, 64, 1),
    block: END_FEATURE_BLOCK.CRYSTAL,
    featureId,
    invulnerable: true,
    kind: 'end-crystal',
  }))
  return { endFeatureIds, endFeatureMarkers, naturalStructureIds, naturalStructureMarkers }
}

const largeMetadataPayload = (identifierLength: number): ChunkEncoded =>
  payloadWithMetadata(largeMetadataData(identifierLength))

const payloadAtByteLength = (byteLength: number): ChunkEncoded => {
  let minimumLength = 4
  let maximumLength = MAX_CHUNK_METADATA_STRING_LENGTH
  while (minimumLength < maximumLength) {
    const candidateLength = Math.ceil((minimumLength + maximumLength) / 2)
    const candidate = largeMetadataPayload(candidateLength)
    if (Buffer.byteLength(JSON.stringify(candidate), 'utf8') <= byteLength) {
      minimumLength = candidateLength
    } else {
      maximumLength = candidateLength - 1
    }
  }

  const baseData = largeMetadataData(minimumLength)
  const base = payloadWithMetadata(baseData)
  let remaining = byteLength - Buffer.byteLength(JSON.stringify(base), 'utf8')
  const naturalStructureIds = [...baseData.naturalStructureIds]
  const endFeatureIds = [...baseData.endFeatureIds]
  for (let index = 400; index < MAX_CHUNK_METADATA_ITEMS && remaining > 0; index += 1) {
    const current = naturalStructureIds[index]
    if (current === undefined) {
      break
    }
    const additional = Math.min(MAX_CHUNK_METADATA_STRING_LENGTH - current.length, remaining)
    naturalStructureIds[index] = `${current}${'x'.repeat(additional)}`
    remaining -= additional
  }
  for (let index = 400; index < MAX_CHUNK_METADATA_ITEMS && remaining > 0; index += 1) {
    const current = endFeatureIds[index]
    if (current === undefined) {
      break
    }
    const additional = Math.min(MAX_CHUNK_METADATA_STRING_LENGTH - current.length, remaining)
    endFeatureIds[index] = `${current}${'x'.repeat(additional)}`
    remaining -= additional
  }

  expect(remaining).toBe(0)
  return payloadWithMetadata({
    endFeatureIds,
    endFeatureMarkers: baseData.endFeatureMarkers,
    naturalStructureIds,
    naturalStructureMarkers: baseData.naturalStructureMarkers,
  })
}

/** An envelope carrying `ENCODED` with one field replaced. */
const envelopeWith = (patch: Partial<ChunkEncoded>) =>
  saveEnvelope(validated.saveFormatName(CHUNK_FORMAT_NAME), CHUNK_FORMAT.version, { ...ENCODED, ...patch })

type DecodeOutcome = {
  readonly _tag: 'Refused' | 'Accepted'
  readonly detail: string
  readonly cause: string
  readonly integrityFailure: Option.Option<ChunkIntegrityFailure>
}

/** Keep unexpected successes small so failures do not print the full chunk buffers. */
const decodeOutcome = (envelope: SaveEnvelopeDraft): Effect.Effect<DecodeOutcome> =>
  Effect.match(decodeSave(CHUNK_FORMAT, envelope), {
    onFailure: (error): DecodeOutcome => ({
      _tag: 'Refused',
      detail: `${error._tag}: ${error.message}`,
      cause: String((error as { readonly cause?: unknown }).cause ?? ''),
      integrityFailure: chunkIntegrityFailureFromSaveDecodeError(error),
    }),
    onSuccess: (chunk): DecodeOutcome => ({
      _tag: 'Accepted',
      detail: `${String(chunk.blocks.length)} blocks, ${String(chunk.biomes.length)} biomes`,
      cause: '',
      integrityFailure: Option.none(),
    }),
  })

describe('untrusted chunk payload limits', () => {
  it.effect('accepts the total JSON payload limit and refuses the next byte', () =>
    Effect.gen(function* () {
      const atLimit = payloadAtByteLength(MAX_CHUNK_PAYLOAD_BYTES)
      expect(Buffer.byteLength(JSON.stringify(atLimit), 'utf8')).toBe(MAX_CHUNK_PAYLOAD_BYTES)

      const accepted = yield* decodeOutcome(envelopeWith(atLimit))
      expect(accepted._tag).toBe('Accepted')

      const naturalStructureIds = [...(atLimit.naturalStructureIds ?? [])]
      const fillerIndex = naturalStructureIds.findIndex(
        (id, index) => index >= 400 && id.length < MAX_CHUNK_METADATA_STRING_LENGTH,
      )
      expect(fillerIndex).toBeGreaterThanOrEqual(400)
      const fillerId = naturalStructureIds[fillerIndex]
      if (fillerId === undefined) throw new Error('the byte-limit fixture has no expandable identifier')
      naturalStructureIds[fillerIndex] = `${fillerId}x`
      const overLimit = { ...atLimit, naturalStructureIds }
      expect(Buffer.byteLength(JSON.stringify(overLimit), 'utf8')).toBe(MAX_CHUNK_PAYLOAD_BYTES + 1)

      const refused = yield* decodeOutcome(envelopeWith(overLimit))
      expect(refused._tag).toBe('Refused')
      expect(refused.detail).toContain('SaveDecodeError')
      expect(refused.cause).toContain(`expected at most ${String(MAX_CHUNK_PAYLOAD_BYTES)} chunk payload bytes`)
    }),
  )

  it.effect('accepts each metadata array at its item limit and refuses one additional item', () =>
    Effect.gen(function* () {
      const ids = Array.from({ length: MAX_CHUNK_METADATA_ITEMS }, (_, index) => `id-${String(index)}`)
      const overIds = [...ids, 'one-over']
      const firstId = 'id-0'
      const endMarker = (featureId: string): EndFeatureMarker => ({
        at: validated.validatedBlockPosition(1, 64, 1),
        block: END_FEATURE_BLOCK.CRYSTAL,
        featureId,
        invulnerable: true,
        kind: 'end-crystal',
      })
      const naturalMarkers = ids.map((structureId) => ({ ...INTEGRITY_MARKER, structureId }))
      const endMarkers = ids.map(endMarker)
      const fields: ReadonlyArray<{
        readonly name: string
        readonly atLimit: Partial<ChunkMetadataData>
        readonly overLimit: Partial<ChunkMetadataData>
      }> = [
        { name: 'endFeatureIds', atLimit: { endFeatureIds: ids }, overLimit: { endFeatureIds: overIds } },
        { name: 'naturalStructureIds', atLimit: { naturalStructureIds: ids }, overLimit: { naturalStructureIds: overIds } },
        { name: 'endFeatureMarkers', atLimit: { endFeatureIds: ids, endFeatureMarkers: endMarkers }, overLimit: { endFeatureIds: ids, endFeatureMarkers: [...endMarkers, endMarker(firstId)] } },
        { name: 'naturalStructureMarkers', atLimit: { naturalStructureIds: ids, naturalStructureMarkers: naturalMarkers }, overLimit: { naturalStructureIds: ids, naturalStructureMarkers: [...naturalMarkers, { ...INTEGRITY_MARKER, structureId: firstId }] } },
      ]

      for (const field of fields) {
        const accepted = yield* decodeOutcome(envelopeWith(payloadWithMetadata(field.atLimit)))
        expect(accepted._tag, `${field.name} at limit`).toBe('Accepted')

        const refused = yield* decodeOutcome(envelopeWith(payloadWithMetadata(field.overLimit)))
        expect(refused._tag, `${field.name} one over`).toBe('Refused')
        expect(refused.detail).toContain('SaveDecodeError')
      }
    }),
  )

  it.effect('accepts 256-character identifiers and refuses 257 characters in id arrays and markers', () =>
    Effect.gen(function* () {
      const atLimit = 'i'.repeat(MAX_CHUNK_METADATA_STRING_LENGTH)
      const overLimit = `${atLimit}i`
      const endMarker = (featureId: string): EndFeatureMarker => ({
        at: validated.validatedBlockPosition(1, 64, 1),
        block: END_FEATURE_BLOCK.CRYSTAL,
        featureId,
        invulnerable: true,
        kind: 'end-crystal',
      })
      const naturalMarker = (structureId: string) => ({ ...INTEGRITY_MARKER, structureId })
      const cases = [
        { atLimit: payloadWithMetadata({ endFeatureIds: [atLimit] }), overLimit: payloadWithMetadata({ endFeatureIds: [overLimit] }) },
        { atLimit: payloadWithMetadata({ naturalStructureIds: [atLimit] }), overLimit: payloadWithMetadata({ naturalStructureIds: [overLimit] }) },
        { atLimit: payloadWithMetadata({ endFeatureIds: [atLimit], endFeatureMarkers: [endMarker(atLimit)] }), overLimit: payloadWithMetadata({ endFeatureIds: [overLimit], endFeatureMarkers: [endMarker(overLimit)] }) },
        { atLimit: payloadWithMetadata({ naturalStructureIds: [atLimit], naturalStructureMarkers: [naturalMarker(atLimit)] }), overLimit: payloadWithMetadata({ naturalStructureIds: [overLimit], naturalStructureMarkers: [naturalMarker(overLimit)] }) },
      ]

      for (const value of cases) {
        expect((yield* decodeOutcome(envelopeWith(value.atLimit)))._tag).toBe('Accepted')
        const refused = yield* decodeOutcome(envelopeWith(value.overLimit))
        expect(refused._tag).toBe('Refused')
        expect(refused.detail).toContain('SaveDecodeError')
        expect(refused.cause).toContain('identifier characters')
      }
    }),
  )

  it.effect('checks base64 string lengths before expanding block and state buffers', () =>
    Effect.gen(function* () {
      expect((yield* decodeOutcome(envelopeWith({ blocks: ENCODED.blocks })))._tag).toBe('Accepted')
      expect((yield* decodeOutcome(envelopeWith({ blockStates: ENCODED.blockStates })))._tag).toBe('Accepted')

      const oversizedBlocks = yield* decodeOutcome(envelopeWith({ blocks: `${ENCODED.blocks}A` }))
      expect(oversizedBlocks._tag).toBe('Refused')
      expect(oversizedBlocks.cause).toContain('base64 characters')

      const oversizedStates = yield* decodeOutcome(envelopeWith({ blockStates: `${ENCODED.blockStates}A` }))
      expect(oversizedStates._tag).toBe('Refused')
      expect(oversizedStates.cause).toContain('base64 characters')
    }),
  )

  it.effect('caps integrity checksum strings at the encoded checksum width', () =>
    Effect.gen(function* () {
      const sections = ENCODED.integrity.sections
      const checksum = sections.blocks.checksum
      expect(checksum).toHaveLength(8)
      const oversizedIntegrity = {
        ...ENCODED.integrity,
        sections: {
          ...sections,
          blocks: { ...sections.blocks, checksum: `${checksum}x` },
        },
      }

      const accepted = yield* decodeOutcome(envelopeWith({ integrity: ENCODED.integrity }))
      expect(accepted._tag).toBe('Accepted')

      const refused = yield* decodeOutcome(envelopeWith({ integrity: oversizedIntegrity }))
      expect(refused._tag).toBe('Refused')
      expect(refused.detail).toContain('SaveDecodeError')
      expect(refused.cause).toContain('checksum characters')
    }),
  )

  it.effect('accepts exactly 256 biome columns and refuses one more', () =>
    Effect.gen(function* () {
      expect(ENCODED.biomes).toHaveLength(CHUNK_BIOME_COUNT)
      expect((yield* decodeOutcome(envelopeWith({ biomes: ENCODED.biomes })))._tag).toBe('Accepted')

      const overLimit = yield* decodeOutcome(envelopeWith({ biomes: [...ENCODED.biomes, 'PLAINS'] }))
      expect(overLimit._tag).toBe('Refused')
      expect(overLimit.detail).toContain('SaveDecodeError')
    }),
  )
})

describe('the chunk format round-trips', () => {
  it.effect('CF-1: a generated chunk survives encode then decode, byte for byte', () =>
    Effect.gen(function* () {
      const envelope = yield* encodeSave(CHUNK_FORMAT, FIXTURE)
      const restored = yield* decodeSave(CHUNK_FORMAT, envelope)

      expect(restored.coord).toStrictEqual(FIXTURE.coord)
      expect(restored.biomes).toStrictEqual(FIXTURE.biomes)
      // Compared as arrays rather than with `toStrictEqual` on the typed array,
      // so a failure prints the first differing INDEX instead of 64KB of hex.
      expect(restored.blocks.length).toBe(FIXTURE.blocks.length)
      const differing = [...FIXTURE.blocks].findIndex((value, index) => restored.blocks[index] !== value)
      expect(differing).toBe(-1)
      expect(restored.blockStates).toStrictEqual(FIXTURE.blockStates)
    }),
  )

  it.effect('CF-2: the encoded payload is the WIRE shape, not the value', () =>
    Effect.gen(function* () {
      const envelope = yield* encodeSave(CHUNK_FORMAT, FIXTURE)
      const payload = envelope.payload as ChunkEncoded

      // A base64 string, not a Uint16Array and not a 65,536-element array.
      // This is the whole of `domain/chunk-format.ts`'s DN-6 decision, asserted.
      expect(typeof payload.blocks).toBe('string')
      expect(payload.blocks).toMatch(/^[A-Za-z0-9+/]*={0,2}$/u)
      // The v2 widened block buffer stays two bytes per cell.
      expect(payload.blocks.length).toBe(174_764)
      expect(typeof payload.blockStates).toBe('string')
      expect(payload.blockStates).toMatch(/^[A-Za-z0-9+/]*={0,2}$/u)
      expect(payload.blockStates.length).toBe(349_528)
      expect(payload.blockStateCodecVersion).toBe(BLOCK_STATE_CODEC_VERSION)

      // Biome NAMES, so reordering `BIOMES` cannot corrupt a save.
      expect(payload.biomes.every((biome) => (BIOMES as ReadonlyArray<string>).includes(biome))).toBe(true)

      // Plain numbers: the brand is a compile-time fact and must not reach the
      // wire, or the save file would depend on `effect`'s runtime.
      expect(payload.coord).toStrictEqual({ cx: 3, cz: -5 })
    }),
  )

  it.effect('CF-2a: a non-default kernel state round-trips in four little-endian bytes', () =>
    Effect.gen(function* () {
      const stairsId = BLOCK_IDS.find((blockId) => {
        const blockType = blockTypeOfId(blockId)
        return Result.isSuccess(blockType) && blockType.success === 'oak_stairs'
      })
      expect(stairsId).toBeDefined()
      if (stairsId === undefined) {
        return
      }

      const defaultState = defaultBlockState(stairsId)
      expect(Result.isSuccess(defaultState)).toBe(true)
      if (Result.isFailure(defaultState)) {
        return
      }
      const encodedState = encodeBlockState(stairsId, { ...defaultState.success, facing: 'south' })
      expect(Result.isSuccess(encodedState)).toBe(true)
      if (Result.isFailure(encodedState)) {
        return
      }

      const blocks = Uint16Array.from(FIXTURE.blocks)
      blocks[0] = stairsId
      const blockStates = Uint32Array.from(FIXTURE.blockStates)
      blockStates[0] = encodedState.success
      const chunk = { ...FIXTURE, blocks, blockStates }
      const envelope = yield* encodeSave(CHUNK_FORMAT, chunk)
      const payload = envelope.payload as ChunkEncoded
      const wireBytes = Buffer.from(payload.blockStates, 'base64')

      expect(encodedState.success).toBeGreaterThan(0)
      expect([...wireBytes.subarray(0, 4)]).toStrictEqual([
        encodedState.success & 0xff,
        (encodedState.success >>> 8) & 0xff,
        (encodedState.success >>> 16) & 0xff,
        (encodedState.success >>> 24) & 0xff,
      ])
      const restored = yield* decodeSave(CHUNK_FORMAT, envelope)
      expect(restored.blockStates[0]).toBe(encodedState.success)
    }),
  )

  it('CF-2b: encoding a generated chunk materializes omitted default states', () => {
    const generated = generateChunk(SEED, validated.validatedChunkCoord(6, -2))
    const encoded = Schema.encodeUnknownResult(CHUNK_SCHEMA)(generated)
    expect(Result.isSuccess(encoded)).toBe(true)
    if (Result.isFailure(encoded)) {
      return
    }

    const restored = Schema.decodeUnknownResult(CHUNK_SCHEMA)(encoded.success)
    expect(Result.isSuccess(restored)).toBe(true)
    if (Result.isFailure(restored)) {
      return
    }
    expect(restored.success.blockStates.length).toBe(CHUNK_VOLUME)
    expect([...restored.success.blockStates]).toStrictEqual(new Array(CHUNK_VOLUME).fill(0))
  })

  it('CF-2c: encoding accepts undefined states and rejects malformed stateful chunks', () => {
    const generated = generateChunk(SEED, validated.validatedChunkCoord(6, -3))
    const encodedUndefinedStates = Schema.encodeUnknownResult(CHUNK_SCHEMA)({ ...generated, blockStates: undefined })
    expect(Result.isSuccess(encodedUndefinedStates)).toBe(true)

    const malformedBlocks = Schema.encodeUnknownResult(CHUNK_SCHEMA)({
      ...FIXTURE,
      blocks: new Uint8Array(CHUNK_VOLUME),
    })
    expect(Result.isFailure(malformedBlocks)).toBe(true)

    const nullStates = Schema.encodeUnknownResult(CHUNK_SCHEMA)({ ...FIXTURE, blockStates: null })
    expect(Result.isFailure(nullStates)).toBe(true)

    const unknownBlockIds = Uint16Array.from(generated.blocks)
    unknownBlockIds[0] = BLOCK_ID_MAX
    const unknownDefault = Schema.encodeUnknownResult(CHUNK_SCHEMA)({
      ...generated,
      blocks: unknownBlockIds,
      blockStates: undefined,
    })
    expect(Result.isFailure(unknownDefault)).toBe(true)
  })

  it('canonicalizes marker objects and JSON scalar edge cases before checksumming', () => {
    const unicodeMarker = { ...INTEGRITY_MARKER, structureId: '雪村' }
    const reorderedUnicodeMarker = {
      z: unicodeMarker.z,
      y: unicodeMarker.y,
      x: unicodeMarker.x,
      lootTable: unicodeMarker.lootTable,
      kind: unicodeMarker.kind,
      structureKind: unicodeMarker.structureKind,
      structureId: unicodeMarker.structureId,
    } satisfies NaturalStructureChunk['naturalStructureMarkers'][number]

    const canonical = integrityForMarkerData({
      endFeatureIds: [],
      endFeatureMarkers: [],
      naturalStructureIds: ['雪村'],
      naturalStructureMarkers: [unicodeMarker],
    })
    const reordered = integrityForMarkerData({
      endFeatureIds: [],
      endFeatureMarkers: [],
      naturalStructureIds: ['雪村'],
      naturalStructureMarkers: [reorderedUnicodeMarker],
    })
    expect(reordered.sections.structureMarkers).toStrictEqual(canonical.sections.structureMarkers)

    const nullScalar = integrityForMarkerData({
      endFeatureIds: [null as unknown as string],
      endFeatureMarkers: [],
      naturalStructureIds: [],
      naturalStructureMarkers: [],
    })
    expect(nullScalar.sections.structureMarkers.byteLength).toBeGreaterThan(0)

    const position = validated.validatedBlockPosition(1, 64, 1)
    const nonFiniteMarker: EndFeatureMarker = {
      kind: 'end-crystal-cage',
      featureId: 'non-finite-radius',
      center: position,
      radius: Number.NaN,
      minY: position.y,
      maxY: position.y,
      material: 'iron_bars',
    }
    const nonFinite = integrityForMarkerData({
      endFeatureIds: [],
      endFeatureMarkers: [nonFiniteMarker],
      naturalStructureIds: [],
      naturalStructureMarkers: [],
    })
    expect(nonFinite.sections.structureMarkers.byteLength).toBeGreaterThan(0)
  })

  it.effect('CF-3: the payload survives JSON and still decodes', () =>
    Effect.gen(function* () {
      const envelope = yield* encodeSave(CHUNK_FORMAT, FIXTURE)

      // The claim mc-save's DN-6 says must be decided before the schema is
      // written: this format does NOT require structured clone. A JSON round
      // trip is the strictly harder medium, and passing it means an export
      // file, a network message and IndexedDB all work.
      const throughJson: unknown = JSON.parse(JSON.stringify(envelope))
      const restored = yield* decodeSave(CHUNK_FORMAT, throughJson as typeof envelope)

      expect(restored.coord).toStrictEqual(FIXTURE.coord)
      const differing = [...FIXTURE.blocks].findIndex((value, index) => restored.blocks[index] !== value)
      expect(differing).toBe(-1)
      expect(restored.blockStates).toStrictEqual(FIXTURE.blockStates)
    }),
  )

  it.effect('CF-4: the envelope is stamped with the format name and current version', () =>
    Effect.gen(function* () {
      const envelope = yield* encodeSave(CHUNK_FORMAT, FIXTURE)

      expect(envelope.format).toBe('@nerima-games/mc-worldgen/chunk')
      expect(envelope.version).toBe(3)
    }),
  )

  it.effect('CF-24: v3 refuses payloads without section integrity metadata', () =>
    Effect.gen(function* () {
      const payload: Record<string, unknown> = { ...ENCODED }
      delete payload['integrity']
      const envelope = saveEnvelope(validated.saveFormatName(CHUNK_FORMAT_NAME), CHUNK_FORMAT.version, payload)
      const outcome = yield* decodeOutcome(envelope)

      expect(outcome._tag).toBe('Refused')
      expect(outcome.detail).toContain('SaveDecodeError')
      expect(outcome.cause).toContain('integrity')
    }),
  )

  it('CF-12: the fixture is not degenerate, so CF-1 is not vacuous', () => {
    // A chunk of one repeated byte round-trips under a format that has thrown
    // information away. docs/testing.md §6 「空虚な成功を防ぐ」.
    expect(new Set(FIXTURE.blocks).size).toBeGreaterThan(1)
    expect(new Set(FIXTURE.biomes).size).toBeGreaterThanOrEqual(1)
    expect(FIXTURE.blocks.length).toBe(CHUNK_VOLUME)
    expect(FIXTURE.biomes.length).toBe(CHUNK_BIOME_COUNT)
  })

  it('CF-21: every registered block has a default state code of zero', () => {
    const defaultsEncodeToZero = BLOCK_IDS.every((blockId) => {
      const defaultState = defaultBlockState(blockId)
      if (Result.isFailure(defaultState)) {
        return false
      }
      const encoded = encodeBlockState(blockId, defaultState.success)
      return Result.isSuccess(encoded) && encoded.success === 0
    })

    expect(defaultsEncodeToZero).toBe(true)
  })

  it.effect('CF-17: a minimal current-format payload without structure metadata decodes with empty arrays', () =>
    Effect.gen(function* () {
      // Not to be confused with `CHUNK_FORMAT_V1` (`chunk-format-v1.test.ts`):
      // this "minimal" is about OPTIONAL FIELDS within one struct shape
      // (`endFeatureIds`/`naturalStructureIds` etc. absent, defaulting to
      // `[]`), not about the retired one-byte-per-block wire width.
      const minimalPayload = {
        coord: ENCODED.coord,
        blocks: ENCODED.blocks,
        biomes: ENCODED.biomes,
        blockStateCodecVersion: ENCODED.blockStateCodecVersion,
        blockStates: ENCODED.blockStates,
        integrity: ENCODED.integrity,
      }
      const restored = yield* decodeSave(
        CHUNK_FORMAT,
        saveEnvelope(validated.saveFormatName(CHUNK_FORMAT_NAME), CHUNK_FORMAT.version, minimalPayload),
      )

      expect(restored.naturalStructureIds).toStrictEqual([])
      expect(restored.naturalStructureMarkers).toStrictEqual([])
    }),
  )

  it.effect('CF-18: an End city chunk preserves structure ids and every marker field', () =>
    Effect.gen(function* () {
      const seed = validated.noiseSeed(1)
      const planOption = planEndCityForRegion(seed, -12, -7, (x, z) => endSurfaceHeightAt(seed, x, z))
      if (Option.isNone(planOption)) throw new Error('expected the known End city candidate to fit real terrain')
      const plan = planOption.value
      const marker = plan.markers[0]
      if (marker === undefined) throw new Error('expected the End city plan to contain markers')
      const chunk = generateEndChunk(
        seed,
        validated.validatedChunkCoord(Math.floor(marker.x / 16), Math.floor(marker.z / 16)),
      )
      const chunkWithStates = Result.getOrThrow(withDefaultBlockStates(chunk))

      expect(chunk.naturalStructureIds).toContain(plan.id)
      expect(chunk.naturalStructureMarkers.length).toBeGreaterThan(0)

      const envelope = yield* encodeSave(CHUNK_FORMAT, chunkWithStates)
      const restored = yield* decodeSave(CHUNK_FORMAT, envelope)

      expect(restored).toStrictEqual(chunkWithStates)
    }),
  )

  it.effect('CF-19: a desert-pyramid chunk preserves its loot marker kind and table', () =>
    Effect.gen(function* () {
      const structureId = 'desert-pyramid:1:0:0'
      const marker: NaturalStructureChunk['naturalStructureMarkers'][number] = {
        structureId,
        structureKind: 'desert-pyramid',
        kind: 'loot-chest',
        lootTable: 'desert-pyramid',
        ...validated.validatedBlockPosition(2, 70, 3),
      }
      const chunk = {
        ...generateChunk(SEED, validated.validatedChunkCoord(0, 0)),
        endFeatureIds: [],
        endFeatureMarkers: [],
        naturalStructureIds: [structureId],
        naturalStructureMarkers: [marker],
      }
      const chunkWithStates = Result.getOrThrow(withDefaultBlockStates(chunk))

      const envelope = yield* encodeSave(CHUNK_FORMAT, chunkWithStates)
      const restored = yield* decodeSave(CHUNK_FORMAT, envelope)

      expect(restored).toStrictEqual(chunkWithStates)
    }),
  )

  it.effect('CF-20: igloo, jungle-pyramid, mineshaft, ocean-monument, ocean-ruin, pillager-outpost, shipwreck, bastion-remnant, and stronghold chunks preserve their semantic markers', () =>
    Effect.gen(function* () {
      const structureId = 'igloo:1:0:0'
      const junglePyramidStructureId = 'jungle-pyramid:1:0:0'
      const mineshaftStructureId = 'mineshaft:1:0:0'
      const oceanMonumentStructureId = 'ocean-monument:1:0:0'
      const oceanStructureId = 'ocean-ruin:1:0:0'
      const outpostStructureId = 'pillager-outpost:1:0:0'
      const shipwreckStructureId = 'shipwreck:1:0:0'
      const bastionRemnantStructureId = 'bastion-remnant:1:0:0'
      const strongholdStructureId = 'stronghold:1:0:0'
      const markers: NaturalStructureChunk['naturalStructureMarkers'] = [
        {
          structureId,
          structureKind: 'igloo',
          kind: 'loot-chest',
          lootTable: 'igloo',
          ...validated.validatedBlockPosition(2, 70, 3),
        },
        {
          structureId,
          structureKind: 'igloo',
          kind: 'entity-spawn',
          entity: 'zombie-villager',
          ...validated.validatedBlockPosition(1, 70, 1),
        },
        {
          structureId: junglePyramidStructureId,
          structureKind: 'jungle-pyramid',
          kind: 'loot-chest',
          lootTable: 'jungle-pyramid',
          ...validated.validatedBlockPosition(2, 67, 2),
        },
        {
          structureId: mineshaftStructureId,
          structureKind: 'mineshaft',
          kind: 'loot-chest',
          lootTable: 'mineshaft',
          ...validated.validatedBlockPosition(3, 53, 4),
        },
        {
          structureId: oceanMonumentStructureId,
          structureKind: 'ocean-monument',
          kind: 'loot-chest',
          lootTable: 'ocean-monument',
          ...validated.validatedBlockPosition(4, 53, 4),
        },
        {
          structureId: bastionRemnantStructureId,
          structureKind: 'bastion-remnant',
          kind: 'loot-chest',
          lootTable: 'bastion-remnant',
          ...validated.validatedBlockPosition(5, 50, 5),
        },
        {
          structureId: bastionRemnantStructureId,
          structureKind: 'bastion-remnant',
          kind: 'entity-spawn',
          entity: 'piglin',
          ...validated.validatedBlockPosition(6, 49, 5),
        },
        {
          structureId: bastionRemnantStructureId,
          structureKind: 'bastion-remnant',
          kind: 'entity-spawn',
          entity: 'piglin-brute',
          ...validated.validatedBlockPosition(4, 49, 5),
        },
        {
          structureId: strongholdStructureId,
          structureKind: 'stronghold',
          kind: 'end-portal-frame',
          facing: 'north',
          eye: true,
          ...validated.validatedBlockPosition(7, 30, 7),
        },
        {
          structureId: oceanStructureId,
          structureKind: 'ocean-ruin',
          kind: 'loot-chest',
          lootTable: 'ocean-ruin',
          ...validated.validatedBlockPosition(4, 56, 4),
        },
        {
          structureId: outpostStructureId,
          structureKind: 'pillager-outpost',
          kind: 'loot-chest',
          lootTable: 'pillager-outpost',
          ...validated.validatedBlockPosition(0, 73, 1),
        },
        {
          structureId: outpostStructureId,
          structureKind: 'pillager-outpost',
          kind: 'entity-spawn',
          entity: 'pillager',
          ...validated.validatedBlockPosition(1, 73, 1),
        },
        {
          structureId: shipwreckStructureId,
          structureKind: 'shipwreck',
          kind: 'loot-chest',
          lootTable: 'shipwreck',
          ...validated.validatedBlockPosition(4, 59, 0),
        },
      ]
      const chunk = {
        ...generateChunk(SEED, validated.validatedChunkCoord(0, 0)),
        endFeatureIds: [],
        endFeatureMarkers: [],
        naturalStructureIds: [structureId, junglePyramidStructureId, mineshaftStructureId, oceanMonumentStructureId, bastionRemnantStructureId, strongholdStructureId, oceanStructureId, outpostStructureId, shipwreckStructureId],
        naturalStructureMarkers: markers,
      }
      const chunkWithStates = Result.getOrThrow(withDefaultBlockStates(chunk))

      const envelope = yield* encodeSave(CHUNK_FORMAT, chunkWithStates)
      const restored = yield* decodeSave(CHUNK_FORMAT, envelope)

      expect(restored).toStrictEqual(chunkWithStates)
    }),
  )
})

describe('a wrong-sized payload is refused rather than regenerated', () => {
  /**
   * REGRESSION — reference `chunk-manager-ops-storage.ts:47-50`, which logged
   * "has invalid buffer length ... regenerating" and discarded the chunk.
   */
  it.effect('CF-5: a TRUNCATED block buffer fails with the recorded version and both lengths', () =>
    Effect.gen(function* () {
      const outcome = yield* decodeOutcome(envelopeWith({ blocks: ENCODED.blocks.slice(0, 400) }))

      expect(outcome._tag).toBe('Refused')
      expect(outcome.detail).toContain('@nerima-games/mc-worldgen/chunk')
      expect(outcome.detail).toContain('v3')
      // The two lengths ride in the ParseError carried as `cause`, which is
      // what makes this actionable rather than merely a refusal. 131,072 =
      // CHUNK_VOLUME * BYTES_PER_ELEMENT (2), the v2 wire width; 300 is
      // unchanged from v1 because a 400-character base64 prefix always
      // decodes to exactly 300 bytes (100 four-character groups), regardless
      // of how wide each stored element is.
      expect(outcome.cause).toContain('expected 131072 block bytes')
      expect(outcome.cause).toContain('received 300')
    }),
  )

  it.effect('CF-6: an oversized base64 block string fails before buffer expansion', () =>
    Effect.gen(function* () {
      // `readBlock` is total and answers AIR past the end, so an over-long
      // buffer is silently ignored everywhere else in this repository. The
      // schema is the only place it can be refused.
      const raw = Buffer.from(ENCODED.blocks, 'base64')
      const doubled = Buffer.concat([raw, raw]).toString('base64')
      const outcome = yield* decodeOutcome(envelopeWith({ blocks: doubled }))

      expect(outcome._tag).toBe('Refused')
      expect(outcome.cause).toContain('expected at most 174764 base64 characters')
      expect(outcome.cause).toContain('received 349528')
    }),
  )

  it.effect('CF-7: a wrong biome-column count fails', () =>
    Effect.gen(function* () {
      const outcome = yield* decodeOutcome(envelopeWith({ biomes: ENCODED.biomes.slice(0, 12) }))

      expect(outcome._tag).toBe('Refused')
      expect(outcome.cause).toContain('expected 256 biome columns')
      expect(outcome.cause).toContain('received 12')
    }),
  )

  it.effect('CF-7a: a wrong-sized block-state region fails', () =>
    Effect.gen(function* () {
      const outcome = yield* decodeOutcome(envelopeWith({ blockStates: ENCODED.blockStates.slice(0, 8) }))

      expect(outcome._tag).toBe('Refused')
      expect(outcome.cause).toContain(`expected ${String(CHUNK_VOLUME * 4)} block-state bytes`)
    }),
  )

  it('CF-7b: integrity extraction ignores non-record nested schema issues', () => {
    const parseResult = Schema.decodeUnknownResult(Schema.String)(0)
    if (Result.isSuccess(parseResult)) {
      throw new Error('Expected a schema mismatch for the malformed issue fixture')
    }

    const nestedIssue = new SchemaIssue.Pointer([], parseResult.failure.issue)
    // Model an issue tree from an incompatible decoder with a primitive child.
    Object.defineProperty(nestedIssue, 'issue', { value: null })
    const error = new SaveDecodeError({
      format: CHUNK_FORMAT_NAME,
      version: CHUNK_FORMAT.version,
      reason: 'malformed schema issue tree',
      cause: new Schema.SchemaError(nestedIssue),
    })

    expect(chunkIntegrityFailureFromSaveDecodeError(error)).toEqual(Option.none())
  })
})

describe('v3 block states are validated against each cell block id', () => {
  it.effect('CF-22: reserved state codes at and beyond the first invalid code fail with a typed save error', () =>
    Effect.gen(function* () {
      const blockBytes = Buffer.from(ENCODED.blocks, 'base64')
      new DataView(blockBytes.buffer, blockBytes.byteOffset, blockBytes.byteLength).setUint16(0, AIR_BLOCK_ID, true)

      for (const invalidCode of [1, 0xffff_ffff]) {
        const stateBytes = Buffer.from(ENCODED.blockStates, 'base64')
        new DataView(stateBytes.buffer, stateBytes.byteOffset, stateBytes.byteLength).setUint32(0, invalidCode, true)
        const blocks = Uint16Array.from(FIXTURE.blocks)
        blocks[0] = AIR_BLOCK_ID
        const blockStates = Uint32Array.from(FIXTURE.blockStates)
        blockStates[0] = invalidCode
        const integrity = chunkIntegrityMetadataFor({
          biomes: FIXTURE.biomes,
          blockStates,
          blocks,
          endFeatureIds: [],
          endFeatureMarkers: [],
          naturalStructureIds: [],
          naturalStructureMarkers: [],
        })
        const outcome = yield* decodeOutcome(envelopeWith({
          blocks: blockBytes.toString('base64'),
          blockStates: stateBytes.toString('base64'),
          integrity,
        }))

        expect(outcome._tag).toBe('Refused')
        expect(outcome.detail).toContain('SaveDecodeError')
        expect(outcome.cause).toContain('reserved-code')
      }
    }),
  )

  it.effect('CF-23: a codec version other than the kernel codec is refused', () =>
    Effect.gen(function* () {
      const outcome = yield* decodeOutcome(envelopeWith({
        blockStateCodecVersion: 2 as unknown as ChunkEncoded['blockStateCodecVersion'],
      }))

      expect(outcome._tag).toBe('Refused')
      expect(outcome.detail).toContain('SaveDecodeError')
      expect(outcome.cause).toContain('blockStateCodecVersion')
    }),
  )

  it('CF-P2: corruption at arbitrary section positions returns a typed, section-specific failure without throwing', () => {
    const arbitraryCorruption = fc.tuple(
      fc.integer({ min: 0, max: CHUNK_VOLUME * 2 - 1 }),
      fc.integer({ min: 0, max: CHUNK_VOLUME * 4 - 1 }),
      fc.integer({ min: 0, max: CHUNK_BIOME_COUNT - 1 }),
      fc.integer({ min: 0, max: INTEGRITY_STRUCTURE_ID.length - 1 }),
    )

    const corruptBytes = (value: string, index: number): string => {
      const decoded = Schema.decodeUnknownResult(Schema.Uint8ArrayFromBase64)(value)
      if (Result.isFailure(decoded)) return value
      const bytes = Uint8Array.from(decoded.success)
      bytes[index] = (bytes[index] ?? 0) ^ 1
      return Result.getOrThrow(Schema.encodeUnknownResult(Schema.Uint8ArrayFromBase64)(bytes))
    }

    const hasIntegrityFailureFor = (section: ChunkIntegritySection, payload: ChunkEncoded): boolean => {
      const outcome = Effect.runSync(decodeOutcome(envelopeWith(payload)))
      return outcome._tag === 'Refused' &&
        outcome.detail.includes('SaveDecodeError') &&
        Option.isSome(outcome.integrityFailure) &&
        outcome.integrityFailure.value._tag === 'ChunkIntegrityFailure' &&
        outcome.integrityFailure.value.section === section
    }

    fc.assert(
      fc.property(arbitraryCorruption, ([blockIndex, stateIndex, biomeIndex, markerIndex]) => {
        const marker = INTEGRITY_ENCODED.naturalStructureMarkers?.[0]
        if (!marker) {
          return false
        }
        const biomes = [...INTEGRITY_ENCODED.biomes]
        biomes[biomeIndex] = biomes[biomeIndex] === 'DESERT' ? 'PLAINS' : 'DESERT'
        const structureId = `${marker.structureId.slice(0, markerIndex)}x${marker.structureId.slice(markerIndex + 1)}`
        const corruptions = [
          {
            section: 'blocks' as const,
            payload: { ...INTEGRITY_ENCODED, blocks: corruptBytes(INTEGRITY_ENCODED.blocks, blockIndex) },
          },
          {
            section: 'blockStates' as const,
            payload: { ...INTEGRITY_ENCODED, blockStates: corruptBytes(INTEGRITY_ENCODED.blockStates, stateIndex) },
          },
          { section: 'biomes' as const, payload: { ...INTEGRITY_ENCODED, biomes } },
          {
            section: 'structureMarkers' as const,
            payload: { ...INTEGRITY_ENCODED, naturalStructureMarkers: [{ ...marker, structureId }] },
          },
        ]
        return corruptions.every(({ section, payload }) => hasIntegrityFailureFor(section, payload))
      }),
      { numRuns: 8, seed: 0x6c57a },
    )
  })

  it('CF-P1: arbitrary block ids and state codes either refuse or round-trip through the exported schema without throwing', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...BLOCK_IDS),
        fc.oneof(
          fc.constant(0),
          fc.integer({ min: 0, max: 0xff }),
          fc.integer({ min: 0, max: 0xffff_ffff }),
        ),
        (blockId, code) => {
          const decodedState = decodeBlockState(blockId, code)
          const blocks = new Uint16Array(CHUNK_VOLUME)
          blocks.fill(AIR_BLOCK_ID)
          blocks[0] = blockId
          const blockStates = new Uint32Array(CHUNK_VOLUME)
          blockStates[0] = code
          const candidate = { ...FIXTURE, blocks, blockStates }
          const encoded = Schema.encodeUnknownResult(CHUNK_SCHEMA)(candidate)

          if (Result.isFailure(decodedState)) {
            return Result.isFailure(encoded)
          }
          if (Result.isFailure(encoded)) {
            return false
          }
          const restored = Schema.decodeUnknownResult(CHUNK_SCHEMA)(encoded.success)
          return Result.isSuccess(restored) && restored.success.blockStates[0] === code
        },
      ),
      { numRuns: 20 },
    )
  })
})

describe('the biome roster is a closed save format', () => {
  it.effect('CF-8: a biome name this build does not know is refused, not defaulted', () =>
    Effect.gen(function* () {
      // The alternative — falling back to PLAINS, as `biomeAt` does for an
      // out-of-range index (`domain/chunk.ts:63`) — would silently rewrite a
      // world saved by a build that had more biomes than this one. Refusing is
      // what makes the retirement of a biome a MIGRATION rather than a
      // data-loss event.
      const unknown = [...ENCODED.biomes.slice(0, CHUNK_BIOME_COUNT - 1), 'MUSHROOM_ISLAND']
      const outcome = yield* decodeOutcome(envelopeWith({ biomes: unknown as ChunkEncoded['biomes'] }))

      expect(outcome._tag).toBe('Refused')
      expect(outcome.cause).toMatch(/SchemaError\(Expected .+ at \["biomes"\]\[255\]\)/su)
    }),
  )

  it.effect('CF-9: every chunk biome is accepted by the schema', () =>
    Effect.gen(function* () {
    // The other direction, and the one that would rot silently: a biome added
    // to `BIOMES` but not to the schema makes a freshly generated chunk
    // unsaveable. They are built from the same constant today; this fails if
    // anyone splits them.
    for (const name of CHUNK_BIOMES) {
      const biomes = Array.from({ length: CHUNK_BIOME_COUNT }, () => name)
      const envelope = yield* encodeSave(CHUNK_FORMAT, { ...FIXTURE, biomes })
      const outcome = yield* decodeOutcome(envelope)
      expect(outcome._tag, `${name} is missing from the chunk schema`).toBe('Accepted')
    }
    }),
  )
})

describe('an envelope that is not ours', () => {
  it.effect('CF-10: a foreign envelope is refused even though the payload would fit', () =>
    Effect.gen(function* () {
      const foreign = saveEnvelope(validated.saveFormatName('@nerima-games/mc-worldgen/chunk-v2-experiment'), validated.saveFormatVersion(1), ENCODED)
      const outcome = yield* decodeOutcome(foreign)

      expect(outcome._tag).toBe('Refused')
      expect(outcome.detail).toContain('chunk-v2-experiment')
    }),
  )

  it.effect('CF-11: a save from a NEWER build is refused as such, not as corruption', () =>
    Effect.gen(function* () {
      // The distinction the reference could not make: it partitioned worlds on
      // whether `Schema` accepted them and offered a delete button for the rest.
      const fromFuture = saveEnvelope(validated.saveFormatName(CHUNK_FORMAT_NAME), validated.saveFormatVersion(CHUNK_FORMAT.version + 1), ENCODED)
      const outcome = yield* decodeOutcome(fromFuture)

      expect(outcome._tag).toBe('Refused')
      expect(outcome.detail).toContain('newer build')
      expect(outcome.detail).toContain('must not be offered for deletion')
    }),
  )
})

describe('the format is well-formed as a definition', () => {
  // @nerima-games/mc-save 0.3.0 (Wave 0) dropped the migration-chain feature
  // (SaveFormat.migrations and validateMigrationChain no longer exist), so
  // CF-13 no longer has a chain to assert against; only the version survives.
  it('CF-13: version 3 (the block-state format) has no problems', () => {
    expect(CHUNK_FORMAT.version).toBe(3)
  })

  it('CF-14: the format name is the permanent identity and is spelled like the tag', () => {
    // Renaming this makes every existing save FOREIGN, and there is no
    // migration path back — the format only matches on an exact name.
    expect(CHUNK_FORMAT.name).toBe('@nerima-games/mc-worldgen/chunk')
    expect(CHUNK_FORMAT_NAME).toBe(CHUNK_FORMAT.name)
  })
})

describe('the coordinate keeps kernel’s refinement', () => {
  it.effect('CF-15: a coordinate that is not a safe integer is refused', () =>
    Effect.gen(function* () {
      // `ChunkAxis` refines on `Number.isSafeInteger`, so a coordinate that
      // arrives from a save file at 2^53 is refused rather than silently
      // collapsed onto its neighbour.
      //
      // THIS DOES NOT PIN `Schema.fromBrand`. Replacing it with
      // `Schema.int() + Schema.brand('ChunkAxis')` leaves this test green,
      // because `Schema.int()` also refines on `Number.isSafeInteger` — the
      // mutation was run and stayed green. `domain/chunk-format.ts`'s header
      // states why the choice is still `fromBrand` and why the argument for it
      // is structural rather than behavioural.
      const outcome = yield* decodeOutcome(envelopeWith({ coord: { cx: Number.MAX_SAFE_INTEGER + 1, cz: 0 } }))

      expect(outcome._tag).toBe('Refused')
      expect(outcome.cause).toContain('ChunkAxis')
    }),
  )

  it.effect('CF-16: a negative coordinate round-trips with its sign', () =>
    Effect.gen(function* () {
      const restored = yield* decodeSave(CHUNK_FORMAT, saveEnvelope(validated.saveFormatName(CHUNK_FORMAT_NAME), CHUNK_FORMAT.version, ENCODED))

      expect(restored.coord.cx).toBe(3)
      expect(restored.coord.cz).toBe(-5)
    }),
  )
})

describe('the widened container is trusted instead of a redundant runtime filter', () => {
  it('BLOCK_ID_MAX still equals the Uint16Array ceiling, which is the premise Uint16ArraySchema relies on', () => {
    // `domain/chunk-format.ts`'s `Uint16ArraySchema` has no `blockId >
    // BLOCK_ID_MAX` filter — a real `Uint16Array` element can never exceed
    // 65535, so that filter could never fail and would be untestable dead
    // code. This is the assertion that stands in for it: if kernel ever
    // widens `BlockId` past 16 bits, THIS goes red, and a real range filter
    // belongs back in `Uint16ArraySchema` at that point.
    expect(BLOCK_ID_MAX).toBe(65535)
  })
})
