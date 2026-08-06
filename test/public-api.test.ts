import * as worldgen from '../src/index'
import { describe, expect, it } from '@effect/vitest'
import { CHUNK_FORMAT as DOMAIN_CHUNK_FORMAT } from '../src/domain/chunk-format'
import { resolveNetherTravel as DOMAIN_RESOLVE_NETHER_TRAVEL } from '../src/domain/nether-travel'
import { blockPosition } from '@nerima-games/mc-kernel'

const TEST_PLAYER_X = 0
const TEST_PLAYER_Y = 64
const TEST_PLAYER_POSITION = blockPosition(TEST_PLAYER_X, TEST_PLAYER_Y, TEST_PLAYER_X)

describe('public API surface', () => {
  it('publishes the chunk persistence format from the package root', () => {
    expect(worldgen.CHUNK_FORMAT).toBe(DOMAIN_CHUNK_FORMAT)
  })

  it('publishes the dimension type and nether travel resolver from the package root', () => {
    const dimensions: ReadonlyArray<worldgen.Dimension> = ['overworld', 'nether', 'end']

    expect(dimensions).toStrictEqual(['overworld', 'nether', 'end'])
    expect(worldgen.resolveNetherTravel).toBe(DOMAIN_RESOLVE_NETHER_TRAVEL)
    expect(worldgen.resolveNetherTravel('overworld', TEST_PLAYER_POSITION, []).toDimension).toBe('nether')
  })
})
