import { describe, expect, it } from '@effect/vitest'
import { Effect, Result } from 'effect'
import { BlockId } from '@nerima-games/mc-kernel'
import { vi } from 'vitest'
import {
  ChunkCapacity,
  ChunkStore,
  ChunkStoreLayer,
  type ChunkSource,
} from '../src/application/chunk-store'
import { BLOCK } from '../src/domain/biome'
import { emptyBlocks } from '../src/domain/chunk'
import { CHUNK_SIZE_XZ } from '../src/domain/constants'
import { LightQueueUnderflowError as makeLightQueueUnderflowError } from '../src/domain/light-propagation'
import { validatedBlockPosition as blockPosition, validatedChunkCoord as chunkCoord } from './fixtures/validated-inputs'

const stateMocks = vi.hoisted(() => ({
  lightAt: vi.fn(),
  publishPreparedBlockWrite: vi.fn(),
}))

vi.mock('../src/domain/chunk-store-state.js', async () => {
  const actual = await vi.importActual<typeof import('../src/domain/chunk-store-state.js')>(
    '../src/domain/chunk-store-state.js',
  )
  return {
    ...actual,
    lightAt: stateMocks.lightAt,
    publishPreparedBlockWrite: stateMocks.publishPreparedBlockWrite,
  }
})

type Captured<A, E> =
  | { readonly kind: 'failure'; readonly error: E }
  | { readonly kind: 'success'; readonly value: A }

const capture = <A, E>(effect: Effect.Effect<A, E>): Promise<Captured<A, E>> =>
  Effect.runPromise(
    Effect.match(effect, {
      onFailure: (error) => ({ error, kind: 'failure' as const }),
      onSuccess: (value) => ({ kind: 'success' as const, value }),
    }),
  )

const CHUNK_BIOME_COUNT = CHUNK_SIZE_XZ * CHUNK_SIZE_XZ
const CAPACITY = Result.getOrThrow(ChunkCapacity.result(1))
const COORD = chunkCoord(0, 0)
const POSITION = blockPosition(1, 1, 1)
const STONE = Result.getOrThrow(BlockId.result(BLOCK.STONE))
const SOURCE: ChunkSource = (coord) =>
  Effect.succeed({
    blocks: emptyBlocks(),
    biomes: Array.from({ length: CHUNK_BIOME_COUNT }, () => 'PLAINS' as const),
    coord,
  })

describe('ChunkStore typed lighting failures', () => {
  it.effect('returns the light failure through publish, setBlock, and getLight without changing the chunk', () =>
    Effect.promise(async () => {
      stateMocks.lightAt.mockReset()
      stateMocks.publishPreparedBlockWrite.mockReset()

      const store = await Effect.runPromise(Effect.provide(ChunkStore, ChunkStoreLayer(SOURCE, CAPACITY)))
      await Effect.runPromise(store.load(COORD))
      const before = await Effect.runPromise(store.snapshot(COORD))
      const prepared = await Effect.runPromise(store.prepare([{ block: STONE, position: POSITION }]))
      const failure = new makeLightQueueUnderflowError({ index: 0 })
      stateMocks.publishPreparedBlockWrite.mockReturnValue(Result.fail(failure))

      const publishResult = await capture(store.publish(prepared))
      expect(publishResult).toEqual({ error: failure, kind: 'failure' })

      const writeResult = await capture(store.setBlock(POSITION, STONE))
      expect(writeResult).toEqual({ error: failure, kind: 'failure' })

      stateMocks.lightAt.mockReturnValue(Result.fail(failure))
      const lightResult = await capture(store.getLight(POSITION))
      expect(lightResult).toEqual({ error: failure, kind: 'failure' })

      const after = await Effect.runPromise(store.snapshot(COORD))
      expect(after?.blocks).toEqual(before?.blocks)
      expect(after?.biomes).toEqual(before?.biomes)
      expect(after?.coord).toEqual(before?.coord)
    }),
  )
})
