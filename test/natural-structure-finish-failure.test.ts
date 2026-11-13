import { describe, expect, it } from '@effect/vitest'
import { Result } from 'effect'
import { vi } from 'vitest'
import { blockAxis, noiseSeed } from './fixtures/validated-inputs'

const finishPlanMock = vi.hoisted(() => vi.fn())

vi.mock('../src/domain/natural-structure-plan-builder', async () => {
  const actual = await vi.importActual<typeof import('../src/domain/natural-structure-plan-builder')>(
    '../src/domain/natural-structure-plan-builder',
  )
  return { ...actual, finishPlan: finishPlanMock }
})

import { InvalidNaturalStructureCoordinate } from '../src/domain/natural-structure-coordinate-validation'
import { planVillageForRegionWithResultSampler } from '../src/domain/natural-structure'
import {
  villageCandidateExistsInRegion,
  villageSiteForRegionWithResultSampler,
  type OverworldTerrainResultSampler,
} from '../src/domain/structure-siting'
import { validateNaturalStructureRegion } from '../src/domain/natural-structure-plan-builder'
import { validatedNaturalStructureRegionAxisFrom } from '../src/domain/natural-structure-coordinate-validation'

describe('village plan finalization failures', () => {
  it('returns the failure from the shared plan builder', () => {
    const seed = noiseSeed(0x2468)
    let regionX = 0
    while (!villageCandidateExistsInRegion(seed, regionX, 0)) {regionX += 1}
    const region = { x: regionX, z: 0 }
    const validated = Result.getOrThrow(validateNaturalStructureRegion('village', region))
    const x = validatedNaturalStructureRegionAxisFrom(validated, 'x')
    const z = validatedNaturalStructureRegionAxisFrom(validated, 'z')
    const sampleTerrain: OverworldTerrainResultSampler = () => Result.succeed({
      biome: 'PLAINS',
      seaLevel: blockAxis(63),
      surfaceY: blockAxis(70),
    })
    const site = villageSiteForRegionWithResultSampler(seed, x, z, sampleTerrain)
    expect(Result.isSuccess(site)).toBe(true)

    const failure = new InvalidNaturalStructureCoordinate({
      axis: 'footprint-y',
      kind: 'village',
      region,
      value: Number.NaN,
    })
    finishPlanMock.mockReturnValueOnce(Result.fail(failure))

    const result = planVillageForRegionWithResultSampler(seed, x, z, sampleTerrain)

    expect(result).toStrictEqual(Result.fail(failure))
  })
})
