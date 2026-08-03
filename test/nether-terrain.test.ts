/* oxlint-disable id-length, max-lines-per-function, max-statements, no-magic-numbers, no-undefined, sort-imports */

import { describe, expect, it } from '@effect/vitest'
import { Option } from 'effect'
import { blockIndex, CHUNK_HEIGHT, CHUNK_SIZE_XZ, CHUNK_VOLUME } from '../src/domain/constants'
import { chunkCoord } from '../src/domain/kernel-vocabulary'
import {
  generateNetherChunk,
  generateNetherTerrainChunk,
  NETHER_BLOCK,
  NETHER_LAVA_LEVEL,
  netherBlockAt,
  netherStructureTerrainAt,
} from '../src/domain/nether-terrain'
import { planRuinedNetherPortalForRegion } from '../src/domain/natural-structure'

describe('Nether terrain', () => {
  it('is deterministic, seed-dependent, bounded, and labels every column as NETHER', () => {
    const coord = chunkCoord(-3, 4)
    const first = generateNetherTerrainChunk(314_159, coord)
    const repeated = generateNetherTerrainChunk(314_159, coord)
    const changedSeed = generateNetherTerrainChunk(271_828, coord)

    expect(first).toStrictEqual(repeated)
    expect(first.blocks).toHaveLength(CHUNK_VOLUME)
    expect(first.blocks).not.toStrictEqual(changedSeed.blocks)
    expect(new Set(first.biomes)).toStrictEqual(new Set(['NETHER']))
    const allowedBlocks = new Set<number>(Object.values(NETHER_BLOCK))
    expect(first.blocks.every((block) => allowedBlocks.has(block))).toBe(true)
  })

  it('shares one absolute-coordinate query across negative chunk boundaries', () => {
    for (const coord of [chunkCoord(-1, -1), chunkCoord(0, 0)]) {
      const chunk = generateNetherTerrainChunk(77, coord)
      for (const [lx, y, lz] of [[0, 0, 0], [15, 31, 15], [0, 64, 15], [15, 255, 0]] as const) {
        const x = coord.cx * CHUNK_SIZE_XZ + lx
        const z = coord.cz * CHUNK_SIZE_XZ + lz
        expect(chunk.blocks[blockIndex(lx, y, lz)]).toBe(netherBlockAt(77, x, y, z))
      }
    }
  })

  it('seals the roof and floor with bedrock and creates caves, lava, and soul sand', () => {
    const blocks = [
      ...generateNetherTerrainChunk(1, chunkCoord(0, 0)).blocks,
      ...generateNetherTerrainChunk(1, chunkCoord(-8, -4)).blocks,
    ]
    for (let lx = 0; lx < CHUNK_SIZE_XZ; lx += 1) {
      for (let lz = 0; lz < CHUNK_SIZE_XZ; lz += 1) {
        expect(netherBlockAt(1, lx, 0, lz)).toBe(NETHER_BLOCK.BEDROCK)
        expect(netherBlockAt(1, lx, CHUNK_HEIGHT - 1, lz)).toBe(NETHER_BLOCK.BEDROCK)
      }
    }
    expect(blocks).toContain(NETHER_BLOCK.NETHERRACK)
    expect(blocks).toContain(NETHER_BLOCK.AIR)
    expect(blocks).toContain(NETHER_BLOCK.LAVA)
    expect(blocks).toContain(NETHER_BLOCK.SOUL_SAND)
  })

  it('reports an actual solid floor with seven blocks of air headroom', () => {
    for (const [x, z] of [[0, 0], [-2_241, 668], [81, -49]] as const) {
      const sample = netherStructureTerrainAt(1, x, z)
      if (sample === undefined) {
      throw new Error('expected a valid Nether structure surface')
    }
      expect(sample.surfaceY).toBeGreaterThan(NETHER_LAVA_LEVEL)
      expect(netherBlockAt(1, x, sample.surfaceY, z)).not.toBe(NETHER_BLOCK.AIR)
      for (let y = sample.surfaceY + 1; y <= sample.surfaceY + 7; y += 1) {
        expect(netherBlockAt(1, x, y, z)).toBe(NETHER_BLOCK.AIR)
      }
      if (sample.ceilingY < CHUNK_HEIGHT) {
        expect(netherBlockAt(1, x, sample.ceilingY, z)).not.toBe(NETHER_BLOCK.AIR)
      }
    }
  })

  it('returns no sample when the column has no valid structure floor', () => {
    expect(netherStructureTerrainAt(0, -256, 0)).toBeUndefined()
  })

  it('applies a real ruined portal across all touched chunks and preserves markers', () => {
    const seed = 1
    const planOption = planRuinedNetherPortalForRegion(
      seed,
      -12,
      3,
      (x, z) => netherStructureTerrainAt(seed, x, z),
    )
    if (Option.isNone(planOption)) throw new Error('expected the known portal candidate to fit real terrain')
    const plan = planOption.value
    const minChunkX = Math.floor(plan.bounds.minX / CHUNK_SIZE_XZ)
    const maxChunkX = Math.floor(plan.bounds.maxX / CHUNK_SIZE_XZ)
    const minChunkZ = Math.floor(plan.bounds.minZ / CHUNK_SIZE_XZ)
    const maxChunkZ = Math.floor(plan.bounds.maxZ / CHUNK_SIZE_XZ)
    const chunks = new Map<string, ReturnType<typeof generateNetherChunk>>()
    for (let cx = minChunkX; cx <= maxChunkX; cx += 1) {
      for (let cz = minChunkZ; cz <= maxChunkZ; cz += 1) {
        chunks.set(`${String(cx)},${String(cz)}`, generateNetherChunk(seed, chunkCoord(cx, cz)))
      }
    }

    for (const placement of plan.blocks) {
      const cx = Math.floor(placement.x / CHUNK_SIZE_XZ)
      const cz = Math.floor(placement.z / CHUNK_SIZE_XZ)
      const chunk = chunks.get(`${String(cx)},${String(cz)}`)
      expect(chunk?.blocks[blockIndex(
        placement.x - cx * CHUNK_SIZE_XZ,
        placement.y,
        placement.z - cz * CHUNK_SIZE_XZ,
      )]).toBe(placement.block)
    }
    const generated = [...chunks.values()]
    expect(generated.filter((chunk) => chunk.naturalStructureIds.includes(plan.id)).length).toBeGreaterThan(1)
    expect(generated.flatMap((chunk) => chunk.naturalStructureMarkers).some((marker) =>
      marker.structureId === plan.id && marker.kind === 'portal-frame',
    )).toBe(true)
  })
})
