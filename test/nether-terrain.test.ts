/* oxlint-disable id-length, max-lines-per-function, max-statements, no-magic-numbers, no-undefined, sort-imports */

import { describe, expect, it } from '@effect/vitest'
import { Option, Result } from 'effect'
import { blockIndex, CHUNK_HEIGHT, CHUNK_SIZE_XZ, CHUNK_VOLUME } from '../src/domain/constants'
import { chunkCoord } from '@nerima-games/mc-kernel'
import {
  generateNetherChunk,
  generateNetherChunkAt,
  generateNetherTerrainChunk,
  NETHER_BLOCK,
  NETHER_LAVA_LEVEL,
  netherBlockAt,
  netherStructureTerrainAt,
} from './helpers/unwrapped-worldgen'
import { planRuinedNetherPortalForRegion } from './helpers/unwrapped-worldgen'
import { blockAxis, chunkAxis, noiseSeed } from './fixtures/validated-inputs'
import { generateNetherChunk as generateNetherChunkRaw } from '../src/domain/nether-terrain'

describe('Nether terrain', () => {
  it('is deterministic, seed-dependent, bounded, and labels every column as NETHER', () => {
    const coord = chunkCoord(chunkAxis(-3), chunkAxis(4))
    const first = generateNetherTerrainChunk(noiseSeed(314_159), coord)
    const repeated = generateNetherTerrainChunk(noiseSeed(314_159), coord)
    const changedSeed = generateNetherTerrainChunk(noiseSeed(271_828), coord)

    expect(first).toStrictEqual(repeated)
    expect(first.blocks).toHaveLength(CHUNK_VOLUME)
    expect(first.blocks).not.toStrictEqual(changedSeed.blocks)
    expect(new Set(first.biomes)).toStrictEqual(new Set(['NETHER']))
    const allowedBlocks = new Set<number>(Object.values(NETHER_BLOCK))
    expect(first.blocks.every((block) => allowedBlocks.has(block))).toBe(true)
  })

  it('shares one absolute-coordinate query across negative chunk boundaries', () => {
    for (const coord of [chunkCoord(chunkAxis(-1), chunkAxis(-1)), chunkCoord(chunkAxis(0), chunkAxis(0))]) {
      const chunk = generateNetherTerrainChunk(noiseSeed(77), coord)
      for (const [lx, y, lz] of [[0, 0, 0], [15, 31, 15], [0, 64, 15], [15, 255, 0]] as const) {
        const x = coord.cx * CHUNK_SIZE_XZ + lx
        const z = coord.cz * CHUNK_SIZE_XZ + lz
        expect(chunk.blocks[blockIndex(lx, y, lz)]).toBe(netherBlockAt(noiseSeed(77), blockAxis(x), blockAxis(y), blockAxis(z)))
      }
    }
  })

  it('seals the roof and floor with bedrock and creates caves, lava, and soul sand', () => {
    const blocks = [
      ...generateNetherTerrainChunk(noiseSeed(1), chunkCoord(chunkAxis(0), chunkAxis(0))).blocks,
      ...generateNetherTerrainChunk(noiseSeed(1), chunkCoord(chunkAxis(-8), chunkAxis(-4))).blocks,
    ]
    for (let lx = 0; lx < CHUNK_SIZE_XZ; lx += 1) {
      for (let lz = 0; lz < CHUNK_SIZE_XZ; lz += 1) {
        expect(netherBlockAt(noiseSeed(1), blockAxis(lx), blockAxis(0), blockAxis(lz))).toBe(NETHER_BLOCK.BEDROCK)
        expect(netherBlockAt(noiseSeed(1), blockAxis(lx), blockAxis(CHUNK_HEIGHT - 1), blockAxis(lz))).toBe(NETHER_BLOCK.BEDROCK)
      }
    }
    expect(blocks).toContain(NETHER_BLOCK.NETHERRACK)
    expect(blocks).toContain(NETHER_BLOCK.AIR)
    expect(blocks).toContain(NETHER_BLOCK.LAVA)
    expect(blocks).toContain(NETHER_BLOCK.SOUL_SAND)
  })

  it('reports an actual solid floor with seven blocks of air headroom', () => {
    for (const [x, z] of [[0, 0], [-2_241, 668], [81, -49]] as const) {
      const sample = netherStructureTerrainAt(noiseSeed(1), blockAxis(x), blockAxis(z))
      if (sample === undefined) {
      throw new Error('expected a valid Nether structure surface')
    }
      expect(sample.surfaceY).toBeGreaterThan(NETHER_LAVA_LEVEL)
      expect(netherBlockAt(noiseSeed(1), blockAxis(x), sample.surfaceY, blockAxis(z))).not.toBe(NETHER_BLOCK.AIR)
      for (let y = sample.surfaceY + 1; y <= sample.surfaceY + 7; y += 1) {
        expect(netherBlockAt(noiseSeed(1), blockAxis(x), blockAxis(y), blockAxis(z))).toBe(NETHER_BLOCK.AIR)
      }
      if (sample.ceilingY < CHUNK_HEIGHT) {
        expect(netherBlockAt(noiseSeed(1), blockAxis(x), sample.ceilingY, blockAxis(z))).not.toBe(NETHER_BLOCK.AIR)
      }
    }
  })

  it('returns no sample when the column has no valid structure floor', () => {
    expect(netherStructureTerrainAt(noiseSeed(0), blockAxis(-256), blockAxis(0))).toBeUndefined()
  })

  it('answers air above and below the world column, the same guard `isWorldY` names elsewhere', () => {
    // `netherBlockAt` is exported and documented as the authoritative query, not
    // just an internal helper the generation loop happens to feed in-range `y`s
    // — nothing else in this repository ever calls it with `y < 0` or
    // `y >= CHUNK_HEIGHT`, but a caller (structure siting probing a neighbour,
    // or an external consumer) legitimately can.
    expect(netherBlockAt(noiseSeed(1), blockAxis(0), blockAxis(-1), blockAxis(0))).toBe(NETHER_BLOCK.AIR)
    expect(netherBlockAt(noiseSeed(1), blockAxis(0), blockAxis(CHUNK_HEIGHT), blockAxis(0))).toBe(NETHER_BLOCK.AIR)
  })

  it('generateNetherChunkAt is the raw-coordinate form of generateNetherChunk', () => {
    // Mirrors `generateEndChunkAt`'s and `generateChunkAt`'s own tests: this
    // convenience wrapper (`seed, cx, cz` instead of a `ChunkCoord`) is the
    // only thing that changes, and this is the one place that equivalence is
    // pinned rather than merely implied by the two having near-identical
    // bodies.
    const seed = 5150
    expect(generateNetherChunkAt(noiseSeed(seed), chunkAxis(-2), chunkAxis(7))).toStrictEqual(generateNetherChunk(noiseSeed(seed), chunkCoord(chunkAxis(-2), chunkAxis(7))))
  })

  it('propagates invalid chunk coordinates as typed Nether failures', () => {
    const coordinate = chunkCoord(chunkAxis(Number.MAX_SAFE_INTEGER), chunkAxis(0))
    const result = generateNetherChunkRaw(noiseSeed(0), coordinate)

    expect(Result.isFailure(result)).toBe(true)
    if (Result.isSuccess(result)) throw new Error('expected an invalid Nether chunk coordinate failure')
    expect(result.failure).toMatchObject({
      _tag: 'InvalidNaturalStructureCoordinate',
      axis: 'footprint-x',
      kind: 'bastion-remnant',
    })
  })

  it('applies a real ruined portal across all touched chunks and preserves markers', () => {
    const seed = 1
    const planOption = planRuinedNetherPortalForRegion(
      noiseSeed(seed),
      -12,
      3,
      (x, z) => netherStructureTerrainAt(noiseSeed(seed), x, z),
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
        chunks.set(`${String(cx)},${String(cz)}`, generateNetherChunk(noiseSeed(seed), chunkCoord(chunkAxis(cx), chunkAxis(cz))))
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
