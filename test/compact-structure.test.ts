/* oxlint-disable curly, id-length, init-declarations, max-lines-per-function, max-statements, no-magic-numbers, no-ternary, no-undefined, sort-imports */

import { describe, expect, it } from '@effect/vitest'
import { BLOCK_IDS, chunkCoord } from '@nerima-games/mc-kernel'
import { Option } from 'effect'
import {
  COMPACT_STRUCTURE_BLOCK,
  COMPACT_STRUCTURE_DESCRIPTORS,
  COMPACT_STRUCTURE_KINDS,
  type CompactStructureKind,
} from '../src/domain/compact-structure-data'
import { planCompactStructureForCandidate } from '../src/domain/compact-structure'
import { CHUNK_SIZE_XZ } from '../src/domain/constants'
import {
  naturalStructurePlansForChunk,
  naturalStructureSliceForChunk,
  planCompactStructureForRegion,
  type NaturalStructurePlan,
} from '../src/domain/natural-structure'
import type { OverworldTerrainSampler } from '../src/domain/structure-siting'

const flatSamplerFor = (kind: CompactStructureKind): OverworldTerrainSampler => {
  const [biome] = COMPACT_STRUCTURE_DESCRIPTORS[kind].allowedBiomes
  if (biome === undefined) throw new Error(`missing biome for ${kind}`)
  return () => ({ biome, seaLevel: 63, surfaceY: 70 })
}

const unwrapDraft = <T>(option: Option.Option<T>): T => {
  if (Option.isNone(option)) throw new Error('expected a compact structure draft')
  return option.value
}

const findPlan = (seed: number, kind: CompactStructureKind): NaturalStructurePlan => {
  const sampler = flatSamplerFor(kind)
  for (let regionX = -32; regionX <= 32; regionX += 1) {
    for (let regionZ = -32; regionZ <= 32; regionZ += 1) {
      const plan = planCompactStructureForRegion(seed, kind, regionX, regionZ, sampler)
      if (Option.isSome(plan)) return plan.value
    }
  }
  throw new Error(`compact structure search range exhausted for ${kind}`)
}

const findAbsentRegion = (seed: number, kind: CompactStructureKind): readonly [number, number] => {
  const sampler = flatSamplerFor(kind)
  for (let regionX = -8; regionX <= 8; regionX += 1) {
    for (let regionZ = -8; regionZ <= 8; regionZ += 1) {
      if (Option.isNone(planCompactStructureForRegion(seed, kind, regionX, regionZ, sampler))) return [regionX, regionZ]
    }
  }
  throw new Error(`compact structure absence search exhausted for ${kind}`)
}

const findCrossChunkPlan = (seed: number): NaturalStructurePlan => {
  for (const kind of COMPACT_STRUCTURE_KINDS) {
    const sampler = flatSamplerFor(kind)
    for (let regionX = -32; regionX <= 32; regionX += 1) {
      for (let regionZ = -32; regionZ <= 32; regionZ += 1) {
        const option = planCompactStructureForRegion(seed, kind, regionX, regionZ, sampler)
        if (Option.isNone(option)) continue
        const plan = option.value
        const spansX = Math.floor(plan.bounds.minX / CHUNK_SIZE_XZ) !== Math.floor(plan.bounds.maxX / CHUNK_SIZE_XZ)
        const spansZ = Math.floor(plan.bounds.minZ / CHUNK_SIZE_XZ) !== Math.floor(plan.bounds.maxZ / CHUNK_SIZE_XZ)
        if (spansX || spansZ) return plan
      }
    }
  }
  throw new Error('compact structure cross-chunk search range exhausted')
}

describe('compact structure plans', () => {
  it('uses registered blocks and produces immutable geometry and loot markers for every kind', () => {
    const registered = new Set<number>(BLOCK_IDS)
    for (const kind of COMPACT_STRUCTURE_KINDS) {
      const descriptor = COMPACT_STRUCTURE_DESCRIPTORS[kind]
      const baseY = 70 + descriptor.baseOffset
      const draft = unwrapDraft(planCompactStructureForCandidate(kind, { x: 0, z: 0 }, flatSamplerFor(kind)))

      expect(Object.isFrozen(draft)).toBe(true)
      expect(Object.isFrozen(draft.origin)).toBe(true)
      expect(Object.isFrozen(draft.blocks)).toBe(true)
      expect(Object.isFrozen(draft.markers)).toBe(true)
      expect(draft.blocks).toContainEqual({ block: descriptor.foundation, x: 0, y: baseY, z: 0 })
      expect(draft.blocks).toContainEqual({ block: descriptor.wall, x: -descriptor.radius, y: baseY + 1, z: 0 })
      expect(draft.blocks).toContainEqual({ block: descriptor.roof, x: 0, y: baseY + descriptor.height, z: 1 })
      expect(draft.blocks).toContainEqual({ block: COMPACT_STRUCTURE_BLOCK.CHEST, x: 0, y: baseY + 1, z: 0 })
      expect(draft.markers).toContainEqual(expect.objectContaining({ kind: 'loot-chest', lootTable: kind }))
      for (const block of draft.blocks) expect(registered.has(block.block)).toBe(true)
      for (const marker of draft.markers) expect(Object.isFrozen(marker)).toBe(true)
    }
  })

  it('rejects unsuitable biomes, shallow sites, and excessive relief', () => {
    const candidate = { x: 0, z: 0 }
    expect(Option.isNone(planCompactStructureForCandidate(
      'buried-treasure',
      candidate,
      () => ({ biome: 'DESERT', seaLevel: 63, surfaceY: 70 }),
    ))).toBe(true)
    expect(Option.isNone(planCompactStructureForCandidate(
      'ancient-city',
      candidate,
      () => ({ biome: 'PLAINS', seaLevel: 63, surfaceY: 64 }),
    ))).toBe(true)
    expect(Option.isNone(planCompactStructureForCandidate(
      'trail-ruins',
      candidate,
      (x) => ({ biome: 'FOREST', seaLevel: 63, surfaceY: x === 0 ? 70 : 80 }),
    ))).toBe(true)
  })

  it('keeps candidate absence distinct from terrain rejection', () => {
    const seed = 20260820
    for (const kind of COMPACT_STRUCTURE_KINDS) {
      const [regionX, regionZ] = findAbsentRegion(seed, kind)
      expect(Option.isNone(planCompactStructureForRegion(seed, kind, regionX, regionZ, flatSamplerFor(kind)))).toBe(true)
    }
  })

  it('enumerates every compact kind through the shared planner', () => {
    const plans = COMPACT_STRUCTURE_KINDS.map((kind) => findPlan(20260820, kind))
    expect(plans.map((plan) => plan.kind)).toStrictEqual([...COMPACT_STRUCTURE_KINDS])
    for (const plan of plans) {
      const coord = chunkCoord(Math.floor(plan.origin.x / CHUNK_SIZE_XZ), Math.floor(plan.origin.z / CHUNK_SIZE_XZ))
      const sharedPlans = naturalStructurePlansForChunk(20260820, 'overworld', coord, { overworld: flatSamplerFor(plan.kind as CompactStructureKind) })
      expect(sharedPlans).toContainEqual(plan)
      expect(plan.markers).toContainEqual(expect.objectContaining({ kind: 'loot-chest', lootTable: plan.kind }))
      expect(naturalStructureSliceForChunk(plan, coord.cx, coord.cz).blocks.length).toBeGreaterThan(0)
    }
  })

  it('splits a compact plan across chunk boundaries without changing its content', () => {
    const plan = findCrossChunkPlan(20260820)
    const minChunkX = Math.floor(plan.bounds.minX / CHUNK_SIZE_XZ)
    const maxChunkX = Math.floor(plan.bounds.maxX / CHUNK_SIZE_XZ)
    const minChunkZ = Math.floor(plan.bounds.minZ / CHUNK_SIZE_XZ)
    const maxChunkZ = Math.floor(plan.bounds.maxZ / CHUNK_SIZE_XZ)
    const slices = []
    for (let chunkX = minChunkX; chunkX <= maxChunkX; chunkX += 1) {
      for (let chunkZ = minChunkZ; chunkZ <= maxChunkZ; chunkZ += 1) slices.push(naturalStructureSliceForChunk(plan, chunkX, chunkZ))
    }
    const blocks = slices.flatMap((slice) => slice.blocks)
    const markers = slices.flatMap((slice) => slice.markers)

    expect(slices.filter((slice) => slice.blocks.length > 0).length).toBeGreaterThan(1)
    const blockKey = (block: (typeof plan.blocks)[number]): string => `${block.x},${block.y},${block.z}:${block.block}`
    expect(blocks.map(blockKey).sort()).toStrictEqual(plan.blocks.map(blockKey).sort())
    expect(markers.map((marker) => JSON.stringify(marker)).sort()).toStrictEqual(plan.markers.map((marker) => JSON.stringify(marker)).sort())
    for (const slice of slices) {
      expect(Object.isFrozen(slice)).toBe(true)
      expect(Object.isFrozen(slice.blocks)).toBe(true)
      expect(Object.isFrozen(slice.markers)).toBe(true)
      for (const block of slice.blocks) {
        expect(Math.floor(block.x / CHUNK_SIZE_XZ)).toBe(slice.chunkX)
        expect(Math.floor(block.z / CHUNK_SIZE_XZ)).toBe(slice.chunkZ)
      }
    }
  })
})
