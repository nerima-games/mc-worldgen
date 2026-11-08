import { describe, expect, it } from '@effect/vitest'
import * as fc from 'fast-check'
import { Result } from 'effect'
import { BlockId } from '@nerima-games/mc-kernel'
import { blockIndex, CHUNK_HEIGHT, CHUNK_SIZE_XZ } from '../src/domain/constants'
import { emptyBlockStates, emptyBlocks, type Chunk, type ChunkWithBlockStates } from '../src/domain/chunk'
import {
  BLOCK,
  computeChunkLight,
  computeChunkLights,
  emptyChunkStoreState,
  emptyChunkLight,
  lightAt,
  LIGHT_BYTE_LENGTH,
  updateChunkLights,
  withBlockAt,
  withChunk,
  type ChunkStoreState,
  type ChunkBiomeType,
  type ChunkLight,
  type ChunkLightChange,
  type LightReading,
  type LightQueueUnderflowError,
} from '../src/index'
import { prepareBlockWrite, publishPreparedBlockWrite } from '../src/domain/chunk-store-state'
import { readQueueValue, sourceAt } from '../src/domain/light-propagation'
import {
  chunkAxis,
  validatedBlockPosition as blockPosition,
  validatedChunkCoord as chunkCoord,
} from './fixtures/validated-inputs'

const TORCH = Result.getOrThrow(BlockId.result(14))
const BIOMES: ReadonlyArray<ChunkBiomeType> = Array.from(
  { length: CHUNK_SIZE_XZ * CHUNK_SIZE_XZ },
  () => 'PLAINS',
)

type ChunkEdit = {
  readonly x: number
  readonly y: number
  readonly z: number
  readonly block: BlockId
}

type ChunkShape = {
  readonly base: BlockId
  readonly edits: ReadonlyArray<ChunkEdit>
}

const arbitraryChunkShape = fc.record({
  base: fc.constantFrom(BLOCK.BEDROCK, BLOCK.STONE),
  edits: fc.array(
    fc.record({
      x: fc.integer({ min: 0, max: CHUNK_SIZE_XZ - 1 }),
      y: fc.integer({ min: 0, max: CHUNK_HEIGHT - 1 }),
      z: fc.integer({ min: 0, max: CHUNK_SIZE_XZ - 1 }),
      block: fc.constantFrom(BLOCK.AIR, BLOCK.STONE, TORCH),
    }),
    { maxLength: 8 },
  ),
})

const makeChunk = (cx: number, cz: number, shape: ChunkShape): ChunkWithBlockStates => {
  const blocks = emptyBlocks()
  blocks.fill(shape.base)
  for (const edit of shape.edits) {
    blocks[blockIndex(edit.x, edit.y, edit.z)] = edit.block
  }
  return { coord: chunkCoord(chunkAxis(cx), chunkAxis(cz)), blockStates: emptyBlockStates(), blocks, biomes: BIOMES }
}

const positionInChunk = (cx: number, cz: number, x: number, y: number, z: number) =>
  blockPosition(cx * CHUNK_SIZE_XZ + x, y, cz * CHUNK_SIZE_XZ + z)

const arbitraryChunk = fc.record({
  cx: fc.integer({ min: -4, max: 4 }),
  cz: fc.integer({ min: -4, max: 4 }),
  shape: arbitraryChunkShape,
}).map(({ cx, cz, shape }) => makeChunk(cx, cz, shape))

const arbitraryValidWrite = fc.record({
  cx: fc.integer({ min: -4, max: 4 }),
  cz: fc.integer({ min: -4, max: 4 }),
  shape: arbitraryChunkShape,
  x: fc.integer({ min: 0, max: CHUNK_SIZE_XZ - 1 }),
  y: fc.integer({ min: 0, max: CHUNK_HEIGHT - 1 }),
  z: fc.integer({ min: 0, max: CHUNK_SIZE_XZ - 1 }),
  block: fc.constantFrom(BLOCK.AIR, BLOCK.STONE, TORCH),
})

const expectUnderflow = (failure: LightQueueUnderflowError): void => {
  expect(failure._tag).toBe('LightQueueUnderflowError')
  expect(Number.isSafeInteger(failure.index)).toBe(true)
}

const expectChunkLight = (light: ChunkLight): void => {
  expect(light.sky).toBeInstanceOf(Uint8Array)
  expect(light.sky).toHaveLength(LIGHT_BYTE_LENGTH)
  expect(light.block).toBeInstanceOf(Uint8Array)
  expect(light.block).toHaveLength(LIGHT_BYTE_LENGTH)
}

const expectStateLightCache = (state: ChunkStoreState): void => {
  expect(state.lights.size).toBe(state.loaded.size)
  for (const light of state.lights.values()) expectChunkLight(light)
}

const expectLightReading = (reading: LightReading, y: number): void => {
  if (y < 0 || y >= CHUNK_HEIGHT) {
    expect(reading).toStrictEqual({ _tag: 'OutOfWorld' })
  } else {
    expect(reading._tag).toBe('Light')
    if (reading._tag === 'Light') {
      expect(reading.sky).toBeGreaterThanOrEqual(0)
      expect(reading.sky).toBeLessThanOrEqual(15)
      expect(reading.block).toBeGreaterThanOrEqual(0)
      expect(reading.block).toBeLessThanOrEqual(15)
    }
  }
}

const expectLightMap = (loaded: ReadonlyMap<string, Chunk>, lights: ReadonlyMap<string, ChunkLight>): void => {
  expect(Array.from(lights.keys())).toStrictEqual(Array.from(loaded.keys()))
  for (const key of loaded.keys()) {
    const light = lights.get(key)
    expect(light).toBeDefined()
    if (light !== undefined) expectChunkLight(light)
  }
}

const expectFailureOrLightMap = (
  loaded: ReadonlyMap<string, Chunk>,
  result: Result.Result<ReadonlyMap<string, ChunkLight>, LightQueueUnderflowError>,
): void => {
  if (Result.isFailure(result)) {
    expectUnderflow(result.failure)
  } else {
    expectLightMap(loaded, result.success)
  }
}

describe('light propagation Result properties', () => {
  it('returns a value or indexed typed failure for arbitrary queue reads without throwing', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer(), { maxLength: 20 }),
        fc.integer({ min: -2, max: 22 }),
        (queue, index) => {
          const result = readQueueValue(queue, index)
          if (Result.isFailure(result)) {
            expect(result.failure).toMatchObject({ _tag: 'LightQueueUnderflowError', index })
          } else {
            expect(index).toBeGreaterThanOrEqual(0)
            expect(index).toBeLessThan(queue.length)
            expect(result.success).toBe(queue[index])
          }
        },
      ),
      { numRuns: 100 },
    )
  })

  it('returns a source or indexed typed failure for arbitrary source tables without throwing', () => {
    const sourceChunk = makeChunk(0, 0, { base: BLOCK.STONE, edits: [] })
    const source = { chunk: sourceChunk, light: emptyChunkLight(), sourceIndex: 0 }

    fc.assert(
      fc.property(
        fc.array(fc.constant(source), { maxLength: 20 }),
        fc.integer({ min: -2, max: 22 }),
        (sourceTable, index) => {
          const result = sourceAt(sourceTable, index)
          if (Result.isFailure(result)) {
            expect(result.failure).toMatchObject({ _tag: 'LightQueueUnderflowError', index })
          } else {
            expect(index).toBeGreaterThanOrEqual(0)
            expect(index).toBeLessThan(sourceTable.length)
            expect(result.success).toBe(sourceTable[index])
          }
        },
      ),
      { numRuns: 100 },
    )
  })

  it('computes a valid chunk light or returns the typed underflow for arbitrary valid chunks', () => {
    fc.assert(
      fc.property(arbitraryChunk, (chunk) => {
        const result = computeChunkLight(chunk)
        if (Result.isFailure(result)) {
          expectUnderflow(result.failure)
        } else {
          expectChunkLight(result.success)
        }
      }),
      { numRuns: 40 },
    )
  })

  it('computes valid keyed light grids or returns the typed underflow for arbitrary chunk sets', () => {
    const arbitraryLoaded = fc.record({
      cx: fc.integer({ min: -4, max: 4 }),
      cz: fc.integer({ min: -4, max: 4 }),
      shapes: fc.array(arbitraryChunkShape, { maxLength: 3 }),
    }).map(({ cx, cz, shapes }) => {
      const loaded = new Map<string, Chunk>()
      shapes.forEach((shape, index) => loaded.set(`chunk-${index}`, makeChunk(cx + index, cz, shape)))
      return loaded
    })

    fc.assert(
      fc.property(arbitraryLoaded, (loaded) => {
        expectFailureOrLightMap(loaded, computeChunkLights(loaded))
      }),
      { numRuns: 40 },
    )
  })

  it('updates valid keyed light grids or returns the typed underflow for arbitrary changes and cache states', () => {
    const arbitraryUpdate = fc.record({
      cx: fc.integer({ min: -4, max: 4 }),
      cz: fc.integer({ min: -4, max: 4 }),
      shape: arbitraryChunkShape,
      cached: fc.boolean(),
      changes: fc.array(
        fc.record({
          x: fc.integer({ min: -1, max: CHUNK_SIZE_XZ }),
          y: fc.integer({ min: -1, max: CHUNK_HEIGHT }),
          z: fc.integer({ min: -1, max: CHUNK_SIZE_XZ }),
        }),
        { maxLength: 8 },
      ),
    })

    fc.assert(
      fc.property(arbitraryUpdate, ({ cx, cz, shape, cached, changes }) => {
        const chunk = makeChunk(cx, cz, shape)
        const loaded = new Map<string, Chunk>([['chunk', chunk]])
        const current = new Map<string, ChunkLight>()
        if (cached) current.set('chunk', emptyChunkLight())
        const lightChanges: ReadonlyArray<ChunkLightChange> = changes.map(({ x, y, z }) => ({
          coord: chunk.coord,
          x,
          y,
          z,
        }))

        expectFailureOrLightMap(loaded, updateChunkLights(loaded, current, lightChanges))
      }),
      { numRuns: 40 },
    )
  })

  it('reads light or returns the typed underflow for arbitrary positions in a resident chunk', () => {
    const arbitraryRead = fc.record({
      cx: fc.integer({ min: -4, max: 4 }),
      cz: fc.integer({ min: -4, max: 4 }),
      shape: arbitraryChunkShape,
      x: fc.integer({ min: 0, max: CHUNK_SIZE_XZ - 1 }),
      y: fc.integer({ min: -1, max: CHUNK_HEIGHT }),
      z: fc.integer({ min: 0, max: CHUNK_SIZE_XZ - 1 }),
    })

    fc.assert(
      fc.property(arbitraryRead, ({ cx, cz, shape, x, y, z }) => {
        const chunk = makeChunk(cx, cz, shape)
        const state = withChunk(emptyChunkStoreState, chunk)
        const result = lightAt(state, positionInChunk(cx, cz, x, y, z))

        if (Result.isFailure(result)) {
          expectUnderflow(result.failure)
        } else {
          expectLightReading(result.success[0], y)
          if (y < 0 || y >= CHUNK_HEIGHT) {
            expect(result.success[1]).toBe(state)
          } else {
            expect(result.success[1].loaded).toBe(state.loaded)
            expectStateLightCache(result.success[1])
          }
        }
      }),
      { numRuns: 30 },
    )
  })

  it('writes a block or returns the typed underflow without leaving partial state', () => {
    fc.assert(
      fc.property(arbitraryValidWrite, ({ cx, cz, shape, x, y, z, block }) => {
        const chunk = makeChunk(cx, cz, shape)
        const position = positionInChunk(cx, cz, x, y, z)
        const voxel = blockIndex(x, y, z)
        const state = withChunk(emptyChunkStoreState, chunk)
        const lightResult = lightAt(state, position)
        const blocksBefore = chunk.blocks.slice()

        if (Result.isFailure(lightResult)) {
          expectUnderflow(lightResult.failure)
          expect(Array.from(chunk.blocks)).toStrictEqual(Array.from(blocksBefore))
          return
        }

        const stateWithLight = lightResult.success[1]
        const lightsBefore = stateWithLight.lights
        const blockStatesBefore = Array.from(stateWithLight.loaded.values())[0]?.blockStates.slice()
        const lightSnapshots = Array.from(lightsBefore.values(), (light) => ({
          sky: light.sky.slice(),
          block: light.block.slice(),
        }))
        const writeResult = withBlockAt(stateWithLight, position, block)

        if (Result.isFailure(writeResult)) {
          if (writeResult.failure._tag !== 'LightQueueUnderflowError') {
            throw new Error(`Unexpected block-state codec failure: ${writeResult.failure.reason}`)
          }
          expectUnderflow(writeResult.failure)
          expect(stateWithLight.loaded).toBe(state.loaded)
          expect(stateWithLight.lights).toBe(lightsBefore)
          expect(Array.from(chunk.blocks)).toStrictEqual(Array.from(blocksBefore))
          expect(Array.from(stateWithLight.loaded.values())[0]?.blockStates).toStrictEqual(blockStatesBefore)
          for (const [index, light] of Array.from(lightsBefore.values()).entries()) {
            const snapshot = lightSnapshots[index]
            expect(snapshot).toBeDefined()
            if (snapshot !== undefined) {
              expect(Array.from(light.sky)).toStrictEqual(Array.from(snapshot.sky))
              expect(Array.from(light.block)).toStrictEqual(Array.from(snapshot.block))
            }
          }
          return
        }

        const [outcome, nextState] = writeResult.success
        if (blocksBefore[voxel] === block) {
          expect(outcome._tag).toBe('Unchanged')
          expect(nextState).toBe(stateWithLight)
          expect(Array.from(chunk.blocks)).toStrictEqual(Array.from(blocksBefore))
        } else {
          expect(outcome._tag).toBe('Written')
          expect(nextState.loaded).toBe(stateWithLight.loaded)
          expect(chunk.blocks[voxel]).toBe(block)
          expectStateLightCache(nextState)
        }
      }),
      { numRuns: 30 },
    )
  })

  it('publishes a prepared write or returns the typed underflow without mutating the prior state', () => {
    fc.assert(
      fc.property(arbitraryValidWrite, ({ cx, cz, shape, x, y, z, block }) => {
        const chunk = makeChunk(cx, cz, shape)
        const position = positionInChunk(cx, cz, x, y, z)
        const voxel = blockIndex(x, y, z)
        const state = withChunk(emptyChunkStoreState, chunk)
        const lightResult = lightAt(state, position)
        const blocksBefore = chunk.blocks.slice()

        if (Result.isFailure(lightResult)) {
          expectUnderflow(lightResult.failure)
          expect(Array.from(chunk.blocks)).toStrictEqual(Array.from(blocksBefore))
          return
        }

        const stateWithLight = lightResult.success[1]
        const preparation = prepareBlockWrite(stateWithLight, position, block)
        expect(preparation._tag).toBe('Prepared')
        if (preparation._tag !== 'Prepared') return

        const publishResult = publishPreparedBlockWrite(stateWithLight, preparation.candidate)
        if (Result.isFailure(publishResult)) {
          expectUnderflow(publishResult.failure)
          expect(stateWithLight.loaded).toBe(state.loaded)
          expect(stateWithLight.lights).toBe(lightResult.success[1].lights)
          expect(Array.from(chunk.blocks)).toStrictEqual(Array.from(blocksBefore))
          return
        }

        const nextState = publishResult.success
        expect(Array.from(chunk.blocks)).toStrictEqual(Array.from(blocksBefore))
        if (preparation.candidate.changedChunks.length === 0) {
          expect(nextState).toBe(stateWithLight)
        } else {
          expect(nextState.loaded).not.toBe(stateWithLight.loaded)
          expectStateLightCache(nextState)
          const publishedChunk = Array.from(nextState.loaded.values())[0]
          expect(publishedChunk).toBeDefined()
          if (publishedChunk !== undefined) expect(publishedChunk.blocks[voxel]).toBe(block)
        }
      }),
      { numRuns: 30 },
    )
  })
})
