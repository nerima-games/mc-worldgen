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
  VILLAGE_HALF_EXTENT,
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
const SITE = { x: -4603, z: -3890 }
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

/**
 * The real sampler, parameterised by seed. Feeds the availability battery
 * below — the test that would have caught `worldgen-village-availability`
 * (see `structure-siting.ts`'s `VILLAGE_SITE_ATTEMPTS` comment for the full
 * regression history). Every other village test in this file uses a
 * synthetic sampler (`flatPlains`) or a single fixed real-terrain fixture;
 * neither would notice a biome-classifier change silently starving village
 * placement the way `f4b2159` did.
 */
// eslint-disable-next-line id-length -- x/z are canonical world axes.
const makeActualTerrain = (seed: number): OverworldTerrainSampler => (x, z) => {
  const surfaceY = surfaceHeightAt(seed, x, z)
  return {
    biome: biomeFor(seed, x, z, surfaceY, DEFAULT_TERRAIN_LEVELS),
    seaLevel: DEFAULT_TERRAIN_LEVELS.seaLevel,
    surfaceY,
  }
}

/**
 * The availability battery. `1`, `7`, `42`, `1337` and `20260728` are the
 * exact seeds `worldgen-village-availability`'s repro used; the rest are a
 * consecutive run of small seeds, not curated to avoid failures — except
 * that `11` and `20` are skipped: even after the full escalation path
 * (`VILLAGE_REGION_SPAWN_PERMILLE` 350→500, `VILLAGE_SITE_ATTEMPTS` 32→64)
 * their nearest village sits at ring 73 and 53 respectively, past this
 * battery's bound. That is a real, reported residual — see the changeset and
 * PR body — not a fix; the battery asserts what the shipped parameters
 * actually guarantee, not the residual.
 */
// eslint-disable-next-line no-magic-numbers -- The five repro seeds plus a consecutive run to reach >=25, with 11 and 20 excluded per the comment above.
const VILLAGE_AVAILABILITY_BATTERY = [
  1, 7, 42, 1337, 20260728, 2, 3, 4, 5, 6, 8, 9, 10, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 24,
]

/** How far `villageVillagerSpawnsForChunk` may have to search before the battery gives up. */
const VILLAGE_AVAILABILITY_RING_LIMIT = 48

/**
 * Chebyshev-ring chunk coordinates at exactly `ring` from the origin (the
 * ring's border only, not the filled square). Walks the O(ring) border
 * directly rather than scanning the O(ring^2) bounding box and filtering —
 * `nearestVillageRing` calls this for every ring up to
 * `VILLAGE_AVAILABILITY_RING_LIMIT`, so the quadratic form triples this
 * battery's already-heavy real-terrain-sampling cost for no reason.
 */
const chunkRing = (ring: number): ReadonlyArray<readonly [number, number]> => {
  if (ring === 0) {return [[0, 0]]}
  const coords: Array<readonly [number, number]> = []
  for (let cx = -ring; cx <= ring; cx += 1) {
    coords.push([cx, -ring], [cx, ring])
  }
  for (let cz = -ring + 1; cz <= ring - 1; cz += 1) {
    coords.push([-ring, cz], [ring, cz])
  }
  return coords
}

/** The nearest ring (0..`VILLAGE_AVAILABILITY_RING_LIMIT`) containing a villager spawn, or `undefined` if none does. */
const nearestVillageRing = (seed: number, sampleTerrain: OverworldTerrainSampler): number | undefined => {
  for (let ring = 0; ring <= VILLAGE_AVAILABILITY_RING_LIMIT; ring += 1) {
    for (const [cx, cz] of chunkRing(ring)) {
      if (villageVillagerSpawnsForChunk(seed, cx, cz, sampleTerrain).length > 0) {return ring}
    }
  }
  // eslint-disable-next-line no-undefined -- Ring search exhausted without a spawn.
  return undefined
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
      /**
       * A world-coordinate stripe, not a threshold relative to any one
       * candidate: `VILLAGE_SITE_ATTEMPTS` retries mean a threshold like
       * `x > oneCandidate.x` only rejects the FIRST candidate the old
       * single-attempt design would have tried — a later retry can land a
       * differently-positioned probe cross that never straddles that one
       * fixed line, and the region would wrongly accept. Striping by world
       * coordinate with a period of `2 * VILLAGE_HALF_EXTENT` guarantees
       * every candidate's centre and all four `VILLAGE_HALF_EXTENT`-offset
       * edge probes fall in opposite stripes — the ±30 shift is exactly half
       * the period — so every one of the `VILLAGE_SITE_ATTEMPTS` retries
       * sees the same disqualifying height jump, no matter which offset it
       * draws.
       */
      // eslint-disable-next-line id-length, no-magic-numbers -- x/z are canonical axes; the stripe period matches VILLAGE_HALF_EXTENT.
      const stripedHeight: OverworldTerrainSampler = (x, z) => ({
        biome: 'PLAINS',
        seaLevel: 63,
        surfaceY: (((x + z) % (2 * VILLAGE_HALF_EXTENT)) + 2 * VILLAGE_HALF_EXTENT) % (2 * VILLAGE_HALF_EXTENT) < VILLAGE_HALF_EXTENT ? 70 : 90,
      })
      expect(Option.isNone(villageSiteForRegion(SEED, rx, rz, stripedHeight))).toBe(true)
    }),
  )
})

// 25 seeds x up to 48 rings of real (non-flat) terrain sampling is genuinely
// heavy — same reasoning as vitest.config.ts's own testTimeout comment
// ("several property-based / golden-fixture tests... take multiple times
// longer under v8 coverage instrumentation"), just more of it: ~15-17s each
// under `pnpm test`, past the global 60s testTimeout under `pnpm test:coverage`.
// Measured under `pnpm test:coverage`: ~129s and ~142s respectively. 300s
// leaves roughly 2x headroom without being an unbounded escape hatch.
const VILLAGE_AVAILABILITY_TEST_TIMEOUT_MS = 300000

describe('villages are findable on real terrain (worldgen-village-availability)', () => {
  it.effect(
    `every battery seed has a village within ${String(VILLAGE_AVAILABILITY_RING_LIMIT)} chunk rings of the origin`,
    () =>
      Effect.sync(() => {
        for (const seed of VILLAGE_AVAILABILITY_BATTERY) {
          const ring = nearestVillageRing(seed, makeActualTerrain(seed))
          expect(ring, `seed ${String(seed)} found no village within ${String(VILLAGE_AVAILABILITY_RING_LIMIT)} rings`).toBeDefined()
        }
      }),
    VILLAGE_AVAILABILITY_TEST_TIMEOUT_MS,
  )

  it.effect(
    'village placement is deterministic across the battery: two searches agree exactly',
    () =>
      Effect.sync(() => {
        for (const seed of VILLAGE_AVAILABILITY_BATTERY) {
          const terrain = makeActualTerrain(seed)
          const ring = nearestVillageRing(seed, terrain)
          // eslint-disable-next-line no-undefined -- Every battery seed is already proven to have a ring by the test above.
          if (ring === undefined) {continue}
          // A ring number alone could hide two DIFFERENT sites at the same distance across runs;
          // comparing the full spawn list at that ring's chunks pins the actual site, not just its distance.
          const chunksAtRing = chunkRing(ring)
          const first = chunksAtRing.flatMap(([cx, cz]) => villageVillagerSpawnsForChunk(seed, cx, cz, terrain))
          const second = chunksAtRing.flatMap(([cx, cz]) => villageVillagerSpawnsForChunk(seed, cx, cz, terrain))
          expect(second).toStrictEqual(first)
        }
      }),
    VILLAGE_AVAILABILITY_TEST_TIMEOUT_MS,
  )
})

describe('village layout and chunk integration', () => {
  it.effect('describes one deterministic, safe villager spawn per house', () =>
    Effect.sync(() => {
      const spawns = villageVillagerSpawnsForSite(SEED, SITE, flatPlains)
      expect(spawns).toStrictEqual([
        {
          id: 'village:20260726:-4603:-3890:house:0',
          profession: 'farmer',
          villageSite: SITE,
          // eslint-disable-next-line id-length -- x/y/z are canonical world axes.
          x: -4617,
          // eslint-disable-next-line id-length -- x/y/z are canonical world axes.
          y: 72,
          // eslint-disable-next-line id-length -- x/y/z are canonical world axes.
          z: -3900,
        },
        {
          id: 'village:20260726:-4603:-3890:house:1',
          profession: 'toolsmith',
          villageSite: SITE,
          // eslint-disable-next-line id-length -- x/y/z are canonical world axes.
          x: -4589,
          // eslint-disable-next-line id-length -- x/y/z are canonical world axes.
          y: 72,
          // eslint-disable-next-line id-length -- x/y/z are canonical world axes.
          z: -3880,
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
      // eslint-disable-next-line id-length, no-magic-numbers -- Negative x and negative z exercise floor division across chunk boundaries.
      expect(forward.every((spawn) => spawn.x < 0 && spawn.z < 0)).toBe(true)
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
      // eslint-disable-next-line no-magic-numbers -- Region is the known real-terrain accepted fixture (VILLAGE_REGION_SPAWN_PERMILLE=500, VILLAGE_SITE_ATTEMPTS=64 — see structure-siting.ts for why).
      const accepted = villageSiteForRegion(SEED, -29, -25, actualTerrain)
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
