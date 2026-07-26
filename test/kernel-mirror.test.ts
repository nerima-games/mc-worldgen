/**
 * The kernel mirror is pinned against kernel's documented shape.
 *
 * Same defence, and the same reasoning, as `mc-sim/test/kernel-mirror.test.ts`:
 * `domain/kernel-vocabulary.ts` promises that deleting it and repointing every
 * import at the published package will typecheck, and nothing but a test can
 * enforce that promise. Kernel's declarations are RESTATED here rather than
 * imported, because mc-kernel is not published — which is the same reason the
 * mirror exists at all. When it is published, each restatement becomes an
 * `import type` and every assertion below keeps its meaning unchanged.
 *
 * This repository's mirror has one hazard mc-sim's does not: the block ids.
 * `domain/biome.ts`'s `BLOCK` constant and kernel's `BLOCK_REGISTRY` must agree
 * on eleven numbers, and those numbers are a SAVE FORMAT. A drift is not a
 * compile error anywhere in the organisation — it is a world whose deserts load
 * as oceans. It is checked here, in both directions, block by block.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { BLOCK } from '../domain/biome'
import { CHUNK_SIZE_XZ as CONSTANTS_CHUNK_SIZE_XZ } from '../domain/constants'
import {
  AIR_BLOCK_ID,
  BLOCK_ID_MAX,
  BlockAxis,
  BlockId,
  blockPosition,
  blockPositionOfChunkLocal,
  ChunkAxis,
  chunkCoord,
  chunkCoordOfBlock,
  LocalAxis,
  localCoordOfBlock,
  type BlockPosition,
  type ChunkCoord,
  type LocalBlockCoord,
} from '../domain/kernel-vocabulary'

describe('coordinate vocabulary matches mc-kernel/domain/coordinates.ts', () => {
  /** Kernel's `ChunkCoord`, restated from `mc-kernel/domain/coordinates.ts:87-90`. */
  type KernelChunkCoord = {
    readonly cx: ChunkAxis
    readonly cz: ChunkAxis
  }

  /** Kernel's `BlockPosition`, same source, lines 74-78. */
  type KernelBlockPosition = {
    readonly x: BlockAxis
    readonly y: BlockAxis
    readonly z: BlockAxis
  }

  /** Kernel's `LocalBlockCoord`, same source, lines 104-108. */
  type KernelLocalBlockCoord = {
    readonly lx: LocalAxis
    readonly ly: BlockAxis
    readonly lz: LocalAxis
  }

  it.effect('is assignable to kernel\'s shapes and back, field for field', () =>
    Effect.sync(() => {
      // The assertion is the ASSIGNMENT, in both directions. A field added,
      // removed or renamed on either side stops the build here rather than at
      // the repoint. The `expect`s exist only so the values are used.
      const asKernelChunk: KernelChunkCoord = chunkCoord(1, 2)
      const backFromKernelChunk: ChunkCoord = asKernelChunk
      const asKernelBlock: KernelBlockPosition = blockPosition(1, 2, 3)
      const backFromKernelBlock: BlockPosition = asKernelBlock
      const asKernelLocal: KernelLocalBlockCoord = localCoordOfBlock(blockPosition(17, 2, 33))
      const backFromKernelLocal: LocalBlockCoord = asKernelLocal

      expect(backFromKernelChunk).toStrictEqual({ cx: 1, cz: 2 })
      expect(backFromKernelBlock).toStrictEqual({ x: 1, y: 2, z: 3 })
      expect(backFromKernelLocal).toStrictEqual({ lx: 1, ly: 2, lz: 1 })
    }),
  )

  it.effect('spells the chunk axes cx/cz, not x/z', () =>
    Effect.sync(() => {
      const coord = chunkCoord(3, -7)
      expect(Object.keys(coord).sort()).toStrictEqual(['cx', 'cz'])
      expect(coord.cx).toBe(3)
      expect(coord.cz).toBe(-7)
    }),
  )

  it.effect('agrees with domain/constants.ts on the chunk width', () =>
    Effect.sync(() => {
      // The mirror consumes this constant rather than restating it; kernel's
      // `CHUNK_SIZE_XZ` is 16 too, and all three must stay one number.
      expect(CONSTANTS_CHUNK_SIZE_XZ).toBe(16)
    }),
  )

  it.effect('round-trips block <-> (chunk, local) including on the negative side', () =>
    Effect.sync(() => {
      // Kernel's stated invariant, `mc-kernel/domain/coordinates.ts:17`.
      for (const [x, y, z] of [
        [0, 0, 0],
        [15, 70, 15],
        [16, 70, 16],
        [-1, 12, -1],
        [-17, 250, -33],
        [1234, 5, -4321],
      ] as const) {
        const position = blockPosition(x, y, z)
        const back = blockPositionOfChunkLocal(chunkCoordOfBlock(position), localCoordOfBlock(position))
        expect(back).toStrictEqual(position)
      }
    }),
  )

  it.effect('normalises -0, so one chunk cannot have two map keys', () =>
    Effect.sync(() => {
      const negative = chunkCoordOfBlock(blockPosition(-1, 0, -1))
      expect(Object.is(negative.cx, -1)).toBe(true)

      const zero = chunkCoordOfBlock(blockPosition(-0, 0, -0))
      expect(Object.is(zero.cx, 0)).toBe(true)
      expect(Object.is(zero.cz, 0)).toBe(true)
      expect(`${zero.cx},${zero.cz}`).toBe('0,0')
    }),
  )

  it.effect('brands reject what kernel says they reject', () =>
    Effect.sync(() => {
      expect(() => BlockAxis(1.5)).toThrow()
      expect(() => ChunkAxis(Number.NaN)).toThrow()
      expect(() => LocalAxis(-1)).toThrow()
      expect(() => LocalAxis(CONSTANTS_CHUNK_SIZE_XZ)).toThrow()
      expect(LocalAxis(CONSTANTS_CHUNK_SIZE_XZ - 1)).toBe(15)
    }),
  )
})

describe('block ids match mc-kernel/domain/block-registry.ts', () => {
  /**
   * Kernel's assignment, transcribed from `BLOCK_REGISTRY`. These are the rows
   * kernel adopted FROM this repository, so the arrow of authorship runs the
   * other way from the rest of this file — but the agreement still has to be
   * checked, because either side can drift.
   */
  const KERNEL_IDS = {
    air: 0,
    bedrock: 1,
    stone: 2,
    dirt: 3,
    grass_block: 4,
    sand: 5,
    water: 6,
    snow: 7,
    gravel: 8,
    oak_log: 9,
    oak_leaves: 10,
  } as const

  it.effect('assigns the same number to every block this generator writes', () =>
    Effect.sync(() => {
      expect(BLOCK.AIR).toBe(KERNEL_IDS.air)
      expect(BLOCK.BEDROCK).toBe(KERNEL_IDS.bedrock)
      expect(BLOCK.STONE).toBe(KERNEL_IDS.stone)
      expect(BLOCK.DIRT).toBe(KERNEL_IDS.dirt)
      // This repository's generation vocabulary is not kernel's `BlockType`
      // vocabulary: GRASS is `grass_block`, LOG is `oak_log`, LEAVES is
      // `oak_leaves`. The NUMBERS are what cross the boundary.
      expect(BLOCK.GRASS).toBe(KERNEL_IDS.grass_block)
      expect(BLOCK.SAND).toBe(KERNEL_IDS.sand)
      expect(BLOCK.WATER).toBe(KERNEL_IDS.water)
      expect(BLOCK.SNOW).toBe(KERNEL_IDS.snow)
      expect(BLOCK.GRAVEL).toBe(KERNEL_IDS.gravel)
      expect(BLOCK.LOG).toBe(KERNEL_IDS.oak_log)
      expect(BLOCK.LEAVES).toBe(KERNEL_IDS.oak_leaves)
    }),
  )

  it.effect('leaves no id unaccounted for on this side', () =>
    Effect.sync(() => {
      // If a generator gains a block, this fails until the kernel row and the
      // transcription above are both updated.
      expect(Object.keys(BLOCK).length).toBe(Object.keys(KERNEL_IDS).length)
      expect(new Set(Object.values(BLOCK)).size).toBe(Object.keys(BLOCK).length)
    }),
  )

  it.effect('brands ids to the byte range the chunk buffer can hold', () =>
    Effect.sync(() => {
      expect(AIR_BLOCK_ID).toBe(0)
      expect(BLOCK_ID_MAX).toBe(255)
      expect(() => BlockId(-1)).toThrow()
      expect(() => BlockId(256)).toThrow()
      expect(() => BlockId(2.5)).toThrow()
    }),
  )
})
