/**
 * Ravines — the other half of plan.md §3.7's 「カーバー（洞窟/渓谷）」.
 *
 * Ported from `packages/world/domain/terrain/ravine-carver.ts` (68 lines). The
 * cave half is `./carver.ts`; this file deliberately does not extend it, because
 * the two carvers share no mechanism. A cave is a 3D density field thresholded
 * into a blob; a ravine is a NOISE BAND — a thin interval around one value of a
 * low-frequency 2D field, which traces a long connected curve across the world
 * because a level set of a continuous field is a curve. That is the same trick
 * the reference's rivers use (`biome-classifier.config.ts:28-34`), and it is why
 * a ravine is a canyon rather than a cave.
 *
 * ---------------------------------------------------------------------------
 * NOT IN `../index.ts`, AND THAT IS THE POINT
 * ---------------------------------------------------------------------------
 *
 * `./ore.ts`, `./vegetation.ts` and `./structure-siting.ts` are not re-exported
 * from the barrel and neither is this file. `api-lock.md`'s four-week clock is
 * plan.md §6 Step 3's publish gate and this repository's critical path; a new
 * export restarts it. A ravine carver has exactly one caller — `./terrain.ts`'s
 * `generateChunk` — so it needs no public surface at all, and `pnpm api:check`
 * reports the same 156 entries after this file as before it.
 *
 * The same reasoning is why `RavineOptions` lives here rather than as a field on
 * `GenerateOptions`: that type IS in `api-lock.md`. The test affordances below
 * are reached by importing this module directly, exactly as `test/ore.test.ts`
 * imports `./ore.ts`.
 *
 * ---------------------------------------------------------------------------
 * THE GUARD, WHICH IS WHY THIS FILE MATTERS MORE THAN ITS SIZE SUGGESTS
 * ---------------------------------------------------------------------------
 *
 * `../docs/design-notes.md` DN-2 says the ravine carver's fix is 「こちらが本質
 * 的に重要」 and the reference's comment records the whole history in five lines
 * (`ravine-carver.ts:41-46`):
 *
 *     // Water bodies keep their beds — vanilla surface ravines don't slice rivers open.
 *     if (state.biome === 'OCEAN' || state.biome === 'RIVER') continue
 *     // Same rule for ANY submerged column (lakes, flooded basins): the biome check
 *     // alone let ravines carve lake beds from under their water, leaving a floating
 *     // water sheet over a dark shaft ("hollow lake" black-void bug).
 *     if (blocks[...surfaceY + 1...] === waterBlockIndex) continue
 *
 * The first line was the original attempt and it was WRONG: a lake in a PLAINS
 * basin is submerged and is neither OCEAN nor RIVER. `../docs/porting.md:235`
 * instructs that both layers be carried across together, and both are below.
 *
 * `RavineOptions.waterGuard` exists so the bug can be REPRODUCED, which is the
 * `test/carver.test.ts` rule: a regression test that cannot show the regression
 * only asserts that today's code equals today's code. `'biome'` runs the
 * reference's first attempt and `'none'` runs neither layer.
 *
 * ---------------------------------------------------------------------------
 * THE CONSTANTS, ONE BY ONE, WITH WHAT EACH ONE IS BACKED BY
 * ---------------------------------------------------------------------------
 *
 * Eight instances of a figure justified by the wrong measurement are on record
 * in this organisation and the canonical one is in this repository —
 * `./terrain.ts`'s `CONTINENTALNESS_CONTRAST` was sampled over four terrain
 * features and left a fifth of the world clamped flat. So every row below says
 * which of three things it is: TRANSCRIBED AND VERIFIED here, TRANSCRIBED
 * UNVERIFIED, or RE-DERIVED because the reference's justification does not
 * survive the port.
 *
 *   RAVINE_NOISE_SCALE 0.004    transcribed, `ravine-carver.ts:10`. A frequency,
 *                               i.e. a wavelength of 250 blocks, which is a
 *                               length in blocks and means the same thing in
 *                               both repositories. Verified only in the weak
 *                               sense that the band it produces is a connected
 *                               curve rather than speckle — see the survey.
 *
 *   RAVINE_CENTER 0.5           transcribed, `:12`. The midpoint of a field
 *                               normalised to [0, 1] on both sides.
 *
 *   RAVINE_HALF_WIDTH 0.006     TRANSCRIBED AND VERIFIED, and this is the row
 *                               that had to be checked rather than copied. The
 *                               reference's own comment (`:13-14`) says the
 *                               number is calibrated to ITS noise: 「Single-octave
 *                               noise clusters near 0.5 (see the river-width
 *                               lesson), so this narrow band still yields ~2% of
 *                               columns」. The river-width lesson it points at is
 *                               the same error in its most explicit form —
 *                               `biome-classifier.config.ts:32-33`: 「the old
 *                               0.055 band classified ~16% of the world as RIVER
 *                               (vanilla ~3-6%)」. A band width is a statement
 *                               about a DISTRIBUTION, so it does not survive a
 *                               change of noise, and `./seeded-random.ts`'s
 *                               `valueNoise2D` is smoothed value noise rather
 *                               than the reference's Perlin.
 *
 *                               So it was measured here before being kept.
 *                               Method: the SURVEY scan, every 16th block over
 *                               8192 x 8192 blocks, 262,144 columns, ~33
 *                               ravine-field wavelengths across; seeds 20260726,
 *                               1, 4242, 999983 and 77777.
 *
 *                                   raw field   p5 0.137  p50 0.498  p95 0.862
 *
 *                                   half-width   columns inside the band
 *                                   0.006            1.7 - 2.0%   <- kept
 *                                   0.010            2.8 - 3.3%
 *                                   0.020            5.6 - 6.5%
 *
 *                               1.7-2.0% against the reference's stated intent
 *                               of ~2%. The number transcribes because this
 *                               field happens to be peaked near 0.5 to about the
 *                               same degree, NOT because a band width is
 *                               portable. `pnpm preview --stats` prints this
 *                               fraction, so the next person to reach for the
 *                               constant moves a number that is measured on
 *                               every run rather than one that is recalled.
 *
 *   RAVINE_MAX_DEPTH 28         transcribed, `:16`. Blocks, in a 256-tall world
 *                               with `SEA_LEVEL` 63 on both sides, so the units
 *                               and the frame of reference both carry over.
 *                               TRANSCRIBED UNVERIFIED as an aesthetic: nothing
 *                               here establishes that 28 is the right depth, only
 *                               that it is the reference's and that it is
 *                               reachable — see `ravineFloorY` below.
 *
 *   RAVINE_MIN_DEPTH 3          transcribed from the literal in
 *                               `:51` (`if (depth < 3) continue`). Named rather
 *                               than inlined because it is what stops the band's
 *                               outer 4.6% from writing one- and two-block
 *                               scratches into the surface.
 *
 *   RAVINE_FLOOR_Y 6            transcribed from the literal in `:53`
 *                               (`Math.max(6, ...)`). It is one above the
 *                               reference's `CAVE_FLOOR = BEDROCK_LAYER_TOP + 1`
 *                               = 5 (`terrain/constants.ts:45`), and this
 *                               repository's cave floor is `CAVE_FLOOR_Y` = 6
 *                               (`./carver.ts`), so the two agree by arithmetic
 *                               accident rather than by derivation. Kept at 6,
 *                               written as its own constant, because it is a
 *                               ravine's floor and not a cave's.
 *
 * TWO OF THE REFERENCE'S CONSTANTS ARE DELIBERATELY ABSENT.
 *
 *   RAVINE_WORLD_OFFSET 40_000 (`:11`) is not here. Its job is to decorrelate
 *   the ravine field from the river field, which the reference has to do by
 *   translating the sample point because its noise service is seeded once
 *   globally (`RIVER_WORLD_OFFSET` is 20_000 for the same reason). This
 *   repository decorrelates by CHANNEL — `channelSeed(seed, 'ravines')` — and
 *   `./seeded-random.ts` says why that shape was chosen: 「adding a channel does
 *   not require inventing and documenting another magic number」.
 *   `./vegetation.ts` dropped the reference's two placement salts on exactly
 *   this argument. Carrying the offset as well would be carrying a second
 *   decorrelator for a correlation that no longer exists.
 *
 *   RAVINE_LAVA_BED_BELOW_Y 16 (`:17`) is not here, and this one is a
 *   REACHABILITY finding rather than a preference. The reference floods the
 *   ravine floor with lava when `floorY <= 16`, and 16 is its
 *   `DEEPSLATE_CEILING` (`terrain/constants.ts:17`) — the rule is "a cut deep
 *   enough to reach the deepslate reaches the lava table".
 *
 *   IN THIS REPOSITORY THAT BRANCH CAN NEVER RUN, and it is arithmetic rather
 *   than measurement. The water guard refuses every column whose `surfaceY + 1`
 *   holds water, and `./terrain.ts` fills water from `surfaceY + 1` up to
 *   `seaLevel`, so a carved column has `surfaceY >= seaLevel` = 63. `floorY` is
 *   at least `surfaceY - RAVINE_MAX_DEPTH` = 35, which is never <= 16. Adding
 *   the branch would have meant adding a LAVA id, a `test/kernel-mirror.test.ts`
 *   row and a `BLOCK_NAMES` row for a code path with no reachable input — the
 *   exact shape of the COAL `peakY = 96` error `./ore.ts` records, where a
 *   transcribed band sat above a ceiling the terrain could not reach.
 *
 *   Kernel already assigns lava id 11 and `@nerima-games/mc-kernel` already
 *   mirrors it in both tables (`'fluid'`, emission 15), so the day this
 *   repository grows a deepslate stratum the branch costs one constant and no
 *   new mirror work. `../docs/porting.md` records it as owed.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS PASS LEAVES STANDING IN MID-AIR, AND WHICH HALF IS FIXED
 * ---------------------------------------------------------------------------
 *
 * `./terrain.ts` runs this pass AFTER decoration, which is the reference's
 * ordering and its stated reason (`generator.ts:141-142`: ravine walls should
 * 「cut cleanly through ores and surface cover」). The cost of that ordering is
 * that decoration has already put things ON TOP of columns this pass is about
 * to remove the ground from. The carve itself starts at `surfaceY` and works
 * down, so everything above `surfaceY` survives with nothing beneath it.
 *
 * That is the `../docs/design-notes.md` DN-2 artefact in a second costume: a
 * thing resting on nothing. The reference has it too. It is split here, and the
 * split is by whether fixing it needs a MECHANISM:
 *
 *   GROUND COVER — FIXED. A plant is one block in one column with no coupling
 *   to its neighbours, so the flower standing at `surfaceY + 1` over a fresh
 *   canyon is removed by reading one cell and writing AIR. `clearGroundCover`
 *   below, `test/ravine.test.ts` R-7.
 *
 *   TREES — RECORDED, NOT FIXED, and the reason is that both available fixes are
 *   new mechanisms rather than three lines. `./terrain.ts`'s `plantTree` writes a
 *   crown across a 5 x 5 footprint and keeps no record of which cells it owned,
 *   so removing one trunk means either mirroring that geometry here (a second
 *   copy of a shape, which is what `TREE_CROWN_RADIUS` exists to stop) or gating
 *   `shouldPlaceTree` on the ravine field (a placement rule, which moves the
 *   pass order this file just argued for). Choosing between them is a design
 *   call and not a port. Measured cost of leaving it, taken in the WORST place
 *   — the 7 x 7 chunks around the densest ravine region within 40 chunks of the
 *   origin: 14 of 580 LOG cells stand on air, 2.4%, about 3 trees of 116. The
 *   same window at the origin, which no ravine reaches, has none.
 *   `test/ravine.test.ts` R-8 pins that so it cannot grow silently, and
 *   `../docs/design-notes.md` DN-8 carries the owed row.
 */
import { BLOCK, type BiomeType } from './biome'
import { columnIndex, readBlock, worldX, worldZ } from './chunk'
import { blockIndex, CHUNK_HEIGHT, CHUNK_SIZE_XZ } from './constants'
import type { ChunkCoord } from "@nerima-games/mc-kernel"
import { channelSeed, valueNoise2D } from './seeded-random'
import { PLANT_IDS } from './vegetation'

/** Frequency of the ravine field. `ravine-carver.ts:10`; a 250-block wavelength. */
export const RAVINE_NOISE_SCALE = 0.004

/** The field value the band is centred on. `ravine-carver.ts:12`. */
export const RAVINE_CENTER = 0.5

/**
 * Half-width of the band, in field units. `ravine-carver.ts:15`.
 *
 * Transcribed AND re-measured — a band width describes a distribution, and this
 * repository's field is not the reference's. See the module header for the
 * survey; it selects 1.7-2.0% of columns here against the reference's ~2%.
 */
export const RAVINE_HALF_WIDTH = 0.006

/** Depth at the exact centre of the band. `ravine-carver.ts:16`. */
export const RAVINE_MAX_DEPTH = 28

/** Below this the cut is a scratch and is skipped. `ravine-carver.ts:51`. */
export const RAVINE_MIN_DEPTH = 3

/** No ravine floor is ever below this. `ravine-carver.ts:53`. */
export const RAVINE_FLOOR_Y = 6

/**
 * Which layers of the water guard run.
 *
 * `'both'` is the shipped behaviour and the only one `generateChunk` uses.
 * `'biome'` reproduces the reference's first attempt — the version that carved
 * lake beds out from under PLAINS lakes — and `'none'` removes the guard
 * entirely. Both exist so `test/ravine.test.ts` can show the bug rather than
 * assert its absence, which is the `./carver.ts` `waterFloorMargin: 0` rule.
 */
export type RavineWaterGuard = 'both' | 'biome' | 'none'

export type RavineOptions = {
  readonly waterGuard?: RavineWaterGuard
}

/**
 * Distance from the band centre for a world column, in field units.
 *
 * Position-absolute like every other field in this repository, which is what
 * makes a ravine cross a chunk border as one canyon rather than as two
 * unrelated trenches: neighbouring chunks sampling the same world column get
 * the same value (`./seeded-random.ts`, `latticeValue`).
 *
 * Exported because it is the cheapest possible question about a ravine and the
 * preview asks it per column, the same way it asks `shouldPlaceTree` — it must
 * not have to generate a 64 KB chunk to colour one pixel.
 */
export const ravineDistanceAt = (seed: number, wx: number, wz: number): number =>
  Math.abs(valueNoise2D(channelSeed(seed, 'ravines'), wx, wz, RAVINE_NOISE_SCALE) - RAVINE_CENTER)

/**
 * Depth of the cut at a band distance, or 0 where nothing is carved.
 *
 * The taper is `ravine-carver.ts:49`: `1 - (distance / halfWidth) ** 2`. Full
 * depth at the centre, quadratic falloff to the edges, which is what gives the
 * canyon sloping walls instead of vertical sides — and the reason the returned
 * depth is the WALL profile rather than a constant.
 *
 * Note where `RAVINE_MIN_DEPTH` bites: `round(28 * taper) < 3` needs
 * `taper < 0.0893`, i.e. `distance > 0.954 * RAVINE_HALF_WIDTH`. So the rule
 * discards the outer 4.6% of the band and no more; it trims the feather edge
 * and does not narrow the canyon.
 */
export const ravineDepthAt = (distance: number): number => {
  if (distance >= RAVINE_HALF_WIDTH) {
    return 0
  }

  const taper = 1 - (distance / RAVINE_HALF_WIDTH) ** 2
  const depth = Math.round(RAVINE_MAX_DEPTH * taper)

  return depth < RAVINE_MIN_DEPTH ? 0 : depth
}

/** Floor of the cut for a column, clamped to `RAVINE_FLOOR_Y`. `ravine-carver.ts:53`. */
export const ravineFloorY = (surfaceY: number, depth: number): number =>
  Math.max(RAVINE_FLOOR_Y, surfaceY - depth)

/**
 * Is this column protected from carving, and by which layer?
 *
 * Returns the layer that refused it, so the tests can assert WHICH one bites on
 * a given column rather than only that something did. That distinction is the
 * whole of DN-2: on a submerged PLAINS column the biome layer passes and the
 * block layer refuses, and a port that carried only the first would look
 * correct on every ocean and fail on every lake.
 */
export const ravineWaterGuardLayer = (
  blocks: Uint8Array,
  lx: number,
  surfaceY: number,
  lz: number,
  biome: BiomeType,
  guard: RavineWaterGuard,
): 'biome' | 'blocks' | null => {
  if (guard === 'none') {
    return null
  }

  // Layer 1, `ravine-carver.ts:42`. The reference also names RIVER; this
  // repository's `./biome.ts` roster has no RIVER, so OCEAN is the whole of it.
  if (biome === 'OCEAN') {
    return 'biome'
  }

  if (guard === 'biome') {
    return null
  }

  // Layer 2, `ravine-carver.ts:46`, and the one that is actually load-bearing.
  // A lake in a PLAINS basin is submerged and is not an OCEAN, so only a probe
  // of the real blocks can see it.
  const above = surfaceY + 1
  if (above < CHUNK_HEIGHT && readBlock(blocks, blockIndex(lx, above, lz)) === BLOCK.WATER) {
    return 'blocks'
  }

  return null
}

/**
 * Remove the single-block plant standing on a column whose ground has just gone.
 *
 * Returns whether anything was cleared. Scoped to `PLANT_IDS` on purpose: those
 * are the ids `./vegetation.ts` writes one per column with no dependency on a
 * neighbour, so this is exact. Logs and leaves are NOT in the set — see the
 * module header on why a trunk cannot be removed without a mechanism.
 */
export const clearGroundCover = (blocks: Uint8Array, lx: number, surfaceY: number, lz: number): boolean => {
  const above = surfaceY + 1
  if (above >= CHUNK_HEIGHT) {
    return false
  }

  const index = blockIndex(lx, above, lz)
  if (!PLANT_IDS.includes(readBlock(blocks, index))) {
    return false
  }

  blocks[index] = BLOCK.AIR
  return true
}

/**
 * Carve ravines into `blocks`, in place. Returns the number of columns carved.
 *
 * Mutating rather than returning a new buffer, for the reason `./carver.ts`
 * gives: a chunk buffer is 64 KB and the pipeline makes several passes over it.
 * The buffer belongs to `generateChunk` and has not been shared yet.
 *
 * `surfaces` and `biomes` are the arrays `generateChunk` already built during
 * its column loop, in `columnIndex` order. They are passed rather than
 * recomputed because the buffer can no longer answer either question: by the
 * time this pass runs the surface has trees standing on it and caves cut
 * through it. The reference passes its `columnStates` for the same reason
 * (`ravine-carver.ts:25`).
 *
 * The count comes back for the same reason the reference returns one
 * (`:31`, `:64`): a carver that silently stops carving is indistinguishable
 * from a world with no ravines in it, and the preview and the tests both need
 * to be able to tell those apart.
 */
export const carveRavines = (
  blocks: Uint8Array,
  seed: number,
  coord: ChunkCoord,
  surfaces: Int16Array,
  biomes: ReadonlyArray<BiomeType>,
  options: RavineOptions = {},
): number => {
  const guard = options.waterGuard ?? 'both'
  let carvedColumns = 0

  for (let lx = 0; lx < CHUNK_SIZE_XZ; lx += 1) {
    for (let lz = 0; lz < CHUNK_SIZE_XZ; lz += 1) {
      const column = columnIndex(lx, lz)
      const distance = ravineDistanceAt(seed, worldX(coord, lx), worldZ(coord, lz))
      const depth = ravineDepthAt(distance)

      if (depth === 0) {
        continue
      }

      const surfaceY = surfaces[column] ?? 0
      const biome = biomes[column] ?? 'PLAINS'

      // ────────────────────────────────────────────────────────────────
      // THE GUARD. Both layers, per ../docs/design-notes.md DN-2. The biome
      // test alone is the version that carved lake beds out from under
      // PLAINS lakes and left the water hanging over an unlit shaft.
      // ────────────────────────────────────────────────────────────────
      if (ravineWaterGuardLayer(blocks, lx, surfaceY, lz, biome, guard) !== null) {
        continue
      }

      const floorY = ravineFloorY(surfaceY, depth)

      for (let y = Math.min(surfaceY, CHUNK_HEIGHT - 1); y > floorY; y -= 1) {
        const index = blockIndex(lx, y, lz)
        // Defensive and currently unreachable — `floorY` is at least
        // `RAVINE_FLOOR_Y` = 6 and `BEDROCK_Y` is 0, so the loop never descends
        // to the floor slab. Kept because the reference keeps it (`:56`) and
        // because the day it earns its place is the day someone lowers
        // `RAVINE_FLOOR_Y`, which is exactly the day nobody would think to add
        // it. `./ore.ts` records `ORE_MIN_Y_FLOOR` under the same heading.
        if (readBlock(blocks, index) === BLOCK.BEDROCK) {
          continue
        }
        blocks[index] = BLOCK.AIR
      }

      clearGroundCover(blocks, lx, surfaceY, lz)
      carvedColumns += 1
    }
  }

  return carvedColumns
}
