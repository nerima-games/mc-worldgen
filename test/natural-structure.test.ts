/* oxlint-disable curly, id-length, init-declarations, max-lines-per-function, max-statements, no-magic-numbers, no-ternary, no-undefined, sort-imports */

import { describe, expect, it } from '@effect/vitest'
import { BLOCK_IDS } from '@nerima-games/mc-kernel'
import { Option, Result } from 'effect'
import { CHUNK_HEIGHT, CHUNK_SIZE_XZ } from '../src/domain/constants'
import { emptyBlocks } from '../src/domain/chunk'
import { chunkCoord } from '@nerima-games/mc-kernel'
import { candidatePresenceChannelSeedFor } from '../src/domain/natural-structure-plan-builder'
import {
  applyNaturalStructurePlansToChunk,
  MAX_NATURAL_STRUCTURE_BLOCKS,
  MAX_NATURAL_STRUCTURE_MARKERS,
  NATURAL_STRUCTURE_BLOCK,
  NATURAL_STRUCTURE_GRID,
  type NaturalStructurePlan,
  naturalStructurePlansForChunk,
  naturalStructureSliceForChunk,
  planDesertPyramidForRegion,
  planEndCityForRegion,
  planRuinedNetherPortalForRegion,
  planVillageForRegion,
} from './helpers/unwrapped-worldgen'
import { VILLAGE_HALF_EXTENT, type OverworldTerrainSampler } from '../src/domain/structure-siting'
import { generateChunk } from './helpers/unwrapped-worldgen'
import { generateChunk as generateChunkRaw } from '../src/domain/terrain'
import {
  InvalidNaturalStructureCoordinate,
  naturalStructurePlansForChunk as naturalStructurePlansForChunkRaw,
  planCompactStructureForRegion as planCompactStructureForRegionRaw,
  planNaturalStructureForRegion as planNaturalStructureForRegionRaw,
  planVillageForRegion as planVillageForRegionRaw,
} from '../src/domain/natural-structure'
import {
  naturalStructurePlansForValidatedChunk as naturalStructurePlansForValidatedChunkWithPlanner,
  validateNaturalStructureChunkCoordinates,
} from '../src/domain/natural-structure-chunk-planner'
import {
  invalidNaturalStructureRegionSpan,
  MAX_NATURAL_STRUCTURE_HORIZONTAL_EXTENT,
  validatedNaturalStructureRegionAxisFrom,
  validateNaturalStructureRegionCoordinates,
} from '../src/domain/natural-structure-coordinate-validation'
import { blockAxis, chunkAxis, noiseSeed } from './fixtures/validated-inputs'
import { planEndCityForRegion as planEndCityForRegionRaw } from '../src/domain/natural-structure-end-city'
import { planRuinedNetherPortalForRegion as planRuinedNetherPortalForRegionRaw } from '../src/domain/natural-structure-portal'
import {
  planStrongholdForRegion as planStrongholdForRegionRaw,
  planStrongholdForValidatedRegion,
} from '../src/domain/stronghold-structure'

const FLAT_PLAINS: OverworldTerrainSampler = () => ({ biome: 'PLAINS', seaLevel: blockAxis(63), surfaceY: blockAxis(70) })
const FLAT_DESERT: OverworldTerrainSampler = () => ({ biome: 'DESERT', seaLevel: blockAxis(63), surfaceY: blockAxis(70) })
const FLAT_NETHER = () => ({ ceilingY: blockAxis(96), surfaceY: blockAxis(48) })
const FLAT_END = () => blockAxis(70)

const unwrap = (option: Option.Option<NaturalStructurePlan>): NaturalStructurePlan => {
  if (Option.isNone(option)) throw new Error('expected a natural structure plan')
  return option.value
}

const findVillage = (seed: number): NaturalStructurePlan => {
  for (let regionX = -12; regionX <= 12; regionX += 1) {
    for (let regionZ = -12; regionZ <= 12; regionZ += 1) {
      const plan = planVillageForRegion(noiseSeed(seed), regionX, regionZ, FLAT_PLAINS)
      if (Option.isSome(plan)) return plan.value
    }
  }
  throw new Error('village search range exhausted')
}

const findDesertPyramid = (seed: number): NaturalStructurePlan => {
  for (let regionX = -12; regionX <= 12; regionX += 1) {
    for (let regionZ = -12; regionZ <= 12; regionZ += 1) {
      const plan = planDesertPyramidForRegion(noiseSeed(seed), regionX, regionZ, FLAT_DESERT)
      if (Option.isSome(plan)) return plan.value
    }
  }
  throw new Error('desert pyramid search range exhausted')
}

const findPortal = (seed: number): NaturalStructurePlan => {
  for (let regionX = -12; regionX <= 12; regionX += 1) {
    for (let regionZ = -12; regionZ <= 12; regionZ += 1) {
      const plan = planRuinedNetherPortalForRegion(noiseSeed(seed), regionX, regionZ, FLAT_NETHER)
      if (Option.isSome(plan)) return plan.value
    }
  }
  throw new Error('ruined portal search range exhausted')
}

const findEndCity = (seed: number, negativeOnly = false): NaturalStructurePlan => {
  const low = negativeOnly ? -12 : -12
  const high = negativeOnly ? -4 : 12
  for (let regionX = low; regionX <= high; regionX += 1) {
    for (let regionZ = low; regionZ <= high; regionZ += 1) {
      const plan = planEndCityForRegion(noiseSeed(seed), regionX, regionZ, FLAT_END)
      if (Option.isSome(plan)) return plan.value
    }
  }
  throw new Error('End city search range exhausted')
}

const positionKey = (position: { readonly x: number; readonly y: number; readonly z: number }): string =>
  `${String(position.x)},${String(position.y)},${String(position.z)}`

describe('natural structure plans', () => {
  it('validates direct region-planning routes for village, Nether portal, and End city', () => {
    const seed = 0x2468
    const village = findVillage(seed)
    const portal = findPortal(seed)
    const endCity = findEndCity(seed)
    const villageResult = planNaturalStructureForRegionRaw({
      dimension: 'overworld',
      kind: 'village',
      presenceChannelSeed: candidatePresenceChannelSeedFor(noiseSeed(seed), 'overworld', 'village'),
      region: village.region,
      samplers: { overworld: FLAT_PLAINS },
      seed: noiseSeed(seed),
    })
    const portalResult = planNaturalStructureForRegionRaw({
      dimension: 'nether',
      kind: 'ruined-nether-portal',
      presenceChannelSeed: candidatePresenceChannelSeedFor(noiseSeed(seed), 'nether', 'ruined-nether-portal'),
      region: portal.region,
      samplers: { nether: FLAT_NETHER },
      seed: noiseSeed(seed),
    })
    const endCityResult = planNaturalStructureForRegionRaw({
      dimension: 'end',
      kind: 'end-city',
      presenceChannelSeed: candidatePresenceChannelSeedFor(noiseSeed(seed), 'end', 'end-city'),
      region: endCity.region,
      samplers: { end: FLAT_END },
      seed: noiseSeed(seed),
    })

    expect(villageResult).toStrictEqual(Result.succeed(Option.some(village)))
    expect(portalResult).toStrictEqual(Result.succeed(Option.some(portal)))
    expect(endCityResult).toStrictEqual(Result.succeed(Option.some(endCity)))
    expect(Result.isSuccess(planEndCityForRegionRaw(noiseSeed(seed), endCity.region.x, endCity.region.z))).toBe(true)
  })

  it('returns a shared no-plan result for an empty validated stronghold region', () => {
    const seed = noiseSeed(0x1357)
    let emptyRegion: { readonly x: number; readonly z: number } | undefined

    for (let regionX = -8; regionX <= 8 && emptyRegion === undefined; regionX += 1) {
      for (let regionZ = -8; regionZ <= 8; regionZ += 1) {
        const result = planStrongholdForRegionRaw(seed, regionX, regionZ)
        if (Result.isSuccess(result) && Option.isNone(result.success)) {
          emptyRegion = { x: regionX, z: regionZ }
          break
        }
      }
    }

    expect(emptyRegion).toBeDefined()
    if (emptyRegion === undefined) {throw new Error('expected an empty stronghold region in search bounds')}
    const validation = validateNaturalStructureRegionCoordinates(
      'stronghold',
      emptyRegion,
      NATURAL_STRUCTURE_GRID.stronghold,
      MAX_NATURAL_STRUCTURE_HORIZONTAL_EXTENT,
    )
    expect(Result.isSuccess(validation)).toBe(true)
    if (Result.isFailure(validation)) {throw validation.failure}
    expect(planStrongholdForValidatedRegion(
      seed,
      validatedNaturalStructureRegionAxisFrom(validation.success, 'x'),
      validatedNaturalStructureRegionAxisFrom(validation.success, 'z'),
    )).toStrictEqual(Result.succeed(Option.none()))
  })

  it('accepts an explicit presence channel while preserving the candidate', () => {
    const seed = 0x3456
    const portal = findPortal(seed)
    const expected = planRuinedNetherPortalForRegion(
      noiseSeed(seed),
      portal.region.x,
      portal.region.z,
      FLAT_NETHER,
    )
    const explicit = planRuinedNetherPortalForRegion(
      noiseSeed(seed),
      portal.region.x,
      portal.region.z,
      FLAT_NETHER,
      candidatePresenceChannelSeedFor(noiseSeed(seed), 'nether', 'ruined-nether-portal'),
    )

    expect(explicit).toStrictEqual(expected)
  })

  it('are deterministic, immutable, and carry actionable semantic markers', () => {
    const firstPlans: readonly [NaturalStructurePlan, NaturalStructurePlan, NaturalStructurePlan, NaturalStructurePlan] = [
      findDesertPyramid(0x1234),
      findVillage(0x1234),
      findPortal(0x1234),
      findEndCity(0x1234),
    ]
    const [desertPyramid, village, portal, endCity] = firstPlans
    const repeatedPlans = [
      unwrap(planDesertPyramidForRegion(noiseSeed(0x1234), desertPyramid.region.x, desertPyramid.region.z, FLAT_DESERT)),
      unwrap(planVillageForRegion(noiseSeed(0x1234), village.region.x, village.region.z, FLAT_PLAINS)),
      unwrap(planRuinedNetherPortalForRegion(noiseSeed(0x1234), portal.region.x, portal.region.z, FLAT_NETHER)),
      unwrap(planEndCityForRegion(noiseSeed(0x1234), endCity.region.x, endCity.region.z, FLAT_END)),
    ]

    expect(repeatedPlans).toStrictEqual(firstPlans)
    expect(firstPlans.map((plan) => plan.dimension)).toStrictEqual(['overworld', 'overworld', 'nether', 'end'])
    for (const plan of firstPlans) {
      expect(Object.isFrozen(plan)).toBe(true)
      expect(Object.isFrozen(plan.blocks)).toBe(true)
      expect(Object.isFrozen(plan.markers)).toBe(true)
      expect(Object.isFrozen(plan.bounds)).toBe(true)
      expect(Object.isFrozen(plan.origin)).toBe(true)
      expect(Object.isFrozen(plan.region)).toBe(true)
      for (const marker of plan.markers) expect(Object.isFrozen(marker)).toBe(true)
      for (const marker of plan.markers.filter((candidate) => candidate.kind === 'loot-chest')) {
        expect(plan.blocks).toContainEqual({ block: NATURAL_STRUCTURE_BLOCK.CHEST, x: marker.x, y: marker.y, z: marker.z })
      }
    }
    expect(desertPyramid.kind).toBe('desert-pyramid')
    expect(desertPyramid.markers).toContainEqual(expect.objectContaining({ kind: 'loot-chest', lootTable: 'desert-pyramid' }))
    expect(village.markers.some((marker) => marker.kind === 'entity-spawn')).toBe(true)
    expect(portal.markers.some((marker) => marker.kind === 'portal-frame' && !marker.complete)).toBe(true)
    expect(endCity.markers.some((marker) => marker.kind === 'spawner')).toBe(true)
    expect(endCity.markers.some((marker) => marker.kind === 'end-ship')).toBe(true)
  })

  it('changes candidates with the seed and keeps every origin inside the separation margin', () => {
    const firstSeed = [findDesertPyramid(111), findVillage(111), findPortal(111), findEndCity(111)]
    const secondSeed = [findDesertPyramid(222), findVillage(222), findPortal(222), findEndCity(222)]
    expect(secondSeed.map((plan) => `${plan.kind}:${positionKey(plan.origin)}`)).not.toStrictEqual(
      firstSeed.map((plan) => `${plan.kind}:${positionKey(plan.origin)}`),
    )

    for (const plan of [...firstSeed, ...secondSeed]) {
      const grid = NATURAL_STRUCTURE_GRID[plan.kind]
      const margin = grid.separation / 2
      const offsetX = plan.origin.x - plan.region.x * grid.spacing
      const offsetZ = plan.origin.z - plan.region.z * grid.spacing
      expect(offsetX).toBeGreaterThanOrEqual(margin)
      expect(offsetX).toBeLessThan(grid.spacing - margin)
      expect(offsetZ).toBeGreaterThanOrEqual(margin)
      expect(offsetZ).toBeLessThan(grid.spacing - margin)
    }
  })

  it('rejects unsuitable biome, relief, headroom, and absent End terrain', () => {
    const desertPyramid = findDesertPyramid(333)
    const village = findVillage(333)
    const portal = findPortal(333)
    const endCity = findEndCity(333)
    const desert: OverworldTerrainSampler = () => ({ biome: 'DESERT', seaLevel: blockAxis(63), surfaceY: blockAxis(70) })
    // A world-coordinate stripe, not a single-point exception: with
    // `structure-siting.ts`'s `VILLAGE_SITE_ATTEMPTS` retries, a threshold
    // keyed to one fixed point only rejects the specific candidate that
    // happened to draw that point — a later retry can land a probe cross
    // that never touches it, and the region would wrongly accept. Striping
    // by world coordinate with a period of `2 * VILLAGE_HALF_EXTENT` instead
    // guarantees every candidate's centre and all four
    // `VILLAGE_HALF_EXTENT`-offset edge probes fall in opposite stripes (the
    // half-extent shift is exactly half the period), so every retry sees the
    // same disqualifying height jump no matter which offset it draws.
    const steepVillage: OverworldTerrainSampler = (x, z) => ({
      biome: 'PLAINS',
      seaLevel: blockAxis(63),
      surfaceY: blockAxis((((x + z) % (2 * VILLAGE_HALF_EXTENT)) + 2 * VILLAGE_HALF_EXTENT) % (2 * VILLAGE_HALF_EXTENT) < VILLAGE_HALF_EXTENT ? 90 : 70),
    })
    const steepDesert: OverworldTerrainSampler = (x, z) => ({
      biome: 'DESERT',
      seaLevel: blockAxis(63),
      surfaceY: blockAxis(x === desertPyramid.origin.x && z === desertPyramid.origin.z ? 90 : 70),
    })

    expect(Option.isNone(planDesertPyramidForRegion(noiseSeed(333), desertPyramid.region.x, desertPyramid.region.z, FLAT_PLAINS))).toBe(true)
    expect(Option.isNone(planDesertPyramidForRegion(
      noiseSeed(333),
      desertPyramid.region.x,
      desertPyramid.region.z,
      () => ({ biome: 'DESERT', seaLevel: blockAxis(63), surfaceY: blockAxis(63) }),
    ))).toBe(true)
    expect(Option.isNone(planDesertPyramidForRegion(noiseSeed(333), desertPyramid.region.x, desertPyramid.region.z, steepDesert))).toBe(true)
    expect(Option.isNone(planVillageForRegion(noiseSeed(333), village.region.x, village.region.z, desert))).toBe(true)
    expect(Option.isNone(planVillageForRegion(noiseSeed(333), village.region.x, village.region.z, steepVillage))).toBe(true)
    expect(Option.isNone(planRuinedNetherPortalForRegion(
      noiseSeed(333),
      portal.region.x,
      portal.region.z,
      () => ({ ceilingY: blockAxis(53), surfaceY: blockAxis(48) }),
    ))).toBe(true)
    expect(Option.isNone(planRuinedNetherPortalForRegion(
      noiseSeed(333),
      portal.region.x,
      portal.region.z,
      (x) => ({ ceilingY: blockAxis(110), surfaceY: blockAxis(x === portal.origin.x ? 48 : 60) }),
    ))).toBe(true)
    expect(Option.isNone(planEndCityForRegion(noiseSeed(333), endCity.region.x, endCity.region.z, () => undefined))).toBe(true)
    expect(Option.isNone(planEndCityForRegion(
      noiseSeed(333),
      endCity.region.x,
      endCity.region.z,
      (x) => blockAxis(x === endCity.origin.x ? 70 : 80),
    ))).toBe(true)
  })

  it('rejects an End city candidate inside the central island before sampling terrain', () => {
    let sampleCount = 0
    const plan = planEndCityForRegion(noiseSeed(0), 0, -1, () => {
      sampleCount += 1
      return blockAxis(70)
    })

    expect(Option.isNone(plan)).toBe(true)
    expect(sampleCount).toBe(0)
  })

  it('returns a typed coordinate failure for a NaN End city region', () => {
    const result = planEndCityForRegionRaw(noiseSeed(123456789), Number.NaN, 0, FLAT_END, noiseSeed(0))

    expect(Result.isFailure(result)).toBe(true)
    if (Result.isSuccess(result)) throw new Error('expected an invalid-coordinate failure')
    expect(result.failure).toMatchObject({
      _tag: 'InvalidNaturalStructureCoordinate',
      axis: 'region-x',
      kind: 'end-city',
      value: Number.NaN,
    })
  })

  it('returns a typed coordinate failure for a NaN End city region z', () => {
    const result = planEndCityForRegionRaw(noiseSeed(123456789), 0, Number.NaN, FLAT_END, noiseSeed(0))

    expect(Result.isFailure(result)).toBe(true)
    if (Result.isSuccess(result)) throw new Error('expected an invalid-coordinate failure')
    expect(result.failure).toMatchObject({
      _tag: 'InvalidNaturalStructureCoordinate',
      axis: 'region-z',
      kind: 'end-city',
      region: { x: 0, z: Number.NaN },
      value: Number.NaN,
    })
  })

  it('returns a typed coordinate failure for a NaN ruined-portal region', () => {
    const result = planRuinedNetherPortalForRegionRaw(noiseSeed(0), Number.NaN, 0, FLAT_NETHER)

    expect(Result.isFailure(result)).toBe(true)
    if (Result.isSuccess(result)) throw new Error('expected an invalid-coordinate failure')
    expect(result.failure).toMatchObject({
      _tag: 'InvalidNaturalStructureCoordinate',
      axis: 'region-x',
      kind: 'ruined-nether-portal',
      value: Number.NaN,
    })
  })

  it('does not hide an invalid region when the selected dimension has no sampler', () => {
    const result = planNaturalStructureForRegionRaw({
      dimension: 'overworld',
      kind: 'village',
      presenceChannelSeed: noiseSeed(0),
      region: { x: Number.NaN, z: 0 },
      samplers: {},
      seed: noiseSeed(123456789),
    })

    expect(Result.isFailure(result)).toBe(true)
    if (Result.isSuccess(result)) throw new Error('expected an invalid-coordinate failure')
    expect(result.failure).toMatchObject({
      _tag: 'InvalidNaturalStructureCoordinate',
      axis: 'region-x',
      kind: 'village',
      value: Number.NaN,
    })
  })

  it('returns a typed coordinate failure from village region planning', () => {
    const result = planVillageForRegionRaw(noiseSeed(0), Number.NaN, 0, () => {
      throw new Error('invalid village regions must not sample terrain')
    })

    expect(Result.isFailure(result)).toBe(true)
    if (Result.isSuccess(result)) throw new Error('expected an invalid-coordinate failure')
    expect(result.failure).toMatchObject({
      _tag: 'InvalidNaturalStructureCoordinate',
      axis: 'region-x',
      kind: 'village',
      value: Number.NaN,
    })
  })

  it('rejects an invalid compact-structure region before sampling terrain', () => {
    const result = planCompactStructureForRegionRaw(noiseSeed(0), 'buried-treasure', Number.NaN, 0, () => {
      throw new Error('invalid coordinates must be rejected before terrain sampling')
    })

    expect(Result.isFailure(result)).toBe(true)
    if (Result.isSuccess(result)) {throw new Error('expected an invalid-coordinate failure')}
    expect(result.failure).toMatchObject({
      _tag: 'InvalidNaturalStructureCoordinate',
      axis: 'region-x',
      kind: 'buried-treasure',
      value: Number.NaN,
    })
  })

  it('returns a typed coordinate failure when an End city footprint exceeds safe integers', () => {
    const result = planEndCityForRegionRaw(noiseSeed(123456789), 28147497671065, 0, FLAT_END, noiseSeed(0))

    expect(Result.isFailure(result)).toBe(true)
    if (Result.isSuccess(result)) throw new Error('expected an invalid-coordinate failure')
    expect(result.failure).toMatchObject({
      _tag: 'InvalidNaturalStructureCoordinate',
      axis: 'footprint-x',
      kind: 'end-city',
      region: { x: 28147497671065, z: 0 },
    })
    expect(Number.isSafeInteger(result.failure.value)).toBe(false)
  })

  it('propagates invalid chunk footprints through plan enumeration and generation', () => {
    const coord = chunkCoord(chunkAxis(Number.MAX_SAFE_INTEGER), chunkAxis(0))
    const plans = naturalStructurePlansForChunkRaw(noiseSeed(0), 'end', coord)

    expect(Result.isFailure(plans)).toBe(true)
    if (Result.isSuccess(plans)) throw new Error('expected an invalid-coordinate failure')
    expect(plans.failure._tag).toBe('InvalidNaturalStructureCoordinate')

    const generated = generateChunkRaw(noiseSeed(0), coord)
    expect(Result.isFailure(generated)).toBe(true)
    if (Result.isSuccess(generated)) throw new Error('expected an invalid-coordinate failure')
    expect(generated.failure._tag).toBe('InvalidNaturalStructureCoordinate')
  })

  it('returns typed failures for malformed chunk coordinates at runtime', () => {
    // Coordinate brands disappear at runtime, so JavaScript callers can pass malformed objects.
    const malformedCoords = [
      { coord: { cx: Number.NaN, cz: chunkAxis(0) }, axis: 'footprint-x', value: Number.NaN },
      { coord: { cx: chunkAxis(0), cz: Number.POSITIVE_INFINITY }, axis: 'footprint-z', value: Number.POSITIVE_INFINITY },
      {
        coord: { cx: chunkAxis(0), cz: chunkAxis(Number.MAX_SAFE_INTEGER) },
        axis: 'footprint-z',
        value: Number.MAX_SAFE_INTEGER * CHUNK_SIZE_XZ,
      },
    ] as const

    for (const { coord, axis, value } of malformedCoords) {
      const plans = naturalStructurePlansForChunkRaw(
        noiseSeed(0),
        'overworld',
        coord as Parameters<typeof naturalStructurePlansForChunkRaw>[2],
      )

      expect(Result.isFailure(plans)).toBe(true)
      if (Result.isSuccess(plans)) throw new Error('expected an invalid-coordinate failure')
      expect(plans.failure).toMatchObject({
        _tag: 'InvalidNaturalStructureCoordinate',
        axis,
        value,
      })
    }
  })

  it('rejects a valid chunk whose candidate-region footprint exceeds safe integers', () => {
    const chunkX = Math.floor((Number.MAX_SAFE_INTEGER - (CHUNK_SIZE_XZ - 1)) / CHUNK_SIZE_XZ)
    const coord = chunkCoord(chunkAxis(chunkX), chunkAxis(0))
    const lastBlockX = chunkX * CHUNK_SIZE_XZ + CHUNK_SIZE_XZ - 1
    expect(Number.isSafeInteger(lastBlockX)).toBe(true)

    const plans = naturalStructurePlansForChunkRaw(noiseSeed(0), 'overworld', coord)

    expect(Result.isFailure(plans)).toBe(true)
    if (Result.isSuccess(plans)) throw new Error('expected an invalid candidate-region footprint failure')
    expect(plans.failure).toMatchObject({
      _tag: 'InvalidNaturalStructureCoordinate',
      axis: 'footprint-x',
    })
  })

  it('returns typed failures for unsafe candidate-region span endpoints', () => {
    const invalidSpans = [
      {
        span: { minRegionX: Number.MAX_SAFE_INTEGER + 1, maxRegionX: 0, minRegionZ: 0, maxRegionZ: 0 },
        axis: 'region-x',
      },
      {
        span: { minRegionX: 0, maxRegionX: Number.MAX_SAFE_INTEGER + 1, minRegionZ: 0, maxRegionZ: 0 },
        axis: 'region-x',
      },
      {
        span: { minRegionX: 0, maxRegionX: 0, minRegionZ: -Number.MAX_SAFE_INTEGER - 1, maxRegionZ: 0 },
        axis: 'region-z',
      },
      {
        span: { minRegionX: 0, maxRegionX: Number.MAX_SAFE_INTEGER, minRegionZ: 0, maxRegionZ: 0 },
        axis: 'footprint-x',
      },
      {
        span: { minRegionX: 0, maxRegionX: 0, minRegionZ: -Number.MAX_SAFE_INTEGER, maxRegionZ: 0 },
        axis: 'footprint-z',
      },
      {
        span: { minRegionX: 0, maxRegionX: 0, minRegionZ: 0, maxRegionZ: Number.MAX_SAFE_INTEGER },
        axis: 'footprint-z',
      },
      {
        span: { minRegionX: 0, maxRegionX: 0, minRegionZ: 0, maxRegionZ: Number.MAX_SAFE_INTEGER + 1 },
        axis: 'region-z',
      },
    ] as const

    for (const { span, axis } of invalidSpans) {
      const failure = invalidNaturalStructureRegionSpan(
        'village',
        span,
        NATURAL_STRUCTURE_GRID.village,
        64,
      )

      expect(failure).toMatchObject({
        _tag: 'InvalidNaturalStructureCoordinate',
        axis,
        kind: 'village',
      })
    }
  })

  it('propagates a region-planning failure through chunk enumeration', () => {
    const failure = new InvalidNaturalStructureCoordinate({
      axis: 'footprint-x',
      kind: 'ancient-city',
      region: { x: 0, z: 0 },
      value: Number.MAX_SAFE_INTEGER + 1,
    })
    const validated = Result.getOrThrow(validateNaturalStructureChunkCoordinates(
      'overworld',
      chunkCoord(chunkAxis(0), chunkAxis(0)),
    ))
    const result = naturalStructurePlansForValidatedChunkWithPlanner(
      noiseSeed(0),
      'overworld',
      validated,
      {},
      () => Result.fail(failure),
    )

    expect(Result.isFailure(result)).toBe(true)
    if (Result.isSuccess(result)) throw new Error('expected the region-planning failure to propagate')
    expect(result.failure).toBe(failure)
  })

  it('splits a negative-coordinate city across chunks without load-order coupling', () => {
    const plan = findEndCity(444, true)
    expect(plan.origin.x).toBeLessThan(0)
    expect(plan.origin.z).toBeLessThan(0)

    const minChunkX = Math.floor(plan.bounds.minX / CHUNK_SIZE_XZ)
    const maxChunkX = Math.floor(plan.bounds.maxX / CHUNK_SIZE_XZ)
    const minChunkZ = Math.floor(plan.bounds.minZ / CHUNK_SIZE_XZ)
    const maxChunkZ = Math.floor(plan.bounds.maxZ / CHUNK_SIZE_XZ)
    const chunkCoordinates: Array<readonly [number, number]> = []
    for (let chunkX = minChunkX; chunkX <= maxChunkX; chunkX += 1) {
      for (let chunkZ = minChunkZ; chunkZ <= maxChunkZ; chunkZ += 1) chunkCoordinates.push([chunkX, chunkZ])
    }

    const forward = chunkCoordinates.map(([chunkX, chunkZ]) => naturalStructureSliceForChunk(plan, chunkAxis(chunkX), chunkAxis(chunkZ)))
    const reverse = [...chunkCoordinates].reverse().map(([chunkX, chunkZ]) => naturalStructureSliceForChunk(plan, chunkAxis(chunkX), chunkAxis(chunkZ)))
    const blockKeys = (slices: typeof forward): ReadonlyArray<string> => slices
      .flatMap((slice) => slice.blocks.map((block) => `${positionKey(block)}:${String(block.block)}`))
      .sort()
    const markerKeys = (slices: typeof forward): ReadonlyArray<string> => slices
      .flatMap((slice) => slice.markers.map((marker) => `${marker.kind}:${positionKey(marker)}`))
      .sort()

    expect(forward.filter((slice) => slice.blocks.length > 0).length).toBeGreaterThan(1)
    expect(blockKeys(forward)).toStrictEqual(blockKeys(reverse))
    expect(markerKeys(forward)).toStrictEqual(markerKeys(reverse))
    expect(blockKeys(forward)).toStrictEqual(plan.blocks.map((block) => `${positionKey(block)}:${String(block.block)}`).sort())
    expect(markerKeys(forward)).toStrictEqual(plan.markers.map((marker) => `${marker.kind}:${positionKey(marker)}`).sort())
    for (const slice of forward) {
      expect(Object.isFrozen(slice)).toBe(true)
      expect(Object.isFrozen(slice.blocks)).toBe(true)
      expect(Object.isFrozen(slice.markers)).toBe(true)
      for (const block of slice.blocks) {
        expect(Math.floor(block.x / CHUNK_SIZE_XZ)).toBe(slice.chunkX)
        expect(Math.floor(block.z / CHUNK_SIZE_XZ)).toBe(slice.chunkZ)
      }
    }
  })

  it('enforces plan caps and uses only existing registry block ids', () => {
    const plans = [findDesertPyramid(555), findVillage(555), findPortal(555), findEndCity(555)]
    const registered = new Set<number>(BLOCK_IDS)
    for (const blockId of Object.values(NATURAL_STRUCTURE_BLOCK)) expect(registered.has(blockId)).toBe(true)
    for (const plan of plans) {
      expect(plan.blocks.length).toBeLessThanOrEqual(MAX_NATURAL_STRUCTURE_BLOCKS)
      expect(plan.markers.length).toBeLessThanOrEqual(MAX_NATURAL_STRUCTURE_MARKERS)
      for (const placement of plan.blocks) expect(registered.has(placement.block)).toBe(true)
    }
  })

  it('enumerates plans stably and applies each plan only once without mutating terrain', () => {
    const plan = findPortal(666)
    const coord = chunkCoord(chunkAxis(Math.floor(plan.origin.x / CHUNK_SIZE_XZ)), chunkAxis(Math.floor(plan.origin.z / CHUNK_SIZE_XZ)))
    const plans = naturalStructurePlansForChunk(noiseSeed(666), 'nether', coord, { nether: FLAT_NETHER })
    const terrain = {
      biomes: Array.from({ length: CHUNK_SIZE_XZ * CHUNK_SIZE_XZ }, () => 'NETHER' as const),
      blocks: emptyBlocks(),
      coord,
    }
    const before = terrain.blocks.slice()
    const applied = applyNaturalStructurePlansToChunk(terrain, [...plans, ...plans])

    expect(naturalStructurePlansForChunk(noiseSeed(666), 'nether', coord, { nether: FLAT_NETHER })).toStrictEqual(plans)
    expect(plans.some((candidate) => candidate.id === plan.id)).toBe(true)
    expect(new Set(applied.naturalStructureIds).size).toBe(applied.naturalStructureIds.length)
    expect(applied.naturalStructureIds).toContain(plan.id)
    expect(terrain.blocks).toStrictEqual(before)
    expect(applied.blocks).not.toBe(terrain.blocks)
    for (const marker of applied.naturalStructureMarkers) {
      expect(applied.naturalStructureIds).toContain(marker.structureId)
      expect(marker.structureKind).toBe('ruined-nether-portal')
    }
  })

  it('applies Overworld village plans through generateChunk', () => {
    // Region (-29, -25) is the known real-terrain accepted fixture under
    // VILLAGE_REGION_SPAWN_PERMILLE=500 / VILLAGE_SITE_ATTEMPTS=64 — see
    // structure-siting.ts for why. The plan id is keyed by region, not site,
    // so it does not move with the seeded (x, z) draw inside the region.
    const generated = generateChunk(noiseSeed(20260726), chunkCoord(chunkAxis(-288), chunkAxis(-244)))
    const markerChunk = generateChunk(noiseSeed(20260726), chunkCoord(chunkAxis(-289), chunkAxis(-244)))
    const villageId = 'village:20260726:-29:-25'

    expect(generated.naturalStructureIds).toContain(villageId)
    expect(markerChunk.naturalStructureMarkers.some((marker) => marker.structureId === villageId)).toBe(true)
  })

  it('enumerates and slices Overworld desert pyramids through the shared planner', () => {
    const plan = findDesertPyramid(999)
    const coord = chunkCoord(chunkAxis(Math.floor(plan.origin.x / CHUNK_SIZE_XZ)), chunkAxis(Math.floor(plan.origin.z / CHUNK_SIZE_XZ)))
    const plans = naturalStructurePlansForChunk(noiseSeed(999), 'overworld', coord, { overworld: FLAT_DESERT })
    const matched = plans.find((candidate) => candidate.id === plan.id)
    if (matched === undefined) throw new Error('expected desert pyramid in Overworld chunk plans')

    const slice = naturalStructureSliceForChunk(matched, coord.cx, coord.cz)
    expect(slice.blocks.length + slice.markers.length).toBeGreaterThan(0)
    expect(slice.blocks.every(({ x, z }) =>
      Math.floor(x / CHUNK_SIZE_XZ) === coord.cx && Math.floor(z / CHUNK_SIZE_XZ) === coord.cz)).toBe(true)
    expect(slice.markers.every(({ x, z }) =>
      Math.floor(x / CHUNK_SIZE_XZ) === coord.cx && Math.floor(z / CHUNK_SIZE_XZ) === coord.cz)).toBe(true)
    expect(matched.markers).toContainEqual(expect.objectContaining({ kind: 'loot-chest', lootTable: 'desert-pyramid' }))
  })

  it('does not record a plan id when its declared bounds overlap but placements miss the chunk', () => {
    const plan: NaturalStructurePlan = Object.freeze({
      blocks: Object.freeze([{ block: NATURAL_STRUCTURE_BLOCK.CHEST, x: blockAxis(CHUNK_SIZE_XZ), y: blockAxis(1), z: blockAxis(CHUNK_SIZE_XZ) }]),
      bounds: Object.freeze({
        maxX: blockAxis(0),
        maxY: blockAxis(1),
        maxZ: blockAxis(0),
        minX: blockAxis(0),
        minY: blockAxis(1),
        minZ: blockAxis(0),
      }),
      dimension: 'overworld',
      id: 'bounds-only-overlap',
      kind: 'desert-well',
      markers: Object.freeze([]),
      origin: Object.freeze({ x: blockAxis(0), y: blockAxis(1), z: blockAxis(0) }),
      region: Object.freeze({ x: 0, z: 0 }),
    })
    const terrain = {
      biomes: Array.from({ length: CHUNK_SIZE_XZ * CHUNK_SIZE_XZ }, () => 'PLAINS' as const),
      blocks: emptyBlocks(),
      coord: chunkCoord(chunkAxis(0), chunkAxis(0)),
    }

    const applied = applyNaturalStructurePlansToChunk(terrain, [plan])

    expect(applied.naturalStructureIds).toStrictEqual([])
    expect(applied.naturalStructureMarkers).toStrictEqual([])
    expect(applied.blocks).toStrictEqual(terrain.blocks)
  })

  it('answers no plans for a dimension whose sampler was not supplied, rather than throwing', () => {
    // `NaturalStructureSamplers`' fields are all optional and `samplers`
    // itself defaults to `{}`, so a caller asking about a dimension it has no
    // terrain sampler for is a real, typed call shape — not a caller error —
    // for both `overworld` and `nether` (the two dimensions `planForRegion`
    // explicitly guards; `end` instead defaults its sampler parameter, which
    // is why it needs no equivalent case here).
    const coord = chunkCoord(chunkAxis(0), chunkAxis(0))

    expect(naturalStructurePlansForChunk(noiseSeed(1), 'overworld', coord)).toStrictEqual([])
    expect(naturalStructurePlansForChunk(noiseSeed(1), 'nether', coord)).toStrictEqual([])
  })

  for (const { dimension, kind } of [
    { dimension: 'overworld', kind: 'nether-fortress' },
    { dimension: 'nether', kind: 'village' },
    { dimension: 'end', kind: 'village' },
  ] as const) {
    it(`returns no plan for ${kind} in ${dimension}`, () => {
      const result = planNaturalStructureForRegionRaw({
        dimension,
        kind,
        presenceChannelSeed: noiseSeed(0),
        region: { x: 0, z: 0 },
        samplers: {},
        seed: noiseSeed(123456789),
      })

      expect(result).toStrictEqual(Result.succeed(Option.none()))
    })
  }

  it('drops the slice of a structure that a pathological sampler pushes below the world', () => {
    // `addBlock`'s `y < 0` guard is not reachable through this repository's
    // OWN Nether terrain (`netherStructureTerrainAt` never reports a
    // `surfaceY` at or below `NETHER_LAVA_LEVEL`), but `sampleTerrain` is a
    // caller-supplied function with no such lower bound in its type — this is
    // the guard that keeps a hostile one doing so from writing a block at a
    // negative index instead of the plan simply omitting it.
    const seed = 777
    const portal = findPortal(seed)
    const belowWorld = () => ({ ceilingY: blockAxis(96), surfaceY: blockAxis(-1) })

    const planOption = planRuinedNetherPortalForRegion(noiseSeed(seed), portal.region.x, portal.region.z, belowWorld)
    const plan = unwrap(planOption)

    expect(plan.blocks.length).toBeGreaterThan(0)
    expect(plan.blocks.every((block) => block.y >= 0)).toBe(true)
  })

  it('drops the slice of a structure that a pathological sampler pushes above the world', () => {
    // The `y >= CHUNK_HEIGHT` side of the same guard, reached through an End
    // city whose sampler reports a surface near the top of the world — the
    // tower and ship both climb well above `baseY`, so a high enough surface
    // pushes part of the structure past `CHUNK_HEIGHT` while the candidate
    // siting itself (which only depends on distance from the origin) still
    // succeeds.
    const seed = 888
    const endCity = findEndCity(seed)
    const nearWorldTop = () => blockAxis(CHUNK_HEIGHT - 6)

    const planOption = planEndCityForRegion(noiseSeed(seed), endCity.region.x, endCity.region.z, nearWorldTop)
    const plan = unwrap(planOption)

    expect(plan.blocks.length).toBeGreaterThan(0)
    expect(plan.blocks.every((block) => block.y < CHUNK_HEIGHT)).toBe(true)
  })
})
