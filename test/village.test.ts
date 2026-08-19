import { describe, expect, it } from '@effect/vitest'
// eslint-disable-next-line sort-imports -- External imports precede project modules.
import { Effect, Option } from 'effect'
// eslint-disable-next-line sort-imports -- Project modules follow domain dependency order.
import { BLOCK } from '../src/domain/biome'
import { getBlockAt } from '../src/domain/chunk'
// eslint-disable-next-line sort-imports -- Domain imports follow their dependency order.
import { CHUNK_SIZE_XZ, DEFAULT_TERRAIN_LEVELS } from '../src/domain/constants'
import { chunkCoord } from '@nerima-games/mc-kernel'
// eslint-disable-next-line sort-imports -- Grouped siting types and values stay together.
import {
  VILLAGE_REGION_SPAWN_PERMILLE,
  type OverworldTerrainSampler,
  villageSiteForRegion,
} from '../src/domain/structure-siting'
import { biomeFor, generateChunk, surfaceHeightAt } from '../src/domain/terrain'
// eslint-disable-next-line sort-imports -- Layout assertions import the public village resolver last.
import {
  VILLAGE_BLOCK,
  villageBlockAt,
  villageVillagerSpawnsForChunk,
  villageVillagerSpawnsForSite,
} from '../src/domain/village'

const SEED = 20260726
// eslint-disable-next-line id-length, no-magic-numbers -- Fixed accepted site is a deterministic integration fixture.
const SITE = { x: -3312, z: 1082 }
// eslint-disable-next-line no-magic-numbers -- Flat fixture models dry buildable plains.
const flatPlains: OverworldTerrainSampler = () => ({ biome: 'PLAINS', seaLevel: 63, surfaceY: 70 })
// eslint-disable-next-line id-length -- x/z are canonical world axes.
const actualTerrain: OverworldTerrainSampler = (x, z) => {
  const surfaceY = surfaceHeightAt(SEED, x, z)
  return {
    biome: biomeFor(SEED, x, z, surfaceY, DEFAULT_TERRAIN_LEVELS),
    seaLevel: DEFAULT_TERRAIN_LEVELS.seaLevel,
    surfaceY,
  }
}

describe('village siting', () => {
  it.effect('is deterministic and seed-dependent while remaining sparse', () =>
    // eslint-disable-next-line max-statements -- One test compares two complete deterministic scans and density.
    Effect.sync(() => {
      const first: Array<string> = []
      const otherSeed: Array<string> = []
      // eslint-disable-next-line no-magic-numbers -- Scan bounds provide a representative 41-region square.
      for (let rx = -20; rx <= 20; rx += 1) {
        // eslint-disable-next-line no-magic-numbers -- Scan bounds provide a representative 41-region square.
        for (let rz = -20; rz <= 20; rz += 1) {
          if (Option.isSome(villageSiteForRegion(SEED, rx, rz, flatPlains))) {first.push(`${String(rx)},${String(rz)}`)}
          // eslint-disable-next-line no-magic-numbers -- Adjacent seed proves seed sensitivity.
          if (Option.isSome(villageSiteForRegion(SEED + 1, rx, rz, flatPlains))) {otherSeed.push(`${String(rx)},${String(rz)}`)}
        }
      }

      const repeated: Array<string> = []
      // eslint-disable-next-line no-magic-numbers -- Repeat the identical representative scan.
      for (let rx = -20; rx <= 20; rx += 1) {
        // eslint-disable-next-line no-magic-numbers -- Repeat the identical representative scan.
        for (let rz = -20; rz <= 20; rz += 1) {
          if (Option.isSome(villageSiteForRegion(SEED, rx, rz, flatPlains))) {repeated.push(`${String(rx)},${String(rz)}`)}
        }
      }
      expect(first).toStrictEqual(repeated)
      expect(first).not.toStrictEqual(otherSeed)
      // eslint-disable-next-line no-magic-numbers -- 41 squared is the scan area; permille converts by 1000.
      expect(first.length / (41 * 41)).toBeCloseTo(VILLAGE_REGION_SPAWN_PERMILLE / 1000, 1)
    }),
  )

  it.effect('rejects an otherwise identical candidate outside dry, level plains', () =>
    // eslint-disable-next-line max-statements -- The test locates one candidate then exercises two rejection gates.
    Effect.sync(() => {
      // eslint-disable-next-line init-declarations, no-undefined -- Candidate absence controls the bounded search.
      let candidate: readonly [number, number] | undefined
      // eslint-disable-next-line no-magic-numbers, no-undefined -- Bounded search only needs one seeded candidate.
      for (let rx = -10; rx <= 10 && candidate === undefined; rx += 1) {
        // eslint-disable-next-line no-magic-numbers -- Bounded search only needs one seeded candidate.
        for (let rz = -10; rz <= 10; rz += 1) {
          if (Option.isSome(villageSiteForRegion(SEED, rx, rz, flatPlains))) {
            candidate = [rx, rz]
            break
          }
        }
      }
      expect(candidate).toBeDefined()
      // eslint-disable-next-line no-undefined -- Guard narrows the fixture after the explicit assertion.
      if (candidate === undefined) { return }
      const [rx, rz] = candidate
      const flatSite = villageSiteForRegion(SEED, rx, rz, flatPlains)
      if (Option.isNone(flatSite)) {throw new Error('expected candidate to remain accepted')}
      // eslint-disable-next-line no-magic-numbers -- Fixed dry heights isolate the biome rejection gate.
      expect(Option.isNone(villageSiteForRegion(SEED, rx, rz, () => ({ biome: 'DESERT', seaLevel: 63, surfaceY: 70 })))).toBe(true)
      // eslint-disable-next-line id-length, no-magic-numbers, no-ternary -- Two fixed heights isolate excessive slope.
      expect(Option.isNone(villageSiteForRegion(SEED, rx, rz, (x) => ({ biome: 'PLAINS', seaLevel: 63, surfaceY: x > flatSite.value.x ? 80 : 70 })))).toBe(true)
    }),
  )
})

describe('village layout and chunk integration', () => {
  it.effect('describes one deterministic, safe villager spawn per house', () =>
    Effect.sync(() => {
      const spawns = villageVillagerSpawnsForSite(SEED, SITE, flatPlains)
      expect(spawns).toStrictEqual([
        {
          id: 'village:20260726:-3312:1082:house:0',
          profession: 'farmer',
          villageSite: SITE,
          // eslint-disable-next-line id-length -- x/y/z are canonical world axes.
          x: -3326,
          // eslint-disable-next-line id-length -- x/y/z are canonical world axes.
          y: 72,
          // eslint-disable-next-line id-length -- x/y/z are canonical world axes.
          z: 1072,
        },
        {
          id: 'village:20260726:-3312:1082:house:1',
          profession: 'toolsmith',
          villageSite: SITE,
          // eslint-disable-next-line id-length -- x/y/z are canonical world axes.
          x: -3298,
          // eslint-disable-next-line id-length -- x/y/z are canonical world axes.
          y: 72,
          // eslint-disable-next-line id-length -- x/y/z are canonical world axes.
          z: 1092,
        },
      ])
      expect(villageVillagerSpawnsForSite(SEED, SITE, flatPlains)).toStrictEqual(spawns)

      for (const spawn of spawns) {
        // eslint-disable-next-line id-length, no-magic-numbers -- x/y/z are canonical axes; one block below is the floor.
        expect(villageBlockAt(SITE, spawn.x, spawn.y - 1, spawn.z, flatPlains)).toBe(VILLAGE_BLOCK.TIMBER)
        // eslint-disable-next-line id-length -- x/y/z are canonical world axes.
        expect(villageBlockAt(SITE, spawn.x, spawn.y, spawn.z, flatPlains)).toBe(BLOCK.AIR)
        // eslint-disable-next-line id-length, no-magic-numbers -- x/y/z are canonical axes; one block above is headroom.
        expect(villageBlockAt(SITE, spawn.x, spawn.y + 1, spawn.z, flatPlains)).toBe(BLOCK.AIR)
      }
    }),
  )

  it.effect('assigns each spawn to exactly one chunk independent of chunk load order', () =>
    Effect.sync(() => {
      const expected = villageVillagerSpawnsForSite(SEED, SITE, flatPlains)
      const chunks = expected.map((spawn) => ({
        // eslint-disable-next-line id-length -- x is the canonical world axis.
        cx: Math.floor(spawn.x / CHUNK_SIZE_XZ),
        // eslint-disable-next-line id-length -- z is the canonical world axis.
        cz: Math.floor(spawn.z / CHUNK_SIZE_XZ),
      }))
      const forward = chunks.flatMap(({ cx, cz }) => villageVillagerSpawnsForChunk(SEED, cx, cz, flatPlains))
      const reverse = [...chunks].reverse().flatMap(({ cx, cz }) => villageVillagerSpawnsForChunk(SEED, cx, cz, flatPlains))

      expect(new Set(forward.map(({ id }) => id)).size).toBe(expected.length)
      expect(forward.map(({ id }) => id).sort()).toStrictEqual(expected.map(({ id }) => id).sort())
      expect(reverse.map(({ id }) => id).sort()).toStrictEqual(forward.map(({ id }) => id).sort())
      // eslint-disable-next-line id-length, no-magic-numbers -- Negative x and positive z exercise floor division across chunk boundaries.
      expect(forward.every((spawn) => spawn.x < 0 && spawn.z > 0)).toBe(true)
    }),
  )

  it.effect('builds two enclosed houses, foundations, doors and a safe road', () =>
    Effect.sync(() => {
      // eslint-disable-next-line no-magic-numbers -- Fixture height is the flat-plains surface.
      expect(villageBlockAt(SITE, SITE.x, 70, SITE.z, flatPlains)).toBe(VILLAGE_BLOCK.ROAD)
      // eslint-disable-next-line no-magic-numbers -- One block above the road must be clear.
      expect(villageBlockAt(SITE, SITE.x, 71, SITE.z, flatPlains)).toBe(BLOCK.AIR)

      // eslint-disable-next-line no-magic-numbers -- These are the two house centres in the fixed plan.
      for (const [dx, dz] of [[-14, -10], [14, 10]] as const) {
        // eslint-disable-next-line no-magic-numbers -- Floor level is one above the flat surface.
        expect(villageBlockAt(SITE, SITE.x + dx, 71, SITE.z + dz, flatPlains)).toBe(VILLAGE_BLOCK.TIMBER)
        // eslint-disable-next-line no-magic-numbers -- Edge at wall height verifies enclosure.
        expect(villageBlockAt(SITE, SITE.x + dx + 4, 73, SITE.z + dz, flatPlains)).toBe(VILLAGE_BLOCK.TIMBER)
        // eslint-disable-next-line no-magic-numbers -- Interior above the floor must be air.
        expect(villageBlockAt(SITE, SITE.x + dx, 72, SITE.z + dz, flatPlains)).toBe(BLOCK.AIR)
        // eslint-disable-next-line no-magic-numbers -- Roof level caps each house.
        expect(villageBlockAt(SITE, SITE.x + dx, 76, SITE.z + dz, flatPlains)).toBe(VILLAGE_BLOCK.TIMBER)
      }
    }),
  )

  it.effect('writes real blocks on both sides of a chunk seam independent of request order', () =>
    // eslint-disable-next-line max-statements -- Integration checks both seam chunks in both request orders.
    Effect.sync(() => {
      // eslint-disable-next-line no-magic-numbers -- Region is the known real-terrain accepted fixture.
      const accepted = villageSiteForRegion(SEED, -21, 6, actualTerrain)
      expect(accepted).toStrictEqual(Option.some(SITE))
      const actualSpawns = villageVillagerSpawnsForSite(SEED, SITE, actualTerrain)
      for (const spawn of actualSpawns) {
        // eslint-disable-next-line id-length, no-magic-numbers -- The actual house floor must support the spawn.
        expect(villageBlockAt(SITE, spawn.x, spawn.y - 1, spawn.z, actualTerrain)).toBe(VILLAGE_BLOCK.TIMBER)
        // eslint-disable-next-line id-length -- The actual spawn block must be clear.
        expect(villageBlockAt(SITE, spawn.x, spawn.y, spawn.z, actualTerrain)).toBe(BLOCK.AIR)
        // eslint-disable-next-line id-length, no-magic-numbers -- Actual terrain must leave headroom above the spawn.
        expect(villageBlockAt(SITE, spawn.x, spawn.y + 1, spawn.z, actualTerrain)).toBe(BLOCK.AIR)
      }

      const leftChunkX = Math.floor(SITE.x / CHUNK_SIZE_XZ)
      const rightChunkX = leftChunkX + 1
      const seamChunkZ = Math.floor(SITE.z / CHUNK_SIZE_XZ)
      const leftCoord = chunkCoord(leftChunkX, seamChunkZ)
      const rightCoord = chunkCoord(rightChunkX, seamChunkZ)
      const leftFirst = generateChunk(SEED, leftCoord)
      const rightSecond = generateChunk(SEED, rightCoord)
      const rightFirst = generateChunk(SEED, rightCoord)
      const leftSecond = generateChunk(SEED, leftCoord)
      expect(leftFirst.blocks).toStrictEqual(leftSecond.blocks)
      expect(rightFirst.blocks).toStrictEqual(rightSecond.blocks)

      const leftX = leftChunkX * CHUNK_SIZE_XZ + CHUNK_SIZE_XZ - 1
      const rightX = rightChunkX * CHUNK_SIZE_XZ
      const leftY = surfaceHeightAt(SEED, leftX, SITE.z)
      const rightY = surfaceHeightAt(SEED, rightX, SITE.z)
      expect(getBlockAt(leftFirst, CHUNK_SIZE_XZ - 1, leftY, SITE.z - leftCoord.cz * CHUNK_SIZE_XZ)).toBe(VILLAGE_BLOCK.ROAD)
      expect(getBlockAt(rightFirst, 0, rightY, SITE.z - rightCoord.cz * CHUNK_SIZE_XZ)).toBe(VILLAGE_BLOCK.ROAD)
    }),
  )
})
