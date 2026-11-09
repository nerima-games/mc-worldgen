/* oxlint-disable curly, init-declarations, max-lines-per-function, max-statements, no-magic-numbers */

import { describe, expect, it } from '@effect/vitest'
import { Option, Result } from 'effect'
import { TerrainDensityFailure } from '../src/domain/density-function'
import {
  candidateChannelSeedsFor,
  candidateChannelSeedsForKnownCandidate,
  candidateExistsForRegion,
  candidatePresenceChannelSeedFor,
  validateNaturalStructureRegion,
} from '../src/domain/natural-structure-plan-builder'
import {
  type NaturalStructureKind,
  planNaturalStructureForRegion,
  planVillageForRegionWithResultSampler,
} from '../src/domain/natural-structure'
import {
  type OverworldTerrainResultSampler,
  type OverworldTerrainSample,
  villageCandidateExistsInRegion,
  villageSiteForRegionWithResultSampler,
  villageSiteOptionForValidatedRegionWithResult,
} from '../src/domain/structure-siting'
import { validatedNaturalStructureRegionAxisFrom } from '../src/domain/natural-structure-coordinate-validation'
import { villageBlockSamplerForSiteWithResult, villageHouseFloorYsForSiteWithResult } from '../src/domain/village'
import { blockAxis, noiseSeed } from './fixtures/validated-inputs'

const SEED = noiseSeed(0x2468)
const FAILURE = new TerrainDensityFailure({ message: 'terrain sample failed', stage: 'evaluation' })
const REGION = { x: 0, z: 0 }

const terrain = (
  biome: OverworldTerrainSample['biome'],
  surfaceY = 70,
  seaLevel = 63,
): OverworldTerrainSample => ({ biome, seaLevel: blockAxis(seaLevel), surfaceY: blockAxis(surfaceY) })

const samplerFor = (sample: OverworldTerrainSample): OverworldTerrainResultSampler =>
  () => Result.succeed(sample)

const findVillageRegion = (seed: ReturnType<typeof noiseSeed>, candidateExpected: boolean): { readonly x: number; readonly z: number } => {
  for (let x = -16; x <= 16; x += 1) {
    for (let z = -16; z <= 16; z += 1) {
      if (villageCandidateExistsInRegion(seed, x, z) === candidateExpected) {return { x, z }}
    }
  }
  throw new Error('village region search exhausted')
}

const villageAxesFor = (region: { readonly x: number; readonly z: number }) => {
  const validated = Result.getOrThrow(validateNaturalStructureRegion('village', region))
  return {
    x: validatedNaturalStructureRegionAxisFrom(validated, 'x'),
    z: validatedNaturalStructureRegionAxisFrom(validated, 'z'),
  }
}

const dispatchOverworld = (
  kind: NaturalStructureKind,
  sample: OverworldTerrainSample,
  region = REGION,
) => {
  const channelSeeds = candidateChannelSeedsFor(SEED, 'overworld', kind)
  return planNaturalStructureForRegion({
    candidateChannelSeeds: candidateChannelSeedsForKnownCandidate(channelSeeds),
    dimension: 'overworld',
    kind,
    presenceChannelSeed: candidatePresenceChannelSeedFor(SEED, 'overworld', kind),
    region,
    samplers: { overworldResult: samplerFor(sample) },
    seed: SEED,
  })
}

describe('result-based natural structure dispatch', () => {
  it('finishes every result-sampled Overworld candidate into a public plan', () => {
    const cases: ReadonlyArray<readonly [NaturalStructureKind, OverworldTerrainSample]> = [
      ['swamp-hut', terrain('SWAMP')],
      ['desert-pyramid', terrain('DESERT')],
      ['desert-well', terrain('DESERT')],
      ['igloo', terrain('SNOW')],
      ['jungle-pyramid', terrain('JUNGLE')],
      ['mineshaft', terrain('PLAINS')],
      ['pillager-outpost', terrain('PLAINS')],
      ['ocean-monument', terrain('OCEAN', 40, 100)],
      ['ocean-ruin', terrain('OCEAN', 40, 100)],
      ['shipwreck', terrain('OCEAN', 40, 100)],
    ]

    for (const [kind, sample] of cases) {
      const result = dispatchOverworld(kind, sample)
      expect(Result.isSuccess(result), `${kind} dispatch`).toBe(true)
      if (Result.isSuccess(result)) {expect(Option.isSome(result.success), `${kind} plan`).toBe(true)}
    }

    const village = dispatchOverworld('village', terrain('PLAINS'))
    expect(Result.isSuccess(village)).toBe(true)
    if (Result.isSuccess(village)) {expect(Option.isSome(village.success)).toBe(true)}
  })

  it('does not sample a region without a candidate and rejects cross-dimension kinds', () => {
    const kind = 'desert-pyramid'
    const channels = candidateChannelSeedsFor(SEED, 'overworld', kind)
    let regionX = 0
    while (candidateExistsForRegion(kind, regionX, 0, channels.presence)) {regionX += 1}
    let calls = 0
    const absent = planNaturalStructureForRegion({
      candidateChannelSeeds: channels,
      dimension: 'overworld',
      kind,
      presenceChannelSeed: channels.presence,
      region: { x: regionX, z: 0 },
      samplers: { overworldResult: () => { calls += 1; return Result.fail(FAILURE) } },
      seed: SEED,
    })

    expect(absent).toStrictEqual(Result.succeed(Option.none()))
    expect(calls).toBe(0)

    const mismatchedKind = planNaturalStructureForRegion({
      dimension: 'overworld',
      kind: 'end-city',
      presenceChannelSeed: candidatePresenceChannelSeedFor(SEED, 'overworld', 'end-city'),
      region: REGION,
      samplers: { overworldResult: samplerFor(terrain('PLAINS')) },
      seed: SEED,
    })
    expect(mismatchedKind).toStrictEqual(Result.succeed(Option.none()))

    const mismatchedKindWithoutResultSampler = planNaturalStructureForRegion({
      dimension: 'overworld',
      kind: 'end-city',
      presenceChannelSeed: candidatePresenceChannelSeedFor(SEED, 'overworld', 'end-city'),
      region: REGION,
      samplers: { overworld: () => terrain('PLAINS') },
      seed: SEED,
    })
    expect(mismatchedKindWithoutResultSampler).toStrictEqual(Result.succeed(Option.none()))
  })

  it('propagates sampling failures from village siting, house floors, carving, and origin', () => {
    const region = findVillageRegion(SEED, true)
    const axes = villageAxesFor(region)
    const failingSampler: OverworldTerrainResultSampler = () => Result.fail(FAILURE)
    const sitingFailure = planNaturalStructureForRegion({
      candidateChannelSeeds: candidateChannelSeedsForKnownCandidate(candidateChannelSeedsFor(SEED, 'overworld', 'village')),
      dimension: 'overworld',
      kind: 'village',
      presenceChannelSeed: candidatePresenceChannelSeedFor(SEED, 'overworld', 'village'),
      region,
      samplers: { overworldResult: failingSampler },
      seed: SEED,
    })
    expect(sitingFailure).toStrictEqual(Result.fail(FAILURE))

    const failingAt = (failureCallIndex: number): OverworldTerrainResultSampler => {
      let calls = 0
      return () => {
        const call = calls
        calls += 1
        return call === failureCallIndex ? Result.fail(FAILURE) : Result.succeed(terrain('PLAINS'))
      }
    }
    const floorFailure = planVillageForRegionWithResultSampler(SEED, axes.x, axes.z, failingAt(5))
    const carveFailure = planVillageForRegionWithResultSampler(SEED, axes.x, axes.z, failingAt(131))
    expect(floorFailure).toStrictEqual(Result.fail(FAILURE))
    expect(carveFailure).toStrictEqual(Result.fail(FAILURE))

    let terrainCalls = 0
    const pointCalls = new Map<string, number>()
    const repeatedPointFailure: OverworldTerrainResultSampler = (x, z) => {
      const previousCall = terrainCalls
      terrainCalls += 1
      if (previousCall < 131) {return Result.succeed(terrain('PLAINS'))}
      const key = `${String(x)},${String(z)}`
      const calls = pointCalls.get(key) ?? 0
      pointCalls.set(key, calls + 1)
      return calls === 0 ? Result.succeed(terrain('PLAINS')) : Result.fail(FAILURE)
    }
    const nestedBlockFailure = planVillageForRegionWithResultSampler(SEED, axes.x, axes.z, repeatedPointFailure)
    expect(nestedBlockFailure).toStrictEqual(Result.fail(FAILURE))

    const center = Result.getOrThrow(villageSiteForRegionWithResultSampler(SEED, axes.x, axes.z, samplerFor(terrain('PLAINS'))))
    if (Option.isNone(center)) {throw new Error('expected village site')}
    let successfulCenterCalls = 0
    const countedPlan = planVillageForRegionWithResultSampler(SEED, axes.x, axes.z, (x, z) => {
      if (x === center.value.x && z === center.value.z) {successfulCenterCalls += 1}
      return Result.succeed(terrain('PLAINS'))
    })
    expect(Result.isSuccess(countedPlan)).toBe(true)
    const originFailure = planVillageForRegionWithResultSampler(SEED, axes.x, axes.z, (() => {
      let calls = 0
      return (x, z) => {
        if (x === center.value.x && z === center.value.z) {
          calls += 1
          if (calls === successfulCenterCalls) {return Result.fail(FAILURE)}
        }
        return Result.succeed(terrain('PLAINS'))
      }
    })())
    expect(originFailure).toStrictEqual(Result.fail(FAILURE))
  })

  it('returns no candidate without sampling and reports invalid direct region coordinates', () => {
    const region = findVillageRegion(SEED, false)
    const axes = villageAxesFor(region)
    let calls = 0
    const absent = villageSiteOptionForValidatedRegionWithResult(
      SEED,
      axes.x,
      axes.z,
      () => { calls += 1; return Result.fail(FAILURE) },
    )
    expect(absent).toStrictEqual(Result.succeed(Option.none()))
    expect(calls).toBe(0)

    const noVillagePlan = planVillageForRegionWithResultSampler(SEED, axes.x, axes.z, () => Result.fail(FAILURE))
    expect(noVillagePlan).toStrictEqual(Result.succeed(Option.none()))

    const invalid = Reflect.apply(villageSiteForRegionWithResultSampler, undefined, [
      SEED,
      Number.NaN,
      0,
      samplerFor(terrain('PLAINS')),
    ])
    expect(Result.isFailure(invalid)).toBe(true)
    if (Result.isFailure(invalid)) {
      expect(invalid.failure).toMatchObject({ _tag: 'InvalidNaturalStructureCoordinate', axis: 'region-x' })
    }
  })

  it('propagates failures from both house floors and each village block sampler route', () => {
    const site = { x: blockAxis(0), z: blockAxis(0) }
    const failAt = (failureCallIndex: number): OverworldTerrainResultSampler => {
      let calls = 0
      return () => {
        const call = calls
        calls += 1
        return call === failureCallIndex ? Result.fail(FAILURE) : Result.succeed(terrain('PLAINS'))
      }
    }

    expect(Result.isFailure(villageHouseFloorYsForSiteWithResult(site, failAt(0)))).toBe(true)
    expect(Result.isFailure(villageHouseFloorYsForSiteWithResult(site, failAt(63)))).toBe(true)

    const floorYs = [71, 71] as const
    const blockSampler = villageBlockSamplerForSiteWithResult(site, () => Result.fail(FAILURE), floorYs)
    const failures = [
      blockSampler(blockAxis(-14), blockAxis(72), blockAxis(-10)),
      blockSampler(blockAxis(14), blockAxis(72), blockAxis(10)),
      blockSampler(blockAxis(0), blockAxis(72), blockAxis(0)),
    ]
    for (const result of failures) {expect(result).toStrictEqual(Result.fail(FAILURE))}
  })
})
