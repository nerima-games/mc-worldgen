/* oxlint-disable id-length, max-statements, no-magic-numbers, no-undefined, sort-imports */

import { describe, expect, it } from '@effect/vitest'
import { Option, Result } from 'effect'
import { CHUNK_HEIGHT, CHUNK_VOLUME, blockIndex } from '../src/domain/constants'
import { END_FEATURE_BLOCK, endFeaturePlanForSeed } from '../src/domain/end-features'
import {
  END_BASE_Y,
  END_OUTER_ISLAND_START,
  END_STONE_BLOCK_ID,
  endSurfaceHeightAt,
  generateEndChunk,
  generateEndChunkAt,
  generateEndTerrainChunk,
} from './helpers/unwrapped-worldgen'
import { planEndCityForRegion } from './helpers/unwrapped-worldgen'
import { chunkCoord } from '@nerima-games/mc-kernel'
import { blockAxis, chunkAxis, noiseSeed } from './fixtures/validated-inputs'
import { generateEndChunk as generateEndChunkRaw } from '../src/domain/end-terrain'

describe('End terrain', () => {
  it('builds a solid central island and labels every column as END', () => {
    const chunk = generateEndChunkAt(noiseSeed(42), chunkAxis(0), chunkAxis(0))
    const surface = endSurfaceHeightAt(noiseSeed(42), blockAxis(0), blockAxis(0))

    expect(chunk.blocks).toHaveLength(CHUNK_VOLUME)
    expect(surface).toBeGreaterThanOrEqual(END_BASE_Y)
    expect(chunk.blocks[blockIndex(0, surface ?? 0, 0)]).toBe(END_STONE_BLOCK_ID)
    expect(new Set(chunk.biomes)).toStrictEqual(new Set(['END']))
  })

  it('leaves the ring between the central and outer islands as void', () => {
    expect(endSurfaceHeightAt(noiseSeed(42), blockAxis(200), blockAxis(0))).toBeUndefined()
    expect(generateEndChunkAt(noiseSeed(42), chunkAxis(12), chunkAxis(0)).blocks.every((block) => block === 0)).toBe(true)
  })

  it('creates seed-dependent outer islands beyond the void ring', () => {
    const columns = Array.from({ length: 512 }, (_, index) => END_OUTER_ISLAND_START + index)
    const first = columns.map((x) => endSurfaceHeightAt(noiseSeed(1), blockAxis(x), blockAxis(0)))
    const second = columns.map((x) => endSurfaceHeightAt(noiseSeed(2), blockAxis(x), blockAxis(0)))

    expect(first.some((height) => height !== undefined)).toBe(true)
    expect(first).not.toStrictEqual(second)
  })

  it('is deterministic and writes only air or end stone within chunk bounds', () => {
    const first = generateEndTerrainChunk(noiseSeed(20260801), chunkCoord(chunkAxis(40), chunkAxis(-18)))
    const second = generateEndTerrainChunk(noiseSeed(20260801), chunkCoord(chunkAxis(40), chunkAxis(-18)))

    expect(first).toStrictEqual(second)
    expect(first.blocks.every((block) => block === 0 || block === END_STONE_BLOCK_ID)).toBe(true)
    expect(first.blocks).toHaveLength(16 * 16 * CHUNK_HEIGHT)
  })

  it('projects the generated spike plan into the owning chunk', () => {
    const seed = 42
    const plan = endFeaturePlanForSeed(noiseSeed(seed))
    const spike = plan.spikes[0]
    if (!spike) throw new Error('expected the generated End plan to contain spikes')
    const cx = Math.floor(spike.centerX / 16)
    const cz = Math.floor(spike.centerZ / 16)
    const chunk = generateEndChunk(noiseSeed(seed), chunkCoord(chunkAxis(cx), chunkAxis(cz)))
    const localX = spike.centerX - cx * 16
    const localZ = spike.centerZ - cz * 16

    expect(chunk.endFeatureIds).toStrictEqual([plan.id])
    expect(chunk.blocks[blockIndex(localX, 0, localZ)]).toBe(END_FEATURE_BLOCK.OBSIDIAN)
    expect(chunk.endFeatureMarkers.some((marker) => marker.kind === 'end-crystal' && marker.featureId === plan.id)).toBe(
      true,
    )
  })

  it('propagates invalid chunk coordinates and structure footprints as typed failures', () => {
    const seed = noiseSeed(0)
    const invalidChunk = chunkCoord(chunkAxis(Number.MAX_SAFE_INTEGER), chunkAxis(0))
    const coordinateFailure = generateEndChunkRaw(seed, invalidChunk)

    expect(Result.isFailure(coordinateFailure)).toBe(true)
    if (Result.isSuccess(coordinateFailure)) throw new Error('expected an invalid chunk coordinate failure')
    expect(coordinateFailure.failure).toMatchObject({
      _tag: 'InvalidNaturalStructureCoordinate',
      axis: 'footprint-x',
      kind: 'end-city',
    })

    const edgeChunkX = Math.floor((Number.MAX_SAFE_INTEGER - 15) / 16)
    const edgeChunk = chunkCoord(chunkAxis(edgeChunkX), chunkAxis(edgeChunkX))
    const footprintFailure = generateEndChunkRaw(seed, edgeChunk)

    expect(Result.isFailure(footprintFailure)).toBe(true)
    if (Result.isSuccess(footprintFailure)) throw new Error('expected an invalid End structure footprint failure')
    expect(footprintFailure.failure).toMatchObject({
      _tag: 'InvalidNaturalStructureCoordinate',
      axis: 'footprint-x',
      kind: 'end-city',
    })
  })

  it('applies every city and ship slice with marker provenance across chunk boundaries', () => {
    const seed = 1
    const planOption = planEndCityForRegion(noiseSeed(seed), -12, -7, (x, z) => endSurfaceHeightAt(noiseSeed(seed), x, z))
    if (Option.isNone(planOption)) throw new Error('expected the known End city candidate to fit real terrain')
    const plan = planOption.value
    const minChunkX = Math.floor(plan.bounds.minX / 16)
    const maxChunkX = Math.floor(plan.bounds.maxX / 16)
    const minChunkZ = Math.floor(plan.bounds.minZ / 16)
    const maxChunkZ = Math.floor(plan.bounds.maxZ / 16)
    const chunks = new Map<string, ReturnType<typeof generateEndChunk>>()

    for (let cx = minChunkX; cx <= maxChunkX; cx += 1) {
      for (let cz = minChunkZ; cz <= maxChunkZ; cz += 1) {
        chunks.set(`${String(cx)},${String(cz)}`, generateEndChunk(noiseSeed(seed), chunkCoord(chunkAxis(cx), chunkAxis(cz))))
      }
    }

    for (const placement of plan.blocks) {
      const cx = Math.floor(placement.x / 16)
      const cz = Math.floor(placement.z / 16)
      const chunk = chunks.get(`${String(cx)},${String(cz)}`)
      expect(chunk?.blocks[blockIndex(placement.x - cx * 16, placement.y, placement.z - cz * 16)]).toBe(placement.block)
    }
    const generated = [...chunks.values()]
    const markers = generated.flatMap((chunk) => chunk.naturalStructureMarkers)
    expect(new Set(generated.flatMap((chunk) => chunk.naturalStructureIds))).toContain(plan.id)
    expect(markers.some((marker) => marker.structureId === plan.id && marker.kind === 'end-ship')).toBe(true)
    expect(markers.some((marker) => marker.structureId === plan.id && marker.kind === 'loot-chest')).toBe(true)
    expect(markers.some((marker) => marker.structureId === plan.id && marker.kind === 'spawner')).toBe(true)
  })
})
