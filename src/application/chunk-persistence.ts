import {
  CHUNK_FORMAT,
  CHUNK_FORMAT_V1,
  CHUNK_FORMAT_V2,
  type ChunkIntegrityFailure,
  chunkIntegrityFailureFromSaveDecodeError,
  migrateChunkV1ToV3,
  migrateChunkV2ToV3,
} from '../domain/chunk-format.js'
import { type Chunk, type ChunkWithBlockStates, withDefaultBlockStates } from '../domain/chunk.js'
import { type ChunkCoord, type Dimension } from '@nerima-games/mc-kernel'
import { Effect, Option } from 'effect'
import {
  type SaveDecodeError,
  SaveKey,
  type StorageError,
  StoragePort,
  type StorageService,
  loadFrom,
  saveTo,
} from '@nerima-games/mc-save'
import type { BlockStateCodecFailure } from '@nerima-games/mc-kernel/domain/block-state'

// @nerima-games/mc-save 0.3.0 (Wave 0) dropped the standalone MigrationError
// Class from its public error surface; decode/migration failures are now
// Reported as SaveDecodeError. This union tracks mc-save's actual exports.
export type ChunkPersistenceError = StorageError | SaveDecodeError | BlockStateCodecFailure | ChunkIntegrityFailure

export type ChunkPersistence = {
  readonly load: (coord: ChunkCoord) => Effect.Effect<Option.Option<ChunkWithBlockStates>, ChunkPersistenceError>
  readonly save: (chunk: Chunk) => Effect.Effect<void, ChunkPersistenceError>
}

export type ChunkPersistenceContext = {
  readonly worldId: string
  readonly dimension: Dimension
}

/** A stable, collision-free key for a chunk within a world and dimension. */
export const chunkSaveKey = (
  { worldId, dimension }: ChunkPersistenceContext,
  coord: ChunkCoord,
): SaveKey =>
  SaveKey(
    `chunk/${encodeURIComponent(worldId)}/${encodeURIComponent(dimension)}/${String(coord.cx)}/${String(coord.cz)}`,
  )

/** Load a v1 chunk with its schema, then derive each block's kernel default state. */
const loadLegacyChunk = (
  storage: StorageService,
  key: SaveKey,
): Effect.Effect<Option.Option<ChunkWithBlockStates>, ChunkPersistenceError> =>
  loadFrom(CHUNK_FORMAT_V1, key, { record: 'Chunk' }).pipe(
    Effect.provideService(StoragePort, storage),
    Effect.flatMap(Option.match({
      onNone: () => Effect.succeed(Option.none()),
      onSome: (chunk) => Effect.map(Effect.fromResult(migrateChunkV1ToV3(chunk)), Option.some),
    })),
  )

const loadV2Chunk = (
  storage: StorageService,
  key: SaveKey,
): Effect.Effect<Option.Option<ChunkWithBlockStates>, ChunkPersistenceError> =>
  loadFrom(CHUNK_FORMAT_V2, key, { record: 'Chunk' }).pipe(
    Effect.provideService(StoragePort, storage),
    Effect.flatMap(Option.match({
      onNone: () => Effect.succeed(Option.none()),
      onSome: (chunk) => Effect.map(Effect.fromResult(migrateChunkV2ToV3(chunk)), Option.some),
    })),
  )

const loadChunk = (
  storage: StorageService,
  key: SaveKey,
): Effect.Effect<Option.Option<ChunkWithBlockStates>, ChunkPersistenceError> =>
  loadFrom(CHUNK_FORMAT, key, { record: 'Chunk' }).pipe(
    Effect.provideService(StoragePort, storage),
    Effect.catchTag('SaveDecodeError', (error) => {
      const integrityFailure = chunkIntegrityFailureFromSaveDecodeError(error)
      if (Option.isSome(integrityFailure)) {
        return Effect.fail(integrityFailure.value)
      }
      if (error.version === CHUNK_FORMAT_V2.version) {
        return loadV2Chunk(storage, key)
      }
      if (error.version === CHUNK_FORMAT_V1.version) {
        return loadLegacyChunk(storage, key)
      }
      return Effect.fail(error)
    }),
  )

/** Bind mc-save's environment-driven storage port to this world's chunk format. */
export const makeChunkPersistence = (
  context: ChunkPersistenceContext,
): Effect.Effect<ChunkPersistence, never, StoragePort> =>
  Effect.map(StoragePort, (storage) => ({
    load: (coord) => loadChunk(storage, chunkSaveKey(context, coord)),
    save: (chunk) => Effect.flatMap(
      Effect.fromResult(withDefaultBlockStates(chunk)),
      (chunkWithBlockStates) => saveTo(CHUNK_FORMAT, chunkSaveKey(context, chunk.coord), chunkWithBlockStates).pipe(
        Effect.provideService(StoragePort, storage),
      ),
    ),
  }))
