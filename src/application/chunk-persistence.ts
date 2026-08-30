import { Effect, Option } from 'effect'
import {
  type SaveDecodeError,
  SaveKey,
  type StorageError,
  StoragePort,
  loadFrom,
  saveTo,
} from '@nerima-games/mc-save'
import { CHUNK_FORMAT } from '../domain/chunk-format.js'
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

/** Bind mc-save's environment-driven storage port to this world's chunk format. */
export const makeChunkPersistence = (
  context: ChunkPersistenceContext,
): Effect.Effect<ChunkPersistence, never, StoragePort> =>
  Effect.map(StoragePort, (storage) => ({
    load: (coord) =>
      loadFrom(CHUNK_FORMAT, chunkSaveKey(context, coord)).pipe(
        Effect.provideService(StoragePort, storage),
      ),
    save: (chunk) =>
      saveTo(CHUNK_FORMAT, chunkSaveKey(context, chunk.coord), chunk).pipe(
        Effect.provideService(StoragePort, storage),
      ),
  }))
