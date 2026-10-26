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
} from './helpers/unwrapped-worldgen'
import type { OverworldTerrainSampler } from '../src/domain/structure-siting'
import { blockAxis, chunkAxis, noiseSeed } from './fixtures/validated-inputs'

const flatSamplerFor = (kind: CompactStructureKind): OverworldTerrainSampler => {
  const [biome] = COMPACT_STRUCTURE_DESCRIPTORS[kind].allowedBiomes
  if (biome === undefined) throw new Error(`missing biome for ${kind}`)
  return () => ({ biome, seaLevel: blockAxis(63), surfaceY: blockAxis(70) })
}

const unwrapDraft = <T>(option: Option.Option<T>): T => {
  if (Option.isNone(option)) throw new Error('expected a compact structure draft')
  return option.value
}

const findPlan = (seed: number, kind: CompactStructureKind): NaturalStructurePlan => {
  const sampler = flatSamplerFor(kind)
  for (let regionX = -32; regionX <= 32; regionX += 1) {
    for (let regionZ = -32; regionZ <= 32; regionZ += 1) {
      const plan = planCompactStructureForRegion(noiseSeed(seed), kind, regionX, regionZ, sampler)
      if (Option.isSome(plan)) return plan.value
    }
  }
  throw new Error(`compact structure search range exhausted for ${kind}`)
}

const findAbsentRegion = (seed: number, kind: CompactStructureKind): readonly [number, number] => {
  const sampler = flatSamplerFor(kind)
  for (let regionX = -8; regionX <= 8; regionX += 1) {
    for (let regionZ = -8; regionZ <= 8; regionZ += 1) {
      if (Option.isNone(planCompactStructureForRegion(noiseSeed(seed), kind, regionX, regionZ, sampler))) return [regionX, regionZ]
    }
  }
  throw new Error(`compact structure absence search exhausted for ${kind}`)
}

const findCrossChunkPlan = (seed: number, kind: CompactStructureKind): NaturalStructurePlan => {
  const sampler = flatSamplerFor(kind)
  for (let regionX = -32; regionX <= 32; regionX += 1) {
    for (let regionZ = -32; regionZ <= 32; regionZ += 1) {
      const option = planCompactStructureForRegion(noiseSeed(seed), kind, regionX, regionZ, sampler)
      if (Option.isNone(option)) continue
      const plan = option.value
      const spansX = Math.floor(plan.bounds.minX / CHUNK_SIZE_XZ) !== Math.floor(plan.bounds.maxX / CHUNK_SIZE_XZ)
      const spansZ = Math.floor(plan.bounds.minZ / CHUNK_SIZE_XZ) !== Math.floor(plan.bounds.maxZ / CHUNK_SIZE_XZ)
      if (spansX || spansZ) return plan
    }
  }
  throw new Error(`compact structure cross-chunk search range exhausted for ${kind}`)
}

describe('compact structure plans', () => {
  it('uses registered blocks and produces immutable geometry and loot markers for every kind', () => {
    const registered = new Set<number>(BLOCK_IDS)
    for (const kind of COMPACT_STRUCTURE_KINDS) {
      const descriptor = COMPACT_STRUCTURE_DESCRIPTORS[kind]
      const baseY = 70 + descriptor.baseOffset
      const candidate = kind === 'woodland-mansion-single-chunk' ? { x: -1, z: -17 } : { x: 0, z: 0 }
      const placement = kind === 'woodland-mansion-single-chunk' ? { x: -8, z: -24 } : candidate
      const draft = unwrapDraft(planCompactStructureForCandidate(kind, candidate, flatSamplerFor(kind)))

      expect(Object.isFrozen(draft)).toBe(true)
      expect(Object.isFrozen(draft.origin)).toBe(true)
      expect(Object.isFrozen(draft.blocks)).toBe(true)
      expect(Object.isFrozen(draft.markers)).toBe(true)
      expect(draft.blocks).toContainEqual({ block: descriptor.foundation, x: placement.x, y: baseY, z: placement.z })
      expect(draft.blocks).toContainEqual({ block: descriptor.wall, x: placement.x - descriptor.radius, y: baseY + 1, z: placement.z })
      expect(draft.blocks).toContainEqual({ block: descriptor.roof, x: placement.x, y: baseY + descriptor.height, z: placement.z + 1 })
      expect(draft.blocks).toContainEqual({ block: COMPACT_STRUCTURE_BLOCK.CHEST, x: placement.x, y: baseY + 1, z: placement.z })
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
      () => ({ biome: 'DESERT', seaLevel: blockAxis(63), surfaceY: blockAxis(70) }),
    ))).toBe(true)
    expect(Option.isNone(planCompactStructureForCandidate(
      'ancient-city',
      candidate,
      () => ({ biome: 'PLAINS', seaLevel: blockAxis(63), surfaceY: blockAxis(64) }),
    ))).toBe(true)
    expect(Option.isNone(planCompactStructureForCandidate(
      'trail-ruins',
      candidate,
      (x) => ({ biome: 'FOREST', seaLevel: blockAxis(63), surfaceY: blockAxis(x === 0 ? 70 : 80) }),
    ))).toBe(true)
  })

  it('keeps candidate absence distinct from terrain rejection', () => {
    const seed = 20260820
    for (const kind of COMPACT_STRUCTURE_KINDS) {
      const [regionX, regionZ] = findAbsentRegion(seed, kind)
      expect(Option.isNone(planCompactStructureForRegion(noiseSeed(seed), kind, regionX, regionZ, flatSamplerFor(kind)))).toBe(true)
    }
  })

  it('enumerates every compact kind through the shared planner', () => {
    const plans = COMPACT_STRUCTURE_KINDS.map((kind) => findPlan(20260820, kind))
    expect(plans.map((plan) => plan.kind)).toStrictEqual([...COMPACT_STRUCTURE_KINDS])
    for (const plan of plans) {
      const coord = chunkCoord(chunkAxis(Math.floor(plan.origin.x / CHUNK_SIZE_XZ)), chunkAxis(Math.floor(plan.origin.z / CHUNK_SIZE_XZ)))
      const sharedPlans = naturalStructurePlansForChunk(noiseSeed(20260820), 'overworld', coord, { overworld: flatSamplerFor(plan.kind as CompactStructureKind) })
      expect(sharedPlans).toContainEqual(plan)
      expect(plan.markers).toContainEqual(expect.objectContaining({ kind: 'loot-chest', lootTable: plan.kind }))
      expect(naturalStructureSliceForChunk(plan, coord.cx, coord.cz).blocks.length).toBeGreaterThan(0)
    }
  })

  it('splits a compact plan across chunk boundaries without changing its content', () => {
    const plan = findCrossChunkPlan(20260820, 'woodland-mansion')
    const minChunkX = Math.floor(plan.bounds.minX / CHUNK_SIZE_XZ)
    const maxChunkX = Math.floor(plan.bounds.maxX / CHUNK_SIZE_XZ)
    const minChunkZ = Math.floor(plan.bounds.minZ / CHUNK_SIZE_XZ)
    const maxChunkZ = Math.floor(plan.bounds.maxZ / CHUNK_SIZE_XZ)
    const slices = []
    for (let chunkX = minChunkX; chunkX <= maxChunkX; chunkX += 1) {
      for (let chunkZ = minChunkZ; chunkZ <= maxChunkZ; chunkZ += 1) slices.push(naturalStructureSliceForChunk(plan, chunkAxis(chunkX), chunkAxis(chunkZ)))
    }
    const blocks = slices.flatMap((slice) => slice.blocks)
    const markers = slices.flatMap((slice) => slice.markers)

    expect(plan.kind).toBe('woodland-mansion')
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

  it('keeps the single-chunk mansion variant within one chunk', () => {
    const plan = findPlan(20260820, 'woodland-mansion-single-chunk')
    const chunkX = Math.floor(plan.origin.x / CHUNK_SIZE_XZ)
    const chunkZ = Math.floor(plan.origin.z / CHUNK_SIZE_XZ)

    expect(plan.kind).toBe('woodland-mansion-single-chunk')
    expect(Math.floor(plan.bounds.minX / CHUNK_SIZE_XZ)).toBe(chunkX)
    expect(Math.floor(plan.bounds.maxX / CHUNK_SIZE_XZ)).toBe(chunkX)
    expect(Math.floor(plan.bounds.minZ / CHUNK_SIZE_XZ)).toBe(chunkZ)
    expect(Math.floor(plan.bounds.maxZ / CHUNK_SIZE_XZ)).toBe(chunkZ)
    for (const block of plan.blocks) {
      expect(Math.floor(block.x / CHUNK_SIZE_XZ)).toBe(chunkX)
      expect(Math.floor(block.z / CHUNK_SIZE_XZ)).toBe(chunkZ)
    }
    for (const marker of plan.markers) {
      expect(Math.floor(marker.x / CHUNK_SIZE_XZ)).toBe(chunkX)
      expect(Math.floor(marker.z / CHUNK_SIZE_XZ)).toBe(chunkZ)
    }

    const slice = naturalStructureSliceForChunk(plan, chunkAxis(chunkX), chunkAxis(chunkZ))
    expect(slice.blocks).toStrictEqual(plan.blocks)
    expect(slice.markers).toStrictEqual(plan.markers)
  })
})