import { describe, expect, it } from '@effect/vitest'
import { BLOCK_IDS, BlockId, AIR_BLOCK_ID } from '@nerima-games/mc-kernel'
import { defaultBlockState, encodeBlockState } from '@nerima-games/mc-kernel/domain/block-state'
import { decodeSave, encodeSave, saveEnvelope } from '@nerima-games/mc-save'
import { Effect, Result } from 'effect'
import * as validated from './fixtures/validated-inputs'
import {
  CHUNK_BIOME_COUNT,
  CHUNK_FORMAT,
  CHUNK_FORMAT_NAME,
  CHUNK_FORMAT_V2,
  migrateChunkV2ToV3,
} from '../src/domain/chunk-format'
import { CHUNK_VOLUME } from '../src/domain/constants'

const blocks = new Uint16Array(CHUNK_VOLUME)
blocks.fill(AIR_BLOCK_ID)
blocks[0] = BLOCK_IDS[2] ?? AIR_BLOCK_ID
blocks[1] = BLOCK_IDS[3] ?? AIR_BLOCK_ID
blocks[2] = BLOCK_IDS[4] ?? AIR_BLOCK_ID

const blockBytes = new Uint8Array(blocks.length * 2)
const blockView = new DataView(blockBytes.buffer)
for (const [index, blockId] of blocks.entries()) {
  blockView.setUint16(index * 2, blockId, true)
}

const legacyPayload = {
  biomes: Array.from({ length: CHUNK_BIOME_COUNT }, () => 'PLAINS' as const),
  blocks: Buffer.from(blockBytes).toString('base64'),
  coord: { cx: -7, cz: 4 },
}

const legacyEnvelope = saveEnvelope(
  validated.saveFormatName(CHUNK_FORMAT_NAME),
  CHUNK_FORMAT_V2.version,
  legacyPayload,
)

describe('CHUNK_FORMAT_V2: the pre-state format, kept as a read path', () => {
  it('CF-V2-0: the legacy format is version 2 and the current format is version 3', () => {
    expect(CHUNK_FORMAT_V2.version).toBe(2)
    expect(CHUNK_FORMAT.version).toBe(3)
    expect(CHUNK_FORMAT_V2.name).toBe(CHUNK_FORMAT.name)
  })

  it.effect('CF-V2-1: the current format refuses a v2 envelope directly', () =>
    Effect.gen(function* () {
      const failure = yield* Effect.flip(decodeSave(CHUNK_FORMAT, legacyEnvelope))

      expect(failure._tag).toBe('SaveDecodeError')
      expect(failure.version).toBe(CHUNK_FORMAT_V2.version)
      expect(failure.reason).toContain('unsupported version')
    }),
  )

  it.effect('CF-V2-2: CHUNK_FORMAT_V2 decodes the two-byte little-endian block region', () =>
    Effect.gen(function* () {
      const legacy = yield* decodeSave(CHUNK_FORMAT_V2, legacyEnvelope)

      expect(legacy.blocks).toBeInstanceOf(Uint16Array)
      expect(legacy.blocks.length).toBe(CHUNK_VOLUME)
      expect([...legacy.blocks.slice(0, 3)]).toStrictEqual([...blocks.slice(0, 3)])
      expect('blockStates' in legacy).toBe(false)
      expect(legacy.coord).toStrictEqual(validated.validatedChunkCoord(-7, 4))
      expect(legacy.naturalStructureIds).toStrictEqual([])
    }),
  )

  it.effect('CF-V2-3: v2 decoding can be re-encoded as v2', () =>
    Effect.gen(function* () {
      const legacy = yield* decodeSave(CHUNK_FORMAT_V2, legacyEnvelope)
      const encoded = yield* encodeSave(CHUNK_FORMAT_V2, {
        biomes: legacy.biomes,
        blocks: legacy.blocks,
        coord: legacy.coord,
      })

      expect(encoded.version).toBe(2)
      const restored = yield* decodeSave(CHUNK_FORMAT_V2, encoded)
      expect([...restored.blocks]).toStrictEqual([...legacy.blocks])
      expect(restored.endFeatureIds).toStrictEqual([])
      expect(restored.endFeatureMarkers).toStrictEqual([])
      expect(restored.naturalStructureIds).toStrictEqual([])
      expect(restored.naturalStructureMarkers).toStrictEqual([])
    }),
  )

  it.effect('CF-V2-4: migration derives every default through the kernel codec, then round-trips as v3', () =>
    Effect.gen(function* () {
      const legacy = yield* decodeSave(CHUNK_FORMAT_V2, legacyEnvelope)
      const migrated = yield* Effect.fromResult(migrateChunkV2ToV3(legacy))
      const expected = new Uint32Array(CHUNK_VOLUME)
      const encodedDefaults = new Map<number, number>()

      for (const blockIdValue of new Set(legacy.blocks)) {
        const blockId = BlockId.result(blockIdValue)
        expect(Result.isSuccess(blockId)).toBe(true)
        if (Result.isFailure(blockId)) {
          return
        }
        const defaultState = defaultBlockState(blockId.success)
        expect(Result.isSuccess(defaultState)).toBe(true)
        if (Result.isFailure(defaultState)) {
          return
        }
        const encoded = encodeBlockState(blockId.success, defaultState.success)
        expect(Result.isSuccess(encoded)).toBe(true)
        if (Result.isFailure(encoded)) {
          return
        }
        encodedDefaults.set(blockIdValue, encoded.success)
      }
      for (const [index, blockIdValue] of legacy.blocks.entries()) {
        const encodedDefault = encodedDefaults.get(blockIdValue)
        expect(encodedDefault).toBeDefined()
        if (encodedDefault !== undefined) {
          expected[index] = encodedDefault
        }
      }

      expect(migrated.blockStates).toStrictEqual(expected)
      expect(migrated.coord).toStrictEqual(legacy.coord)
      expect([...migrated.blocks]).toStrictEqual([...legacy.blocks])

      const encoded = yield* encodeSave(CHUNK_FORMAT, migrated)
      expect(encoded.version).toBe(3)
      const restored = yield* decodeSave(CHUNK_FORMAT, encoded)
      expect([...restored.blockStates]).toStrictEqual([...expected])
    }),
  )

  it.effect('CF-V2-5: an unregistered block fails migration with the kernel codec error', () =>
    Effect.gen(function* () {
      const unknownBlocks = new Uint16Array(CHUNK_VOLUME)
      unknownBlocks.fill(AIR_BLOCK_ID)
      unknownBlocks[0] = 65_535
      const unknownBytes = new Uint8Array(unknownBlocks.length * 2)
      const unknownView = new DataView(unknownBytes.buffer)
      for (const [index, blockId] of unknownBlocks.entries()) {
        unknownView.setUint16(index * 2, blockId, true)
      }
      const unknownEnvelope = saveEnvelope(
        validated.saveFormatName(CHUNK_FORMAT_NAME),
        CHUNK_FORMAT_V2.version,
        { ...legacyPayload, blocks: Buffer.from(unknownBytes).toString('base64') },
      )
      const unknown = yield* decodeSave(CHUNK_FORMAT_V2, unknownEnvelope)
      const failure = migrateChunkV2ToV3(unknown)

      expect(Result.isFailure(failure)).toBe(true)
      if (Result.isFailure(failure)) {
        expect(failure.failure._tag).toBe('BlockStateCodecFailure')
        expect(failure.failure.reason).toBe('unknown-block-id')
      }
    }),
  )
})
