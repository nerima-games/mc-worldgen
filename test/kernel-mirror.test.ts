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
  BLOCK_OPACITIES,
  BlockAxis,
  BlockId,
  blockPosition,
  blockPositionOfChunkLocal,
  ChunkAxis,
  chunkCoord,
  chunkCoordOfBlock,
  clampLightLevel,
  lightEmissionOfBlockId,
  LIGHT_LEVEL_MAX,
  LIGHT_LEVEL_MIN,
  LocalAxis,
  localCoordOfBlock,
  opacityOfBlockId,
  transmitsLight,
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

/**
 * The two PROPERTY columns, which are guarded here and nowhere else.
 *
 * `domain/kernel-vocabulary.ts`'s header names this gap rather than leaving it
 * to be found: mc-dev-meta's `pnpm check:mirrors` probes transcribed capability
 * FLAGS by importing kernel's `capabilityOfBlockId` and diffing all 256 ids, and
 * it has no property half. `lightEmission` and `opacity` are properties, so this
 * file is the whole of their defence.
 *
 * That is the weaker of the two guarantees available, and it is the same weaker
 * guarantee that let `replaceable` silently lose lava in mx-gameplay until the
 * cross-repository check was built. The rows below are therefore restated from
 * `mc-kernel/domain/block-registry.ts` WITH THEIR LINE NUMBERS, so that a
 * reviewer can check the transcription against the source without running
 * anything.
 */
describe('light columns match mc-kernel/domain/block-properties.ts', () => {
  it.effect('transcribes every emitting row, and no others', () =>
    Effect.sync(() => {
      // `block-registry.ts:372` lava 15, `:422` torch 14, `:438` glowstone 15.
      // Kernel's audit §5: `EMISSIVE_LEVEL_OVERRIDES` in the reference already
      // made `emissive: boolean` a lie, which is why this is a number.
      expect(lightEmissionOfBlockId(11)).toBe(15) // lava
      expect(lightEmissionOfBlockId(14)).toBe(14) // torch
      expect(lightEmissionOfBlockId(15)).toBe(15) // glowstone

      // The one-level gap between torch and glowstone is the whole reason the
      // column is not a boolean. If a future edit flattens it, this fails.
      expect(lightEmissionOfBlockId(14)).not.toBe(lightEmissionOfBlockId(15))
    }),
  )

  it.effect('defaults emission to kernel’s LIGHT_LEVEL_MIN for everything else', () =>
    Effect.sync(() => {
      expect(LIGHT_LEVEL_MIN).toBe(0)
      expect(LIGHT_LEVEL_MAX).toBe(15)

      expect(lightEmissionOfBlockId(BLOCK.AIR)).toBe(LIGHT_LEVEL_MIN)
      expect(lightEmissionOfBlockId(BLOCK.STONE)).toBe(LIGHT_LEVEL_MIN)
      expect(lightEmissionOfBlockId(BLOCK.WATER)).toBe(LIGHT_LEVEL_MIN)
      // Total, exactly as `resolveBlockProperties` is for an id kernel cannot
      // name: an unknown byte is an ordinary opaque cube that emits nothing.
      expect(lightEmissionOfBlockId(200)).toBe(LIGHT_LEVEL_MIN)
    }),
  )

  it.effect('transcribes kernel’s three opacity classes, in kernel’s order', () =>
    Effect.sync(() => {
      // Order is plan.md §3.3's render priority, not an alphabetisation, and
      // mc-render consumes all three. A local two-value enum would have to be
      // widened on the day this is published.
      expect(BLOCK_OPACITIES).toStrictEqual(['transparentSolid', 'fluid', 'opaque'])
    }),
  )

  it.effect('gives AIR a transparentSolid opacity, which is kernel’s row and not an oversight', () =>
    Effect.sync(() => {
      // `block-registry.ts:218`. Air really is in kernel's non-opaque table
      // rather than being a fourth class, and the whole light grid depends on
      // it: an air row that fell through to the `'opaque'` default would make a
      // world in which no light travels at all.
      expect(opacityOfBlockId(BLOCK.AIR)).toBe('transparentSolid')
      expect(transmitsLight(BLOCK.AIR)).toBe(true)
    }),
  )

  it.effect('keeps the fluid and transparentSolid rows apart from the opaque default', () =>
    Effect.sync(() => {
      // `:289` water fluid, `:348` oak_leaves transparentSolid, `:368` lava
      // fluid, `:398` glass transparentSolid, `:416` torch transparentSolid.
      expect(opacityOfBlockId(BLOCK.WATER)).toBe('fluid')
      expect(opacityOfBlockId(BLOCK.LEAVES)).toBe('transparentSolid')
      expect(opacityOfBlockId(11)).toBe('fluid') // lava
      expect(opacityOfBlockId(13)).toBe('transparentSolid') // glass
      expect(opacityOfBlockId(14)).toBe('transparentSolid') // torch

      // Everything else, including an id this build cannot name.
      expect(opacityOfBlockId(BLOCK.STONE)).toBe('opaque')
      expect(opacityOfBlockId(BLOCK.LOG)).toBe('opaque')
      expect(opacityOfBlockId(200)).toBe('opaque')
    }),
  )

  it.effect('GLOWSTONE IS OPAQUE AND STILL EMITS, which is the row that needs both columns', () =>
    Effect.sync(() => {
      // The case that proves the two columns are independent. Kernel gives
      // glowstone no `opacity` override, so it resolves to `'opaque'`, and gives
      // it `lightEmission: 15`. A transcription that inferred one from the other
      // — "emitters are transparent", or "opaque blocks are dark" — would get
      // this row wrong in whichever direction it guessed.
      expect(opacityOfBlockId(15)).toBe('opaque')
      expect(transmitsLight(15)).toBe(false)
      expect(lightEmissionOfBlockId(15)).toBe(15)
    }),
  )

  it.effect('clamps into the 4-bit range at both ends, like kernel’s clampLightLevel', () =>
    Effect.sync(() => {
      expect(clampLightLevel(-1)).toBe(0)
      expect(clampLightLevel(0)).toBe(0)
      expect(clampLightLevel(15)).toBe(15)
      expect(clampLightLevel(16)).toBe(15)
      // `Math.trunc`, so a fractional level from a save file becomes an integer
      // rather than a nibble that reads back as something else.
      expect(clampLightLevel(7.9)).toBe(7)
    }),
  )
})
