/* oxlint-disable curly, id-length, init-declarations, max-lines-per-function, max-statements, no-magic-numbers, no-ternary, no-undefined, sort-imports */

import { describe, expect, it } from '@effect/vitest'
import { BLOCK_IDS, chunkCoord } from '@nerima-games/mc-kernel'
import { Option } from 'effect'
import { CHUNK_HEIGHT, CHUNK_SIZE_XZ } from '../src/domain/constants'
import { JUNGLE_PYRAMID_BLOCK, JUNGLE_PYRAMID_LAYOUT } from '../src/domain/jungle-pyramid-data'
import { type JunglePyramidDraft, planJunglePyramidForCandidate } from '../src/domain/jungle-pyramid'
import {
  NATURAL_STRUCTURE_GRID,
  type NaturalStructurePlan,
  naturalStructurePlansForChunk,
  naturalStructureSliceForChunk,
  planJunglePyramidForRegion,
} from '../src/domain/natural-structure'
import type { OverworldTerrainSampler } from '../src/domain/structure-siting'

const FLAT_JUNGLE: OverworldTerrainSampler = () => ({ biome: 'JUNGLE', seaLevel: 63, surfaceY: 70 })

type LocatedJunglePyramid = {
  readonly plan: NaturalStructurePlan
  readonly regionX: number
  readonly regionZ: number
}

const unwrapDraft = (option: Option.Option<JunglePyramidDraft>): JunglePyramidDraft => {
  if (Option.isNone(option)) throw new Error('expected a jungle pyramid draft')
  return option.value
}

const findJunglePyramid = (seed: number): LocatedJunglePyramid => {
  for (let regionX = -20; regionX <= 20; regionX += 1) {
    for (let regionZ = -20; regionZ <= 20; regionZ += 1) {
      const plan = planJunglePyramidForRegion(seed, regionX, regionZ, FLAT_JUNGLE)
      if (Option.isSome(plan)) return { plan: plan.value, regionX, regionZ }
    }
  }
  throw new Error('jungle pyramid search range exhausted')
}

const findAbsentRegion = (seed: number): readonly [number, number] => {
  for (let regionX = -20; regionX <= 20; regionX += 1) {
    for (let regionZ = -20; regionZ <= 20; regionZ += 1) {
      if (Option.isNone(planJunglePyramidForRegion(seed, regionX, regionZ, FLAT_JUNGLE))) return [regionX, regionZ]
    }
  }
  throw new Error('jungle pyramid absent-region search range exhausted')
}

describe('jungle pyramid plans', () => {
  it('are deterministic, immutable, registry-backed, and semantically marked', () => {
    const first = unwrapDraft(planJunglePyramidForCandidate({ x: 0, z: 0 }, FLAT_JUNGLE))
    const repeated = unwrapDraft(planJunglePyramidForCandidate({ x: 0, z: 0 }, FLAT_JUNGLE))
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
    for (const marker of first.markers) expect(Object.isFrozen(marker)).toBe(true)
    for (const block of Object.values(JUNGLE_PYRAMID_BLOCK)) expect(placedBlocks.has(block)).toBe(true)
    expect(first.markers).toContainEqual(expect.objectContaining({ kind: 'loot-chest', lootTable: 'jungle-pyramid' }))
    expect(first.blocks).toContainEqual(expect.objectContaining({ block: JUNGLE_PYRAMID_BLOCK.TNT, x: 0, y: 68, z: 0 }))
    expect(first.blocks).toContainEqual(expect.objectContaining({ block: JUNGLE_PYRAMID_BLOCK.CHEST, x: -1, y: 68, z: 0 }))
  })

  it('rejects unsuitable sites and accepts the maximum supported relief', () => {
    const invalidBiome: OverworldTerrainSampler = () => ({ biome: 'FOREST', seaLevel: 63, surfaceY: 70 })
    const wetSite: OverworldTerrainSampler = () => ({ biome: 'JUNGLE', seaLevel: 69, surfaceY: 70 })
    const belowWorld: OverworldTerrainSampler = () => ({ biome: 'JUNGLE', seaLevel: -100, surfaceY: -98 })
    const chamberBelowWorld: OverworldTerrainSampler = () => ({ biome: 'JUNGLE', seaLevel: -1, surfaceY: 1 })
    const highSite: OverworldTerrainSampler = () => ({ biome: 'JUNGLE', seaLevel: -10, surfaceY: CHUNK_HEIGHT })
    const excessiveRelief: OverworldTerrainSampler = (x, z) => ({
      biome: 'JUNGLE',
      seaLevel: 63,
      surfaceY: x === 0 && z === 0 ? 70 : 74,
    })
    const maximumRelief: OverworldTerrainSampler = (x, z) => ({
      biome: 'JUNGLE',
      seaLevel: 63,
      surfaceY: x === 0 && z === 0 ? 70 : 73,
    })

    expect(Option.isNone(planJunglePyramidForCandidate({ x: 0, z: 0 }, invalidBiome))).toBe(true)
    expect(Option.isNone(planJunglePyramidForCandidate({ x: 0, z: 0 }, wetSite))).toBe(true)
    expect(Option.isNone(planJunglePyramidForCandidate({ x: 0, z: 0 }, belowWorld))).toBe(true)
    expect(Option.isNone(planJunglePyramidForCandidate({ x: 0, z: 0 }, chamberBelowWorld))).toBe(true)
    expect(Option.isNone(planJunglePyramidForCandidate({ x: 0, z: 0 }, highSite))).toBe(true)
    expect(Option.isNone(planJunglePyramidForCandidate({ x: 0, z: 0 }, excessiveRelief))).toBe(true)
    expect(Option.isSome(planJunglePyramidForCandidate({ x: 0, z: 0 }, maximumRelief))).toBe(true)
  })

  it('routes through the shared planner and owns only the target chunk slice', () => {
    const seed = 0x1234
    const located = findJunglePyramid(seed)
    const unsuitableTerrain: OverworldTerrainSampler = () => ({ biome: 'FOREST', seaLevel: 63, surfaceY: 70 })
    const repeated = planJunglePyramidForRegion(seed, located.regionX, located.regionZ, FLAT_JUNGLE)
    const [absentX, absentZ] = findAbsentRegion(seed)
    const originChunk = chunkCoord(
      Math.floor(located.plan.origin.x / CHUNK_SIZE_XZ),
      Math.floor(located.plan.origin.z / CHUNK_SIZE_XZ),
    )
    const plans = naturalStructurePlansForChunk(seed, 'overworld', originChunk, { overworld: FLAT_JUNGLE })
    const routed = plans.find((plan) => plan.id === located.plan.id)

    expect(Option.isSome(repeated)).toBe(true)
    expect(Option.isNone(planJunglePyramidForRegion(seed, located.regionX, located.regionZ, unsuitableTerrain))).toBe(true)
    expect(Option.isNone(planJunglePyramidForRegion(seed, absentX, absentZ, FLAT_JUNGLE))).toBe(true)
    expect(NATURAL_STRUCTURE_GRID['jungle-pyramid']).toStrictEqual({ separation: 96, spacing: 256, spawnPermille: 160 })
    expect(located.plan.kind).toBe('jungle-pyramid')
    expect(located.plan.dimension).toBe('overworld')
    expect(located.plan.bounds.minY).toBe(located.plan.origin.y - JUNGLE_PYRAMID_LAYOUT.chamberFloorYOffset)
    expect(located.plan.bounds.maxY).toBe(
      located.plan.origin.y + JUNGLE_PYRAMID_LAYOUT.baseYClearance + JUNGLE_PYRAMID_LAYOUT.templeWallHeight,
    )
    if (routed === undefined) throw new Error('expected jungle pyramid in Overworld chunk plans')

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
