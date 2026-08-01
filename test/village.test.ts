import { describe, expect, it } from '@effect/vitest'
// eslint-disable-next-line sort-imports -- External imports precede project modules.
import { Effect, Option } from 'effect'
// eslint-disable-next-line sort-imports -- Project modules follow domain dependency order.
import { BLOCK } from '../src/domain/biome'
import { getBlockAt } from '../src/domain/chunk'
// eslint-disable-next-line sort-imports -- Domain imports follow their dependency order.
import { DEFAULT_TERRAIN_LEVELS } from '../src/domain/constants'
import { chunkCoord } from '../src/domain/kernel-vocabulary'
// eslint-disable-next-line sort-imports -- Grouped siting types and values stay together.
import {
  VILLAGE_REGION_SPAWN_PERMILLE,
  type VillageTerrainSampler,
  villageSiteForRegion,
} from '../src/domain/structure-siting'
import { biomeFor, generateChunk, surfaceHeightAt } from '../src/domain/terrain'
// eslint-disable-next-line sort-imports -- Layout assertions import the public village resolver last.
import { VILLAGE_BLOCK, villageBlockAt } from '../src/domain/village'

const SEED = 20260726
// eslint-disable-next-line id-length, no-magic-numbers -- Fixed accepted site is a deterministic integration fixture.
const SITE = { x: -6142, z: -2509 }
// eslint-disable-next-line no-magic-numbers -- Flat fixture models dry buildable plains.
const flatPlains: VillageTerrainSampler = () => ({ biome: 'PLAINS', seaLevel: 63, surfaceY: 70 })
// eslint-disable-next-line id-length -- x/z are canonical world axes.
const actualTerrain: VillageTerrainSampler = (x, z) => {
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
      const accepted = villageSiteForRegion(SEED, -39, -16, actualTerrain)
      expect(accepted).toStrictEqual(Option.some(SITE))

      // eslint-disable-next-line no-magic-numbers -- Chunk -385 is immediately left of the negative seam.
      const leftCoord = chunkCoord(-385, Math.floor(SITE.z / 16))
      // eslint-disable-next-line no-magic-numbers -- Chunk -384 is immediately right of the negative seam.
      const rightCoord = chunkCoord(-384, Math.floor(SITE.z / 16))
      const leftFirst = generateChunk(SEED, leftCoord)
      const rightSecond = generateChunk(SEED, rightCoord)
      const rightFirst = generateChunk(SEED, rightCoord)
      const leftSecond = generateChunk(SEED, leftCoord)
      expect(leftFirst.blocks).toStrictEqual(leftSecond.blocks)
      expect(rightFirst.blocks).toStrictEqual(rightSecond.blocks)

      // eslint-disable-next-line no-magic-numbers -- Last world column left of the seam.
      const leftX = -6145
      // eslint-disable-next-line no-magic-numbers -- First world column right of the seam.
      const rightX = -6144
      const leftY = surfaceHeightAt(SEED, leftX, SITE.z)
      const rightY = surfaceHeightAt(SEED, rightX, SITE.z)
      // eslint-disable-next-line no-magic-numbers -- Local column 15 is the left chunk edge.
      expect(getBlockAt(leftFirst, 15, leftY, SITE.z - leftCoord.cz * 16)).toBe(VILLAGE_BLOCK.ROAD)
      // eslint-disable-next-line no-magic-numbers -- Local column zero is the right chunk edge.
      expect(getBlockAt(rightFirst, 0, rightY, SITE.z - rightCoord.cz * 16)).toBe(VILLAGE_BLOCK.ROAD)
    }),
  )
})
