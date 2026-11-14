import { describe, expect, it } from '@effect/vitest'
import { BlockId } from '@nerima-games/mc-kernel'
import { defaultBlockState, encodeBlockState } from '@nerima-games/mc-kernel/domain/block-state'
import { Result } from 'effect'
import { BLOCK } from '../src/domain/biome'
import { defaultBlockStatesFor } from '../src/domain/chunk'

const encodedDefaultState = (blockIdValue: number): number => {
  const blockId = BlockId(blockIdValue)
  const defaultState = Result.getOrThrow(defaultBlockState(blockId))
  return Result.getOrThrow(encodeBlockState(blockId, defaultState))
}

describe('defaultBlockStatesFor', () => {
  it('fills adjacent block-id runs and repeats defaults for later runs', () => {
    const blocks = Uint16Array.of(
      BLOCK.AIR,
      BLOCK.AIR,
      BLOCK.STONE,
      BLOCK.STONE,
      BLOCK.AIR,
      BLOCK.WATER,
      BLOCK.WATER,
      BLOCK.STONE,
    )

    const result = defaultBlockStatesFor(blocks)

    expect(Result.isSuccess(result)).toBe(true)
    if (Result.isFailure(result)) return
    expect(result.success).toStrictEqual(
      Uint32Array.from(blocks, (blockIdValue) => encodedDefaultState(blockIdValue)),
    )
  })
})
