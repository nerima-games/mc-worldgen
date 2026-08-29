/* oxlint-disable curly, id-length, init-declarations, max-lines-per-function, max-statements, no-magic-numbers, no-ternary, no-undefined, sort-imports */

import { describe, expect, it } from '@effect/vitest'
import { BLOCK_IDS } from '@nerima-games/mc-kernel'
import { Option } from 'effect'
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
} from '../src/domain/natural-structure'
import type { OverworldTerrainSampler } from '../src/domain/structure-siting'
import { generateChunk } from '../src/domain/terrain'

const FLAT_PLAINS: OverworldTerrainSampler = () => ({ biome: 'PLAINS', seaLevel: 63, surfaceY: 70 })
const FLAT_DESERT: OverworldTerrainSampler = () => ({ biome: 'DESERT', seaLevel: 63, surfaceY: 70 })
const FLAT_NETHER = () => ({ ceilingY: 96, surfaceY: 48 })
const FLAT_END = () => 70

const unwrap = (option: Option.Option<NaturalStructurePlan>): NaturalStructurePlan => {
  if (Option.isNone(option)) throw new Error('expected a natural structure plan')
  return option.value
}

const findVillage = (seed: number): NaturalStructurePlan => {
  for (let regionX = -12; regionX <= 12; regionX += 1) {
    for (let regionZ = -12; regionZ <= 12; regionZ += 1) {
      const plan = planVillageForRegion(seed, regionX, regionZ, FLAT_PLAINS)
      if (Option.isSome(plan)) return plan.value
    }
  }
  throw new Error('village search range exhausted')
}

const findDesertPyramid = (seed: number): NaturalStructurePlan => {
  for (let regionX = -12; regionX <= 12; regionX += 1) {
    for (let regionZ = -12; regionZ <= 12; regionZ += 1) {
      const plan = planDesertPyramidForRegion(seed, regionX, regionZ, FLAT_DESERT)
      if (Option.isSome(plan)) return plan.value
    }
  }
  throw new Error('desert pyramid search range exhausted')
}

const findPortal = (seed: number): NaturalStructurePlan => {
  for (let regionX = -12; regionX <= 12; regionX += 1) {
    for (let regionZ = -12; regionZ <= 12; regionZ += 1) {
      const plan = planRuinedNetherPortalForRegion(seed, regionX, regionZ, FLAT_NETHER)
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
      const plan = planEndCityForRegion(seed, regionX, regionZ, FLAT_END)
      if (Option.isSome(plan)) return plan.value
    }
  }
  throw new Error('End city search range exhausted')
}

const positionKey = (position: { readonly x: number; readonly y: number; readonly z: number }): string =>
  `${String(position.x)},${String(position.y)},${String(position.z)}`

describe('natural structure plans', () => {
  it('accepts an explicit presence channel while preserving the candidate', () => {
    const seed = 0x3456
    const portal = findPortal(seed)
    const expected = planRuinedNetherPortalForRegion(
      seed,
      portal.region.x,
      portal.region.z,
      FLAT_NETHER,
    )
    const explicit = planRuinedNetherPortalForRegion(
      seed,
      portal.region.x,
      portal.region.z,
      FLAT_NETHER,
      candidatePresenceChannelSeedFor(seed, 'nether', 'ruined-nether-portal'),
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
      unwrap(planDesertPyramidForRegion(0x1234, desertPyramid.region.x, desertPyramid.region.z, FLAT_DESERT)),
      unwrap(planVillageForRegion(0x1234, village.region.x, village.region.z, FLAT_PLAINS)),
      unwrap(planRuinedNetherPortalForRegion(0x1234, portal.region.x, portal.region.z, FLAT_NETHER)),
      unwrap(planEndCityForRegion(0x1234, endCity.region.x, endCity.region.z, FLAT_END)),
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
    const desert: OverworldTerrainSampler = () => ({ biome: 'DESERT', seaLevel: 63, surfaceY: 70 })
    const steepVillage: OverworldTerrainSampler = (x, z) => ({
      biome: 'PLAINS',
      seaLevel: 63,
      surfaceY: x === village.origin.x && z === village.origin.z ? 90 : 70,
    })
    const steepDesert: OverworldTerrainSampler = (x, z) => ({
      biome: 'DESERT',
      seaLevel: 63,
      surfaceY: x === desertPyramid.origin.x && z === desertPyramid.origin.z ? 90 : 70,
    })

    expect(Option.isNone(planDesertPyramidForRegion(333, desertPyramid.region.x, desertPyramid.region.z, FLAT_PLAINS))).toBe(true)
    expect(Option.isNone(planDesertPyramidForRegion(
      333,
      desertPyramid.region.x,
      desertPyramid.region.z,
      () => ({ biome: 'DESERT', seaLevel: 63, surfaceY: 63 }),
    ))).toBe(true)
    expect(Option.isNone(planDesertPyramidForRegion(333, desertPyramid.region.x, desertPyramid.region.z, steepDesert))).toBe(true)
    expect(Option.isNone(planVillageForRegion(333, village.region.x, village.region.z, desert))).toBe(true)
    expect(Option.isNone(planVillageForRegion(333, village.region.x, village.region.z, steepVillage))).toBe(true)
    expect(Option.isNone(planRuinedNetherPortalForRegion(
      333,
      portal.region.x,
      portal.region.z,
      () => ({ ceilingY: 53, surfaceY: 48 }),
    ))).toBe(true)
    expect(Option.isNone(planRuinedNetherPortalForRegion(
      333,
      portal.region.x,
      portal.region.z,
      (x) => ({ ceilingY: 110, surfaceY: x === portal.origin.x ? 48 : 60 }),
    ))).toBe(true)
    expect(Option.isNone(planEndCityForRegion(333, endCity.region.x, endCity.region.z, () => undefined))).toBe(true)
    expect(Option.isNone(planEndCityForRegion(
      333,
      endCity.region.x,
      endCity.region.z,
      (x) => x === endCity.origin.x ? 70 : 80,
    ))).toBe(true)
  })

  it('rejects an End city candidate inside the central island before sampling terrain', () => {
    let sampleCount = 0
    const plan = planEndCityForRegion(0, 0, -1, () => {
      sampleCount += 1
      return 70
    })

    expect(Option.isNone(plan)).toBe(true)
    expect(sampleCount).toBe(0)
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

    const forward = chunkCoordinates.map(([chunkX, chunkZ]) => naturalStructureSliceForChunk(plan, chunkX, chunkZ))
    const reverse = [...chunkCoordinates].reverse().map(([chunkX, chunkZ]) => naturalStructureSliceForChunk(plan, chunkX, chunkZ))
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
    const coord = chunkCoord(Math.floor(plan.origin.x / CHUNK_SIZE_XZ), Math.floor(plan.origin.z / CHUNK_SIZE_XZ))
    const plans = naturalStructurePlansForChunk(666, 'nether', coord, { nether: FLAT_NETHER })
    const terrain = {
      biomes: Array.from({ length: CHUNK_SIZE_XZ * CHUNK_SIZE_XZ }, () => 'NETHER' as const),
      blocks: emptyBlocks(),
      coord,
    }
    const before = terrain.blocks.slice()
    const applied = applyNaturalStructurePlansToChunk(terrain, [...plans, ...plans])

    expect(naturalStructurePlansForChunk(666, 'nether', coord, { nether: FLAT_NETHER })).toStrictEqual(plans)
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
    const generated = generateChunk(20260726, chunkCoord(-207, 67))
    const markerChunk = generateChunk(20260726, chunkCoord(-208, 67))
    const villageId = 'village:20260726:-21:6'

    expect(generated.naturalStructureIds).toContain(villageId)
    expect(markerChunk.naturalStructureMarkers.some((marker) => marker.structureId === villageId)).toBe(true)
  })

  it('enumerates and slices Overworld desert pyramids through the shared planner', () => {
    const plan = findDesertPyramid(999)
    const coord = chunkCoord(Math.floor(plan.origin.x / CHUNK_SIZE_XZ), Math.floor(plan.origin.z / CHUNK_SIZE_XZ))
    const plans = naturalStructurePlansForChunk(999, 'overworld', coord, { overworld: FLAT_DESERT })
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
      blocks: Object.freeze([{ block: NATURAL_STRUCTURE_BLOCK.CHEST, x: CHUNK_SIZE_XZ, y: 1, z: CHUNK_SIZE_XZ }]),
      bounds: Object.freeze({ maxX: 0, maxY: 1, maxZ: 0, minX: 0, minY: 1, minZ: 0 }),
      dimension: 'overworld',
      id: 'bounds-only-overlap',
      kind: 'desert-well',
      markers: Object.freeze([]),
      origin: Object.freeze({ x: 0, y: 1, z: 0 }),
      region: Object.freeze({ x: 0, z: 0 }),
    })
    const terrain = {
      biomes: Array.from({ length: CHUNK_SIZE_XZ * CHUNK_SIZE_XZ }, () => 'PLAINS' as const),
      blocks: emptyBlocks(),
      coord: chunkCoord(0, 0),
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
    const coord = chunkCoord(0, 0)

    expect(naturalStructurePlansForChunk(1, 'overworld', coord)).toStrictEqual([])
    expect(naturalStructurePlansForChunk(1, 'nether', coord)).toStrictEqual([])
  })

  it('drops the slice of a structure that a pathological sampler pushes below the world', () => {
    // `addBlock`'s `y < 0` guard is not reachable through this repository's
    // OWN Nether terrain (`netherStructureTerrainAt` never reports a
    // `surfaceY` at or below `NETHER_LAVA_LEVEL`), but `sampleTerrain` is a
    // caller-supplied function with no such lower bound in its type — this is
    // the guard that keeps a hostile one doing so from writing a block at a
    // negative index instead of the plan simply omitting it.
    const seed = 777
    const portal = findPortal(seed)
    const belowWorld = (): { readonly ceilingY: number; readonly surfaceY: number } => ({ ceilingY: 96, surfaceY: -1 })

    const planOption = planRuinedNetherPortalForRegion(seed, portal.region.x, portal.region.z, belowWorld)
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
    const nearWorldTop = (): number => CHUNK_HEIGHT - 6

    const planOption = planEndCityForRegion(seed, endCity.region.x, endCity.region.z, nearWorldTop)
    const plan = unwrap(planOption)

    expect(plan.blocks.length).toBeGreaterThan(0)
    expect(plan.blocks.every((block) => block.y < CHUNK_HEIGHT)).toBe(true)
  })
})
