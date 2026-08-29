/* oxlint-disable curly, id-length, init-declarations, max-lines-per-function, max-statements, no-magic-numbers, no-ternary, no-undefined, sort-imports */

import { describe, expect, it } from '@effect/vitest'
import { BLOCK_IDS, chunkCoord } from '@nerima-games/mc-kernel'
import { Option } from 'effect'
import { CHUNK_HEIGHT, CHUNK_SIZE_XZ } from '../src/domain/constants'
import { DESERT_WELL_BLOCK, DESERT_WELL_LAYOUT } from '../src/domain/desert-well-data'
import { type DesertWellDraft, planDesertWellForCandidate } from '../src/domain/desert-well'
import {
  NATURAL_STRUCTURE_GRID,
  type NaturalStructurePlan,
  naturalStructurePlansForChunk,
  naturalStructureSliceForChunk,
  planDesertWellForRegion,
} from '../src/domain/natural-structure'
import type { OverworldTerrainSampler } from '../src/domain/structure-siting'

const FLAT_DESERT: OverworldTerrainSampler = () => ({ biome: 'DESERT', seaLevel: 63, surfaceY: 70 })

type LocatedDesertWell = {
  readonly plan: NaturalStructurePlan
  readonly regionX: number
  readonly regionZ: number
}

const unwrapDraft = (option: Option.Option<DesertWellDraft>): DesertWellDraft => {
  if (Option.isNone(option)) throw new Error('expected a desert-well draft')
  return option.value
}

const findDesertWell = (seed: number): LocatedDesertWell => {
  for (let regionX = -20; regionX <= 20; regionX += 1) {
    for (let regionZ = -20; regionZ <= 20; regionZ += 1) {
      const plan = planDesertWellForRegion(seed, regionX, regionZ, FLAT_DESERT)
      if (Option.isSome(plan)) return { plan: plan.value, regionX, regionZ }
    }
  }
  throw new Error('desert-well search range exhausted')
}

const findAbsentRegion = (seed: number): readonly [number, number] => {
  for (let regionX = -20; regionX <= 20; regionX += 1) {
    for (let regionZ = -20; regionZ <= 20; regionZ += 1) {
      if (Option.isNone(planDesertWellForRegion(seed, regionX, regionZ, FLAT_DESERT))) return [regionX, regionZ]
    }
  }
  throw new Error('desert-well absent-region search range exhausted')
}

describe('desert well plans', () => {
  it('are deterministic, immutable, and registry-backed', () => {
    const first = unwrapDraft(planDesertWellForCandidate({ x: 0, z: 0 }, FLAT_DESERT))
    const repeated = unwrapDraft(planDesertWellForCandidate({ x: 0, z: 0 }, FLAT_DESERT))
    const registeredBlocks = new Set<number>(BLOCK_IDS)
    const placedBlocks = new Set(first.blocks.map((placement) => placement.block))
    const expectedWaterCount = (DESERT_WELL_LAYOUT.waterHalfExtent * 2 + 1) ** 2

    expect(repeated).toStrictEqual(first)
    expect(first.origin).toStrictEqual({ x: 0, y: 71, z: 0 })
    expect(first.blocks.length).toBeGreaterThan(0)
    expect(first.markers).toHaveLength(0)
    expect(first.blocks.filter((placement) => placement.block === DESERT_WELL_BLOCK.WATER)).toHaveLength(expectedWaterCount)
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first.blocks)).toBe(true)
    expect(Object.isFrozen(first.markers)).toBe(true)
    expect(Object.isFrozen(first.origin)).toBe(true)
    for (const placement of first.blocks) {
      expect(Object.isFrozen(placement)).toBe(true)
      expect(registeredBlocks.has(placement.block)).toBe(true)
      expect(placement.y).toBeGreaterThanOrEqual(0)
      expect(placement.y).toBeLessThan(CHUNK_HEIGHT)
    }
    for (const block of Object.values(DESERT_WELL_BLOCK)) expect(placedBlocks.has(block)).toBe(true)
  })

  it('rejects unsuitable desert sites and accepts the maximum supported relief', () => {
    const plains: OverworldTerrainSampler = () => ({ biome: 'PLAINS', seaLevel: 63, surfaceY: 70 })
    const wetDesert: OverworldTerrainSampler = () => ({ biome: 'DESERT', seaLevel: 70, surfaceY: 71 })
    const excessiveRelief: OverworldTerrainSampler = (x, z) => ({
      biome: 'DESERT',
      seaLevel: 0,
      surfaceY: x === 0 && z === 0 ? 80 : 70,
    })
    const lowSite: OverworldTerrainSampler = () => ({ biome: 'DESERT', seaLevel: -100, surfaceY: -2 })
    const highSite: OverworldTerrainSampler = () => ({ biome: 'DESERT', seaLevel: 0, surfaceY: CHUNK_HEIGHT - 5 })
    const maximumRelief: OverworldTerrainSampler = (x, z) => ({
      biome: 'DESERT',
      seaLevel: 0,
      surfaceY: x === 0 && z === 0 ? 70 : 73,
    })

    expect(Option.isNone(planDesertWellForCandidate({ x: 0, z: 0 }, plains))).toBe(true)
    expect(Option.isNone(planDesertWellForCandidate({ x: 0, z: 0 }, wetDesert))).toBe(true)
    expect(Option.isNone(planDesertWellForCandidate({ x: 0, z: 0 }, excessiveRelief))).toBe(true)
    expect(Option.isNone(planDesertWellForCandidate({ x: 0, z: 0 }, lowSite))).toBe(true)
    expect(Option.isNone(planDesertWellForCandidate({ x: 0, z: 0 }, highSite))).toBe(true)
    expect(Option.isSome(planDesertWellForCandidate({ x: 0, z: 0 }, maximumRelief))).toBe(true)
  })

  it('routes through the shared planner and owns only the target chunk slice', () => {
    const seed = 0x1234
    const located = findDesertWell(seed)
    const repeated = planDesertWellForRegion(seed, located.regionX, located.regionZ, FLAT_DESERT)
    const [absentX, absentZ] = findAbsentRegion(seed)
    const originChunk = chunkCoord(
      Math.floor(located.plan.origin.x / CHUNK_SIZE_XZ),
      Math.floor(located.plan.origin.z / CHUNK_SIZE_XZ),
    )
    const plans = naturalStructurePlansForChunk(seed, 'overworld', originChunk, { overworld: FLAT_DESERT })
    const routed = plans.find((plan) => plan.id === located.plan.id)

    expect(Option.isSome(repeated)).toBe(true)
    expect(Option.isNone(planDesertWellForRegion(seed, absentX, absentZ, FLAT_DESERT))).toBe(true)
    expect(NATURAL_STRUCTURE_GRID['desert-well']).toStrictEqual({ separation: 64, spacing: 128, spawnPermille: 200 })
    expect(located.plan.kind).toBe('desert-well')
    expect(located.plan.dimension).toBe('overworld')
    expect(located.plan.bounds.minY).toBe(located.plan.origin.y)
    expect(located.plan.bounds.maxY).toBe(located.plan.origin.y + DESERT_WELL_LAYOUT.roofOffsetY)
    if (routed === undefined) throw new Error('expected desert well in Overworld chunk plans')

    const slice = naturalStructureSliceForChunk(routed, originChunk.cx, originChunk.cz)
    expect(slice.blocks.length + slice.markers.length).toBeGreaterThan(0)
    for (const placement of slice.blocks) {
      expect(Math.floor(placement.x / CHUNK_SIZE_XZ)).toBe(originChunk.cx)
      expect(Math.floor(placement.z / CHUNK_SIZE_XZ)).toBe(originChunk.cz)
    }
  })
})
