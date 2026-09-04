import { CHUNK_FORMAT, CHUNK_FORMAT_V1, migrateChunkV1ToV2 } from '../domain/chunk-format.js'
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
import type { Chunk } from '../domain/chunk.js'
import type { ChunkCoord } from '@nerima-games/mc-kernel'
import type { Dimension } from '../domain/nether-travel.js'

// @nerima-games/mc-save 0.3.0 (Wave 0) dropped the standalone MigrationError
// Class from its public error surface; decode/migration failures are now
// Reported as SaveDecodeError. This union tracks mc-save's actual exports.
export type ChunkPersistenceError = StorageError | SaveDecodeError

export type ChunkPersistence = {
  readonly load: (coord: ChunkCoord) => Effect.Effect<Option.Option<Chunk>, ChunkPersistenceError>
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

/**
 * Load a chunk under `CHUNK_FORMAT` (v2), falling back to `CHUNK_FORMAT_V1`
 * for a save written before `domain/chunk.ts`'s block buffer widened.
 *
 * mc-save's `decodeSave` refuses any envelope whose version is not the
 * format's own — see `CHUNK_FORMAT`'s doc comment in `chunk-format.ts` — so
 * the v2 attempt fails with a `SaveDecodeError` reporting the STORED
 * envelope's actual version whenever a v1 save is read this way. Matching on
 * `error.version === CHUNK_FORMAT_V1.version` distinguishes "this envelope is
 * v1" from every other decode failure (malformed envelope, wrong format name,
 * genuinely corrupt v2 payload), each of which reports a version other than
 * 1 or fails for a reason unrelated to version at all. Only the v1 case is
 * retried; every other `SaveDecodeError` propagates unchanged.
 */
const loadLegacyChunk = (
  storage: StorageService,
  key: SaveKey,
): Effect.Effect<Option.Option<Chunk>, ChunkPersistenceError> =>
  loadFrom(CHUNK_FORMAT_V1, key).pipe(
    Effect.provideService(StoragePort, storage),
    Effect.map(Option.map(migrateChunkV1ToV2)),
  )

const loadChunk = (
  storage: StorageService,
  key: SaveKey,
): Effect.Effect<Option.Option<Chunk>, ChunkPersistenceError> =>
  loadFrom(CHUNK_FORMAT, key).pipe(
    Effect.provideService(StoragePort, storage),
    Effect.catchTag('SaveDecodeError', (error) => {
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
    save: (chunk) =>
      saveTo(CHUNK_FORMAT, chunkSaveKey(context, chunk.coord), chunk).pipe(
        Effect.provideService(StoragePort, storage),
      ),
  }))
