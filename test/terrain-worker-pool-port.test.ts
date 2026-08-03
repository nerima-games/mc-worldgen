import { describe, expect, it } from '@effect/vitest'
// eslint-disable-next-line sort-imports -- External imports precede project modules.
import { Effect } from 'effect'
// eslint-disable-next-line sort-imports -- The public API import keeps related values together.
import {
  type TerrainWorkerPoolPort,
  chunkSourceFromTerrainWorkerPool,
  generatedChunkSource,
} from '../src/index'
// eslint-disable-next-line sort-imports -- Kernel coordinates follow the public API import.
import { type ChunkCoord, chunkCoord } from '../src/domain/kernel-vocabulary'

const FORWARDING_SEED = 20260803
// eslint-disable-next-line no-magic-numbers -- Negative and positive coordinates exercise forwarding.
const FORWARDING_COORD = chunkCoord(-3, 7)
// eslint-disable-next-line no-magic-numbers -- Representative negative, origin, and positive chunks cover parity.
const PARITY_COORDINATES = [chunkCoord(-2, -1), chunkCoord(0, 0), chunkCoord(4, 3)]

describe('TerrainWorkerPoolPort', () => {
  it.effect('adapts a host port without changing the ChunkSource contract', () =>
    Effect.gen(function* forwardsChunkSource() {
      const expected = yield* generatedChunkSource(FORWARDING_SEED)(FORWARDING_COORD)
      const requested: Array<ChunkCoord> = []
      const port: TerrainWorkerPoolPort = {
        generateTerrain: (requestedCoord) => {
          requested.push(requestedCoord)
          return Effect.succeed(expected)
        },
      }

      const actual = yield* chunkSourceFromTerrainWorkerPool(port)(FORWARDING_COORD)

      expect(actual).toBe(expected)
      expect(requested).toStrictEqual([FORWARDING_COORD])
    }),
  )

  it.effect('preserves byte-identical terrain output across the host boundary', () =>
    Effect.gen(function* preservesTerrainParity() {
      const seed = 777
      const mainThread = generatedChunkSource(seed)
      const port: TerrainWorkerPoolPort = {
        generateTerrain: (coord) => mainThread(coord),
      }
      const workerSource = chunkSourceFromTerrainWorkerPool(port)

      for (const coord of PARITY_COORDINATES) {
        const expected = yield* mainThread(coord)
        const actual = yield* workerSource(coord)
        expect(actual).toStrictEqual(expected)
      }
    }),
  )
})
