import { describe, expect, it } from '@effect/vitest'
import { Result } from 'effect'
import { vi } from 'vitest'
import { blockAxis, noiseSeed, validatedChunkCoord } from './fixtures/validated-inputs'

const ports = vi.hoisted(() => ({
  createSampler: vi.fn(),
  naturalStructurePlans: vi.fn(),
  resolveTerrainColumn: vi.fn(),
}))

vi.mock('../src/domain/density-function', async () => {
  const actual = await vi.importActual<typeof import('../src/domain/density-function')>('../src/domain/density-function')
  return { ...actual, createTerrainDensitySampler: ports.createSampler }
})

vi.mock('../src/domain/terrain-column', async () => {
  const actual = await vi.importActual<typeof import('../src/domain/terrain-column')>('../src/domain/terrain-column')
  return { ...actual, resolveTerrainColumnForGeneration: ports.resolveTerrainColumn }
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
  it('maps a range failure and propagates a typed density failure through column generation', async () => {
    const sampler = await actualDensitySampler()
    ports.createSampler.mockReturnValue(Result.succeed(sampler))
    ports.resolveTerrainColumn.mockReturnValueOnce(Result.fail(new RangeError('column outside terrain bounds')))

    const rangeFailure = generateChunk(SEED, COORD, { decorate: false })

    expect(Result.isFailure(rangeFailure)).toBe(true)
    if (Result.isFailure(rangeFailure)) {
      expect(rangeFailure.failure).toBeInstanceOf(TerrainDensityFailure)
      expect(rangeFailure.failure).toMatchObject({ stage: 'evaluation', message: 'column outside terrain bounds' })
    }

    ports.resolveTerrainColumn.mockReturnValueOnce(Result.fail(FAILURE))
    const typedFailure = generateChunk(SEED, COORD, { decorate: false })
    expect(typedFailure).toStrictEqual(Result.fail(FAILURE))
  })

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
    const actualColumn = await vi.importActual<typeof import('../src/domain/terrain-column')>('../src/domain/terrain-column')
    ports.resolveTerrainColumn.mockImplementation(actualColumn.resolveTerrainColumnForGeneration)
    ports.naturalStructurePlans.mockImplementation((_seed, _dimension, _chunk, samplers) => {
      const externalSample = samplers.overworldResult(blockAxis(1000), blockAxis(1000))
      return Result.isFailure(externalSample) ? Result.fail(externalSample.failure) : Result.succeed([])
    })

    const result = generateChunk(SEED, COORD, { decorate: false })

    expect(result).toStrictEqual(Result.fail(FAILURE))
  })
})
