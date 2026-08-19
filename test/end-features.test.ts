/* oxlint-disable id-length, max-statements, no-magic-numbers, no-undefined, sort-imports */

import { describe, expect, it } from '@effect/vitest'
import { blockIndex, CHUNK_HEIGHT } from '../src/domain/constants'
import {
  applyEndFeaturePlansToChunk,
  END_FEATURE_BLOCK,
  endFeaturePlanForSeed,
  type EndFeaturePlan,
  type EndSpike,
} from '../src/domain/end-features'
import { generateEndTerrainChunk } from '../src/domain/end-terrain'
import type { NaturalStructureChunk } from '../src/domain/natural-structure'
import { blockPosition, chunkCoord, type ChunkCoord } from '@nerima-games/mc-kernel'

const emptyNaturalChunk = (coord: ChunkCoord): NaturalStructureChunk => {
  const terrain = generateEndTerrainChunk(0, coord)
  return {
    ...terrain,
    naturalStructureIds: Object.freeze([]),
    naturalStructureMarkers: Object.freeze([]),
  }
}

const planFor = (id: string, spikes: ReadonlyArray<EndSpike>, crystalInvulnerable = true): EndFeaturePlan =>
  Object.freeze({
    id,
    dimension: 'end' as const,
    crystalInvulnerable,
    spikes: Object.freeze([...spikes]),
  })

describe('End features', () => {
  it('creates a deterministic, immutable set of ten spikes', () => {
    const first = endFeaturePlanForSeed(42)
    const second = endFeaturePlanForSeed(42)
    const sampled = Array.from({ length: 8 }, (_, seed) => endFeaturePlanForSeed(seed))
    const positions = new Set(first.spikes.map(({ centerX, centerZ }) => `${centerX},${centerZ}`))

    expect(first).toStrictEqual(second)
    expect(first.dimension).toBe('end')
    expect(first.spikes).toHaveLength(10)
    expect(positions.size).toBe(first.spikes.length)
    expect(first.spikes.every(({ height, radius }) => height >= 76 && height <= 78 && radius >= 2 && radius <= 4)).toBe(
      true,
    )
    expect(sampled.some((plan) => plan.spikes.some(({ guarded }) => guarded))).toBe(true)
    expect(sampled.some((plan) => plan.spikes.some(({ guarded }) => !guarded))).toBe(true)
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first.spikes)).toBe(true)
    expect(Object.isFrozen(first.spikes[0])).toBe(true)
  })

  it('writes pillars only where they intersect a chunk and emits one marker set per owner chunk', () => {
    const plan = planFor('spanning', [
      { centerX: 1, centerZ: 1, radius: 1, height: 2, guarded: true },
      { centerX: 16, centerZ: 0, radius: 1, height: 2, guarded: false },
      { centerX: 100, centerZ: 100, radius: 1, height: 1, guarded: false },
    ])
    const source = emptyNaturalChunk(chunkCoord(0, 0))
    const applied = applyEndFeaturePlansToChunk(source, [plan])
    const crystal = applied.endFeatureMarkers.find((marker) => marker.kind === 'end-crystal')
    const cage = applied.endFeatureMarkers.find((marker) => marker.kind === 'end-crystal-cage')

    expect(applied.endFeatureIds).toStrictEqual(['spanning'])
    expect(applied.blocks[blockIndex(1, 0, 1)]).toBe(END_FEATURE_BLOCK.OBSIDIAN)
    expect(applied.blocks[blockIndex(15, 0, 0)]).toBe(END_FEATURE_BLOCK.OBSIDIAN)
    expect(applied.blocks[blockIndex(0, 0, 0)]).not.toBe(END_FEATURE_BLOCK.OBSIDIAN)
    expect(applied.endFeatureMarkers).toHaveLength(2)
    expect(crystal).toStrictEqual({
      kind: 'end-crystal',
      featureId: 'spanning',
      at: blockPosition(1, 3, 1),
      block: END_FEATURE_BLOCK.CRYSTAL,
      invulnerable: true,
    })
    expect(cage).toStrictEqual({
      kind: 'end-crystal-cage',
      featureId: 'spanning',
      center: blockPosition(1, 3, 1),
      radius: 2,
      minY: 1,
      maxY: 5,
      material: 'iron_bars',
    })
    expect(Object.isFrozen(applied)).toBe(true)
    expect(Object.isFrozen(applied.endFeatureIds)).toBe(true)
    expect(Object.isFrozen(applied.endFeatureMarkers)).toBe(true)
    expect(Object.isFrozen(crystal)).toBe(true)
    expect(Object.isFrozen(cage)).toBe(true)

    const neighbor = applyEndFeaturePlansToChunk(emptyNaturalChunk(chunkCoord(1, 0)), [plan])
    expect(neighbor.endFeatureIds).toStrictEqual(['spanning'])
    expect(neighbor.endFeatureMarkers).toStrictEqual([{
      at: blockPosition(16, 3, 0),
      block: END_FEATURE_BLOCK.CRYSTAL,
      featureId: 'spanning',
      invulnerable: true,
      kind: 'end-crystal',
    }])
    expect(neighbor.blocks[blockIndex(0, 0, 0)]).toBe(END_FEATURE_BLOCK.OBSIDIAN)
  })

  it('clamps cage metadata at the world height and keeps distant chunks unchanged', () => {
    const plan = planFor('clamped', [
      { centerX: 1, centerZ: 1, radius: 0, height: CHUNK_HEIGHT + 2, guarded: true },
      { centerX: 2, centerZ: 2, radius: 0, height: 0, guarded: true },
    ])
    const source = emptyNaturalChunk(chunkCoord(0, 0))
    const applied = applyEndFeaturePlansToChunk(source, [plan])
    const cages = applied.endFeatureMarkers.filter((marker) => marker.kind === 'end-crystal-cage')
    const distant = emptyNaturalChunk(chunkCoord(20, 20))
    const untouched = applyEndFeaturePlansToChunk(distant, [plan])

    expect(applied.blocks[blockIndex(1, CHUNK_HEIGHT - 1, 1)]).toBe(END_FEATURE_BLOCK.OBSIDIAN)
    expect(cages.map(({ minY, maxY }) => [minY, maxY])).toStrictEqual([
      [CHUNK_HEIGHT + 1, CHUNK_HEIGHT - 1],
      [0, 3],
    ])
    expect(untouched.endFeatureIds).toStrictEqual([])
    expect(untouched.endFeatureMarkers).toStrictEqual([])
    expect(untouched.blocks).toStrictEqual(distant.blocks)
  })

  it('deduplicates plans by id and returns touched ids in stable order', () => {
    const firstB = planFor('b', [{ centerX: 2, centerZ: 2, radius: 0, height: 1, guarded: false }])
    const replacementB = planFor('b', [{ centerX: 3, centerZ: 3, radius: 0, height: 1, guarded: false }])
    const planA = planFor('a', [{ centerX: 1, centerZ: 1, radius: 0, height: 1, guarded: false }])
    const applied = applyEndFeaturePlansToChunk(emptyNaturalChunk(chunkCoord(0, 0)), [firstB, planA, replacementB])
    const crystals = applied.endFeatureMarkers.filter((marker) => marker.kind === 'end-crystal')

    expect(applied.endFeatureIds).toStrictEqual(['a', 'b'])
    expect(crystals.map(({ at }) => at)).toStrictEqual([blockPosition(1, 2, 1), blockPosition(3, 2, 3)])
  })
})
