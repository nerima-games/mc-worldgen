/* oxlint-disable id-length, max-statements, no-magic-numbers, no-undefined, sort-imports */

import { describe, expect, it } from '@effect/vitest'
import { Option } from 'effect'
import { CHUNK_HEIGHT, CHUNK_VOLUME, blockIndex } from '../src/domain/constants'
import {
  END_BASE_Y,
  END_OUTER_ISLAND_START,
  END_STONE_BLOCK_ID,
  endSurfaceHeightAt,
  generateEndChunk,
  generateEndChunkAt,
  generateEndTerrainChunk,
} from '../src/domain/end-terrain'
import { planEndCityForRegion } from '../src/domain/natural-structure'
import { chunkCoord } from '@nerima-games/mc-kernel'

describe('End terrain', () => {
  it('builds a solid central island and labels every column as END', () => {
    const chunk = generateEndChunkAt(42, 0, 0)
    const surface = endSurfaceHeightAt(42, 0, 0)

    expect(chunk.blocks).toHaveLength(CHUNK_VOLUME)
    expect(surface).toBeGreaterThanOrEqual(END_BASE_Y)
    expect(chunk.blocks[blockIndex(0, surface ?? 0, 0)]).toBe(END_STONE_BLOCK_ID)
    expect(new Set(chunk.biomes)).toStrictEqual(new Set(['END']))
  })

  it('leaves the ring between the central and outer islands as void', () => {
    expect(endSurfaceHeightAt(42, 200, 0)).toBeUndefined()
    expect(generateEndChunkAt(42, 12, 0).blocks.every((block) => block === 0)).toBe(true)
  })

  it('creates seed-dependent outer islands beyond the void ring', () => {
    const columns = Array.from({ length: 512 }, (_, index) => END_OUTER_ISLAND_START + index)
    const first = columns.map((x) => endSurfaceHeightAt(1, x, 0))
    const second = columns.map((x) => endSurfaceHeightAt(2, x, 0))

    expect(first.some((height) => height !== undefined)).toBe(true)
    expect(first).not.toStrictEqual(second)
  })

  it('is deterministic and writes only air or end stone within chunk bounds', () => {
    const first = generateEndTerrainChunk(20260801, chunkCoord(40, -18))
    const second = generateEndTerrainChunk(20260801, chunkCoord(40, -18))

    expect(first).toStrictEqual(second)
    expect(first.blocks.every((block) => block === 0 || block === END_STONE_BLOCK_ID)).toBe(true)
    expect(first.blocks).toHaveLength(16 * 16 * CHUNK_HEIGHT)
  })

  it('applies every city and ship slice with marker provenance across chunk boundaries', () => {
    const seed = 1
    const planOption = planEndCityForRegion(seed, -12, -7, (x, z) => endSurfaceHeightAt(seed, x, z))
    if (Option.isNone(planOption)) throw new Error('expected the known End city candidate to fit real terrain')
    const plan = planOption.value
    const minChunkX = Math.floor(plan.bounds.minX / 16)
    const maxChunkX = Math.floor(plan.bounds.maxX / 16)
    const minChunkZ = Math.floor(plan.bounds.minZ / 16)
    const maxChunkZ = Math.floor(plan.bounds.maxZ / 16)
    const chunks = new Map<string, ReturnType<typeof generateEndChunk>>()

    for (let cx = minChunkX; cx <= maxChunkX; cx += 1) {
      for (let cz = minChunkZ; cz <= maxChunkZ; cz += 1) {
        chunks.set(`${String(cx)},${String(cz)}`, generateEndChunk(seed, chunkCoord(cx, cz)))
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
