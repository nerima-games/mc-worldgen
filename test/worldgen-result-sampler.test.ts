/* oxlint-disable curly, id-length, max-lines-per-function, max-statements, no-magic-numbers, sort-imports */

import { describe, expect, it } from '@effect/vitest'
import { Option, Result } from 'effect'
import { TerrainDensityFailure } from '../src/domain/density-function'
import { planCompactStructureForCandidateWithResultSampler } from '../src/domain/compact-structure'
import { planDesertPyramidForCandidateWithResultSampler } from '../src/domain/desert-pyramid'
import { planDesertWellForCandidateWithResultSampler } from '../src/domain/desert-well'
import { planIglooForCandidateWithResultSampler } from '../src/domain/igloo'
import { planJunglePyramidForCandidateWithResultSampler } from '../src/domain/jungle-pyramid'
import { planMineshaftForCandidateWithResultSampler } from '../src/domain/mineshaft'
import { planOceanMonumentForCandidateWithResultSampler } from '../src/domain/ocean-monument'
import { planOceanRuinForCandidateWithResultSampler } from '../src/domain/ocean-ruin'
import { planPillagerOutpostForCandidateWithResultSampler } from '../src/domain/pillager-outpost'
import { planShipwreckForCandidateWithResultSampler } from '../src/domain/shipwreck'
import type { OverworldTerrainResultSampler, OverworldTerrainSample } from '../src/domain/structure-siting'
import { blockAxis } from './fixtures/validated-inputs'

const CANDIDATE = { x: 0, z: 0 }
const FAILURE = new TerrainDensityFailure({ message: 'terrain sample failed', stage: 'evaluation' })
const failSampler: OverworldTerrainResultSampler = () => Result.fail(FAILURE)

const sample = (
  biome: OverworldTerrainSample['biome'],
  surfaceY = 70,
  seaLevel = 63,
): OverworldTerrainSample => ({ biome, seaLevel: blockAxis(seaLevel), surfaceY: blockAxis(surfaceY) })

const samplerFor = (terrain: OverworldTerrainSample): OverworldTerrainResultSampler =>
  () => Result.succeed(terrain)

const expectFailure = (result: Result.Result<unknown, unknown>): void => {
  expect(Result.isFailure(result)).toBe(true)
  if (Result.isFailure(result)) {expect(result.failure).toBe(FAILURE)}
}

const expectDraft = <Draft, Failure>(result: Result.Result<Option.Option<Draft>, Failure>): void => {
  expect(Result.isSuccess(result)).toBe(true)
  if (Result.isSuccess(result)) {expect(Option.isSome(result.success)).toBe(true)}
}

describe('result-sampled structure plans', () => {
  it('propagates terrain failures from each candidate planner', () => {
    const results = [
      planCompactStructureForCandidateWithResultSampler('swamp-hut', CANDIDATE, failSampler),
      planDesertPyramidForCandidateWithResultSampler(CANDIDATE, failSampler),
      planDesertWellForCandidateWithResultSampler(CANDIDATE, failSampler),
      planIglooForCandidateWithResultSampler(CANDIDATE, failSampler),
      planJunglePyramidForCandidateWithResultSampler(CANDIDATE, failSampler),
      planMineshaftForCandidateWithResultSampler(CANDIDATE, failSampler),
      planOceanMonumentForCandidateWithResultSampler(CANDIDATE, failSampler),
      planOceanRuinForCandidateWithResultSampler(CANDIDATE, failSampler),
      planPillagerOutpostForCandidateWithResultSampler(CANDIDATE, failSampler),
      planShipwreckForCandidateWithResultSampler(CANDIDATE, failSampler),
    ]

    for (const result of results) {expectFailure(result)}
  })

  it('checks all compact-structure probes before producing a draft', () => {
    let calls = 0
    const lateFailure: OverworldTerrainResultSampler = () => {
      calls += 1
      return calls === 1 ? Result.succeed(sample('SWAMP')) : Result.fail(FAILURE)
    }
    const lateFailureResult = planCompactStructureForCandidateWithResultSampler('swamp-hut', CANDIDATE, lateFailure)
    expectFailure(lateFailureResult)

    const unsuitable = planCompactStructureForCandidateWithResultSampler(
      'swamp-hut',
      CANDIDATE,
      samplerFor(sample('DESERT')),
    )
    expect(Result.isSuccess(unsuitable)).toBe(true)
    if (Result.isSuccess(unsuitable)) {expect(Option.isNone(unsuitable.success)).toBe(true)}

    const valid = planCompactStructureForCandidateWithResultSampler(
      'swamp-hut',
      CANDIDATE,
      samplerFor(sample('SWAMP')),
    )
    expect(Result.isSuccess(valid)).toBe(true)
    if (Result.isSuccess(valid) && Option.isSome(valid.success)) {
      expect(valid.success.value.blocks.length).toBeGreaterThan(0)
    }
  })

  it('plans supported structures and returns no draft when their layout exceeds world bounds', () => {
    expectDraft(planIglooForCandidateWithResultSampler(CANDIDATE, samplerFor(sample('SNOW'))))
    expectDraft(planDesertPyramidForCandidateWithResultSampler(CANDIDATE, samplerFor(sample('DESERT'))))
    expectDraft(planDesertWellForCandidateWithResultSampler(CANDIDATE, samplerFor(sample('DESERT'))))
    expectDraft(planJunglePyramidForCandidateWithResultSampler(CANDIDATE, samplerFor(sample('JUNGLE'))))
    expectDraft(planMineshaftForCandidateWithResultSampler(CANDIDATE, samplerFor(sample('PLAINS'))))
    expectDraft(planPillagerOutpostForCandidateWithResultSampler(CANDIDATE, samplerFor(sample('PLAINS'))))
    expectDraft(planOceanMonumentForCandidateWithResultSampler(CANDIDATE, samplerFor(sample('OCEAN', 40, 100))))
    expectDraft(planOceanRuinForCandidateWithResultSampler(CANDIDATE, samplerFor(sample('OCEAN', 40, 100))))
    expectDraft(planShipwreckForCandidateWithResultSampler(CANDIDATE, samplerFor(sample('OCEAN', 40, 100))))

    const highDesert = samplerFor(sample('DESERT', 300, 0))
    const highSnow = samplerFor(sample('SNOW', 300, 0))
    const highJungle = samplerFor(sample('JUNGLE', 300, 0))
    const highPlains = samplerFor(sample('PLAINS', 300, 0))
    const deepOcean = samplerFor(sample('OCEAN', 300, 400))

    for (const result of [
      planDesertWellForCandidateWithResultSampler(CANDIDATE, highDesert),
      planIglooForCandidateWithResultSampler(CANDIDATE, highSnow),
      planJunglePyramidForCandidateWithResultSampler(CANDIDATE, highJungle),
      planPillagerOutpostForCandidateWithResultSampler(CANDIDATE, highPlains),
      planOceanRuinForCandidateWithResultSampler(CANDIDATE, deepOcean),
    ]) {
      expect(Result.isSuccess(result)).toBe(true)
      if (Result.isSuccess(result)) {expect(Option.isNone(result.success)).toBe(true)}
    }

    const variableOcean: OverworldTerrainResultSampler = (x, z) => Result.succeed(
      sample('OCEAN', x === 0 && z === 0 ? 40 : 60, 100),
    )
    const failedMonumentFit = planOceanMonumentForCandidateWithResultSampler(CANDIDATE, variableOcean)
    expect(Result.isSuccess(failedMonumentFit)).toBe(true)
    if (Result.isSuccess(failedMonumentFit)) {expect(Option.isNone(failedMonumentFit.success)).toBe(true)}

    const monumentOutsideWorldHeight: OverworldTerrainResultSampler = (x, z) => Result.succeed(
      x === blockAxis(-8) && z === blockAxis(0)
        ? sample('OCEAN', 40, 50)
        : sample('OCEAN', 42, 60),
    )
    const monumentDoesNotFit = planOceanMonumentForCandidateWithResultSampler(CANDIDATE, monumentOutsideWorldHeight)
    expect(Result.isSuccess(monumentDoesNotFit)).toBe(true)
    if (Result.isSuccess(monumentDoesNotFit)) {expect(Option.isNone(monumentDoesNotFit.success)).toBe(true)}
  })
})
