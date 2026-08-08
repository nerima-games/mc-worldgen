/**
 * Stronghold siting.
 *
 * `domain/structure-siting.ts` ships the SITING half of the stronghold and not
 * the block half, and the most important thing this file does is check that the
 * half which shipped is COMPLETE rather than a stub — a scaffold that nobody can
 * rely on is the 「half-built structure」 failure the module header refuses.
 *
 * It writes no blocks, so it moves no golden. Nothing here needed a
 * regeneration and nothing here backs one.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect, Option } from 'effect'
import { BLOCK } from '../src/domain/biome'
import { readBlock } from '../src/domain/chunk'
import { BEDROCK_Y, blockIndex, CHUNK_SIZE_XZ } from '../src/domain/constants'
import {
  STRONGHOLD_FLOOR_Y,
  STRONGHOLD_REGION_SIZE,
  STRONGHOLD_REGION_SPAWN_PERMILLE,
  STRONGHOLD_SITE_MARGIN,
  locateStronghold,
  nearestStrongholdSite,
  strongholdSiteForRegion,
  strongholdSitesNearChunk,
} from '../src/domain/structure-siting'
import { MIN_SURFACE_Y, generateChunkAt } from '../src/domain/terrain'
import { GOLDEN_SEED } from '../scripts/golden-fixture'

describe('the region rule', () => {
  it.effect('transcribes the reference’s four constants', () =>
    Effect.sync(() => {
      // `packages/world/domain/terrain/stronghold.ts:17-21`.
      expect(STRONGHOLD_REGION_SIZE).toBe(384)
      expect(STRONGHOLD_REGION_SPAWN_PERMILLE).toBe(350)
      expect(STRONGHOLD_SITE_MARGIN).toBe(96)
      expect(STRONGHOLD_FLOOR_Y).toBe(28)
    }),
  )

  it.effect('places a site in about 35% of regions, which is what the permille says', () =>
    Effect.sync(() => {
      let present = 0
      let regions = 0
      for (let regionX = -60; regionX < 60; regionX += 1) {
        for (let regionZ = -60; regionZ < 60; regionZ += 1) {
          regions += 1
          if (Option.isSome(strongholdSiteForRegion(GOLDEN_SEED, regionX, regionZ))) {
            present += 1
          }
        }
      }

      const realised = present / regions
      // 14,400 regions. The expected rate is a LITERAL rather than the constant
      // divided by 1000, so this cannot become a comparison of the table with
      // itself — the tautology `test/vegetation.test.ts` records finding.
      expect(realised).toBeGreaterThan(0.33)
      expect(realised).toBeLessThan(0.37)
    }),
  )

  it.effect('keeps every site inside its own region’s margin', () =>
    Effect.sync(() => {
      const offences: Array<string> = []

      for (let regionX = -20; regionX < 20; regionX += 1) {
        for (let regionZ = -20; regionZ < 20; regionZ += 1) {
          const site = strongholdSiteForRegion(GOLDEN_SEED, regionX, regionZ)
          if (Option.isNone(site)) {
            continue
          }
          const offsetX = site.value.x - regionX * STRONGHOLD_REGION_SIZE
          const offsetZ = site.value.z - regionZ * STRONGHOLD_REGION_SIZE
          const low = STRONGHOLD_SITE_MARGIN
          const high = STRONGHOLD_REGION_SIZE - STRONGHOLD_SITE_MARGIN
          if (offsetX < low || offsetX >= high || offsetZ < low || offsetZ >= high) {
            offences.push(`region (${String(regionX)}, ${String(regionZ)}) offset (${String(offsetX)}, ${String(offsetZ)})`)
          }
        }
      }

      expect(offences, 'sites outside the region margin').toStrictEqual([])
    }),
  )

  /**
   * The margin's whole purpose. Two sites in adjacent regions are at least
   * `REGION_SIZE - 2 * MARGIN` apart by construction, and this measures that the
   * construction holds — the same 「bound it on the lattice」 check
   * `test/tree-canopy.test.ts` runs for tree cells.
   */
  it.effect('bounds the spacing between neighbouring sites by construction', () =>
    Effect.sync(() => {
      const bound = STRONGHOLD_REGION_SIZE - STRONGHOLD_SITE_MARGIN * 2
      let closest = Number.POSITIVE_INFINITY
      let pairs = 0

      for (let regionX = -20; regionX < 20; regionX += 1) {
        for (let regionZ = -20; regionZ < 20; regionZ += 1) {
          const here = strongholdSiteForRegion(GOLDEN_SEED, regionX, regionZ)
          if (Option.isNone(here)) {
            continue
          }
          for (const [dx, dz] of [
            [1, 0],
            [0, 1],
            [1, 1],
          ] as const) {
            const there = strongholdSiteForRegion(GOLDEN_SEED, regionX + dx, regionZ + dz)
            if (Option.isNone(there)) {
              continue
            }
            pairs += 1
            closest = Math.min(
              closest,
              Math.max(Math.abs(here.value.x - there.value.x), Math.abs(here.value.z - there.value.z)),
            )
          }
        }
      }

      expect(pairs).toBeGreaterThan(100)
      expect(closest, 'two sites closer than the margin allows').toBeGreaterThan(bound - 1)
    }),
  )

  it.effect('depends on the seed, unlike the reference’s seedless hash', () =>
    Effect.sync(() => {
      let differing = 0
      for (let regionX = -30; regionX < 30; regionX += 1) {
        for (let regionZ = -30; regionZ < 30; regionZ += 1) {
          const a = strongholdSiteForRegion(1, regionX, regionZ)
          const b = strongholdSiteForRegion(2, regionX, regionZ)
          if (Option.isSome(a) !== Option.isSome(b)) {
            differing += 1
          } else if (Option.isSome(a) && Option.isSome(b) && (a.value.x !== b.value.x || a.value.z !== b.value.z)) {
            differing += 1
          }
        }
      }
      expect(differing).toBeGreaterThan(1000)
    }),
  )

  it.effect('is deterministic', () =>
    Effect.sync(() => {
      for (const [regionX, regionZ] of [
        [0, 0],
        [7, -3],
        [-11, 22],
      ] as const) {
        expect(strongholdSiteForRegion(GOLDEN_SEED, regionX, regionZ)).toStrictEqual(
          strongholdSiteForRegion(GOLDEN_SEED, regionX, regionZ),
        )
      }
    }),
  )
})

describe('the nearest-site query', () => {
  /**
   * THE ONE THAT MATTERS. The reference's own comment says a naive
   * return-on-first-hit is not nearest, so this checks the widening shell
   * against a brute-force scan of a large neighbourhood. If the early exit is
   * ever tightened by one region, this is what says so.
   */
  it.effect('agrees with a brute-force scan, including across region borders', () =>
    Effect.sync(() => {
      const bruteForce = (x: number, z: number): Option.Option<{ x: number; z: number }> => {
        const cx = Math.floor(x / STRONGHOLD_REGION_SIZE)
        const cz = Math.floor(z / STRONGHOLD_REGION_SIZE)
        let best: { x: number; z: number } | undefined = undefined
        let bestSq = Number.POSITIVE_INFINITY
        for (let regionX = cx - 6; regionX <= cx + 6; regionX += 1) {
          for (let regionZ = cz - 6; regionZ <= cz + 6; regionZ += 1) {
            const site = strongholdSiteForRegion(GOLDEN_SEED, regionX, regionZ)
            if (Option.isNone(site)) {
              continue
            }
            const dx = site.value.x - x
            const dz = site.value.z - z
            const sq = dx * dx + dz * dz
            if (sq < bestSq) {
              bestSq = sq
              best = { x: site.value.x, z: site.value.z }
            }
          }
        }
        return best === undefined ? Option.none() : Option.some(best)
      }

      const disagreements: Array<string> = []
      // Deliberately includes columns just inside a region edge, which is where
      // the neighbour's site beats your own and where first-hit gets it wrong.
      for (const x of [0, 1, 191, 192, 383, 384, 385, -1, -383, -385, 4321, -7654]) {
        for (const z of [0, 383, 384, -1, -384, 2048, -2049]) {
          const fast = nearestStrongholdSite(GOLDEN_SEED, x, z)
          const slow = bruteForce(x, z)
          if (JSON.stringify(fast) !== JSON.stringify(slow)) {
            disagreements.push(`(${String(x)}, ${String(z)})`)
          }
        }
      }

      expect(disagreements, 'the shell scan disagreed with brute force').toStrictEqual([])
    }),
  )

  it.effect('always finds one — at 350 permille an all-miss neighbourhood is not reachable in practice', () =>
    Effect.sync(() => {
      for (const [x, z] of [
        [0, 0],
        [100000, -100000],
        [-999999, 555555],
      ] as const) {
        expect(Option.isSome(nearestStrongholdSite(GOLDEN_SEED, x, z))).toBe(true)
      }
    }),
  )

  it.effect('is never further away than a whole search radius', () =>
    Effect.sync(() => {
      for (let x = -2000; x <= 2000; x += 371) {
        const site = nearestStrongholdSite(GOLDEN_SEED, x, x)
        expect(Option.isSome(site)).toBe(true)
        if (Option.isSome(site)) {
          const dx = site.value.x - x
          const dz = site.value.z - x
          expect(Math.hypot(dx, dz)).toBeLessThan(STRONGHOLD_REGION_SIZE * 3)
        }
      }
    }),
  )
})

describe('the ranked list — locateStronghold', () => {
  /**
   * The sort's tie-break, forced rather than hoped for.
   *
   * `locateStronghold` orders candidates by squared distance, then by `x`, then
   * by `z`. An origin chosen at random essentially never ties two real sites'
   * distances (they are continuous-valued and independent), so the tie-break
   * arms have never fired — this constructs one deliberately instead of
   * leaving it to chance.
   *
   * The construction is exact rather than approximate: for any two points A
   * and B, EVERY point on their perpendicular bisector is equidistant from
   * both, and the bisector's own midpoint is the simplest one to compute. IEEE
   * 754 squaring is exact under sign flip (`(-y) ** 2 === y ** 2` bit for
   * bit), so `(A.x - mid.x) ** 2 === (B.x - mid.x) ** 2` holds precisely, not
   * approximately — the tie is real, not a floating-point coincidence.
   */
  it.effect('breaks an exact distance tie by x, then by z, deterministically', () =>
    Effect.sync(() => {
      // Two real sites from different regions, found rather than invented —
      // this is a tie between two candidates `locateStronghold` would
      // actually produce, not two points the comparator was never meant to
      // see.
      const sites: Array<{ x: number; z: number }> = []
      for (let regionX = 0; regionX < 12 && sites.length < 2; regionX += 1) {
        const candidate = strongholdSiteForRegion(GOLDEN_SEED, regionX, 0)
        if (Option.isSome(candidate)) {
          sites.push(candidate.value)
        }
      }
      const [a, b] = sites
      expect(sites, 'need two real stronghold sites to construct a tie').toHaveLength(2)
      if (a === undefined || b === undefined) {
        return
      }
      expect(a.x, 'the two sites must differ in x for this to be a meaningful x tie-break').not.toBe(b.x)

      // The exact midpoint: equidistant from `a` and `b` by construction.
      const origin = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }
      const leftDistance = (a.x - origin.x) ** 2 + (a.z - origin.z) ** 2
      const rightDistance = (b.x - origin.x) ** 2 + (b.z - origin.z) ** 2
      expect(leftDistance, 'the midpoint construction did not produce an exact tie').toBe(rightDistance)

      const results = locateStronghold(GOLDEN_SEED, origin, 40)
      const indexA = results.findIndex((site) => site.x === a.x && site.z === a.z)
      const indexB = results.findIndex((site) => site.x === b.x && site.z === b.z)
      expect(indexA, 'site a is missing from the ranked list').toBeGreaterThanOrEqual(0)
      expect(indexB, 'site b is missing from the ranked list').toBeGreaterThanOrEqual(0)

      // Tied on distance, so the lower x must sort first — the branch that
      // was never exercised before this test.
      const lowerXIndex = a.x < b.x ? indexA : indexB
      const higherXIndex = a.x < b.x ? indexB : indexA
      expect(lowerXIndex).toBeLessThan(higherXIndex)
    }),
  )

  /**
   * The SECOND arm of the tie-break, which needs a rarer coincidence: two
   * sites whose `x` also ties, so the comparator falls all the way through
   * to `z`. Two sites sharing a `regionX` but differing in `regionZ` draw
   * `offsetX` from independent hash channels, so an exact `x` match is a
   * genuine coincidence — searched for across many region columns rather
   * than manufactured by editing a site's coordinates, which would test the
   * comparator against a pair `locateStronghold` could never actually
   * produce.
   *
   * The search window per column is kept narrow (`regionZ` 0-7) so that any
   * pair found is close enough together for one `origin` to have both
   * within `STRONGHOLD_SEARCH_RADIUS` — a coincidence found far apart would
   * be real but untestable through the public search.
   */
  it.effect('breaks a distance-AND-x tie by z', () =>
    Effect.sync(() => {
      // A matching `offsetX` is common (over a thousand pairs turn up within
      // just the first 30 region columns), but most pairs land many regions
      // apart in `z`. Only a pair close enough together for one `origin` to
      // reach both through the real `STRONGHOLD_SEARCH_RADIUS` is useful
      // here, so the search keeps looking past the first match until it
      // finds one within reach.
      const MAX_USABLE_REGION_GAP = 8
      let duplicate: readonly [{ x: number; z: number }, { x: number; z: number }] | undefined

      for (let regionX = 0; regionX < 60 && duplicate === undefined; regionX += 1) {
        const byOffsetX = new Map<number, { readonly site: { x: number; z: number }; readonly regionZ: number }>()
        for (let regionZ = 0; regionZ < 500; regionZ += 1) {
          const candidate = strongholdSiteForRegion(GOLDEN_SEED, regionX, regionZ)
          if (Option.isNone(candidate)) {
            continue
          }
          const offsetX = candidate.value.x - regionX * STRONGHOLD_REGION_SIZE
          const existing = byOffsetX.get(offsetX)
          if (existing !== undefined && Math.abs(existing.regionZ - regionZ) <= MAX_USABLE_REGION_GAP) {
            duplicate = [existing.site, candidate.value]
            break
          }
          if (existing === undefined) {
            byOffsetX.set(offsetX, { regionZ, site: candidate.value })
          }
        }
      }

      expect(duplicate, 'no two nearby sites in the swept region columns shared an x — widen the sweep').toBeDefined()
      if (duplicate === undefined) {
        return
      }
      const [a, b] = duplicate
      expect(a.x).toBe(b.x)
      expect(a.z, 'the two sites must differ in z for this to be a meaningful z tie-break').not.toBe(b.z)

      // `a.x === b.x` already ties the x term for any `origin.x`, so only
      // `origin.z` needs choosing — the exact midpoint of `a.z`/`b.z`.
      const origin = { x: a.x, z: (a.z + b.z) / 2 }
      const leftDistance = (a.x - origin.x) ** 2 + (a.z - origin.z) ** 2
      const rightDistance = (b.x - origin.x) ** 2 + (b.z - origin.z) ** 2
      expect(leftDistance, 'the construction did not produce an exact distance tie').toBe(rightDistance)

      const results = locateStronghold(GOLDEN_SEED, origin, 80)
      const indexA = results.findIndex((site) => site.x === a.x && site.z === a.z)
      const indexB = results.findIndex((site) => site.x === b.x && site.z === b.z)
      expect(indexA, 'site a is missing from the ranked list').toBeGreaterThanOrEqual(0)
      expect(indexB, 'site b is missing from the ranked list').toBeGreaterThanOrEqual(0)

      // Tied on distance AND x, so the lower z must sort first.
      const lowerZIndex = a.z < b.z ? indexA : indexB
      const higherZIndex = a.z < b.z ? indexB : indexA
      expect(lowerZIndex).toBeLessThan(higherZIndex)
    }),
  )
})

describe('the chunk query the block half would start from', () => {
  it.effect('reports a site exactly when it lies within the chunk plus its extent', () =>
    Effect.sync(() => {
      const halfExtent = 6

      // Take a real site and ask its own chunk, then a chunk far away.
      const site = nearestStrongholdSite(GOLDEN_SEED, 0, 0)
      expect(Option.isSome(site)).toBe(true)
      if (Option.isNone(site)) {
        return
      }

      const chunkX = Math.floor(site.value.x / CHUNK_SIZE_XZ)
      const chunkZ = Math.floor(site.value.z / CHUNK_SIZE_XZ)

      expect(strongholdSitesNearChunk(GOLDEN_SEED, chunkX, chunkZ, halfExtent)).toContainEqual(site.value)
      expect(strongholdSitesNearChunk(GOLDEN_SEED, chunkX + 40, chunkZ + 40, halfExtent)).not.toContainEqual(
        site.value,
      )
    }),
  )

  it.effect('is reported by every chunk the footprint straddles, which is why it is not per-chunk state', () =>
    Effect.sync(() => {
      const halfExtent = 6
      const site = nearestStrongholdSite(GOLDEN_SEED, 0, 0)
      expect(Option.isSome(site)).toBe(true)
      if (Option.isNone(site)) {
        return
      }

      // A 13-wide room straddles a chunk boundary about half the time; every
      // chunk it touches must see it, or the room is written with a slice
      // missing. This is the property the block half depends on.
      let reporting = 0
      const chunkX = Math.floor(site.value.x / CHUNK_SIZE_XZ)
      const chunkZ = Math.floor(site.value.z / CHUNK_SIZE_XZ)
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dz = -1; dz <= 1; dz += 1) {
          if (strongholdSitesNearChunk(GOLDEN_SEED, chunkX + dx, chunkZ + dz, halfExtent).length > 0) {
            reporting += 1
          }
        }
      }
      expect(reporting).toBeGreaterThan(0)
    }),
  )
})

describe('STRONGHOLD_FLOOR_Y survives the port', () => {
  /**
   * A depth transcribed from a taller world is exactly what `domain/ore.ts`'s
   * bands turned out to be, so the one constant here that describes a DEPTH is
   * checked against this repository's terrain rather than trusted.
   */
  it.effect('sits in continuous stone in this repository’s terrain, not in air or bedrock', () =>
    Effect.sync(() => {
      let cells = 0
      let stone = 0

      for (let cx = -3; cx < 3; cx += 1) {
        for (let cz = -3; cz < 3; cz += 1) {
          const chunk = generateChunkAt(GOLDEN_SEED, cx, cz, { decorate: false })
          for (let lx = 0; lx < CHUNK_SIZE_XZ; lx += 1) {
            for (let lz = 0; lz < CHUNK_SIZE_XZ; lz += 1) {
              cells += 1
              const id = readBlock(chunk.blocks, blockIndex(lx, STRONGHOLD_FLOOR_Y, lz))
              if (id === BLOCK.STONE) {
                stone += 1
              }
              // Whatever else it is, it must not be the bedrock floor.
              expect(id).not.toBe(BLOCK.BEDROCK)
            }
          }
        }
      }

      // Caves reach this depth, so this is "almost all" rather than "all" —
      // which is itself the reason the block half needs an intersection rule.
      expect(stone / cells).toBeGreaterThan(0.85)

      // Buried by construction as well as by measurement: the room floor is
      // below the SHALLOWEST surface the shaper can produce, so no stronghold
      // can ever break the surface however low the terrain goes there.
      expect(STRONGHOLD_FLOOR_Y).toBeLessThan(MIN_SURFACE_Y)
      expect(STRONGHOLD_FLOOR_Y).toBeGreaterThan(BEDROCK_Y)
    }),
  )
})
