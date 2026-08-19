/* oxlint-disable curly, id-length, init-declarations, max-lines-per-function, max-statements, no-magic-numbers, no-ternary, no-undefined, sort-imports */

import { describe, expect, it } from '@effect/vitest'
import { BLOCK_IDS, chunkCoord } from '@nerima-games/mc-kernel'
import { Option } from 'effect'
import { CHUNK_HEIGHT, CHUNK_SIZE_XZ } from '../src/domain/constants'
import { OCEAN_RUIN_BLOCK, OCEAN_RUIN_LAYOUT } from '../src/domain/ocean-ruin-data'
import { type OceanRuinDraft, planOceanRuinForCandidate } from '../src/domain/ocean-ruin'
import {
  NATURAL_STRUCTURE_GRID,
  type NaturalStructurePlan,
  naturalStructurePlansForChunk,
  naturalStructureSliceForChunk,
  planOceanRuinForRegion,
} from '../src/domain/natural-structure'
import type { OverworldTerrainSampler } from '../src/domain/structure-siting'

const FLAT_OCEAN: OverworldTerrainSampler = () => ({ biome: 'OCEAN', seaLevel: 63, surfaceY: 55 })

type LocatedOceanRuin = {
  readonly plan: NaturalStructurePlan
  readonly regionX: number
  readonly regionZ: number
}

const unwrapDraft = (option: Option.Option<OceanRuinDraft>): OceanRuinDraft => {
  if (Option.isNone(option)) throw new Error('expected an ocean-ruin draft')
  return option.value
}

const findOceanRuin = (seed: number): LocatedOceanRuin => {
  for (let regionX = -20; regionX <= 20; regionX += 1) {
    for (let regionZ = -20; regionZ <= 20; regionZ += 1) {
      const plan = planOceanRuinForRegion(seed, regionX, regionZ, FLAT_OCEAN)
      if (Option.isSome(plan)) return { plan: plan.value, regionX, regionZ }
    }
  }
  throw new Error('ocean-ruin search range exhausted')
}

const findAbsentRegion = (seed: number): readonly [number, number] => {
  for (let regionX = -20; regionX <= 20; regionX += 1) {
    for (let regionZ = -20; regionZ <= 20; regionZ += 1) {
      if (Option.isNone(planOceanRuinForRegion(seed, regionX, regionZ, FLAT_OCEAN))) return [regionX, regionZ]
    }
  }
  throw new Error('ocean-ruin absent-region search range exhausted')
}

describe('ocean-ruin plans', () => {
  it('are deterministic, immutable, registry-backed, and semantically marked', () => {
    const first = unwrapDraft(planOceanRuinForCandidate({ x: 0, z: 0 }, FLAT_OCEAN))
    const repeated = unwrapDraft(planOceanRuinForCandidate({ x: 0, z: 0 }, FLAT_OCEAN))
    const registeredBlocks = new Set<number>(BLOCK_IDS)
    const placedBlocks = new Set(first.blocks.map((placement) => placement.block))

    expect(repeated).toStrictEqual(first)
    expect(first.origin).toStrictEqual({ x: 0, y: 56, z: 0 })
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
    for (const block of Object.values(OCEAN_RUIN_BLOCK)) expect(placedBlocks.has(block)).toBe(true)
    expect(first.markers).toContainEqual(expect.objectContaining({ kind: 'loot-chest', lootTable: 'ocean-ruin' }))
    expect(first.blocks).toContainEqual(expect.objectContaining({ block: OCEAN_RUIN_BLOCK.CHEST, x: 0, y: 57, z: -2 }))
  })

  it('rejects unsuitable ocean sites and accepts the maximum supported relief', () => {
    const plains: OverworldTerrainSampler = () => ({ biome: 'PLAINS', seaLevel: 63, surfaceY: 55 })
    const shallow: OverworldTerrainSampler = () => ({ biome: 'OCEAN', seaLevel: 55, surfaceY: 54 })
    const excessiveRelief: OverworldTerrainSampler = (x, z) => ({
      biome: 'OCEAN',
      seaLevel: 63,
      surfaceY: x === 0 && z === 0 ? 55 : 58,
    })
    const lowSite: OverworldTerrainSampler = () => ({ biome: 'OCEAN', seaLevel: 0, surfaceY: -2 })
    const highSite: OverworldTerrainSampler = () => ({ biome: 'OCEAN', seaLevel: CHUNK_HEIGHT + 10, surfaceY: CHUNK_HEIGHT - 2 })
    const maximumRelief: OverworldTerrainSampler = (x, z) => ({
      biome: 'OCEAN',
      seaLevel: 63,
      surfaceY: x === 0 && z === 0 ? 55 : 57,
    })

    expect(Option.isNone(planOceanRuinForCandidate({ x: 0, z: 0 }, plains))).toBe(true)
    expect(Option.isNone(planOceanRuinForCandidate({ x: 0, z: 0 }, shallow))).toBe(true)
    expect(Option.isNone(planOceanRuinForCandidate({ x: 0, z: 0 }, excessiveRelief))).toBe(true)
    expect(Option.isNone(planOceanRuinForCandidate({ x: 0, z: 0 }, lowSite))).toBe(true)
    expect(Option.isNone(planOceanRuinForCandidate({ x: 0, z: 0 }, highSite))).toBe(true)
    expect(Option.isSome(planOceanRuinForCandidate({ x: 0, z: 0 }, maximumRelief))).toBe(true)
  })

  it('routes through the shared planner and owns only the target chunk slice', () => {
    const seed = 0x1234
    const located = findOceanRuin(seed)
    const repeated = planOceanRuinForRegion(seed, located.regionX, located.regionZ, FLAT_OCEAN)
    const [absentX, absentZ] = findAbsentRegion(seed)
    const originChunk = chunkCoord(
      Math.floor(located.plan.origin.x / CHUNK_SIZE_XZ),
      Math.floor(located.plan.origin.z / CHUNK_SIZE_XZ),
    )
    const plans = naturalStructurePlansForChunk(seed, 'overworld', originChunk, { overworld: FLAT_OCEAN })
    const routed = plans.find((plan) => plan.id === located.plan.id)

    expect(Option.isSome(repeated)).toBe(true)
    expect(Option.isNone(planOceanRuinForRegion(seed, absentX, absentZ, FLAT_OCEAN))).toBe(true)
    expect(NATURAL_STRUCTURE_GRID['ocean-ruin']).toStrictEqual({ separation: 64, spacing: 192, spawnPermille: 180 })
    expect(located.plan.kind).toBe('ocean-ruin')
    expect(located.plan.dimension).toBe('overworld')
    expect(located.plan.bounds.minY).toBe(located.plan.origin.y)
    expect(located.plan.bounds.maxY).toBe(located.plan.origin.y + OCEAN_RUIN_LAYOUT.wallHeight - 1)
    if (routed === undefined) throw new Error('expected ocean ruin in Overworld chunk plans')

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
