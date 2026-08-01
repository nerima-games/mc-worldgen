import { describe, expect, it } from '@effect/vitest'
import { CHUNK_HEIGHT, CHUNK_VOLUME, blockIndex } from '../src/domain/constants'
import {
  END_BASE_Y,
  END_OUTER_ISLAND_START,
  END_STONE_BLOCK_ID,
  endSurfaceHeightAt,
  generateEndChunkAt,
} from '../src/domain/end-terrain'

describe('End terrain', () => {
  it('builds a solid central island and labels every column as END', () => {
    const chunk = generateEndChunkAt(42, 0, 0)
    const surface = endSurfaceHeightAt(42, 0, 0)

    expect(chunk.blocks).toHaveLength(CHUNK_VOLUME)
    expect(surface).toBeGreaterThanOrEqual(END_BASE_Y)
    expect(chunk.blocks[blockIndex(0, surface ?? 0, 0)]).toBe(END_STONE_BLOCK_ID)
    expect(new Set(chunk.biomes)).toStrictEqual(new Set(['END']))
  })

  it('leaves the ring between the central and outer islands as void', () => {
    expect(endSurfaceHeightAt(42, 200, 0)).toBeUndefined()
    expect(generateEndChunkAt(42, 12, 0).blocks.every((block) => block === 0)).toBe(true)
  })

  it('creates seed-dependent outer islands beyond the void ring', () => {
    const columns = Array.from({ length: 512 }, (_, index) => END_OUTER_ISLAND_START + index)
    const first = columns.map((x) => endSurfaceHeightAt(1, x, 0))
    const second = columns.map((x) => endSurfaceHeightAt(2, x, 0))

    expect(first.some((height) => height !== undefined)).toBe(true)
    expect(first).not.toStrictEqual(second)
  })

  it('is deterministic and writes only air or end stone within chunk bounds', () => {
    const first = generateEndChunkAt(20260801, 40, -18)
    const second = generateEndChunkAt(20260801, 40, -18)

    expect(first).toStrictEqual(second)
    expect(first.blocks.every((block) => block === 0 || block === END_STONE_BLOCK_ID)).toBe(true)
    expect(first.blocks).toHaveLength(16 * 16 * CHUNK_HEIGHT)
  })
})
