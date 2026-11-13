import { describe, expect, it } from '@effect/vitest'
import { Result } from 'effect'
import { vi } from 'vitest'
import { blockAxis, noiseSeed, validatedChunkCoord } from './fixtures/validated-inputs'

const ports = vi.hoisted(() => ({
  createSampler: vi.fn(),
  naturalStructurePlans: vi.fn(),
}))

vi.mock('../src/domain/density-function', async () => {
  const actual = await vi.importActual<typeof import('../src/domain/density-function')>('../src/domain/density-function')
  return { ...actual, createTerrainDensitySampler: ports.createSampler }
})

vi.mock('../src/domain/natural-structure', async () => {
  const actual = await vi.importActual<typeof import('../src/domain/natural-structure')>('../src/domain/natural-structure')
  return { ...actual, naturalStructurePlansForValidatedChunk: ports.naturalStructurePlans }
})

import { TerrainDensityFailure } from '../src/domain/density-function'
import { generateChunk } from '../src/domain/terrain'

const SEED = noiseSeed(204)
const COORD = validatedChunkCoord(0, 0)
const FAILURE = new TerrainDensityFailure({ message: 'terrain sample failed', stage: 'evaluation' })

const actualDensitySampler = async () => {
  const actual = await vi.importActual<typeof import('../src/domain/density-function')>('../src/domain/density-function')
  return Result.getOrThrow(actual.createTerrainDensitySampler(SEED))
}

describe('terrain generation Result propagation', () => {
  it('returns a density runtime construction failure before generating a chunk', () => {
    ports.createSampler.mockReturnValueOnce(Result.fail(FAILURE))

    const result = generateChunk(SEED, COORD, { decorate: false })

    expect(result).toStrictEqual(Result.fail(FAILURE))
  })

  it('propagates an external structure terrain sampling failure', async () => {
    const sampler = await actualDensitySampler()
    ports.createSampler.mockReturnValue(Result.succeed({
      ...sampler,
      surfaceHeightAt: () => Result.fail(FAILURE),
    }))
    ports.naturalStructurePlans.mockImplementation((_seed, _dimension, _chunk, samplers) => {
      const externalSample = samplers.overworldResult(blockAxis(1000), blockAxis(1000))
      return Result.isFailure(externalSample) ? Result.fail(externalSample.failure) : Result.succeed([])
    })

    const result = generateChunk(SEED, COORD, { decorate: false })

    expect(result).toStrictEqual(Result.fail(FAILURE))
  })
})
