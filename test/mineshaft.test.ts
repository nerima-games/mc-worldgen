/* oxlint-disable curly, id-length, init-declarations, max-lines-per-function, max-statements, no-magic-numbers, no-ternary, no-undefined, sort-imports */

import { describe, expect, it } from '@effect/vitest'
import { BLOCK_IDS, chunkCoord } from '@nerima-games/mc-kernel'
import { Option } from 'effect'
import { CHUNK_HEIGHT, CHUNK_SIZE_XZ } from '../src/domain/constants'
import { MINESHAFT_BLOCK, MINESHAFT_LAYOUT } from '../src/domain/mineshaft-data'
import { type MineshaftDraft, planMineshaftForCandidate } from '../src/domain/mineshaft'
import {
  NATURAL_STRUCTURE_GRID,
  type NaturalStructurePlan,
  naturalStructurePlansForChunk,
  naturalStructureSliceForChunk,
  planMineshaftForRegion,
} from '../src/domain/natural-structure'
import type { OverworldTerrainSampler } from '../src/domain/structure-siting'

const FLAT_PLAINS: OverworldTerrainSampler = () => ({ biome: 'PLAINS', seaLevel: 63, surfaceY: 70 })

type LocatedMineshaft = {
  readonly plan: NaturalStructurePlan
  readonly regionX: number
  readonly regionZ: number
}

const unwrapDraft = (option: Option.Option<MineshaftDraft>): MineshaftDraft => {
  if (Option.isNone(option)) throw new Error('expected a mineshaft draft')
  return option.value
}

const findMineshaft = (seed: number): LocatedMineshaft => {
  for (let regionX = -20; regionX <= 20; regionX += 1) {
    for (let regionZ = -20; regionZ <= 20; regionZ += 1) {
      const plan = planMineshaftForRegion(seed, regionX, regionZ, FLAT_PLAINS)
      if (Option.isSome(plan)) return { plan: plan.value, regionX, regionZ }
    }
  }
  throw new Error('mineshaft search range exhausted')
}

const findAbsentRegion = (seed: number): readonly [number, number] => {
  for (let regionX = -20; regionX <= 20; regionX += 1) {
    for (let regionZ = -20; regionZ <= 20; regionZ += 1) {
      if (Option.isNone(planMineshaftForRegion(seed, regionX, regionZ, FLAT_PLAINS))) return [regionX, regionZ]
    }
  }
  throw new Error('mineshaft absent-region search range exhausted')
}

describe('mineshaft plans', () => {
  it('are deterministic, immutable, registry-backed, and semantically marked', () => {
    const first = unwrapDraft(planMineshaftForCandidate({ x: 0, z: 0 }, FLAT_PLAINS))
    const repeated = unwrapDraft(planMineshaftForCandidate({ x: 0, z: 0 }, FLAT_PLAINS))
    const registeredBlocks = new Set<number>(BLOCK_IDS)
    const placedBlocks = new Set(first.blocks.map((placement) => placement.block))

    expect(repeated).toStrictEqual(first)
    expect(first.origin).toStrictEqual({ x: 0, y: 52, z: 0 })
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
    for (const block of Object.values(MINESHAFT_BLOCK)) expect(placedBlocks.has(block)).toBe(true)
    expect(first.markers).toContainEqual(expect.objectContaining({ kind: 'loot-chest', lootTable: 'mineshaft' }))
    expect(first.blocks).toContainEqual(expect.objectContaining({ block: MINESHAFT_BLOCK.CHEST, x: -8, y: 53, z: 8 }))
  })

  it('rejects unsuitable terrain and accepts the maximum supported relief', () => {
    const lowSite: OverworldTerrainSampler = () => ({ biome: 'PLAINS', seaLevel: 63, surfaceY: 20 })
    const highSite: OverworldTerrainSampler = () => ({ biome: 'PLAINS', seaLevel: 63, surfaceY: CHUNK_HEIGHT + 20 })
    const excessiveRelief: OverworldTerrainSampler = (x, z) => ({
      biome: 'PLAINS',
      seaLevel: 63,
      surfaceY: x === 0 && z === 0 ? 70 : 77,
    })
    const maximumRelief: OverworldTerrainSampler = (x, z) => ({
      biome: 'PLAINS',
      seaLevel: 63,
      surfaceY: x === 0 && z === 0 ? 70 : 76,
    })

    expect(Option.isNone(planMineshaftForCandidate({ x: 0, z: 0 }, lowSite))).toBe(true)
    expect(Option.isNone(planMineshaftForCandidate({ x: 0, z: 0 }, highSite))).toBe(true)
    expect(Option.isNone(planMineshaftForCandidate({ x: 0, z: 0 }, excessiveRelief))).toBe(true)
    expect(Option.isSome(planMineshaftForCandidate({ x: 0, z: 0 }, maximumRelief))).toBe(true)
  })

  it('routes through the shared planner and owns only the target chunk slice', () => {
    const seed = 0x1234
    const located = findMineshaft(seed)
    const unsuitableTerrain: OverworldTerrainSampler = () => ({ biome: 'PLAINS', seaLevel: 63, surfaceY: 20 })
    const repeated = planMineshaftForRegion(seed, located.regionX, located.regionZ, FLAT_PLAINS)
    const [absentX, absentZ] = findAbsentRegion(seed)
    const originChunk = chunkCoord(
      Math.floor(located.plan.origin.x / CHUNK_SIZE_XZ),
      Math.floor(located.plan.origin.z / CHUNK_SIZE_XZ),
    )
    const plans = naturalStructurePlansForChunk(seed, 'overworld', originChunk, { overworld: FLAT_PLAINS })
    const routed = plans.find((plan) => plan.id === located.plan.id)

    expect(Option.isSome(repeated)).toBe(true)
    expect(Option.isNone(planMineshaftForRegion(seed, located.regionX, located.regionZ, unsuitableTerrain))).toBe(true)
    expect(Option.isNone(planMineshaftForRegion(seed, absentX, absentZ, FLAT_PLAINS))).toBe(true)
    expect(NATURAL_STRUCTURE_GRID.mineshaft).toStrictEqual({ separation: 96, spacing: 256, spawnPermille: 150 })
    expect(located.plan.kind).toBe('mineshaft')
    expect(located.plan.dimension).toBe('overworld')
    expect(located.plan.bounds.minY).toBe(located.plan.origin.y)
    expect(located.plan.bounds.maxY).toBe(located.plan.origin.y + MINESHAFT_LAYOUT.frameHeight - 1)
    if (routed === undefined) throw new Error('expected mineshaft in Overworld chunk plans')

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
