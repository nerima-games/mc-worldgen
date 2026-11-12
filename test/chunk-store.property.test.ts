import { describe, expect, it } from '@effect/vitest'
import * as fc from 'fast-check'
import { Effect, Result, Schema } from 'effect'
import { BlockId } from '@nerima-games/mc-kernel'
import {
  BLOCK,
  CHUNK_FORMAT,
  CHUNK_HEIGHT,
  CHUNK_SIZE_XZ,
  CHUNK_VOLUME,
  ChunkCapacity,
  ChunkStore,
  ChunkStoreLayer,
  generatedChunkSource,
  generatedDimensionChunkSource,
  type ChunkSource,
} from '../src/index'
import { validatedBlockPosition as blockPosition, validatedChunkCoord as chunkCoord, noiseSeed } from './fixtures/validated-inputs'

type Store = Effect.Success<typeof ChunkStore>
type StoreResult<A, E> =
  | { readonly kind: 'failure'; readonly error: E }
  | { readonly kind: 'success'; readonly value: A }

const TEST_CAPACITY = Result.getOrThrow(ChunkCapacity.result(1))
const CHUNK_BIOME_COUNT = CHUNK_SIZE_XZ * CHUNK_SIZE_XZ
const POSITION_XZ = fc.oneof(
  fc.constant(-CHUNK_SIZE_XZ),
  fc.constant(CHUNK_SIZE_XZ - 1),
  fc.integer({ min: -CHUNK_SIZE_XZ + 1, max: CHUNK_SIZE_XZ - 2 }),
)
const arbitraryPosition = fc
  .record({
    x: POSITION_XZ,
    y: fc.oneof(
      fc.constant(-1),
      fc.constant(CHUNK_HEIGHT),
      fc.integer({ min: 0, max: CHUNK_HEIGHT - 1 }),
    ),
    z: POSITION_XZ,
  })
  .map(({ x, y, z }) => blockPosition(x, y, z))
const arbitraryDirtyCells = fc.uniqueArray(
  fc.tuple(
    fc.integer({ min: 0, max: CHUNK_SIZE_XZ - 1 }),
    fc.integer({ min: 0, max: CHUNK_HEIGHT - 1 }),
    fc.integer({ min: 0, max: CHUNK_SIZE_XZ - 1 }),
  ),
  {
    minLength: 1,
    maxLength: 24,
    selector: ([x, y, z]) => `${x},${y},${z}`,
  },
)
const arbitraryBlockId = fc
  .oneof(fc.constant(0), fc.constant(0xffff), fc.integer({ min: 0, max: 0xffff }))
  .map((value) => Result.getOrThrow(BlockId.result(value)))
const arbitraryLogAxis = fc.constantFrom('x', 'y', 'z')
const arbitraryGenerationOptions = fc.oneof(
  fc.anything().map((terrainLevels) => ({ terrainLevels })),
  fc.record({
    terrainLevels: fc.record({
      lakeLevel: fc.integer({ min: -1_000, max: 1_000 }),
      seaLevel: fc.integer({ min: -1_000, max: 1_000 }),
    }),
  }),
  fc.constant({}),
  fc.constant({ terrainLevels: { lakeLevel: Number.MAX_SAFE_INTEGER + 1, seaLevel: 63 } }),
  fc.constant({ terrainLevels: { lakeLevel: 63, seaLevel: Number.MIN_SAFE_INTEGER - 1 } }),
  fc.constant(null),
  fc.constant('invalid options'),
  fc.constant([]),
)

const airSource: ChunkSource = (coord) =>
  Effect.succeed({
    coord,
    blocks: new Uint16Array(CHUNK_VOLUME).fill(BLOCK.AIR),
    biomes: Array.from({ length: CHUNK_BIOME_COUNT }, () => 'PLAINS' as const),
  })

const freshStore = (): Promise<Store> => Effect.runPromise(Effect.provide(ChunkStore, ChunkStoreLayer(airSource, TEST_CAPACITY)))

const capture = <A, E>(effect: Effect.Effect<A, E>): Promise<StoreResult<A, E>> =>
  Effect.runPromise(
    Effect.match(effect, {
      onFailure: (error) => ({ error, kind: 'failure' as const }),
      onSuccess: (value) => ({ kind: 'success' as const, value }),
    }),
  )

const expectChunk = (chunk: unknown): void => {
  const encoded = Schema.encodeUnknownResult(CHUNK_FORMAT.schema)(chunk)
  expect(Result.isSuccess(encoded)).toBe(true)
  if (Result.isSuccess(encoded)) {
    expect(Result.isSuccess(Schema.decodeUnknownResult(CHUNK_FORMAT.schema)(encoded.success))).toBe(true)
  }
}

const loadAt = async (store: Store, position: ReturnType<typeof blockPosition>): Promise<void> => {
  const coord = chunkCoord(Math.floor(position.x / CHUNK_SIZE_XZ), Math.floor(position.z / CHUNK_SIZE_XZ))
  const loaded = await capture(store.load(coord))
  expect(loaded.kind).toBe('success')
  if (loaded.kind === 'success') {
    expectChunk(loaded.value)
  }
}

const expectErrorTag = (error: unknown, allowedTags: ReadonlyArray<string>): void => {
  const tag =
    typeof error === 'object' && error !== null && '_tag' in error && typeof error._tag === 'string'
      ? error._tag
      : undefined
  expect(allowedTags).toContain(tag)
}

describe('ChunkStore typed service boundaries', () => {
  it.effect('dirty AABB is the exact half-open union of arbitrary changed cells', () =>
    Effect.promise(async () => {
      await fc.assert(
        fc.asyncProperty(arbitraryDirtyCells, async (cells) => {
          const store = await freshStore()
          const coord = chunkCoord(0, 0)
          const loaded = await capture(store.load(coord))
          expect(loaded.kind).toBe('success')
          const subscription = await Effect.runPromise(store.subscribeDirty)

          await cells.reduce<Promise<void>>(
            async (previousWrite, [x, y, z]) => {
              await previousWrite
              const write = await capture(store.setBlock(blockPosition(x, y, z), BLOCK.SAND))
              expect(write.kind).toBe('success')
              if (write.kind === 'success') expect(write.value._tag).toBe('Written')
            },
            Promise.resolve(),
          )

          const batch = await Effect.runPromise(subscription.drain)
          const minX = Math.min(...cells.map(([x]) => x))
          const minY = Math.min(...cells.map(([, y]) => y))
          const minZ = Math.min(...cells.map(([, , z]) => z))
          const maxX = Math.max(...cells.map(([x]) => x)) + 1
          const maxY = Math.max(...cells.map(([, y]) => y)) + 1
          const maxZ = Math.max(...cells.map(([, , z]) => z)) + 1

          expect(batch.changed).toStrictEqual([{ ...coord, min: [minX, minY, minZ], max: [maxX, maxY, maxZ] }])
          expect(batch.removed).toStrictEqual([])
        }),
        { numRuns: 32, seed: 0x6c576 },
      )
    }),
  )

  it.effect('getLight returns a reading or its declared light failure for arbitrary valid positions', () =>
    Effect.promise(async () => {
      await fc.assert(
        fc.asyncProperty(arbitraryPosition, async (position) => {
          const store = await freshStore()
          await loadAt(store, position)

          const result = await capture(store.getLight(position))
          if (result.kind === 'failure') {
            expectErrorTag(result.error, ['LightQueueUnderflowError'])
            return
          }

          if (position.y < 0 || position.y >= CHUNK_HEIGHT) {
            expect(result.value).toStrictEqual({ _tag: 'OutOfWorld' })
          } else {
            expect(result.value).toMatchObject({ _tag: 'Light' })
          }
          if (result.value._tag === 'Light') {
            expect(Number.isInteger(result.value.sky) && result.value.sky >= 0 && result.value.sky <= 15).toBe(true)
            expect(Number.isInteger(result.value.block) && result.value.block >= 0 && result.value.block <= 15).toBe(true)
          }
        }),
        { numRuns: 16, seed: 0x6c573 },
      )
    }),
  )

  it.effect('getBlockWithState returns a revision-tagged reading or its declared codec failure for arbitrary positions', () =>
    Effect.promise(async () => {
      await fc.assert(
        fc.asyncProperty(arbitraryPosition, async (position) => {
          const store = await freshStore()
          const result = await capture(store.getBlockWithState(position))
          if (result.kind === 'failure') {
            expectErrorTag(result.error, ['BlockStateCodecFailure'])
            return
          }

          expect(Number.isSafeInteger(result.value.dimensionRevision) && result.value.dimensionRevision >= 0).toBe(true)
          if (position.y < 0 || position.y >= CHUNK_HEIGHT) {
            expect(result.value._tag).toBe('OutOfWorld')
          } else {
            expect(result.value._tag).toBe('ChunkNotLoaded')
          }
        }),
        { numRuns: 16, seed: 0x6c57a },
      )
    }),
  )

  it.effect('setBlock returns an outcome or its declared state/light failure for arbitrary valid positions and block ids', () =>
    Effect.promise(async () => {
      await fc.assert(
        fc.asyncProperty(arbitraryPosition, arbitraryBlockId, async (position, block) => {
          const store = await freshStore()
          await loadAt(store, position)

          const result = await capture(store.setBlock(position, block))
          if (result.kind === 'failure') {
            expectErrorTag(result.error, ['BlockStateCodecFailure', 'LightQueueUnderflowError'])
            return
          }

          expect(position.y < 0 || position.y >= CHUNK_HEIGHT ? ['OutOfWorld'] : ['Written', 'Unchanged']).toContain(
            result.value._tag,
          )
          const coord = chunkCoord(Math.floor(position.x / CHUNK_SIZE_XZ), Math.floor(position.z / CHUNK_SIZE_XZ))
          const chunk = await capture(store.peek(coord))
          expect(chunk.kind).toBe('success')
          if (chunk.kind === 'success') {
            expect(chunk.value).toBeDefined()
            expectChunk(chunk.value)
          }
        }),
        { numRuns: 16, seed: 0x6c574 },
      )
    }),
  )

  it.effect('setBlock publishes generated valid log axes and reads the same state back', () =>
    Effect.promise(async () => {
      const store = await freshStore()
      const position = blockPosition(1, 20, 1)
      await loadAt(store, position)

      await fc.assert(
        fc.asyncProperty(arbitraryLogAxis, async (axis) => {
          const write = await capture(store.setBlock(position, BLOCK.LOG, { axis }))
          expect(write.kind).toBe('success')
          if (write.kind === 'success') expect(['Written', 'Unchanged']).toContain(write.value._tag)

          const reading = await capture(store.getBlockWithState(position))
          expect(reading.kind).toBe('success')
          if (reading.kind === 'success') {
            expect(reading.value).toMatchObject({ _tag: 'Block', block: BLOCK.LOG, state: { axis } })
          }
        }),
        { numRuns: 9, seed: 0x6c57b },
      )
    }),
  )

  it.effect('setBlock rejects state properties unsupported by the selected block without changing data', () =>
    Effect.promise(async () => {
      const store = await freshStore()
      const position = blockPosition(1, 20, 1)
      await loadAt(store, position)
      const subscription = await Effect.runPromise(store.subscribeDirty)
      await Effect.runPromise(subscription.drain)
      const before = await Effect.runPromise(store.snapshot(chunkCoord(0, 0)))

      await fc.assert(
        fc.asyncProperty(arbitraryLogAxis, async (axis) => {
          const write = await capture(store.setBlock(position, BLOCK.STONE, { axis }))
          expect(write.kind).toBe('failure')
          if (write.kind === 'failure') expectErrorTag(write.error, ['BlockStateCodecFailure'])

          expect(await Effect.runPromise(store.snapshot(chunkCoord(0, 0)))).toStrictEqual(before)
          expect(await Effect.runPromise(subscription.drain)).toStrictEqual({ changed: [], removed: [] })
        }),
        { numRuns: 9, seed: 0x6c57c },
      )
    }),
  )

  it.effect('publish returns void or a declared write/light failure for arbitrary valid prepared writes', () =>
    Effect.promise(async () => {
      await fc.assert(
        fc.asyncProperty(arbitraryPosition, arbitraryBlockId, async (position, block) => {
          const store = await freshStore()
          await loadAt(store, position)

          const preparedResult = await capture(store.prepare([{ block, position }]))
          if (preparedResult.kind === 'failure') {
            expectErrorTag(preparedResult.error, [
              'BlockStateCodecFailure',
              'ChunkWriteInvalidBatch',
              'ChunkWriteChunkUnavailable',
            ])
            return
          }

          const published = await capture(store.publish(preparedResult.value))
          if (published.kind === 'failure') {
            expectErrorTag(published.error, [
              'ChunkWriteStale',
              'ChunkWriteTokenInvalid',
              'LightQueueUnderflowError',
            ])
            return
          }

          expect(published.value).toBeUndefined()
          const coord = chunkCoord(Math.floor(position.x / CHUNK_SIZE_XZ), Math.floor(position.z / CHUNK_SIZE_XZ))
          const chunk = await capture(store.peek(coord))
          expect(chunk.kind).toBe('success')
          if (chunk.kind === 'success') {
            expect(chunk.value).toBeDefined()
            expectChunk(chunk.value)
          }
        }),
        { numRuns: 16, seed: 0x6c575 },
      )
    }),
  )

  it.effect('prepare keeps generated valid log axes invisible until publication', () =>
    Effect.promise(async () => {
      const store = await freshStore()
      const position = blockPosition(1, 20, 1)
      await loadAt(store, position)

      await fc.assert(
        fc.asyncProperty(arbitraryLogAxis, async (axis) => {
          const before = await Effect.runPromise(store.snapshot(chunkCoord(0, 0)))
          if (!before) throw new Error('loaded chunk has no snapshot')
          const readingBefore = await Effect.runPromise(store.getBlockWithState(position))

          const prepared = await capture(store.prepare([{ position, block: BLOCK.LOG, state: { axis } }]))
          expect(prepared.kind).toBe('success')
          expect(await Effect.runPromise(store.snapshot(chunkCoord(0, 0)))).toStrictEqual(before)
          expect(await Effect.runPromise(store.getBlockWithState(position))).toStrictEqual(readingBefore)
          if (prepared.kind === 'success') {
            expect(await capture(store.publish(prepared.value))).toMatchObject({ kind: 'success' })
          }

          expect(await Effect.runPromise(store.getBlockWithState(position))).toMatchObject({
            _tag: 'Block',
            block: BLOCK.LOG,
            state: { axis },
          })
        }),
        { numRuns: 9, seed: 0x6c57d },
      )
    }),
  )

  it.effect('prepare returns a typed state codec failure without changing data', () =>
    Effect.promise(async () => {
      const store = await freshStore()
      const position = blockPosition(1, 20, 1)
      await loadAt(store, position)
      const subscription = await Effect.runPromise(store.subscribeDirty)
      await Effect.runPromise(subscription.drain)
      const before = await Effect.runPromise(store.snapshot(chunkCoord(0, 0)))

      await fc.assert(
        fc.asyncProperty(arbitraryLogAxis, async (axis) => {
          const prepared = await capture(store.prepare([{ position, block: BLOCK.STONE, state: { axis } }]))
          expect(prepared.kind).toBe('failure')
          if (prepared.kind === 'failure') expectErrorTag(prepared.error, ['BlockStateCodecFailure'])

          expect(await Effect.runPromise(store.snapshot(chunkCoord(0, 0)))).toStrictEqual(before)
          expect(await Effect.runPromise(subscription.drain)).toStrictEqual({ changed: [], removed: [] })
        }),
        { numRuns: 9, seed: 0x6c57e },
      )
    }),
  )

  it.effect('generatedDimensionChunkSource returns a typed failure or a schema-valid chunk for arbitrary runtime options', () =>
    Effect.promise(async () => {
      const coord = chunkCoord(0, 0)
      const seed = noiseSeed(0)

      await fc.assert(
        fc.asyncProperty(arbitraryGenerationOptions, async (options) => {
          const source = Reflect.apply(generatedDimensionChunkSource, undefined, [seed, 'overworld', options]) as ChunkSource
          const result = await capture(source(coord))
          if (result.kind === 'failure') {
            expectErrorTag(result.error, ['InvalidNaturalStructureCoordinate', 'InvalidTerrainLevels'])
            return
          }

          expectChunk(result.value)
        }),
        { numRuns: 12, seed: 0x6c576 },
      )
    }),
  )

  it.effect('generatedChunkSource returns a typed failure or a schema-valid chunk for arbitrary runtime options', () =>
    Effect.promise(async () => {
      const coord = chunkCoord(0, 0)
      const seed = noiseSeed(0)

      await fc.assert(
        fc.asyncProperty(arbitraryGenerationOptions, async (options) => {
          const sourceValue: unknown = Reflect.apply(generatedChunkSource, undefined, [seed, options])
          expect(typeof sourceValue).toBe('function')
          if (typeof sourceValue !== 'function') {
            return
          }

          const result = await capture((sourceValue as ChunkSource)(coord))
          if (result.kind === 'failure') {
            expectErrorTag(result.error, ['InvalidNaturalStructureCoordinate', 'InvalidTerrainLevels'])
            return
          }

          expectChunk(result.value)
        }),
        { numRuns: 12, seed: 0x6c577 },
      )
    }),
  )
})
