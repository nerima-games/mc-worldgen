import { describe, expect, it } from '@effect/vitest'
import { vi } from 'vitest'
import { BLOCK } from '../src/domain/biome'
import { carveCaves, CAVE_FLOOR_Y } from '../src/domain/carver'
import { blockIndex, CHUNK_VOLUME, CHUNK_SIZE_XZ } from '../src/domain/constants'
import { noiseSeed, validatedChunkCoord } from './fixtures/validated-inputs'

const caveNoise = vi.hoisted(() => ({ sample: vi.fn(() => 0) }))

vi.mock('@nerima-games/mc-noise', async () => {
  const actual = await vi.importActual<typeof import('@nerima-games/mc-noise')>('@nerima-games/mc-noise')
  return {
    ...actual,
    createNoiseField: vi.fn(() => ({ noise3d: caveNoise.sample })),
  }
})

const SEED = noiseSeed(7)
const COORD = validatedChunkCoord(0, 0)
// 255 dry columns sample 51 stone voxels each; the water column samples 50.
const EXPECTED_NOISE_CALLS = 13_055

const caveNoiseCountFixture = (): Uint16Array => {
  const blocks = new Uint16Array(CHUNK_VOLUME).fill(BLOCK.STONE)

  for (let lx = 0; lx < CHUNK_SIZE_XZ; lx += 1) {
    for (let lz = 0; lz < CHUNK_SIZE_XZ; lz += 1) {
      blocks[blockIndex(lx, CAVE_FLOOR_Y, lz)] = BLOCK.BEDROCK
      blocks[blockIndex(lx, CAVE_FLOOR_Y + 1, lz)] = BLOCK.AIR
    }
  }

  blocks[blockIndex(0, CAVE_FLOOR_Y + 2, 0)] = BLOCK.WATER
  return blocks
}

describe('cave noise call count', () => {
  it('skips noise for air, water, and bedrock voxels', () => {
    const blocks = caveNoiseCountFixture()
    caveNoise.sample.mockClear()

    const result = carveCaves(blocks, SEED, COORD)

    expect(result).toMatchObject({ _tag: 'Success' })
    expect(caveNoise.sample).toHaveBeenCalledTimes(EXPECTED_NOISE_CALLS)
  })
})
