import {
  type MigrationError,
  type SaveDecodeError,
  SaveKey,
  type StorageError,
  StoragePort,
  decodeSave,
  encodeSave,
} from '@nerima-games/mc-save'
import { Effect, Option } from 'effect'
import type { Chunk } from '../domain/chunk'
import { CHUNK_FORMAT } from '../domain/chunk-format'
import type { ChunkCoord } from '../domain/kernel-vocabulary'

export type ChunkPersistenceError = StorageError | SaveDecodeError | MigrationError

export type ChunkPersistence = {
  readonly load: (coord: ChunkCoord) => Effect.Effect<Option.Option<Chunk>, ChunkPersistenceError>
  readonly save: (chunk: Chunk) => Effect.Effect<void, ChunkPersistenceError>
}

export type ChunkPersistenceContext = {
  readonly worldId: string
  readonly dimension: string
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
      Effect.flatMap(
        storage.get(chunkSaveKey(context, coord)),
        Option.match({
          onNone: () => Effect.succeed(Option.none<Chunk>()),
          onSome: (envelope) => Effect.map(decodeSave(CHUNK_FORMAT, envelope), Option.some),
        }),
      ),
    save: (chunk) =>
      Effect.flatMap(encodeSave(CHUNK_FORMAT, chunk), (envelope) =>
        storage.put(chunkSaveKey(context, chunk.coord), envelope),
      ),
  }))
