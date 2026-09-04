/* oxlint-disable id-length, max-lines-per-function, max-statements, no-magic-numbers, no-undefined, sort-imports */

import { describe, expect, it } from '@effect/vitest'
import { AIR_BLOCK_ID, blockIdOf, chunkCoord, type BlockId, type ChunkCoord } from '@nerima-games/mc-kernel'
import { blockIndex, CHUNK_HEIGHT, CHUNK_SIZE_XZ } from '../src/domain/constants'
import { emptyBlocks, readBlock, setBlockAt, type Chunk } from '../src/domain/chunk'
import {
  END_OUTER_ISLAND_START,
  endSurfaceHeightAt,
  generateEndChunk,
  generateEndTerrainChunk,
} from '../src/domain/end-terrain'
import {
  applyEndChorusPlansToChunk,
  END_VEGETATION_BLOCK,
  endChorusPlanForChunk,
  type EndChorusPlacement,
  type EndChorusPlan,
  type EndChorusPlant,
} from '../src/domain/end-vegetation'

const emptyChunk = (coord: ChunkCoord): Chunk => ({
  blocks: emptyBlocks(),
  biomes: Array.from({ length: CHUNK_SIZE_XZ * CHUNK_SIZE_XZ }, () => 'END' as const),
  coord,
})

const makePlacement = (block: BlockId, x: number, y: number, z: number): EndChorusPlacement => ({
  block,
  x,
  y,
  z,
})

const makePlant = (
  baseX: number,
  baseY: number,
  baseZ: number,
  placements: ReadonlyArray<EndChorusPlacement>,
): EndChorusPlant => ({ baseX, baseY, baseZ, placements })

const makePlan = (id: string, plants: ReadonlyArray<EndChorusPlant>): EndChorusPlan => ({
  dimension: 'end',
  id,
  plants,
})

describe('End vegetation', () => {
  it('creates deterministic immutable plants with and without branches', () => {
    const input = {
      coord: chunkCoord(0, 0),
      isOuterIsland: () => true,
      seed: 0,
      surfaceHeightAt: () => 64,
    }
    const first = endChorusPlanForChunk(input)
    const second = endChorusPlanForChunk(input)

    expect(first).toStrictEqual(second)
    expect(first.dimension).toBe('end')
    expect(first.plants.length).toBeGreaterThan(0)
    expect(first.plants.some((plant) => plant.placements.some(({ x, z }) => x !== plant.baseX || z !== plant.baseZ))).toBe(
      true,
    )
    expect(first.plants.some((plant) => plant.placements.every(({ x, z }) => x === plant.baseX && z === plant.baseZ))).toBe(
      true,
    )
    expect(first.plants.every((plant) => plant.placements.every(({ block }) =>
      block === END_VEGETATION_BLOCK.CHORUS_FLOWER || block === END_VEGETATION_BLOCK.CHORUS_PLANT,
    ))).toBe(true)
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first.plants)).toBe(true)
    expect(Object.isFrozen(first.plants[0])).toBe(true)
    expect(Object.isFrozen(first.plants[0]?.placements)).toBe(true)
    expect(Object.isFrozen(first.plants[0]?.placements[0])).toBe(true)
  })

  it('rejects non-island and invalid surface candidates, including empty chunks', () => {
    const base = {
      coord: chunkCoord(0, 0),
      isOuterIsland: () => true,
      seed: 0,
      surfaceHeightAt: () => 64,
    }

    expect(endChorusPlanForChunk({ ...base, isOuterIsland: () => false }).plants).toStrictEqual([])
    expect(endChorusPlanForChunk({ ...base, surfaceHeightAt: () => undefined }).plants).toStrictEqual([])
    expect(endChorusPlanForChunk({ ...base, surfaceHeightAt: () => -1 }).plants).toStrictEqual([])
    expect(endChorusPlanForChunk({ ...base, surfaceHeightAt: () => 64.5 }).plants).toStrictEqual([])
    expect(endChorusPlanForChunk({ ...base, surfaceHeightAt: () => 250 }).plants).toStrictEqual([])
    expect(endChorusPlanForChunk({ ...base, coord: chunkCoord(1, 9) }).plants).toStrictEqual([])
  })

  it('applies only supported, local, air targets without mutating the source', () => {
    const source = emptyChunk(chunkCoord(0, 0))
    const endStone = END_VEGETATION_BLOCK.END_STONE
    const stone = blockIdOf('stone')
    setBlockAt(source.blocks, 1, 64, 1, endStone)
    setBlockAt(source.blocks, 2, 64, 2, stone)
    setBlockAt(source.blocks, 2, 65, 2, stone)

    const validPlant = makePlant(1, 65, 1, [
      makePlacement(END_VEGETATION_BLOCK.CHORUS_PLANT, 1, 65, 1),
      makePlacement(END_VEGETATION_BLOCK.CHORUS_FLOWER, 1, 66, 1),
      makePlacement(END_VEGETATION_BLOCK.CHORUS_PLANT, 0, 65, 1),
      makePlacement(END_VEGETATION_BLOCK.CHORUS_FLOWER, 1, 65, 0),
      makePlacement(END_VEGETATION_BLOCK.CHORUS_PLANT, -1, 65, 1),
      makePlacement(END_VEGETATION_BLOCK.CHORUS_PLANT, 1, 65, -1),
      makePlacement(END_VEGETATION_BLOCK.CHORUS_PLANT, 1, -1, 1),
      makePlacement(END_VEGETATION_BLOCK.CHORUS_PLANT, 1, CHUNK_HEIGHT, 1),
      makePlacement(END_VEGETATION_BLOCK.CHORUS_PLANT, 2, 65, 2),
    ])
    const invalidBaseX = makePlant(-1, 65, 1, [])
    const invalidBaseZ = makePlant(1, 65, -1, [])
    const invalidBaseY = makePlant(1, CHUNK_HEIGHT, 1, [])
    const zeroBaseY = makePlant(1, 0, 1, [])
    const unsupportedFloor = makePlant(3, 65, 3, [])
    const applied = applyEndChorusPlansToChunk(source, [
      makePlan('b', [validPlant]),
      makePlan('a', [invalidBaseX, invalidBaseZ, invalidBaseY, zeroBaseY, unsupportedFloor]),
      makePlan('b', [validPlant]),
    ])
    const untouched = applyEndChorusPlansToChunk(source, [])

    expect(applied.blocks).not.toBe(source.blocks)
    expect(source.blocks[blockIndex(1, 65, 1)]).toBe(AIR_BLOCK_ID)
    expect(applied.blocks[blockIndex(1, 65, 1)]).toBe(END_VEGETATION_BLOCK.CHORUS_PLANT)
    expect(applied.blocks[blockIndex(1, 66, 1)]).toBe(END_VEGETATION_BLOCK.CHORUS_FLOWER)
    expect(applied.blocks[blockIndex(0, 65, 1)]).toBe(END_VEGETATION_BLOCK.CHORUS_PLANT)
    expect(applied.blocks[blockIndex(1, 65, 0)]).toBe(END_VEGETATION_BLOCK.CHORUS_FLOWER)
    expect(readBlock(applied.blocks, blockIndex(2, 65, 2))).toBe(stone)
    expect(readBlock(applied.blocks, blockIndex(15, 65, 15))).toBe(AIR_BLOCK_ID)
    expect(untouched.blocks).toStrictEqual(source.blocks)
  })

  it('connects deterministic chorus plans to generated End chunks', () => {
    const seed = 0
    const coord = chunkCoord(24, 20)
    const plan = endChorusPlanForChunk({
      coord,
      isOuterIsland: (worldX, worldZ) => Math.hypot(worldX, worldZ) >= END_OUTER_ISLAND_START,
      seed,
      surfaceHeightAt: endSurfaceHeightAt,
    })
    const terrain = generateEndTerrainChunk(seed, coord)
    const generated = generateEndChunk(seed, coord)
    const chorusBlocks = new Set<number>([
      END_VEGETATION_BLOCK.CHORUS_FLOWER,
      END_VEGETATION_BLOCK.CHORUS_PLANT,
    ])
    const chorusCount = (blocks: Uint16Array): number => blocks.reduce(
      (count, block) => count + (chorusBlocks.has(block) ? 1 : 0),
      0,
    )

    expect(plan.plants.length).toBeGreaterThan(0)
    expect(chorusCount(terrain.blocks)).toBe(0)
    expect(chorusCount(generated.blocks)).toBeGreaterThan(0)
    expect(generated.blocks).not.toStrictEqual(terrain.blocks)
  })
})
