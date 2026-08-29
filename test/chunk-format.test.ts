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
import { Effect, Option } from 'effect'
import { BIOMES, CHUNK_BIOMES } from '../src/domain/biome'
import {
  CHUNK_BIOME_COUNT,
  CHUNK_FORMAT,
  CHUNK_FORMAT_NAME,
  type ChunkEncoded,
} from '../src/domain/chunk-format'
import { CHUNK_VOLUME } from '../src/domain/constants'
import { endSurfaceHeightAt, generateEndChunk } from '../src/domain/end-terrain'
import { chunkCoord } from '@nerima-games/mc-kernel'
import { planEndCityForRegion, type NaturalStructureChunk } from '../src/domain/natural-structure'
import {
  decodeSave,
  encodeSave,
  saveEnvelope,
  validateMigrationChain,
  type SaveEnvelope,
} from '@nerima-games/mc-save'
import { generateChunk } from '../src/domain/terrain'

const SEED = 20260728

/**
 * One generated chunk, at a coordinate with a NEGATIVE component.
 *
 * Negative on purpose: `chunkCoord` normalises `-0` (`mc-kernel:153`)
 * and a coordinate that only ever gets tested at the origin cannot show that the
 * sign survives base64's neighbours in the same struct.
 *
 * Memoised because a chunk is 64KB and docs/testing.md §6 says so.
 */
const FIXTURE = generateChunk(SEED, chunkCoord(3, -5))

/** The encoded payload of `FIXTURE`, built once and treated as read-only. */
const ENCODED: ChunkEncoded = Effect.runSync(
  Effect.map(encodeSave(CHUNK_FORMAT, FIXTURE), (envelope) => envelope.payload as ChunkEncoded),
)

/** An envelope carrying `ENCODED` with one field replaced. */
const envelopeWith = (patch: Partial<ChunkEncoded>) =>
  saveEnvelope(CHUNK_FORMAT_NAME, CHUNK_FORMAT.version, { ...ENCODED, ...patch })

/**
 * Both outcomes of a decode, reduced to something SMALL.
 *
 * Written this way after the obvious `Effect.flip` made the suite unusable, and
 * the reason is worth keeping: `flip` on a decode that unexpectedly SUCCEEDS
 * fails with the whole `Chunk`, and vitest then formats a 65,536-element
 * `Uint8Array` into the failure message. Found by deleting the length filter
 * below and watching the run stop responding rather than go red — so the
 * mutation that proves these tests work was also the thing that could not be
 * read.
 *
 * `Accepted` carries the two lengths instead, which is exactly the information
 * wanted when a size check has been lost: the failure line reads
 * `{ _tag: 'Accepted', detail: '131072 blocks, 256 biomes' }`.
 */
type DecodeOutcome = {
  readonly _tag: 'Refused' | 'Accepted'
  /** The refusal's message, or a description of what was wrongly ACCEPTED. */
  readonly detail: string
  /** The `ParseError` under a refusal, rendered. Empty for an acceptance. */
  readonly cause: string
}

const decodeOutcome = (envelope: SaveEnvelope): Effect.Effect<DecodeOutcome> =>
  Effect.match(decodeSave(CHUNK_FORMAT, envelope), {
    onFailure: (error): DecodeOutcome => ({
      _tag: 'Refused',
      detail: error.message,
      cause: String((error as { readonly cause?: unknown }).cause ?? ''),
    }),
    onSuccess: (chunk): DecodeOutcome => ({
      _tag: 'Accepted',
      detail: `${String(chunk.blocks.length)} blocks, ${String(chunk.biomes.length)} biomes`,
      cause: '',
    }),
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
      const differing = [...FIXTURE.blocks].findIndex((byte, index) => restored.blocks[index] !== byte)
      expect(differing).toBe(-1)
    }),
  )

  it.effect('CF-2: the encoded payload is the WIRE shape, not the value', () =>
    Effect.gen(function* () {
      const envelope = yield* encodeSave(CHUNK_FORMAT, FIXTURE)
      const payload = envelope.payload as ChunkEncoded

      // A base64 string, not a Uint8Array and not a 65,536-element array. This
      // is the whole of `domain/chunk-format.ts`'s DN-6 decision, asserted.
      expect(typeof payload.blocks).toBe('string')
      expect(payload.blocks).toMatch(/^[A-Za-z0-9+/]*={0,2}$/u)
      // ceil(65536 / 3) * 4
      expect(payload.blocks.length).toBe(87_384)

      // Biome NAMES, so reordering `BIOMES` cannot corrupt a save.
      expect(payload.biomes.every((biome) => (BIOMES as ReadonlyArray<string>).includes(biome))).toBe(true)

      // Plain numbers: the brand is a compile-time fact and must not reach the
      // wire, or the save file would depend on `effect`'s runtime.
      expect(payload.coord).toStrictEqual({ cx: 3, cz: -5 })
    }),
  )

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
      const differing = [...FIXTURE.blocks].findIndex((byte, index) => restored.blocks[index] !== byte)
      expect(differing).toBe(-1)
    }),
  )

  it.effect('CF-4: the envelope is stamped with the format name and current version', () =>
    Effect.gen(function* () {
      const envelope = yield* encodeSave(CHUNK_FORMAT, FIXTURE)

      expect(envelope.format).toBe('@nerima-games/mc-worldgen/chunk')
      expect(envelope.version).toBe(1)
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

  it.effect('CF-17: a minimal v1 persistence payload without structure metadata decodes with empty arrays', () =>
    Effect.gen(function* () {
      const legacyPayload = {
        coord: ENCODED.coord,
        blocks: ENCODED.blocks,
        biomes: ENCODED.biomes,
      }
      const restored = yield* decodeSave(
        CHUNK_FORMAT,
        saveEnvelope(CHUNK_FORMAT_NAME, 1, legacyPayload),
      )

      expect(restored.naturalStructureIds).toStrictEqual([])
      expect(restored.naturalStructureMarkers).toStrictEqual([])
    }),
  )

  it.effect('CF-18: an End city chunk preserves structure ids and every marker field', () =>
    Effect.gen(function* () {
      const seed = 1
      const planOption = planEndCityForRegion(seed, -12, -7, (x, z) => endSurfaceHeightAt(seed, x, z))
      if (Option.isNone(planOption)) throw new Error('expected the known End city candidate to fit real terrain')
      const plan = planOption.value
      const marker = plan.markers[0]
      if (marker === undefined) throw new Error('expected the End city plan to contain markers')
      const chunk = generateEndChunk(
        seed,
        chunkCoord(Math.floor(marker.x / 16), Math.floor(marker.z / 16)),
      )

      expect(chunk.naturalStructureIds).toContain(plan.id)
      expect(chunk.naturalStructureMarkers.length).toBeGreaterThan(0)

      const envelope = yield* encodeSave(CHUNK_FORMAT, chunk)
      const restored = yield* decodeSave(CHUNK_FORMAT, envelope)

      expect(restored).toStrictEqual(chunk)
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
        x: 2,
        y: 70,
        z: 3,
      }
      const chunk = {
        ...generateChunk(SEED, chunkCoord(0, 0)),
        endFeatureIds: [],
        endFeatureMarkers: [],
        naturalStructureIds: [structureId],
        naturalStructureMarkers: [marker],
      }

      const envelope = yield* encodeSave(CHUNK_FORMAT, chunk)
      const restored = yield* decodeSave(CHUNK_FORMAT, envelope)

      expect(restored).toStrictEqual(chunk)
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
          x: 2,
          y: 70,
          z: 3,
        },
        {
          structureId,
          structureKind: 'igloo',
          kind: 'entity-spawn',
          entity: 'zombie-villager',
          x: 1,
          y: 70,
          z: 1,
        },
        {
          structureId: junglePyramidStructureId,
          structureKind: 'jungle-pyramid',
          kind: 'loot-chest',
          lootTable: 'jungle-pyramid',
          x: 2,
          y: 67,
          z: 2,
        },
        {
          structureId: mineshaftStructureId,
          structureKind: 'mineshaft',
          kind: 'loot-chest',
          lootTable: 'mineshaft',
          x: 3,
          y: 53,
          z: 4,
        },
        {
          structureId: oceanMonumentStructureId,
          structureKind: 'ocean-monument',
          kind: 'loot-chest',
          lootTable: 'ocean-monument',
          x: 4,
          y: 53,
          z: 4,
        },
        {
          structureId: bastionRemnantStructureId,
          structureKind: 'bastion-remnant',
          kind: 'loot-chest',
          lootTable: 'bastion-remnant',
          x: 5,
          y: 50,
          z: 5,
        },
        {
          structureId: bastionRemnantStructureId,
          structureKind: 'bastion-remnant',
          kind: 'entity-spawn',
          entity: 'piglin',
          x: 6,
          y: 49,
          z: 5,
        },
        {
          structureId: bastionRemnantStructureId,
          structureKind: 'bastion-remnant',
          kind: 'entity-spawn',
          entity: 'piglin-brute',
          x: 4,
          y: 49,
          z: 5,
        },
        {
          structureId: strongholdStructureId,
          structureKind: 'stronghold',
          kind: 'end-portal-frame',
          facing: 'north',
          eye: true,
          x: 7,
          y: 30,
          z: 7,
        },
        {
          structureId: oceanStructureId,
          structureKind: 'ocean-ruin',
          kind: 'loot-chest',
          lootTable: 'ocean-ruin',
          x: 4,
          y: 56,
          z: 4,
        },
        {
          structureId: outpostStructureId,
          structureKind: 'pillager-outpost',
          kind: 'loot-chest',
          lootTable: 'pillager-outpost',
          x: 0,
          y: 73,
          z: 1,
        },
        {
          structureId: outpostStructureId,
          structureKind: 'pillager-outpost',
          kind: 'entity-spawn',
          entity: 'pillager',
          x: 1,
          y: 73,
          z: 1,
        },
        {
          structureId: shipwreckStructureId,
          structureKind: 'shipwreck',
          kind: 'loot-chest',
          lootTable: 'shipwreck',
          x: 4,
          y: 59,
          z: 0,
        },
      ]
      const chunk = {
        ...generateChunk(SEED, chunkCoord(0, 0)),
        endFeatureIds: [],
        endFeatureMarkers: [],
        naturalStructureIds: [structureId, junglePyramidStructureId, mineshaftStructureId, oceanMonumentStructureId, bastionRemnantStructureId, strongholdStructureId, oceanStructureId, outpostStructureId, shipwreckStructureId],
        naturalStructureMarkers: markers,
      }

      const envelope = yield* encodeSave(CHUNK_FORMAT, chunk)
      const restored = yield* decodeSave(CHUNK_FORMAT, envelope)

      expect(restored).toStrictEqual(chunk)
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
      expect(outcome.detail).toContain('v1')
      // The two lengths ride in the ParseError carried as `cause`, which is
      // what makes this actionable rather than merely a refusal.
      expect(outcome.cause).toContain('expected 65536 block bytes')
      expect(outcome.cause).toContain('received 300')
    }),
  )

  it.effect('CF-6: an OVERSIZED block buffer fails too, though nothing downstream would notice', () =>
    Effect.gen(function* () {
      // `readBlock` is total and answers AIR past the end, so an over-long
      // buffer is silently ignored everywhere else in this repository. The
      // schema is the only place it can be refused.
      const raw = Buffer.from(ENCODED.blocks, 'base64')
      const doubled = Buffer.concat([raw, raw]).toString('base64')
      const outcome = yield* decodeOutcome(envelopeWith({ blocks: doubled }))

      expect(outcome._tag).toBe('Refused')
      expect(outcome.cause).toContain('received 131072')
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
      expect(outcome.cause).toContain('MUSHROOM_ISLAND')
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
      const outcome = yield* decodeOutcome(envelopeWith({ biomes }))
      expect(outcome._tag, `${name} is missing from the chunk schema`).toBe('Accepted')
    }
    }),
  )
})

describe('an envelope that is not ours', () => {
  it.effect('CF-10: a foreign envelope is refused even though the payload would fit', () =>
    Effect.gen(function* () {
      const foreign = saveEnvelope('@nerima-games/mc-worldgen/chunk-v2-experiment', 1, ENCODED)
      const outcome = yield* decodeOutcome(foreign)

      expect(outcome._tag).toBe('Refused')
      expect(outcome.detail).toContain('chunk-v2-experiment')
    }),
  )

  it.effect('CF-11: a save from a NEWER build is refused as such, not as corruption', () =>
    Effect.gen(function* () {
      // The distinction the reference could not make: it partitioned worlds on
      // whether `Schema` accepted them and offered a delete button for the rest.
      const fromFuture = saveEnvelope(CHUNK_FORMAT_NAME, CHUNK_FORMAT.version + 1, ENCODED)
      const outcome = yield* decodeOutcome(fromFuture)

      expect(outcome._tag).toBe('Refused')
      expect(outcome.detail).toContain('newer build')
      expect(outcome.detail).toContain('must not be offered for deletion')
    }),
  )
})

describe('the format is well-formed as a definition', () => {
  it('CF-13: version 1 with an empty chain has no problems', () => {
    expect(CHUNK_FORMAT.version).toBe(1)
    expect(CHUNK_FORMAT.migrations).toStrictEqual([])
    expect(
      validateMigrationChain({
        name: CHUNK_FORMAT.name,
        version: CHUNK_FORMAT.version,
        migrations: CHUNK_FORMAT.migrations,
      }),
    ).toStrictEqual([])
  })

  it('CF-14: the format name is the permanent identity and is spelled like the tag', () => {
    // Renaming this makes every existing save FOREIGN, with no migration able
    // to help — the chain is only consulted after the name matches.
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
      const restored = yield* decodeSave(CHUNK_FORMAT, saveEnvelope(CHUNK_FORMAT_NAME, 1, ENCODED))

      expect(restored.coord.cx).toBe(3)
      expect(restored.coord.cz).toBe(-5)
    }),
  )
})
