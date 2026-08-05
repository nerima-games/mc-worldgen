/**
 * The application boundary for terrain generation performed outside this
 * repository.
 *
 * mc-worldgen owns the `ChunkSource` contract but not the execution medium.
 * A browser host may implement this Port with mc-render's generic worker pool,
 * while Node and tests can use the synchronous generator. Keeping the Port
 * free of DOM and Worker types preserves the package's worker-safe boundary.
 */
import type { Chunk } from '../domain/chunk'
import type { ChunkCoord } from '@nerima-games/mc-kernel'
import type { ChunkSource } from './chunk-store'
import { Effect } from 'effect'

/** A terrain generator supplied by the application host. */
export type TerrainWorkerPoolPort = {
  readonly generateTerrain: (coord: ChunkCoord) => Effect.Effect<Chunk>
}

/** Adapt a host-provided terrain Port to the ChunkStore injection seam. */
export const chunkSourceFromTerrainWorkerPool = (
  port: TerrainWorkerPoolPort,
): ChunkSource =>
  (coord) => port.generateTerrain(coord)
