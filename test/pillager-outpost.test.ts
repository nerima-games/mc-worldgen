/* oxlint-disable curly, id-length, init-declarations, max-lines-per-function, max-statements, no-magic-numbers, no-ternary, no-undefined, sort-imports */

import { describe, expect, it } from '@effect/vitest'
import { BLOCK_IDS, chunkCoord } from '@nerima-games/mc-kernel'
import { Option } from 'effect'
import { CHUNK_HEIGHT, CHUNK_SIZE_XZ } from '../src/domain/constants'
import { PILLAGER_OUTPOST_BLOCK, PILLAGER_OUTPOST_LAYOUT } from '../src/domain/pillager-outpost-data'
import { type PillagerOutpostDraft, planPillagerOutpostForCandidate } from '../src/domain/pillager-outpost'
import {
  NATURAL_STRUCTURE_GRID,
  type NaturalStructurePlan,
  naturalStructurePlansForChunk,
  naturalStructureSliceForChunk,
  planPillagerOutpostForRegion,
} from '../src/domain/natural-structure'
import type { OverworldTerrainSampler } from '../src/domain/structure-siting'

const FLAT_PLAINS: OverworldTerrainSampler = () => ({ biome: 'PLAINS', seaLevel: 63, surfaceY: 70 })

type LocatedPillagerOutpost = {
  readonly plan: NaturalStructurePlan
  readonly regionX: number
  readonly regionZ: number
}

const unwrapDraft = (option: Option.Option<PillagerOutpostDraft>): PillagerOutpostDraft => {
  if (Option.isNone(option)) throw new Error('expected a pillager outpost draft')
  return option.value
}

const findPillagerOutpost = (seed: number): LocatedPillagerOutpost => {
  for (let regionX = -20; regionX <= 20; regionX += 1) {
    for (let regionZ = -20; regionZ <= 20; regionZ += 1) {
      const plan = planPillagerOutpostForRegion(seed, regionX, regionZ, FLAT_PLAINS)
      if (Option.isSome(plan)) return { plan: plan.value, regionX, regionZ }
    }
  }
  throw new Error('pillager outpost search range exhausted')
}

const findAbsentRegion = (seed: number): readonly [number, number] => {
  for (let regionX = -20; regionX <= 20; regionX += 1) {
    for (let regionZ = -20; regionZ <= 20; regionZ += 1) {
      if (Option.isNone(planPillagerOutpostForRegion(seed, regionX, regionZ, FLAT_PLAINS))) return [regionX, regionZ]
    }
  }
  throw new Error('pillager outpost absent-region search range exhausted')
}

describe('pillager outpost plans', () => {
  it('are deterministic, immutable, registry-backed, and semantically marked', () => {
    const first = unwrapDraft(planPillagerOutpostForCandidate({ x: 0, z: 0 }, FLAT_PLAINS))
    const repeated = unwrapDraft(planPillagerOutpostForCandidate({ x: 0, z: 0 }, FLAT_PLAINS))
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
    for (const block of Object.values(PILLAGER_OUTPOST_BLOCK)) expect(placedBlocks.has(block)).toBe(true)
    expect(first.markers).toContainEqual(expect.objectContaining({ kind: 'loot-chest', lootTable: 'pillager-outpost' }))
    expect(first.markers).toContainEqual(expect.objectContaining({ kind: 'entity-spawn', entity: 'pillager' }))
    expect(first.blocks).toContainEqual(expect.objectContaining({ block: PILLAGER_OUTPOST_BLOCK.CHEST, x: 0, y: 73, z: 1 }))
  })

  it('rejects unsuitable sites and accepts the maximum supported relief', () => {
    const invalidBiome: OverworldTerrainSampler = () => ({ biome: 'FOREST', seaLevel: 63, surfaceY: 70 })
    const wetSite: OverworldTerrainSampler = () => ({ biome: 'PLAINS', seaLevel: 63, surfaceY: 64 })
    const lowSite: OverworldTerrainSampler = () => ({ biome: 'PLAINS', seaLevel: -10, surfaceY: -2 })
    const highSite: OverworldTerrainSampler = () => ({ biome: 'PLAINS', seaLevel: -10, surfaceY: CHUNK_HEIGHT })
    const excessiveRelief: OverworldTerrainSampler = (x, z) => ({
      biome: 'PLAINS',
      seaLevel: 63,
      surfaceY: x === 0 && z === 0 ? 70 : 74,
    })
    const maximumRelief: OverworldTerrainSampler = (x, z) => ({
      biome: 'PLAINS',
      seaLevel: 63,
      surfaceY: x === 0 && z === 0 ? 70 : 73,
    })

    expect(Option.isNone(planPillagerOutpostForCandidate({ x: 0, z: 0 }, invalidBiome))).toBe(true)
    expect(Option.isNone(planPillagerOutpostForCandidate({ x: 0, z: 0 }, wetSite))).toBe(true)
    expect(Option.isNone(planPillagerOutpostForCandidate({ x: 0, z: 0 }, lowSite))).toBe(true)
    expect(Option.isNone(planPillagerOutpostForCandidate({ x: 0, z: 0 }, highSite))).toBe(true)
    expect(Option.isNone(planPillagerOutpostForCandidate({ x: 0, z: 0 }, excessiveRelief))).toBe(true)
    expect(Option.isSome(planPillagerOutpostForCandidate({ x: 0, z: 0 }, maximumRelief))).toBe(true)
  })

  it('routes through the shared planner and owns only the target chunk slice', () => {
    const seed = 0x1234
    const located = findPillagerOutpost(seed)
    const unsuitableTerrain: OverworldTerrainSampler = () => ({ biome: 'FOREST', seaLevel: 63, surfaceY: 70 })
    const repeated = planPillagerOutpostForRegion(seed, located.regionX, located.regionZ, FLAT_PLAINS)
    const [absentX, absentZ] = findAbsentRegion(seed)
    const originChunk = chunkCoord(
      Math.floor(located.plan.origin.x / CHUNK_SIZE_XZ),
      Math.floor(located.plan.origin.z / CHUNK_SIZE_XZ),
    )
    const plans = naturalStructurePlansForChunk(seed, 'overworld', originChunk, { overworld: FLAT_PLAINS })
    const routed = plans.find((plan) => plan.id === located.plan.id)

    expect(Option.isSome(repeated)).toBe(true)
    expect(Option.isNone(planPillagerOutpostForRegion(seed, located.regionX, located.regionZ, unsuitableTerrain))).toBe(true)
    expect(Option.isNone(planPillagerOutpostForRegion(seed, absentX, absentZ, FLAT_PLAINS))).toBe(true)
    expect(NATURAL_STRUCTURE_GRID['pillager-outpost']).toStrictEqual({ separation: 128, spacing: 320, spawnPermille: 120 })
    expect(located.plan.kind).toBe('pillager-outpost')
    expect(located.plan.dimension).toBe('overworld')
    expect(located.plan.bounds.minY).toBe(located.plan.origin.y)
    expect(located.plan.bounds.maxY).toBe(
      located.plan.origin.y + PILLAGER_OUTPOST_LAYOUT.towerBaseYOffset + PILLAGER_OUTPOST_LAYOUT.floorCount * PILLAGER_OUTPOST_LAYOUT.floorSpacing,
    )
    if (routed === undefined) throw new Error('expected pillager outpost in Overworld chunk plans')

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
