/**
 * Ground cover: grass, ferns and flowers.
 *
 * plan.md §3.7 gives this repository 植生, and `./tree-placement.ts` closed the
 * tree half of it. This file is the other half — the single-block plants that
 * stand on the surface — ported from the reference implementation's
 * `packages/world/domain/terrain/plant-placement-{model,rules,ops}.ts`.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT SHAPED LIKE THE TREE PLACER
 * ---------------------------------------------------------------------------
 *
 * `./tree-placement.ts` spends its entire header on a jittered grid, because a
 * tree has a RADIUS: two crowns 5 columns apart fuse into one walkable leaf
 * slab, so the placement rule has to bound the spacing between candidates before
 * anything else runs.
 *
 * A ground plant occupies exactly one column and exactly one cell of it. Two
 * adjacent flowers are two adjacent flowers; there is nothing to fuse. So the
 * reference uses a plain per-column Bernoulli trial here
 * (`plant-placement-rules.ts:44-56`) and that is the correct shape — the whole
 * argument for the grid is an argument about crowns, and importing it would be
 * importing a mechanism whose justification does not hold.
 *
 * The consequence worth stating, since the tree header makes so much of the
 * opposite case: ground cover DOES clump, and that is wanted. A meadow is a
 * patchy thing.
 *
 * ---------------------------------------------------------------------------
 * THE SEED, WHICH IS THE ONE DELIBERATE DIVERGENCE FROM THE REFERENCE
 * ---------------------------------------------------------------------------
 *
 * The reference's `plantRng` (`plant-placement-rules.ts:58-59`) is
 *
 *     fract(sin(wx * 12.9898 + wz * 78.233 + salt * 37.719) * 43758.5453)
 *
 * and takes NO WORLD SEED. Neither does its ore stream (`math.ts:20`,
 * `seedFromChunk`), and neither does its stronghold siting (`stronghold.ts:8-9`
 * says so outright: 「sites are derived purely from world coordinates via a
 * seedless hash」).
 *
 * For trees that is nearly harmless in this repository, and it was checked
 * rather than assumed: `treeCellCandidate` is seedless too, but the gates around
 * it are not, so chunk (5, -12) carries 3 trunks at seed 20260726, 1 at seed 4242
 * and 0 at seed 1. The lattice is shared; the trees are not.
 *
 * Ground cover does not get that protection, and the reason is the density. At
 * `PLAINS: 0.22` the placement roll passes for 22% of ALL columns whatever the
 * seed, so two worlds would carry the same flower pattern at the same absolute
 * coordinates wherever both happened to grow grass there. That is a visible
 * artefact rather than a theoretical one.
 *
 * So the roll is drawn from `./seeded-random`'s `channelSeed` + `latticeValue`
 * instead. This costs nothing, it is what the repository already requires of
 * every other generated value, and it removes the reference's two magic scale
 * constants along with it — `channelSeed` is keyed by a STRING precisely so that
 * 「adding a channel does not require inventing and documenting another magic
 * number」 (`./seeded-random`), which is also why the reference's
 * `GROUND_PLANT_PLACEMENT_SALT = 59` and `GROUND_PLANT_VARIANT_SALT = 61`
 * (`plant-placement-model.ts:30-31`) are not transcribed: their whole job is to
 * decorrelate two streams, and a channel name does that job by construction.
 *
 * `latticeValue` and not `valueNoise2D`: the placement test wants an INDEPENDENT
 * per-column draw, and `valueNoise2D` is a smoothly interpolated field. Sampling
 * a smooth field per column would make the plants appear in blobs whose size is
 * set by the noise frequency rather than by the density.
 *
 * ---------------------------------------------------------------------------
 * TWO TRANSCRIBED DENSITIES ARE UNREACHABLE HERE, AND ARE KEPT ANYWAY
 * ---------------------------------------------------------------------------
 *
 * The support rule wants GRASS or DIRT under the plant
 * (`plant-placement-rules.ts:184-195`). In `./biome.ts`'s `BIOME_SURFACES` only
 * SAVANNA, PLAINS, FOREST and TAIGA have a GRASS top; BEACH and DESERT are SAND
 * and SNOW is SNOW. So the reference's `BEACH: 0.02` row cannot place anything
 * in this repository no matter what the roll says, and DESERT and SNOW are zero
 * on both sides.
 *
 * The row is transcribed rather than dropped because the two facts are
 * independent and should stay that way: a future surface table that gives BEACH
 * a dirt patch should get the reference's density for free, and dropping the row
 * now would silently make that a decision nobody remembers to take.
 * `test/vegetation.test.ts` pins the unreachability as a MEASUREMENT, so if the
 * surface table changes the test says so instead of the row quietly waking up.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS NOT HERE
 * ---------------------------------------------------------------------------
 *
 * The reference's plant module also places sugar cane, cactus, lily pads,
 * mushrooms, kelp and seagrass. None is here, and the reason is the same for
 * all six: every one of them is gated on a biome this repository's roster does
 * not have (SWAMP, JUNGLE, RIVER, FLOWER_FOREST), or on a support this
 * repository does not generate, or — for kelp and seagrass — needs the aquatic
 * column rules that `docs/porting.md` §5 has not claimed yet. Adding a cactus
 * generator whose only customer is a DESERT surface would be one more thing to
 * keep honest for no visible gain. `docs/porting.md` records them as owed.
 */
import { BEDROCK_Y, CHUNK_HEIGHT, blockIndex } from './constants'
import { BIOME_SURFACES, BLOCK, type BiomeType } from './biome'
import { channelSeed, latticeValue } from './seeded-random'
import { BlockId } from '@nerima-games/mc-kernel'
import { readBlock } from './chunk'

/**
 * The plant ids, transcribed from `mc-kernel/domain/block-registry.ts`.
 *
 * These are kernel's assignments and this repository is adopting them — the
 * same direction as `BLOCK.OBSIDIAN` and the opposite of the eleven terrain ids
 * kernel took from here. `test/kernel-mirror.test.ts` pins all four in both
 * directions with the rest.
 *
 * They live here rather than in `./biome.ts`'s `BLOCK` for a reason that is
 * worth stating plainly, because it is a cost and not a tidiness: `BLOCK` is
 * re-exported by `index.ts` and therefore appears in `api-lock.md`, and
 * `api-lock.md`'s four-week clock (plan.md §6 Step 3) is this project's critical
 * path. Adding four keys to `BLOCK` would restart it. Nothing in this file is
 * re-exported from the barrel, so it costs nothing.
 *
 * Every one of the four is `opacity: 'transparentSolid'` in kernel, which
 * `mc-kernel` already transcribes (ids 21, 22, 25, 26) — so
 * `./light.ts` treats them as light-transmitting the day they appear in a chunk,
 * with no further change. A flower does not cast a shadow.
 */
/** `block-registry.ts:869-871`. */
const DANDELION_KERNEL_ID = 21
/** `block-registry.ts:969-971`. */
const FERN_KERNEL_ID = 26
/** `block-registry.ts:889-891`. */
const POPPY_KERNEL_ID = 22
/** `block-registry.ts:949-951`. */
const TALL_GRASS_KERNEL_ID = 25

export const PLANT = {
  DANDELION: BlockId(DANDELION_KERNEL_ID),
  FERN: BlockId(FERN_KERNEL_ID),
  POPPY: BlockId(POPPY_KERNEL_ID),
  TALL_GRASS: BlockId(TALL_GRASS_KERNEL_ID),
} as const

/** Every id this module can write. Used by the goldens and by `test/vegetation.test.ts`. */
export const PLANT_IDS: ReadonlyArray<number> = Object.values(PLANT)

/**
 * Per-column probability that a ground plant is attempted.
 *
 * Transcribed from `GROUND_PLANT_DENSITY_BY_BIOME`
 * (`plant-placement-model.ts:66-75`). The reference's table is a
 * `Partial<Record<...>>` whose absent rows read as 0; this repository writes
 * those zeroes explicitly because its table is total.
 *
 * OCEAN, DESERT and SNOW are absent there and therefore zero here. The zeroes
 * are written out rather than left to a `?? 0` because this repository uses a
 * TOTAL `Record`, and a total table is the thing that makes 「which biome grows
 * nothing」 answerable by reading rather than by tracing — the same argument
 * `./biome.ts` makes for its rule table.
 */
export const GROUND_PLANT_DENSITY: Record<BiomeType, number> = {
  BEACH: 0.02,
  DESERT: 0,
  FLOWER_FOREST: 0.42,
  FOREST: 0.14,
  JUNGLE: 0.18,
  MOUNTAINS: 0,
  OCEAN: 0,
  PLAINS: 0.22,
  RIVER: 0,
  SAVANNA: 0.08,
  SNOW: 0,
  SWAMP: 0.1,
  TAIGA: 0.12,
}

/** The two decorrelated draws. Strings rather than numeric salts — see the header. */
const PLACEMENT_CHANNEL = 'ground-plant-placement'
const VARIANT_CHANNEL = 'ground-plant-variant'

/**
 * A deterministic, seeded, independent draw in [0, 1) for one world column.
 *
 * Exported because `test/vegetation.test.ts` measures its distribution directly:
 * a placement rule whose density parameter does not match the realised frequency
 * is the defect this repository has on record twice, and the cheapest way to see
 * it is to look at the draw rather than at the terrain.
 */
export const plantRoll = (seed: number, wx: number, wz: number, channel: string): number =>
  latticeValue(channelSeed(seed, channel), wx, wz)

/**
 * Does the density roll pass for this column?
 *
 * The height guard is the reference's (`plant-placement-rules.ts:52`): a surface
 * at 0 or at the top of the world has nowhere to put the plant, and rejecting it
 * here keeps `canPlaceGroundPlantAt` from having to reason about the buffer edge.
 */
/** Density below which a biome grows no ground plants at all. */
const NO_GROUND_PLANT_DENSITY = 0

/** Offset converting `CHUNK_HEIGHT` (a count) into the topmost valid Y index. */
const TOP_Y_INDEX_OFFSET = 1

export const shouldPlaceGroundPlant = (input: {
  readonly seed: number
  readonly worldX: number
  readonly worldZ: number
  readonly biome: BiomeType
  readonly surfaceY: number
}): boolean => {
  const density = GROUND_PLANT_DENSITY[input.biome]

  if (
    density <= NO_GROUND_PLANT_DENSITY ||
    input.surfaceY <= BEDROCK_Y ||
    input.surfaceY >= CHUNK_HEIGHT - TOP_Y_INDEX_OFFSET
  ) {
    return false
  }

  return plantRoll(input.seed, input.worldX, input.worldZ, PLACEMENT_CHANNEL) < density
}

/** One cumulative-probability boundary: below `threshold`, `plant` grows. */
type VariantThreshold = readonly [threshold: number, plant: BlockId]

const TAIGA_FERN_THRESHOLD = 0.65
const JUNGLE_FERN_THRESHOLD = 0.55
const FOREST_DANDELION_THRESHOLD = 0.12
const FOREST_POPPY_THRESHOLD = 0.2
const FOREST_FERN_THRESHOLD = 0.55
const FLOWER_FOREST_DANDELION_THRESHOLD = 0.4
const FLOWER_FOREST_POPPY_THRESHOLD = 0.75
const SWAMP_FERN_THRESHOLD = 0.4
const PLAINS_SAVANNA_DANDELION_THRESHOLD = 0.12
const PLAINS_SAVANNA_POPPY_THRESHOLD = 0.22

/** PLAINS and SAVANNA share one table — the reference tests both with one branch. */
const PLAINS_SAVANNA_VARIANT_TABLE: ReadonlyArray<VariantThreshold> = [
  [PLAINS_SAVANNA_DANDELION_THRESHOLD, PLANT.DANDELION],
  [PLAINS_SAVANNA_POPPY_THRESHOLD, PLANT.POPPY],
]

/**
 * Cumulative first-match-wins thresholds per biome, transcribed from
 * `selectGroundPlantBlockIndex` (`plant-placement-rules.ts:99-121`).
 *
 * The ordering is first-match-wins on one draw, which is what makes the
 * proportions add up: FOREST is 12% dandelion, 8% poppy, 35% fern and 45% tall
 * grass, and the cumulative form is how the reference states it. A biome
 * absent here (or whose table is exhausted without a match) falls through to
 * `PLANT.TALL_GRASS` in `groundPlantAt`.
 */
const GROUND_PLANT_VARIANT_TABLE: Partial<Record<BiomeType, ReadonlyArray<VariantThreshold>>> = {
  FLOWER_FOREST: [
    [FLOWER_FOREST_DANDELION_THRESHOLD, PLANT.DANDELION],
    [FLOWER_FOREST_POPPY_THRESHOLD, PLANT.POPPY],
  ],
  FOREST: [
    [FOREST_DANDELION_THRESHOLD, PLANT.DANDELION],
    [FOREST_POPPY_THRESHOLD, PLANT.POPPY],
    [FOREST_FERN_THRESHOLD, PLANT.FERN],
  ],
  JUNGLE: [[JUNGLE_FERN_THRESHOLD, PLANT.FERN]],
  PLAINS: PLAINS_SAVANNA_VARIANT_TABLE,
  SAVANNA: PLAINS_SAVANNA_VARIANT_TABLE,
  SWAMP: [[SWAMP_FERN_THRESHOLD, PLANT.FERN]],
  TAIGA: [[TAIGA_FERN_THRESHOLD, PLANT.FERN]],
}

/** Which plant grows here. See `GROUND_PLANT_VARIANT_TABLE` for the thresholds. */
export const groundPlantAt = (seed: number, wx: number, wz: number, biome: BiomeType): BlockId => {
  const variant = plantRoll(seed, wx, wz, VARIANT_CHANNEL)
  const table = GROUND_PLANT_VARIANT_TABLE[biome] ?? []

  for (const [threshold, plant] of table) {
    if (variant < threshold) {
      return plant
    }
  }

  return PLANT.TALL_GRASS
}

/**
 * Is there somewhere to put it?
 *
 * Transcribed from `canPlaceGroundPlantAt` (`plant-placement-rules.ts:184-195`):
 * a soil block below and air above. The air test is what keeps a plant from
 * replacing a tree trunk, from displacing water on a submerged column, and from
 * being written twice into the same cell.
 *
 * It reads the BUFFER rather than the surface height, which matters because the
 * carver runs before decoration: a column whose top block was carved out from
 * underneath is no longer soil, and asking the buffer is how that is noticed.
 */
/** Vertical offset from a surface cell to the cell directly above it. */
const ABOVE_SURFACE_OFFSET = 1

export const canPlaceGroundPlantAt = (blocks: Uint8Array, lx: number, surfaceY: number, lz: number): boolean => {
  const support = readBlock(blocks, blockIndex(lx, surfaceY, lz))

  return (
    (support === BLOCK.GRASS || support === BLOCK.DIRT) &&
    readBlock(blocks, blockIndex(lx, surfaceY + ABOVE_SURFACE_OFFSET, lz)) === BLOCK.AIR
  )
}

/**
 * Whether this repository's surface table can ever satisfy the support rule for
 * a biome. Derived, never asserted about — `test/vegetation.test.ts` checks it
 * against the realised block counts, so the two cannot drift.
 */
export const biomeCanGrowGroundPlants = (biome: BiomeType): boolean => {
  const { top } = BIOME_SURFACES[biome]
  return GROUND_PLANT_DENSITY[biome] > NO_GROUND_PLANT_DENSITY && (top === BLOCK.GRASS || top === BLOCK.DIRT)
}

/**
 * Place one plant. One block, at `surfaceY + 1`.
 *
 * `placeGroundPlant`, `plant-placement-ops.ts:82-89`. The single-cell height is
 * the reference's for these four ids; `MAX_NATURAL_PLANT_HEIGHT = 3`
 * (`plant-placement-model.ts:41`) applies to sugar cane and cactus, which are
 * stacks and are not ported — see the header.
 */
export const plantGroundCover = (
  blocks: Uint8Array,
  column: { readonly lx: number; readonly surfaceY: number; readonly lz: number },
  plant: BlockId,
): void => {
  blocks[blockIndex(column.lx, column.surfaceY + ABOVE_SURFACE_OFFSET, column.lz)] = plant
}
