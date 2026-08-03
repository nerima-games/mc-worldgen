import { describe, expect, it } from '@effect/vitest'
import { Effect, Option } from 'effect'
import { BLOCK } from '../src/domain/biome'
import { readBlock } from '../src/domain/chunk'
import { blockIndex, CHUNK_SIZE_XZ } from '../src/domain/constants'
import { chunkCoord } from '../src/domain/kernel-vocabulary'
import { detectCompletedEndPortal, endPortalCenterForStronghold } from '../src/domain/end-portal'
import {
  STRONGHOLD_BLOCK,
  STRONGHOLD_CEILING_Y,
  STRONGHOLD_SHELL_HALF_EXTENT,
  generateStrongholdPlan,
  strongholdBlockAt,
} from '../src/domain/stronghold'
import {
  STRONGHOLD_FLOOR_Y,
  nearestStrongholdSite,
  locateStronghold,
  type StrongholdSite,
} from '../src/domain/structure-siting'
import { generateChunk } from '../src/domain/terrain'
import { GOLDEN_SEED } from '../scripts/golden-fixture'

const requiredSite = (): StrongholdSite => {
  const site = nearestStrongholdSite(GOLDEN_SEED, 0, 0)
  if (Option.isNone(site)) throw new Error('expected a stronghold site')
  return site.value
}

describe('stronghold room layout', () => {
  it.effect('builds a 13 by 13 shell from the reference constants', () =>
    Effect.sync(() => {
      const site = requiredSite()
      let floor = 0
      let ceiling = 0
      let middleWall = 0

      for (let dx = -6; dx <= 6; dx += 1) {
        for (let dz = -6; dz <= 6; dz += 1) {
          if (strongholdBlockAt(site, site.x + dx, STRONGHOLD_FLOOR_Y, site.z + dz) === STRONGHOLD_BLOCK.COBBLESTONE) floor += 1
          if (strongholdBlockAt(site, site.x + dx, STRONGHOLD_CEILING_Y, site.z + dz) === STRONGHOLD_BLOCK.COBBLESTONE) ceiling += 1
          if (strongholdBlockAt(site, site.x + dx, STRONGHOLD_FLOOR_Y + 2, site.z + dz) === STRONGHOLD_BLOCK.COBBLESTONE) middleWall += 1
        }
      }

      expect(STRONGHOLD_SHELL_HALF_EXTENT).toBe(6)
      expect(floor).toBe(169)
      expect(ceiling).toBe(169)
      expect(middleWall).toBe(48)
    }),
  )

  it.effect('places the twelve portal frames one block above the floor', () =>
    Effect.sync(() => {
      const site = requiredSite()
      const frames: Array<string> = []

      for (let dx = -5; dx <= 5; dx += 1) {
        for (let dz = -5; dz <= 5; dz += 1) {
          if (
            strongholdBlockAt(site, site.x + dx, STRONGHOLD_FLOOR_Y + 1, site.z + dz) ===
            STRONGHOLD_BLOCK.END_PORTAL_FRAME
          ) {
            frames.push(`${String(dx)},${String(dz)}`)
          }
        }
      }

      expect(frames).toHaveLength(12)
      expect(frames).toContain('0,-2')
      expect(frames).toContain('2,1')
      expect(strongholdBlockAt(site, site.x, STRONGHOLD_FLOOR_Y + 1, site.z)).toBe(BLOCK.AIR)
    }),
  )

  it.effect('does not affect positions outside the room', () =>
    Effect.sync(() => {
      const site = requiredSite()
      expect(strongholdBlockAt(site, site.x + 7, STRONGHOLD_FLOOR_Y, site.z)).toBeUndefined()
      expect(strongholdBlockAt(site, site.x, STRONGHOLD_FLOOR_Y - 1, site.z)).toBeUndefined()
      expect(strongholdBlockAt(site, site.x, STRONGHOLD_CEILING_Y + 1, site.z)).toBeUndefined()
    }),
  )
})

describe('stronghold chunk generation', () => {
  it.effect('writes every chunk slice of a cross-boundary room', () =>
    Effect.sync(() => {
      const site = requiredSite()
      const minChunkX = Math.floor((site.x - STRONGHOLD_SHELL_HALF_EXTENT) / CHUNK_SIZE_XZ)
      const maxChunkX = Math.floor((site.x + STRONGHOLD_SHELL_HALF_EXTENT) / CHUNK_SIZE_XZ)
      const minChunkZ = Math.floor((site.z - STRONGHOLD_SHELL_HALF_EXTENT) / CHUNK_SIZE_XZ)
      const maxChunkZ = Math.floor((site.z + STRONGHOLD_SHELL_HALF_EXTENT) / CHUNK_SIZE_XZ)
      const chunks = new Map<string, ReturnType<typeof generateChunk>>()
      const plan = generateStrongholdPlan(GOLDEN_SEED, site)
      expect(plan).toBeDefined()
      const plannedBlocks = new Map(
        plan?.mutations.map((mutation) => [
          `${String(mutation.x)},${String(mutation.y)},${String(mutation.z)}`,
          mutation.block,
        ]),
      )

      for (let cx = minChunkX; cx <= maxChunkX; cx += 1) {
        for (let cz = minChunkZ; cz <= maxChunkZ; cz += 1) {
          chunks.set(`${String(cx)},${String(cz)}`, generateChunk(GOLDEN_SEED, chunkCoord(cx, cz)))
        }
      }

      expect(chunks.size).toBeGreaterThan(1)
      for (let wx = site.x - 6; wx <= site.x + 6; wx += 1) {
        for (let wz = site.z - 6; wz <= site.z + 6; wz += 1) {
          const cx = Math.floor(wx / CHUNK_SIZE_XZ)
          const cz = Math.floor(wz / CHUNK_SIZE_XZ)
          const chunk = chunks.get(`${String(cx)},${String(cz)}`)
          expect(chunk).toBeDefined()
          if (chunk === undefined) continue
          const lx = wx - cx * CHUNK_SIZE_XZ
          const lz = wz - cz * CHUNK_SIZE_XZ
          for (let y = STRONGHOLD_FLOOR_Y; y <= STRONGHOLD_CEILING_Y; y += 1) {
            expect(readBlock(chunk.blocks, blockIndex(lx, y, lz))).toBe(
              plannedBlocks.get(`${String(wx)},${String(y)},${String(wz)}`),
            )
          }
        }
      }
    }),
  )

  it.effect('runs after carving and independently of decoration', () =>
    Effect.sync(() => {
      const site = requiredSite()
      const coord = chunkCoord(
        Math.floor(site.x / CHUNK_SIZE_XZ),
        Math.floor(site.z / CHUNK_SIZE_XZ),
      )
      const decorated = generateChunk(GOLDEN_SEED, coord)
      const bare = generateChunk(GOLDEN_SEED, coord, { decorate: false })
      const lx = site.x - coord.cx * CHUNK_SIZE_XZ
      const lz = site.z - coord.cz * CHUNK_SIZE_XZ

      expect(readBlock(decorated.blocks, blockIndex(lx, STRONGHOLD_FLOOR_Y, lz))).toBe(
        STRONGHOLD_BLOCK.COBBLESTONE,
      )
      expect(readBlock(decorated.blocks, blockIndex(lx, STRONGHOLD_FLOOR_Y + 1, lz))).toBe(BLOCK.AIR)
      expect(readBlock(bare.blocks, blockIndex(lx, STRONGHOLD_FLOOR_Y + 1, lz))).toBe(BLOCK.AIR)
    }),
  )
})

describe('stronghold plan', () => {
  it.effect('is deterministic, unique, complete, and overworld-only', () => Effect.sync(() => {
    const site = requiredSite()
    const first = generateStrongholdPlan(GOLDEN_SEED, site)
    const second = generateStrongholdPlan(GOLDEN_SEED, site)
    expect(first).toEqual(second)
    expect(first?.pieces.map((piece) => piece.kind)).toEqual(['portal-room', 'corridor', 'stair', 'library'])
    expect(first?.frames).toHaveLength(12)
    expect(new Set(first?.mutations.map((mutation) => `${mutation.x},${mutation.y},${mutation.z}`)).size).toBe(first?.mutations.length)
    expect(first?.frames.every((frame) => frame.eye === (frame.block === STRONGHOLD_BLOCK.END_PORTAL_FRAME_FILLED))).toBe(true)
    expect(generateStrongholdPlan(GOLDEN_SEED, site, 'end')).toBeUndefined()
  }))

  it.effect('locates multiple ordered candidates and changes with the seed', () => Effect.sync(() => {
    const first = locateStronghold(GOLDEN_SEED, { x: 0, z: 0 }, 4)
    const repeated = locateStronghold(GOLDEN_SEED, { x: 0, z: 0 }, 4)
    const other = locateStronghold(GOLDEN_SEED + 1, { x: 0, z: 0 }, 4)
    expect(first).toHaveLength(4)
    expect(first).toEqual(repeated)
    expect(other).not.toEqual(first)
  }))

  it.effect('publishes inward frame metadata accepted by the portal validator', () => Effect.sync(() => {
    const site = requiredSite()
    const plan = generateStrongholdPlan(GOLDEN_SEED, site)
    const states = new Map(plan?.frames.map((frame) => [
      `${frame.x},${frame.y},${frame.z}`,
      { block: STRONGHOLD_BLOCK.END_PORTAL_FRAME_FILLED, facing: frame.facing },
    ]))
    const completed = detectCompletedEndPortal(
      (x, y, z) => states.get(`${x},${y},${z}`),
      'overworld',
      endPortalCenterForStronghold(site),
    )
    expect(Option.isSome(completed)).toBe(true)
  }))
})
