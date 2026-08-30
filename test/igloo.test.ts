/* oxlint-disable curly, id-length, init-declarations, max-lines-per-function, max-statements, no-magic-numbers, no-ternary, no-undefined, sort-imports */

import { describe, expect, it } from '@effect/vitest'
import { BLOCK_IDS, chunkCoord } from '@nerima-games/mc-kernel'
import { Option } from 'effect'
import { CHUNK_HEIGHT, CHUNK_SIZE_XZ } from '../src/domain/constants'
import { IGLOO_BLOCK, IGLOO_LAYOUT } from '../src/domain/igloo-data'
import { type IglooDraft, planIglooForCandidate } from '../src/domain/igloo'
import {
  NATURAL_STRUCTURE_GRID,
  type NaturalStructurePlan,
  naturalStructurePlansForChunk,
  naturalStructureSliceForChunk,
  planIglooForRegion,
} from '../src/domain/natural-structure'
import type { OverworldTerrainSampler } from '../src/domain/structure-siting'

const FLAT_SNOW: OverworldTerrainSampler = () => ({ biome: 'SNOW', seaLevel: 63, surfaceY: 70 })

type LocatedIgloo = {
  readonly plan: NaturalStructurePlan
  readonly regionX: number
  readonly regionZ: number
}

const unwrapDraft = (option: Option.Option<IglooDraft>): IglooDraft => {
  if (Option.isNone(option)) throw new Error('expected an igloo draft')
  return option.value
}

const findIgloo = (seed: number): LocatedIgloo => {
  for (let regionX = -20; regionX <= 20; regionX += 1) {
    for (let regionZ = -20; regionZ <= 20; regionZ += 1) {
      const plan = planIglooForRegion(seed, regionX, regionZ, FLAT_SNOW)
      if (Option.isSome(plan)) return { plan: plan.value, regionX, regionZ }
    }
  }
  throw new Error('igloo search range exhausted')
}

const findAbsentRegion = (seed: number): readonly [number, number] => {
  for (let regionX = -20; regionX <= 20; regionX += 1) {
    for (let regionZ = -20; regionZ <= 20; regionZ += 1) {
      if (Option.isNone(planIglooForRegion(seed, regionX, regionZ, FLAT_SNOW))) return [regionX, regionZ]
    }
  }
  throw new Error('igloo absent-region search range exhausted')
}

describe('igloo plans', () => {
  it('are deterministic, immutable, registry-backed, and semantically marked', () => {
    const first = unwrapDraft(planIglooForCandidate({ x: 0, z: 0 }, FLAT_SNOW))
    const repeated = unwrapDraft(planIglooForCandidate({ x: 0, z: 0 }, FLAT_SNOW))
    const registeredBlocks = new Set<number>(BLOCK_IDS)
    const placedBlocks = new Set(first.blocks.map((placement) => placement.block))

    expect(repeated).toStrictEqual(first)
    expect(first.origin).toStrictEqual({ x: 0, y: 71, z: 0 })
    expect(first.blocks.length).toBeGreaterThan(0)
    expect(first.markers.length).toBeGreaterThan(0)
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
    for (const marker of first.markers) {
      expect(Object.isFrozen(marker)).toBe(true)
      expect(marker.x).toBeGreaterThanOrEqual(-IGLOO_LAYOUT.basementHalfExtent)
    }
    for (const block of Object.values(IGLOO_BLOCK)) expect(placedBlocks.has(block)).toBe(true)
    expect(first.markers).toContainEqual(expect.objectContaining({ kind: 'loot-chest', lootTable: 'igloo' }))
    expect(first.markers).toContainEqual(expect.objectContaining({ entity: 'villager', profession: 'farmer' }))
    expect(first.markers).toContainEqual(expect.objectContaining({ entity: 'zombie-villager' }))
  })

  it('rejects unsuitable snow sites and accepts the maximum supported relief', () => {
    const plains: OverworldTerrainSampler = () => ({ biome: 'PLAINS', seaLevel: 63, surfaceY: 70 })
    const wetSnow: OverworldTerrainSampler = () => ({ biome: 'SNOW', seaLevel: 70, surfaceY: 71 })
    const excessiveRelief: OverworldTerrainSampler = (x, z) => ({
      biome: 'SNOW',
      seaLevel: 0,
      surfaceY: x === 0 && z === 0 ? 80 : 70,
    })
    const lowSite: OverworldTerrainSampler = () => ({ biome: 'SNOW', seaLevel: 0, surfaceY: 3 })
    const highSite: OverworldTerrainSampler = () => ({ biome: 'SNOW', seaLevel: 0, surfaceY: CHUNK_HEIGHT - 1 })
    const maximumRelief: OverworldTerrainSampler = (x, z) => ({
      biome: 'SNOW',
      seaLevel: 0,
      surfaceY: x === 0 && z === 0 ? 70 : 73,
    })

    expect(Option.isNone(planIglooForCandidate({ x: 0, z: 0 }, plains))).toBe(true)
    expect(Option.isNone(planIglooForCandidate({ x: 0, z: 0 }, wetSnow))).toBe(true)
    expect(Option.isNone(planIglooForCandidate({ x: 0, z: 0 }, excessiveRelief))).toBe(true)
    expect(Option.isNone(planIglooForCandidate({ x: 0, z: 0 }, lowSite))).toBe(true)
    expect(Option.isNone(planIglooForCandidate({ x: 0, z: 0 }, highSite))).toBe(true)
    expect(Option.isSome(planIglooForCandidate({ x: 0, z: 0 }, maximumRelief))).toBe(true)
  })

  it('routes through the shared planner and owns only the target chunk slice', () => {
    const seed = 0x1234
    const located = findIgloo(seed)
    const repeated = planIglooForRegion(seed, located.regionX, located.regionZ, FLAT_SNOW)
    const [absentX, absentZ] = findAbsentRegion(seed)
    const originChunk = chunkCoord(
      Math.floor(located.plan.origin.x / CHUNK_SIZE_XZ),
      Math.floor(located.plan.origin.z / CHUNK_SIZE_XZ),
    )
    const plans = naturalStructurePlansForChunk(seed, 'overworld', originChunk, { overworld: FLAT_SNOW })
    const routed = plans.find((plan) => plan.id === located.plan.id)

    expect(Option.isSome(repeated)).toBe(true)
    expect(Option.isNone(planIglooForRegion(seed, absentX, absentZ, FLAT_SNOW))).toBe(true)
    expect(NATURAL_STRUCTURE_GRID.igloo).toStrictEqual({ separation: 64, spacing: 128, spawnPermille: 200 })
    expect(located.plan.kind).toBe('igloo')
    expect(located.plan.dimension).toBe('overworld')
    expect(located.plan.bounds.minY).toBe(located.plan.origin.y - IGLOO_LAYOUT.basementDepth)
    expect(located.plan.bounds.maxY).toBe(located.plan.origin.y + IGLOO_LAYOUT.domeLevelCount - 1)
    if (routed === undefined) throw new Error('expected igloo in Overworld chunk plans')

    const slice = naturalStructureSliceForChunk(routed, originChunk.cx, originChunk.cz)
    expect(slice.blocks.length + slice.markers.length).toBeGreaterThan(0)
    for (const placement of slice.blocks) {
      expect(Math.floor(placement.x / CHUNK_SIZE_XZ)).toBe(originChunk.cx)
      expect(Math.floor(placement.z / CHUNK_SIZE_XZ)).toBe(originChunk.cz)
    }
    for (const marker of slice.markers) {
      expect(Math.floor(marker.x / CHUNK_SIZE_XZ)).toBe(originChunk.cx)
      expect(Math.floor(marker.z / CHUNK_SIZE_XZ)).toBe(originChunk.cz)
    }
  })
})
