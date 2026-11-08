import { describe, expect, it, vi } from 'vitest'
import { BlockId } from '@nerima-games/mc-kernel'
import { Result } from 'effect'
import { BLOCK } from '../src/domain/biome'
import { blockIndex, CHUNK_SIZE_XZ } from '../src/domain/constants'
import { emptyBlocks, type Chunk } from '../src/domain/chunk'
import { computeChunkLight, computeChunkLights } from '../src/domain/light'
import { chunkAxis, validatedChunkCoord } from './fixtures/validated-inputs'

const TORCH = Result.getOrThrow(BlockId.result(14))
const BIOMES = Array.from({ length: CHUNK_SIZE_XZ * CHUNK_SIZE_XZ }, () => 'PLAINS' as const)

const solidChunkWithTorch = (): Chunk => {
  const blocks = emptyBlocks()
  blocks.fill(BLOCK.STONE)
  blocks[blockIndex(1, 20, 1)] = TORCH
  return { blocks, biomes: BIOMES, coord: validatedChunkCoord(chunkAxis(0), chunkAxis(0)) }
}

const openChunkWithTorch = (): Chunk => {
  const blocks = emptyBlocks()
  blocks[blockIndex(1, 20, 1)] = TORCH
  return { blocks, biomes: BIOMES, coord: validatedChunkCoord(chunkAxis(0), chunkAxis(0)) }
}

// Drop one parallel-array append to exercise typed failure propagation for a corrupted queue.
const withSuppressedPush = <Value>(pushIndex: number, run: () => Value): Value => {
  let pushes = 0
  const originalPush = Array.prototype.push
  // eslint-disable-next-line no-extend-native -- Corrupt one internal queue append to exercise its typed failure path.
  Array.prototype.push = function <Item>(this: Item[], ...items: Item[]): number {
    pushes += 1
    if (pushes === pushIndex) {
      return this.length
    }
    return originalPush.apply(this, items)
  }

  try {
    return run()
  } finally {
    // eslint-disable-next-line no-extend-native -- Restore the built-in after the scoped fault injection.
    Array.prototype.push = originalPush
  }
}

const withSuppressedSourceEntry = <Value>(sourceIndex: number, run: () => Value): Value => {
  const originalPush = Array.prototype.push
  // eslint-disable-next-line no-extend-native -- Omit one source entry to exercise missing-source propagation.
  Array.prototype.push = function <Item>(this: Item[], ...items: Item[]): number {
    const item: unknown = items[0]
    if (
      items.length === 1 &&
      typeof item === 'object' &&
      item !== null &&
      'sourceIndex' in item &&
      item.sourceIndex === sourceIndex
    ) {
      return this.length
    }
    return originalPush.apply(this, items)
  }

  try {
    return run()
  } finally {
    // eslint-disable-next-line no-extend-native -- Restore the built-in after the scoped fault injection.
    Array.prototype.push = originalPush
  }
}

const withInvalidAdjacentIndex = <Value>(run: () => Value): { readonly lookups: number; readonly result: Value } => {
  const originalGet = Map.prototype.get
  let lookups = 0
  const getSpy = vi.spyOn(Map.prototype, 'get').mockImplementation(function <Key, MapValue>(
    this: Map<Key, MapValue>,
    key: Key,
  ): MapValue | undefined {
    if (this.size === 2 && typeof key === 'string') {
      lookups += 1
      return 99 as MapValue
    }
    return originalGet.call(this, key)
  })

  try {
    const result = run()
    return { lookups, result }
  } finally {
    getSpy.mockRestore()
  }
}

describe('light queue underflow propagation', () => {
  it('returns the indexed typed failure from single- and multi-chunk computation', () => {
    const chunk = solidChunkWithTorch()
    const single = withSuppressedPush(3, () => computeChunkLight(chunk))
    expect(Result.isFailure(single)).toBe(true)
    if (Result.isFailure(single)) {
      expect(single.failure).toMatchObject({ _tag: 'LightQueueUnderflowError', index: 0 })
    }

    const multiple = withSuppressedPush(5, () => computeChunkLights(new Map([['only', chunk]])))
    expect(Result.isFailure(multiple)).toBe(true)
    if (Result.isFailure(multiple)) {
      expect(multiple.failure).toMatchObject({ _tag: 'LightQueueUnderflowError', index: 0 })
    }

    const missingPackedValue = withSuppressedPush(2, () => computeChunkLight(chunk))
    expect(Result.isFailure(missingPackedValue)).toBe(true)
    if (Result.isFailure(missingPackedValue)) {
      expect(missingPackedValue.failure).toMatchObject({ _tag: 'LightQueueUnderflowError', index: 0 })
    }
  })

  it('returns a typed failure when a queued source table entry is missing during sky propagation', () => {
    const result = withSuppressedSourceEntry(0, () => computeChunkLights(new Map([['only', openChunkWithTorch()]])))

    expect(Result.isFailure(result)).toBe(true)
    if (Result.isFailure(result)) {
      expect(result.failure).toMatchObject({ _tag: 'LightQueueUnderflowError', index: 0 })
    }
  })

  it('returns a typed failure when a cross-chunk source index is absent', () => {
    const leftBlocks = emptyBlocks()
    leftBlocks.fill(BLOCK.STONE)
    leftBlocks[blockIndex(CHUNK_SIZE_XZ - 1, 20, 1)] = TORCH
    const left: Chunk = {
      blocks: leftBlocks,
      biomes: BIOMES,
      coord: validatedChunkCoord(chunkAxis(0), chunkAxis(0)),
    }
    const rightBlocks = emptyBlocks()
    rightBlocks.fill(BLOCK.STONE)
    const right: Chunk = {
      blocks: rightBlocks,
      biomes: BIOMES,
      coord: validatedChunkCoord(chunkAxis(1), chunkAxis(0)),
    }
    const loaded = new Map([['left', left], ['right', right]])
    const { lookups, result } = withInvalidAdjacentIndex(() => computeChunkLights(loaded))

    expect(Result.isFailure(result)).toBe(true)
    if (Result.isFailure(result)) {
      expect(result.failure).toMatchObject({ _tag: 'LightQueueUnderflowError', index: 99 })
    }
    expect(lookups).toBeGreaterThan(0)
  })
})
