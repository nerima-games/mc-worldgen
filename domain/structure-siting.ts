/**
 * Where structures go. NOT what they are made of.
 *
 * plan.md §3.7 gives this repository 「構造物（村/ポータル/End）」 and
 * `docs/responsibility.md` widens it to 村 / End / 要塞. This file closes the
 * SITING half of the stronghold and nothing else: it decides, for any world
 * coordinate, whether a stronghold stands there and where its nearest one is.
 * It writes no blocks and names no block ids.
 *
 * ---------------------------------------------------------------------------
 * WHY A SCAFFOLD AND NOT A GENERATOR, STATED PLAINLY
 * ---------------------------------------------------------------------------
 *
 * A structure generator is two separable things — 「is there one here」 and
 * 「what is in it」 — and the reference implementation separates them cleanly:
 * `stronghold.ts:33-42` is the siting rule, `:112-174` is the block writing.
 * The siting half is a pure function of coordinates, is 40 lines, and every
 * consumer of a stronghold needs it before any of them needs a wall. The block
 * half needs a room layout, four block ids this repository does not yet name,
 * and a decision about what happens where a room intersects a cave.
 *
 * So the siting half ships and the block half does not, and the boundary is
 * chosen so that what ships is USEFUL ON ITS OWN rather than being a stub:
 * `nearestStrongholdSite` is exactly what an eye of ender needs, and it is
 * complete. What is here works; what is not here is absent rather than
 * half-present. A generator that carved an empty room would be worse than this,
 * because a world would then contain something wrong instead of nothing.
 *
 * WHAT THE BLOCK HALF STILL NEEDS, so that the next person costs it rather than
 * discovers it:
 *
 *   1. FOUR BLOCK IDS. `cobblestone` (kernel 17) is already assigned;
 *      `end_stone` (86), `end_portal_frame` and `end_portal`
 *      (`mc-kernel/domain/block-registry.ts:1804-1824`) are assigned in kernel
 *      and not adopted here. Adopting them is the same cheap move
 *      `./ore.ts` and `./vegetation.ts` made — a local table, no barrel export,
 *      no `api-lock.md` diff.
 *   2. A CROSS-CHUNK WRITE PROTOCOL. A stronghold room is 13 blocks across and a
 *      chunk is 16, so a room straddles a chunk boundary roughly half the time.
 *      The reference solves this by having each chunk compute the slice of every
 *      nearby site that falls inside it (`strongholdBlockAt`), which is the
 *      right shape and is why siting has to be a pure coordinate function — the
 *      same property `./tree-placement.ts`'s header wants and does not have for
 *      canopies (`domain/terrain.ts`'s `plantTree` clips at the border).
 *   3. AN INTERSECTION RULE. `carveCaves` runs before decoration and a room at
 *      `STRONGHOLD_FLOOR_Y = 28` sits squarely in the cave band
 *      (`CAVE_FLOOR_Y = 6` .. `CAVE_CEILING_Y = 58`). Either the room is written
 *      after carving and wins, or the carver learns to avoid it. The reference
 *      writes after, which is a decision this file does not get to make.
 *
 * ---------------------------------------------------------------------------
 * THERE IS NO VILLAGE TO PORT, AND THAT IS A FINDING RATHER THAN AN EXCUSE
 * ---------------------------------------------------------------------------
 *
 * `docs/responsibility.md` lists 村 alongside End and 要塞, and `docs/porting.md`
 * §6 lists five reference files for 構造物 — nether-generator, portal-frame,
 * stronghold, nether-fortress, end-portal-frame. NO VILLAGE FILE IS AMONG THEM,
 * and it is not an omission in that list: measured over the whole of
 * `packages/world`, the string 「village」 occurs four times and every one is a
 * comment about CROP GROWTH (`crop-growth.ts:2`,
 * `crop-growth-service.ts:20`, `block-service.config.ts:175`) plus the mob names
 * `Villager` and `ZombieVillager` in `world-metadata-model.ts:59,68`.
 *
 * The reference implementation has no village generator. So 村 is not a port
 * that has not happened — it is CONTENT THIS ORGANISATION HAS NEVER WRITTEN, and
 * building one here would be design work (house schemas, a road graph, villager
 * spawning, biome-specific palettes) rather than the transcription every other
 * row in this repository is. That is a different kind of task with a different
 * kind of risk, and `docs/responsibility.md` now says so rather than carrying a
 * ⬜ that reads as 「somebody just has not got to it」.
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

/** Euclidean floor division — correct for negative operands, as in `./kernel-vocabulary.ts`. */
const floorDiv = (value: number, divisor: number): number => Math.floor(value / divisor)

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
