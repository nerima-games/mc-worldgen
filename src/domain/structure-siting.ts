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
import { channelSeed, latticeValue } from '@nerima-games/mc-noise'
import type { BiomeType } from './biome'
import { Option } from 'effect'

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

/** A permille figure (parts per 1000) divides by this to become a probability in `[0, 1)`. */
const PERMILLE_SCALE = 1000

/** A region's margin is subtracted from both of its edges to get the free span inside it. */
const MARGIN_SIDES = 2

/** Euclidean floor division — correct for negative operands, as in `mc-kernel`. */
const floorDiv = (value: number, divisor: number): number => Math.floor(value / divisor)

/**
 * The site in one region, or nothing.
 *
 * Three independent draws — one to decide whether the region has a stronghold at
 * all, two for the offset — from three channels, because a shared stream would
 * make 「which regions have
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

  if (roll >= STRONGHOLD_REGION_SPAWN_PERMILLE / PERMILLE_SCALE) {
    return Option.none()
  }

  const span = STRONGHOLD_REGION_SIZE - STRONGHOLD_SITE_MARGIN * MARGIN_SIDES
  const offsetX =
    STRONGHOLD_SITE_MARGIN + Math.floor(latticeValue(channelSeed(seed, 'stronghold-x'), regionX, regionZ) * span)
  const offsetZ =
    STRONGHOLD_SITE_MARGIN + Math.floor(latticeValue(channelSeed(seed, 'stronghold-z'), regionX, regionZ) * span)

  return Option.some({
    x: regionX * STRONGHOLD_REGION_SIZE + offsetX,
    z: regionZ * STRONGHOLD_REGION_SIZE + offsetZ,
  })
}

/** `locateStronghold` returns this many candidates unless the caller asks for fewer or more. */
const DEFAULT_STRONGHOLD_RESULT_LIMIT = 3
/** Exponent turning a coordinate delta into its square, for a squared-distance sort key. */
const SQUARED_DISTANCE_EXPONENT = 2
/** Floor under a caller-supplied `limit`: never return fewer than this many (i.e. never negative). */
const MIN_RESULT_COUNT = 0
/** Start index for `Array.prototype.slice` when taking the first `limit` results. */
const RESULT_START_INDEX = 0

/** Returns the nearest deterministic candidates, ordered by distance then coordinate. */
export const locateStronghold = (
  seed: number,
  origin: StrongholdOrigin,
  limit = DEFAULT_STRONGHOLD_RESULT_LIMIT,
): ReadonlyArray<StrongholdSite> => {
  const regionX = floorDiv(origin.x, STRONGHOLD_REGION_SIZE)
  const regionZ = floorDiv(origin.z, STRONGHOLD_REGION_SIZE)
  const sites: StrongholdSite[] = []
  for (let dx = -STRONGHOLD_SEARCH_RADIUS; dx <= STRONGHOLD_SEARCH_RADIUS; dx++) {
    for (let dz = -STRONGHOLD_SEARCH_RADIUS; dz <= STRONGHOLD_SEARCH_RADIUS; dz++) {
      const candidate = strongholdSiteForRegion(seed, regionX + dx, regionZ + dz)
      if (Option.isSome(candidate)) {sites.push(candidate.value)}
    }
  }
  return sites
    .sort((left, right) => {
      const leftDistance = (left.x - origin.x) ** SQUARED_DISTANCE_EXPONENT + (left.z - origin.z) ** SQUARED_DISTANCE_EXPONENT
      const rightDistance = (right.x - origin.x) ** SQUARED_DISTANCE_EXPONENT + (right.z - origin.z) ** SQUARED_DISTANCE_EXPONENT
      return leftDistance - rightDistance || left.x - right.x || left.z - right.z
    })
    .slice(RESULT_START_INDEX, Math.max(MIN_RESULT_COUNT, limit))
}

export const VILLAGE_REGION_SIZE = 160
export const VILLAGE_REGION_SPAWN_PERMILLE = 120
export const VILLAGE_SITE_MARGIN = 32
export const VILLAGE_HALF_EXTENT = 30
const VILLAGE_MIN_DRY_CLEARANCE = 1
const VILLAGE_MAX_HEIGHT_VARIATION = 6
const CHUNK_SIZE = 16
const CHUNK_MAX_LOCAL = 15
const REGION_STEP = 1

export type VillageSite = {
  readonly x: number
  readonly z: number
}

export type OverworldTerrainSample = {
  readonly biome: BiomeType
  readonly surfaceY: number
  readonly seaLevel: number
}

export type OverworldTerrainSampler = (x: number, z: number) => OverworldTerrainSample

/**
 * Is every probe of a candidate village site dry, level PLAINS?
 *
 * Split out of `villageSiteForRegion` so that function's own statement count
 * stays a plain read: roll, reject, offset, probe, reject-or-accept.
 */
const isValidVillageSite = (probes: ReadonlyArray<OverworldTerrainSample>): boolean => {
  if (probes.some((probe) => probe.biome !== 'PLAINS' || probe.surfaceY <= probe.seaLevel + VILLAGE_MIN_DRY_CLEARANCE)) {
    return false
  }

  const heights = probes.map((probe) => probe.surfaceY)
  return Math.max(...heights) - Math.min(...heights) <= VILLAGE_MAX_HEIGHT_VARIATION
}

/** A sparse, seeded candidate accepted only when its complete footprint is dry, level plains. */
export const villageSiteForRegion = (
  seed: number,
  regionX: number,
  regionZ: number,
  sampleTerrain: OverworldTerrainSampler,
): Option.Option<VillageSite> => {
  const roll = latticeValue(channelSeed(seed, 'village-present'), regionX, regionZ)
  if (roll >= VILLAGE_REGION_SPAWN_PERMILLE / PERMILLE_SCALE) {
    return Option.none()
  }

  const span = VILLAGE_REGION_SIZE - VILLAGE_SITE_MARGIN * MARGIN_SIDES
  const x =
    regionX * VILLAGE_REGION_SIZE +
    VILLAGE_SITE_MARGIN +
    Math.floor(latticeValue(channelSeed(seed, 'village-x'), regionX, regionZ) * span)
  const z =
    regionZ * VILLAGE_REGION_SIZE +
    VILLAGE_SITE_MARGIN +
    Math.floor(latticeValue(channelSeed(seed, 'village-z'), regionX, regionZ) * span)
  const probes = [
    sampleTerrain(x, z),
    sampleTerrain(x - VILLAGE_HALF_EXTENT, z),
    sampleTerrain(x + VILLAGE_HALF_EXTENT, z),
    sampleTerrain(x, z - VILLAGE_HALF_EXTENT),
    sampleTerrain(x, z + VILLAGE_HALF_EXTENT),
  ]

  if (!isValidVillageSite(probes)) {
    return Option.none()
  }

  return Option.some({ x, z })
}

/** Finds all accepted village centres whose footprint can overlap this chunk. */
export const villageSitesNearChunk = (
  seed: number,
  chunkX: number,
  chunkZ: number,
  sampleTerrain: OverworldTerrainSampler,
): ReadonlyArray<VillageSite> => {
  const bounds = {
    maxX: chunkX * CHUNK_SIZE + CHUNK_MAX_LOCAL + VILLAGE_HALF_EXTENT,
    maxZ: chunkZ * CHUNK_SIZE + CHUNK_MAX_LOCAL + VILLAGE_HALF_EXTENT,
    minX: chunkX * CHUNK_SIZE - VILLAGE_HALF_EXTENT,
    minZ: chunkZ * CHUNK_SIZE - VILLAGE_HALF_EXTENT,
  }
  const sites: Array<VillageSite> = []

  for (
    let regionX = floorDiv(bounds.minX, VILLAGE_REGION_SIZE);
    regionX <= floorDiv(bounds.maxX, VILLAGE_REGION_SIZE);
    regionX += REGION_STEP
  ) {
    for (
      let regionZ = floorDiv(bounds.minZ, VILLAGE_REGION_SIZE);
      regionZ <= floorDiv(bounds.maxZ, VILLAGE_REGION_SIZE);
      regionZ += REGION_STEP
    ) {
      const site = villageSiteForRegion(seed, regionX, regionZ, sampleTerrain)
      if (
        Option.isSome(site) &&
        site.value.x >= bounds.minX && site.value.x <= bounds.maxX &&
        site.value.z >= bounds.minZ && site.value.z <= bounds.maxZ
      ) {
        sites.push(site.value)
      }
    }
  }
  return sites
}

/** Chebyshev shell radius containing only the centre region itself. */
const CENTRE_SHELL_RADIUS = 0
/** How many full regions closer than `radius` a shell's near edge is guaranteed to be. */
const SHELL_INNER_RADIUS_OFFSET = 1
/** A shell bound of exactly this is not yet meaningful (radius 0 or 1) — never used to cut the search. */
const NO_SHELL_BOUND = 0

type StrongholdSearchQuery = {
  readonly seed: number
  readonly x: number
  readonly z: number
}

type StrongholdRegionCoord = {
  readonly regionX: number
  readonly regionZ: number
}

type StrongholdSearchState = {
  readonly best: Option.Option<StrongholdSite>
  readonly bestDistanceSq: number
}

/** Considers one region as a stronghold candidate, keeping the closer of it and `state.best`. */
const considerStrongholdRegion = (
  query: StrongholdSearchQuery,
  regionX: number,
  regionZ: number,
  state: StrongholdSearchState,
): StrongholdSearchState => {
  const site = strongholdSiteForRegion(query.seed, regionX, regionZ)

  if (Option.isNone(site)) {
    return state
  }

  const dx = site.value.x - query.x
  const dz = site.value.z - query.z
  const distanceSq = dx * dx + dz * dz

  if (distanceSq >= state.bestDistanceSq) {
    return state
  }

  return { best: site, bestDistanceSq: distanceSq }
}

/**
 * Scans the newly-reached shell at Chebyshev radius `radius` around `centre`,
 * skipping the interior cells already scanned by smaller radii.
 */
const scanStrongholdShell = (
  query: StrongholdSearchQuery,
  centre: StrongholdRegionCoord,
  radius: number,
  state: StrongholdSearchState,
): StrongholdSearchState => {
  let next = state

  for (let regionX = centre.regionX - radius; regionX <= centre.regionX + radius; regionX++) {
    for (let regionZ = centre.regionZ - radius; regionZ <= centre.regionZ + radius; regionZ++) {
      const ring = Math.max(Math.abs(regionX - centre.regionX), Math.abs(regionZ - centre.regionZ))

      if (radius === CENTRE_SHELL_RADIUS || ring >= radius) {
        next = considerStrongholdRegion(query, regionX, regionZ, next)
      }
    }
  }

  return next
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
 *
 * Per-shell work is split into `considerStrongholdRegion` (does this region
 * beat the best so far?) and `scanStrongholdShell` (walk one shell), so this
 * function itself stays the five-line search loop the doc comment describes.
 */
export const nearestStrongholdSite = (seed: number, x: number, z: number): Option.Option<StrongholdSite> => {
  const query: StrongholdSearchQuery = { seed, x, z }
  const centre: StrongholdRegionCoord = {
    regionX: floorDiv(x, STRONGHOLD_REGION_SIZE),
    regionZ: floorDiv(z, STRONGHOLD_REGION_SIZE),
  }
  let state: StrongholdSearchState = { best: Option.none(), bestDistanceSq: Number.POSITIVE_INFINITY }

  for (let radius = CENTRE_SHELL_RADIUS; radius <= STRONGHOLD_SEARCH_RADIUS; radius++) {
    const shellLowerBound = (radius - SHELL_INNER_RADIUS_OFFSET) * STRONGHOLD_REGION_SIZE

    if (Option.isSome(state.best) && shellLowerBound > NO_SHELL_BOUND && shellLowerBound * shellLowerBound > state.bestDistanceSq) {
      break
    }

    state = scanStrongholdShell(query, centre, radius, state)
  }

  return state.best
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
  const bounds = {
    maxX: chunkX * CHUNK_SIZE + CHUNK_MAX_LOCAL + halfExtent,
    maxZ: chunkZ * CHUNK_SIZE + CHUNK_MAX_LOCAL + halfExtent,
    minX: chunkX * CHUNK_SIZE - halfExtent,
    minZ: chunkZ * CHUNK_SIZE - halfExtent,
  }

  const sites: Array<StrongholdSite> = []
  for (
    let regionX = floorDiv(bounds.minX, STRONGHOLD_REGION_SIZE);
    regionX <= floorDiv(bounds.maxX, STRONGHOLD_REGION_SIZE);
    regionX++
  ) {
    for (
      let regionZ = floorDiv(bounds.minZ, STRONGHOLD_REGION_SIZE);
      regionZ <= floorDiv(bounds.maxZ, STRONGHOLD_REGION_SIZE);
      regionZ++
    ) {
      const site = strongholdSiteForRegion(seed, regionX, regionZ)
      if (
        Option.isSome(site) &&
        site.value.x >= bounds.minX && site.value.x <= bounds.maxX &&
        site.value.z >= bounds.minZ && site.value.z <= bounds.maxZ
      ) {
        sites.push(site.value)
      }
    }
  }

  return sites
}
