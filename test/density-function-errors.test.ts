import { describe, expect, it } from '@effect/vitest'
import { Result } from 'effect'
import { vi } from 'vitest'
import { blockAxis, noiseSeed } from './fixtures/validated-inputs'

const densityRuntime = vi.hoisted(() => ({ create: vi.fn() }))

vi.mock('@nerima-games/mc-noise', async () => {
  const actual = await vi.importActual<typeof import('@nerima-games/mc-noise')>('@nerima-games/mc-noise')
  return { ...actual, createDensityFunctionRuntime: densityRuntime.create }
})

import { createTerrainDensitySampler, TerrainDensityFailure } from '../src/domain/density-function'

const SEED = noiseSeed(41)
const AXIS = blockAxis(0)

describe('terrain density runtime failures', () => {
  it('labels runtime construction errors', () => {
    const cause = new TypeError('invalid density runtime')
    densityRuntime.create.mockReturnValueOnce(Result.fail(cause))

    const result = createTerrainDensitySampler(SEED)

    expect(Result.isFailure(result)).toBe(true)
    if (Result.isFailure(result)) {
      expect(result.failure).toBeInstanceOf(TerrainDensityFailure)
      expect(result.failure).toMatchObject({ stage: 'construction', message: cause.message })
    }
  })

  it('labels runtime evaluation errors', () => {
    const cause = new RangeError('density coordinate outside runtime')
    densityRuntime.create.mockReturnValueOnce(Result.succeed({
      compute: () => Result.fail(cause),
    }))

    const sampler = Result.getOrThrow(createTerrainDensitySampler(SEED))
    const result = sampler.densityAt(AXIS, AXIS, AXIS)

    expect(Result.isFailure(result)).toBe(true)
    if (Result.isFailure(result)) {
      expect(result.failure).toBeInstanceOf(TerrainDensityFailure)
      expect(result.failure).toMatchObject({ stage: 'evaluation', message: cause.message })
    }
  })
})
