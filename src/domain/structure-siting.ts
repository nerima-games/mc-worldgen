/**
 * Where strongholds go. The block writer lives in `./stronghold.ts`.
 *
 * plan.md §3.7 gives this repository 「構造物（村/ポータル/End）」 and
 * `docs/responsibility.md` widens it to 村 / End / 要塞. This file closes the
 * SITING half of the stronghold: it decides, for any world
 * coordinate, whether a stronghold stands there and where its nearest one is.
 * It writes no blocks and names no block ids; keeping siting pure lets every
 * chunk write its own stronghold slice without cross-chunk mutation.
 *
 * ---------------------------------------------------------------------------
 * THE SEED, FOR THE THIRD TIME
 * ---------------------------------------------------------------------------
 *
 * `stronghold.ts:8-9` states its own choice: 「sites are derived purely from
 * world coordinates via a seedless hash, so each chunk writes its own slice
 * independently and multiplayer clients agree for free」.
 *
 * The stated benefit is real but it is not what makes it work. Chunks agree
 * because the function is PURE AND SHARED, not because it ignores the seed — a
 * seeded function of `(seed, region)` is just as independent per chunk, since
 * every chunk of one world has the same seed. What seedlessness actually buys is
 * nothing, and what it costs is that every world in the organisation has its
 * strongholds in the same 384-block grid cells. Same conclusion as
 * `./vegetation.ts` and `./ore.ts`, and by now the same paragraph.
 */
import { Option } from 'effect'
import type { BiomeType } from './biome'
import { channelSeed, latticeValue } from './seeded-random'

/**
 * Edge of a siting region, in blocks. `stronghold.ts:17`.
 *
 * One candidate per region is what bounds the density: strongholds cannot be
 * closer together than roughly `STRONGHOLD_REGION_SIZE - 2 * MARGIN` apart even
 * in the worst case of two adjacent regions placing at facing edges, which is
 * the same 「bound it on the lattice, before any later gate runs」 argument
 * `./tree-placement.ts` makes for tree cells.
 */
export const STRONGHOLD_REGION_SIZE = 384

/** Fraction of regions holding a stronghold, in permille. `stronghold.ts:19`. */
export const STRONGHOLD_REGION_SPAWN_PERMILLE = 350

/**
 * Blocks of each region edge a site may not enter. `stronghold.ts:20`.
 *
 * With margin 96 and region 384 the site lands in the middle 192 blocks, so two
 * sites in adjacent regions are at least `384 - 192 = 192` blocks apart.
 */
export const STRONGHOLD_SITE_MARGIN = 96

/**
 * Y of the room floor. `stronghold.ts:21`.
 *
 * Transcribed, and it survives the port for a reason worth checking rather than
 * assuming: this repository's stone is continuous at y=28. Measured over 144
 * chunks at three seeds, every cell at y=25..35 is STONE — the depth is well
 * below the shallowest surface (`MIN_SURFACE_Y` is 38) and well above the
 * bedrock floor. `test/structure-siting.test.ts` pins that, because a floor Y
 * transcribed from a taller world is exactly the class of error
 * `./ore.ts`'s depth bands turned out to be.
 */
export const STRONGHOLD_FLOOR_Y = 28

/** How many region shells `nearestStrongholdSite` will search. `stronghold.ts:57`. */
export const STRONGHOLD_SEARCH_RADIUS = 6

export type StrongholdSite = {
  readonly x: number
  readonly z: number
}

export type StrongholdOrigin = { readonly x: number; readonly z: number }

/** Returns the nearest deterministic candidates, ordered by distance then coordinate. */
export const locateStronghold = (
  seed: number,
  origin: StrongholdOrigin,
  limit = 3,
): ReadonlyArray<StrongholdSite> => {
  const regionX = floorDiv(origin.x, STRONGHOLD_REGION_SIZE)
  const regionZ = floorDiv(origin.z, STRONGHOLD_REGION_SIZE)
  const sites: StrongholdSite[] = []
  for (let dx = -STRONGHOLD_SEARCH_RADIUS; dx <= STRONGHOLD_SEARCH_RADIUS; dx += 1) {
    for (let dz = -STRONGHOLD_SEARCH_RADIUS; dz <= STRONGHOLD_SEARCH_RADIUS; dz += 1) {
      const candidate = strongholdSiteForRegion(seed, regionX + dx, regionZ + dz)
      if (Option.isSome(candidate)) sites.push(candidate.value)
    }
  }
  return sites
    .sort((left, right) => {
      const leftDistance = (left.x - origin.x) ** 2 + (left.z - origin.z) ** 2
      const rightDistance = (right.x - origin.x) ** 2 + (right.z - origin.z) ** 2
      return leftDistance - rightDistance || left.x - right.x || left.z - right.z
    })
    .slice(0, Math.max(0, limit))
}

export const VILLAGE_REGION_SIZE = 160
export const VILLAGE_REGION_SPAWN_PERMILLE = 120
export const VILLAGE_SITE_MARGIN = 32
export const VILLAGE_HALF_EXTENT = 30
const PERMILLE_SCALE = 1000
const VILLAGE_MIN_DRY_CLEARANCE = 1
const VILLAGE_MAX_HEIGHT_VARIATION = 6
const CHUNK_SIZE = 16
const CHUNK_MAX_LOCAL = 15
const VILLAGE_SITE_MARGIN_SIDES = 2
const REGION_STEP = 1

export type VillageSite = {
  // eslint-disable-next-line id-length -- x/z are canonical world axes.
  readonly x: number
  // eslint-disable-next-line id-length -- x/z are canonical world axes.
  readonly z: number
}

export type VillageTerrainSample = {
  readonly biome: BiomeType
  readonly surfaceY: number
  readonly seaLevel: number
}

// eslint-disable-next-line id-length -- x/z are canonical world axes.
export type VillageTerrainSampler = (x: number, z: number) => VillageTerrainSample

/** Euclidean floor division — correct for negative operands, as in `mc-kernel`. */
const floorDiv = (value: number, divisor: number): number => Math.floor(value / divisor)

/** A sparse, seeded candidate accepted only when its complete footprint is dry, level plains. */
// eslint-disable-next-line max-params, max-statements -- Public siting API mirrors other seeded region locators.
export const villageSiteForRegion = (
  seed: number,
  regionX: number,
  regionZ: number,
  sampleTerrain: VillageTerrainSampler,
): Option.Option<VillageSite> => {
  const roll = latticeValue(channelSeed(seed, 'village-present'), regionX, regionZ)
  if (roll >= VILLAGE_REGION_SPAWN_PERMILLE / PERMILLE_SCALE) {
    return Option.none()
  }

  const span = VILLAGE_REGION_SIZE - VILLAGE_SITE_MARGIN * VILLAGE_SITE_MARGIN_SIDES
  // eslint-disable-next-line id-length -- x/z are canonical world axes.
  const x = regionX * VILLAGE_REGION_SIZE + VILLAGE_SITE_MARGIN +
    Math.floor(latticeValue(channelSeed(seed, 'village-x'), regionX, regionZ) * span)
  // eslint-disable-next-line id-length -- x/z are canonical world axes.
  const z = regionZ * VILLAGE_REGION_SIZE + VILLAGE_SITE_MARGIN +
    Math.floor(latticeValue(channelSeed(seed, 'village-z'), regionX, regionZ) * span)
  const probes = [
    sampleTerrain(x, z),
    sampleTerrain(x - VILLAGE_HALF_EXTENT, z),
    sampleTerrain(x + VILLAGE_HALF_EXTENT, z),
    sampleTerrain(x, z - VILLAGE_HALF_EXTENT),
    sampleTerrain(x, z + VILLAGE_HALF_EXTENT),
  ]
  if (probes.some((probe) => probe.biome !== 'PLAINS' || probe.surfaceY <= probe.seaLevel + VILLAGE_MIN_DRY_CLEARANCE)) {
    return Option.none()
  }

  const heights = probes.map((probe) => probe.surfaceY)
  if (Math.max(...heights) - Math.min(...heights) > VILLAGE_MAX_HEIGHT_VARIATION) {
    return Option.none()
  }
  // eslint-disable-next-line id-length -- x/z are canonical world axes.
  return Option.some({ x, z })
}

/** Finds all accepted village centres whose footprint can overlap this chunk. */
// eslint-disable-next-line max-params, max-statements -- Public chunk query mirrors other structure writers.
export const villageSitesNearChunk = (
  seed: number,
  chunkX: number,
  chunkZ: number,
  sampleTerrain: VillageTerrainSampler,
): ReadonlyArray<VillageSite> => {
  const minX = chunkX * CHUNK_SIZE - VILLAGE_HALF_EXTENT
  const maxX = chunkX * CHUNK_SIZE + CHUNK_MAX_LOCAL + VILLAGE_HALF_EXTENT
  const minZ = chunkZ * CHUNK_SIZE - VILLAGE_HALF_EXTENT
  const maxZ = chunkZ * CHUNK_SIZE + CHUNK_MAX_LOCAL + VILLAGE_HALF_EXTENT
  const sites: Array<VillageSite> = []

  for (let regionX = floorDiv(minX, VILLAGE_REGION_SIZE); regionX <= floorDiv(maxX, VILLAGE_REGION_SIZE); regionX += REGION_STEP) {
    for (let regionZ = floorDiv(minZ, VILLAGE_REGION_SIZE); regionZ <= floorDiv(maxZ, VILLAGE_REGION_SIZE); regionZ += REGION_STEP) {
      const site = villageSiteForRegion(seed, regionX, regionZ, sampleTerrain)
      if (
        Option.isSome(site) &&
        site.value.x >= minX && site.value.x <= maxX &&
        site.value.z >= minZ && site.value.z <= maxZ
      ) {
        sites.push(site.value)
      }
    }
  }
  return sites
}

/**
 * The site in one region, or nothing.
 *
 * Three independent draws — one to decide whether the region has a stronghold at
 * all, two for the offset — from three channels, for the reason
 * `./seeded-random.ts` gives: a shared stream would make 「which regions have
 * one」 and 「where in the region it is」 the same fact, and every stronghold
 * would sit at the same offset inside its own region.
 *
 * The reference uses `hash3(regionX, 991, regionZ)`, `992` and `993` for the
 * same three draws (`stronghold.ts:34-39`) — distinct magic middle coordinates
 * doing the work a channel name does here.
 */
export const strongholdSiteForRegion = (
  seed: number,
  regionX: number,
  regionZ: number,
): Option.Option<StrongholdSite> => {
  const roll = latticeValue(channelSeed(seed, 'stronghold-present'), regionX, regionZ)

  if (roll >= STRONGHOLD_REGION_SPAWN_PERMILLE / 1000) {
    return Option.none()
  }

  const span = STRONGHOLD_REGION_SIZE - STRONGHOLD_SITE_MARGIN * 2
  const offsetX =
    STRONGHOLD_SITE_MARGIN + Math.floor(latticeValue(channelSeed(seed, 'stronghold-x'), regionX, regionZ) * span)
  const offsetZ =
    STRONGHOLD_SITE_MARGIN + Math.floor(latticeValue(channelSeed(seed, 'stronghold-z'), regionX, regionZ) * span)

  return Option.some({
    x: regionX * STRONGHOLD_REGION_SIZE + offsetX,
    z: regionZ * STRONGHOLD_REGION_SIZE + offsetZ,
  })
}

/**
 * The nearest stronghold to a world column.
 *
 * THE WIDENING SHELL IS THE POINT, and the reference says why in a comment worth
 * carrying over verbatim in substance (`stronghold.ts:52-56`): 「a naive
 * return-on-first-hit is NOT nearest — a site across a region border can be much
 * closer than the player's own region's site」. A player standing one block
 * inside their region's edge is 383 blocks from their own region's far side and
 * possibly 20 from the neighbour's.
 *
 * The early exit is the other half: any region at Chebyshev radius `r` is at
 * least `(r - 1)` full regions away, so once the best distance beats that bound
 * no farther shell can win. Without it this would scan all 169 regions every
 * time; with it, it usually stops at radius 2.
 *
 * `Option` rather than a nullable, matching `./portal-frame.ts` — and the
 * `none` case is reachable rather than theoretical: at 350 permille a
 * 13-by-13 block of regions is all-miss with probability about 1e-30, but a
 * caller near the edge of a small search radius can still be told 「not within
 * range」, which is a different answer from 「there are none」.
 */
export const nearestStrongholdSite = (seed: number, x: number, z: number): Option.Option<StrongholdSite> => {
  const centreRegionX = floorDiv(x, STRONGHOLD_REGION_SIZE)
  const centreRegionZ = floorDiv(z, STRONGHOLD_REGION_SIZE)

  let best: StrongholdSite | undefined = undefined
  let bestDistanceSq = Number.POSITIVE_INFINITY

  for (let radius = 0; radius <= STRONGHOLD_SEARCH_RADIUS; radius += 1) {
    const shellLowerBound = (radius - 1) * STRONGHOLD_REGION_SIZE
    if (best !== undefined && shellLowerBound > 0 && shellLowerBound * shellLowerBound > bestDistanceSq) {
      break
    }

    for (let regionX = centreRegionX - radius; regionX <= centreRegionX + radius; regionX += 1) {
      for (let regionZ = centreRegionZ - radius; regionZ <= centreRegionZ + radius; regionZ += 1) {
        // Only the newly reached shell; inner regions were scanned already.
        const ring = Math.max(Math.abs(regionX - centreRegionX), Math.abs(regionZ - centreRegionZ))
        if (radius > 0 && ring < radius) {
          continue
        }

        const site = strongholdSiteForRegion(seed, regionX, regionZ)
        if (Option.isNone(site)) {
          continue
        }

        const dx = site.value.x - x
        const dz = site.value.z - z
        const distanceSq = dx * dx + dz * dz
        if (distanceSq < bestDistanceSq) {
          best = site.value
          bestDistanceSq = distanceSq
        }
      }
    }
  }

  return best === undefined ? Option.none() : Option.some(best)
}

/**
 * Does a stronghold's footprint touch this chunk?
 *
 * The query a generator pass would start from, and the reason siting is a pure
 * coordinate function: a chunk can answer it about its neighbours' sites without
 * loading them. It is here rather than waiting for the block half because it is
 * the part that has to be right for the block half to be writable at all, and
 * because `test/structure-siting.test.ts` can check it against the room extent
 * today.
 *
 * `halfExtent` is the caller's, not this module's: the room size belongs to the
 * generator, and baking a number here would be this file claiming a decision it
 * has explicitly deferred.
 */
export const strongholdSitesNearChunk = (
  seed: number,
  chunkX: number,
  chunkZ: number,
  halfExtent: number,
): ReadonlyArray<StrongholdSite> => {
  const minX = chunkX * 16 - halfExtent
  const maxX = chunkX * 16 + 15 + halfExtent
  const minZ = chunkZ * 16 - halfExtent
  const maxZ = chunkZ * 16 + 15 + halfExtent

  const sites: Array<StrongholdSite> = []
  for (let regionX = floorDiv(minX, STRONGHOLD_REGION_SIZE); regionX <= floorDiv(maxX, STRONGHOLD_REGION_SIZE); regionX += 1) {
    for (let regionZ = floorDiv(minZ, STRONGHOLD_REGION_SIZE); regionZ <= floorDiv(maxZ, STRONGHOLD_REGION_SIZE); regionZ += 1) {
      const site = strongholdSiteForRegion(seed, regionX, regionZ)
      if (Option.isSome(site) && site.value.x >= minX && site.value.x <= maxX && site.value.z >= minZ && site.value.z <= maxZ) {
        sites.push(site.value)
      }
    }
  }

  return sites
}
