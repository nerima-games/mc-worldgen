import { describe, expect, it } from '@effect/vitest'
import { Result } from 'effect'
import { BlockId, chunkKeyOf } from '@nerima-games/mc-kernel'
import { encodeBlockState } from '@nerima-games/mc-kernel/domain/block-state'
import { vi } from 'vitest'
import { BLOCK } from '../src/domain/biome'
import { emptyBlockStates, emptyBlocks, readBlock, type ChunkWithBlockStates } from '../src/domain/chunk'
import { blockIndex, CHUNK_HEIGHT, CHUNK_SIZE_XZ } from '../src/domain/constants'
import { blockAxis, validatedBlockPosition as blockPosition, validatedChunkCoord as chunkCoord } from './fixtures/validated-inputs'

const lightFunctions = vi.hoisted(() => ({
  computeChunkLights: vi.fn(),
  updateChunkLights: vi.fn(),
}))

vi.mock('../src/domain/light.js', async () => {
  const actual = await vi.importActual<typeof import('../src/domain/light.js')>('../src/domain/light.js')
  return {
    ...actual,
    computeChunkLights: lightFunctions.computeChunkLights,
    updateChunkLights: lightFunctions.updateChunkLights,
  }
})

import { emptyChunkLight, LightQueueUnderflowError, computeChunkLights, updateChunkLights } from '../src/domain/light'
import {
  blockWithStateAt,
  emptyChunkStoreState,
  drained,
  lightAt,
  prepareBlockWrite,
  publishPreparedBlockWrite,
  subscribed,
  withBlockAt,
  withChunk,
  type ChunkStoreState,
} from '../src/domain/chunk-store-state'

const COORD = chunkCoord(0, 0)
const POSITION = blockPosition(1, blockAxis(10), 1)
const CHUNK: ChunkWithBlockStates = {
  coord: COORD,
  blocks: emptyBlocks(),
  blockStates: emptyBlockStates(),
  biomes: Array.from({ length: CHUNK_SIZE_XZ * CHUNK_SIZE_XZ }, () => 'PLAINS' as const),
}
const FAILURE = new LightQueueUnderflowError({ index: 0 })

const stateWithCompleteLightCache = (): ChunkStoreState => {
  const resident = withChunk(emptyChunkStoreState, CHUNK)
  return {
    ...resident,
    lights: new Map([[chunkKeyOf(COORD), emptyChunkLight()]]),
  }
}

describe('ChunkStoreState typed light failures', () => {
  it('rejects a state value the block codec does not allow', () => {
    const expected = encodeBlockState(BLOCK.STONE, { axis: 'x' })
    const result = withBlockAt(emptyChunkStoreState, POSITION, BLOCK.STONE, { axis: 'x' })

    expect(Result.isFailure(expected)).toBe(true)
    expect(Result.isFailure(result)).toBe(true)
    if (Result.isFailure(expected) && Result.isFailure(result)) {
      expect(result.failure).toStrictEqual(expected.failure)
    }
  })

  it('keeps the full chunk bounds when a resident chunk is replaced', () => {
    const [subscriber, subscribedState] = subscribed(emptyChunkStoreState)
    const loaded = withChunk(subscribedState, CHUNK)
    const replaced = withChunk(loaded, CHUNK)
    const [batch] = drained(replaced, subscriber)

    expect(batch.changed).toStrictEqual([{
      ...COORD,
      min: [0, 0, 0],
      max: [CHUNK_SIZE_XZ, CHUNK_HEIGHT, CHUNK_SIZE_XZ],
    }])
  })

  it('reads the empty encoded default when a state buffer is short', () => {
    const shortChunk = { ...CHUNK, blockStates: new Uint32Array(0) }
    const state = withChunk(emptyChunkStoreState, shortChunk)
    const reading = blockWithStateAt(state, POSITION)

    expect(Result.isSuccess(reading)).toBe(true)
    if (Result.isSuccess(reading)) {
      expect(reading.success).toStrictEqual({
        _tag: 'Block',
        block: BLOCK.AIR,
        dimensionRevision: state.revisionClock,
      })
    }
  })

  it('rolls a block buffer back when incremental relighting fails', () => {
    vi.mocked(updateChunkLights).mockReturnValue(Result.fail(FAILURE))
    const state = stateWithCompleteLightCache()
    const originalBlocks = state.loaded.get(chunkKeyOf(COORD))?.blocks
    const originalBlockStates = state.loaded.get(chunkKeyOf(COORD))?.blockStates

    const result = withBlockAt(state, POSITION, Result.getOrThrow(BlockId.result(BLOCK.STONE)))

    expect(Result.isFailure(result)).toBe(true)
    if (Result.isFailure(result)) {
      expect(result.failure).toBe(FAILURE)
    }
    expect(originalBlocks).toBeDefined()
    if (originalBlocks !== undefined) {
      expect(readBlock(originalBlocks, blockIndex(POSITION.x, POSITION.y, POSITION.z))).toBe(BLOCK.AIR)
    }
    expect(state.loaded.get(chunkKeyOf(COORD))?.blocks).toBe(originalBlocks)
    expect(state.loaded.get(chunkKeyOf(COORD))?.blockStates).toBe(originalBlockStates)
  })

  it('returns a failed prepared publish without exposing the candidate chunk', () => {
    vi.mocked(updateChunkLights).mockReturnValue(Result.fail(FAILURE))
    const state = stateWithCompleteLightCache()
    const prepared = prepareBlockWrite(state, POSITION, Result.getOrThrow(BlockId.result(BLOCK.STONE)))
    expect(prepared['_tag']).toBe('Prepared')
    if (prepared['_tag'] !== 'Prepared') {
      return
    }

    const originalLoaded = state.loaded
    const originalBlocks = state.loaded.get(chunkKeyOf(COORD))?.blocks
    const originalBlockStates = state.loaded.get(chunkKeyOf(COORD))?.blockStates
    const result = publishPreparedBlockWrite(state, prepared.candidate)

    expect(Result.isFailure(result)).toBe(true)
    if (Result.isFailure(result)) {
      expect(result.failure).toBe(FAILURE)
    }
    expect(state.loaded).toBe(originalLoaded)
    expect(state.loaded.get(chunkKeyOf(COORD))?.blocks).toBe(originalBlocks)
    expect(state.loaded.get(chunkKeyOf(COORD))?.blockStates).toBe(originalBlockStates)
    expect(originalBlocks?.[blockIndex(POSITION.x, POSITION.y, POSITION.z)]).toBe(BLOCK.AIR)
  })

  it('returns a cold-cache light calculation failure without changing state', () => {
    vi.mocked(computeChunkLights).mockReturnValue(Result.fail(FAILURE))
    const state = withChunk(emptyChunkStoreState, CHUNK)

    const result = lightAt(state, POSITION)

    expect(Result.isFailure(result)).toBe(true)
    if (Result.isFailure(result)) {
      expect(result.failure).toBe(FAILURE)
    }
    expect(state.lights.size).toBe(0)
    expect(state.loaded.get(chunkKeyOf(COORD))).toBe(CHUNK)
    expect(state.loaded.get(chunkKeyOf(COORD))?.blockStates).toBe(CHUNK.blockStates)
  })

  it('does not recompute lights for a block-state-only write', () => {
    const index = blockIndex(POSITION.x, POSITION.y, POSITION.z)
    const blocks = emptyBlocks()
    blocks[index] = BLOCK.LOG
    const blockStates = emptyBlockStates()
    blockStates[index] = Result.getOrThrow(encodeBlockState(BLOCK.LOG, { axis: 'x' }))
    const chunk = { ...CHUNK, blocks, blockStates }
    const resident = withChunk(emptyChunkStoreState, chunk)
    const state: ChunkStoreState = {
      ...resident,
      lights: new Map([[chunkKeyOf(COORD), emptyChunkLight()]]),
    }
    vi.mocked(updateChunkLights).mockClear()

    const result = withBlockAt(state, POSITION, BLOCK.LOG, { axis: 'z' })

    expect(Result.isSuccess(result)).toBe(true)
    if (Result.isSuccess(result)) {
      expect(result.success[0]).toStrictEqual({ _tag: 'Written', previous: BLOCK.LOG, chunk: COORD })
      expect(result.success[1].lights).toBe(state.lights)
      expect(result.success[1].loaded.get(chunkKeyOf(COORD))?.blockStates[index]).toBe(
        Result.getOrThrow(encodeBlockState(BLOCK.LOG, { axis: 'z' })),
      )
    }
    expect(updateChunkLights).not.toHaveBeenCalled()
  })
})
