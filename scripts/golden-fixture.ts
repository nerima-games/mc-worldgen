/**
 * golden-fixture.ts — the seed-fixed golden matrix, and the digest taken over it.
 *
 * docs/testing.md §3 (完了条件 3) asks for "シード固定ゴールデンハッシュがコミット
 * されている", and spells out three implementation rules that shape this file:
 *
 *   - the hash is written BY GENERATING CODE, never by hand;
 *   - updating it must be a deliberate act, never something `vitest -u` does
 *     quietly;
 *   - a changed hash means "the terrain changed" and is a review item.
 *
 * The second rule is why nothing here uses `toMatchSnapshot` or
 * `toMatchInlineSnapshot`. mc-noise pins its frozen contract with
 * `toMatchInlineSnapshot` (test/public-api.test.ts:60), which is fine there
 * because those are nine scalars a reviewer reads directly — but a snapshot is
 * exactly the artefact `-u` rewrites without comment, and a 64-character digest
 * is not something a reviewer can sanity-check by eye. So the digests live in a
 * committed JSON file, the test compares them with `toBe`, and the only way to
 * move them is `pnpm goldens:update`.
 *
 * ---------------------------------------------------------------------------
 * A golden agrees with whatever produced it — including a bug
 * ---------------------------------------------------------------------------
 *
 * This is not hypothetical in this organisation. mc-noise's `buildPermutation`
 * had its name pinned by the public-API lock and its OUTPUT pinned by goldens,
 * and neither could see that the table might not be a bijection: the goldens
 * are whatever the table produces, so a duplicated gradient index reproduced
 * perfectly (mc-noise/test/permutation.test.ts:5-26). The first moment anyone
 * could have SEEN it was the day the goldens were regenerated, by which point
 * the regeneration had blessed it.
 *
 * The conclusion drawn there applies unchanged here: a digest is a drift
 * detector and nothing else. It is worth having because it is nearly free and
 * because property tests structurally cannot see a version-to-version drift
 * that keeps every property true. It is worth NOTHING as a statement that the
 * terrain is correct. So two things sit alongside every digest in this file:
 *
 *   1. a readable SUMMARY — block histogram, biome histogram, water surface,
 *      terrain top — so that a diff of `chunk-goldens.json` says "OCEAN 256 ->
 *      31, water 1166 -> 0" instead of saying that 64 hex characters changed;
 *
 *   2. INDEPENDENT INVARIANTS, asserted by `test/chunk-golden.test.ts` against
 *      freshly generated chunks and never against this file. Those are what
 *      make a blessed-bug regeneration fail. They are listed one by one in that
 *      file, each naming the digest field it backs.
 *
 * ---------------------------------------------------------------------------
 * How the eight coordinates were chosen
 * ---------------------------------------------------------------------------
 *
 * One chunk per biome: for each member of `BIOMES`, the chunk NEAREST THE
 * ORIGIN (Chebyshev rings, so the answer is a function of the seed rather than
 * of scan order) all 256 of whose columns classify as that biome.
 *
 * The rule matters more than the coordinates. A hand-picked matrix around the
 * origin is what docs/testing.md §4-b F-5 warns about from the other direction:
 * the first biome measurement in this repository looked at 384 x 384 blocks,
 * saw no DESERT and no SNOW, and concluded they were unreachable. Both are
 * real, and both live far enough out that a 3 x 3 matrix at the origin cannot
 * contain them — DESERT's nearest solid chunk is (33, 48) and SNOW's is
 * (22, -60), against a world where they are 0.1% and 0.8% of columns. A golden
 * set that omits them cannot notice the day they stop generating.
 *
 * The ninth entry re-generates the FOREST chunk with `decorate: false`. Without
 * it every digest here is taken through the decoration pass, and the tree
 * placer could be deleted outright while a decorated-only matrix still
 * disagreed in exactly the way it would for any other change. With it the two
 * FOREST rows differ ONLY by vegetation, so the diff localises.
 *
 * The tenth was added because the first nine made an invariant VACUOUS — see
 * its own comment below. That is the more useful half of this file's history:
 * the matrix was chosen by a rule, the rule was reasonable, and it still
 * produced a set on which "the carver's water-floor guard works" was true by
 * there being nothing for the guard to do.
 *
 * THE ELEVENTH WAS ADDED FOR THE SAME REASON, ONE FEATURE LATER, which is what
 * makes the pattern worth naming rather than treating as bad luck twice. The
 * ravine carver landed and every digest here was byte-identical, because a
 * ravine is a thin curve at a 250-block wavelength and no chunk chosen by
 * "nearest all-X" happens to sit on one. A selection rule that never mentions a
 * feature cannot be expected to cover it, and the miss is silent in both
 * directions: the suite passes whether the pass works or does nothing at all.
 */
import { createHash } from 'node:crypto'
import path from 'node:path'
import { BIOMES, BLOCK, type BiomeType } from '../src/domain/biome'
import { CAVE_CEILING_Y, CAVE_FLOOR_Y } from '../src/domain/carver'
import { columnIndex, readBlock, type Chunk } from '../src/domain/chunk'
import { blockIndex, CHUNK_HEIGHT, CHUNK_SIZE_XZ, SEA_LEVEL } from '../src/domain/constants'
import { ORE_BLOCK } from '../src/domain/ore'
import { generateChunkAt } from '../src/domain/terrain'
import { PLANT } from '../src/domain/vegetation'

/**
 * The seed every golden is taken at.
 *
 * The same literal as `apps/preview-terrain/options.ts` and
 * `scripts/bench-terrain.ts`, so that a digest which moves can be looked at
 * with `pnpm preview --seed 20260726` without translating coordinates between
 * two different worlds.
 */
export const GOLDEN_SEED = 20260726

export type GoldenSpec = {
  /** The biome all 256 columns of this chunk classify as. Documentation, and asserted. */
  readonly biome: BiomeType
  readonly cx: number
  readonly cz: number
  /** False generates without the vegetation pass. Only the ninth row sets it. */
  readonly decorate: boolean
  /** Why this row is in the matrix. A golden nobody can justify is a golden nobody dares change. */
  readonly why: string
}

/**
 * The matrix. Derived by the rule in the header; committed as literals because
 * a golden whose coordinates are searched for at test time is a golden that
 * moves when the terrain moves, which is the one thing it exists to detect.
 *
 * `test/chunk-golden.test.ts` re-checks the "all 256 columns" half of the rule
 * on every run, so a shaper change that makes one of these chunks mixed fails
 * loudly here rather than silently weakening the matrix.
 */
export const GOLDEN_SPECS: ReadonlyArray<GoldenSpec> = [
  { biome: 'OCEAN', cx: 5, cz: 7, decorate: true, why: 'nearest all-OCEAN chunk' },
  { biome: 'BEACH', cx: 3, cz: 5, decorate: true, why: 'nearest all-BEACH chunk' },
  { biome: 'DESERT', cx: 33, cz: 48, decorate: true, why: 'nearest all-DESERT chunk; 0.1% of the world' },
  { biome: 'SAVANNA', cx: 13, cz: -1, decorate: true, why: 'nearest all-SAVANNA chunk' },
  { biome: 'PLAINS', cx: -1, cz: -2, decorate: true, why: 'nearest all-PLAINS chunk' },
  { biome: 'FOREST', cx: 8, cz: -8, decorate: true, why: 'nearest all-FOREST chunk' },
  { biome: 'TAIGA', cx: 1, cz: 0, decorate: true, why: 'nearest all-TAIGA chunk; carries a 4,193-block cave' },
  { biome: 'SNOW', cx: 22, cz: -60, decorate: true, why: 'nearest all-SNOW chunk; 0.8% of the world' },
  { biome: 'FOREST', cx: 8, cz: -8, decorate: false, why: 'the FOREST chunk without the vegetation pass' },
  {
    biome: 'OCEAN',
    cx: 4,
    cz: 9,
    decorate: true,
    // ADDED AFTER A VACUOUS PASS, and the vacancy is documented behaviour rather
    // than bad luck: docs/testing.md §4-b F-4 records that at this seed, near
    // the origin, `--no-guard` changes nothing at all, because no cave comes
    // within three blocks of a lake bed. The first eight rows were all like
    // that, so I-4 ("the shell under water is solid") held by there being
    // nothing to carve — it scored a perfect result on a generator with the
    // guard deleted, which is exactly what deleting the guard was tried and
    // confirmed to do.
    //
    // (4, 9) is the strongest counterexample inside 40 chunks of the origin:
    // 229 of its 256 columns lose their water-floor shell when the margin is
    // set to 0, and 0 do with the guard on. `test/chunk-golden.test.ts` I-4 now
    // asserts BOTH halves against this chunk, which is the `test/carver.test.ts`
    // rule — reproduce the bug, do not merely assert its absence.
    why: 'the water-floor guard actually bites here: 229 columns break without it',
  },
  {
    biome: 'FOREST',
    cx: 21,
    cz: 11,
    decorate: true,
    // THE ELEVENTH ROW EXISTS FOR THE SAME REASON THE TENTH DOES, and the
    // measurement that forced it was taken before a line of it was written: the
    // ravine carver landed, every digest above was byte-identical, and the whole
    // suite passed. Not because the pass does nothing — it carves 0.9-2.1% of
    // the world — but because the ravine band is a thin curve at a 250-block
    // wavelength and NONE of the first ten chunks intersects one. Zero band
    // columns out of 2,560.
    //
    // That is docs/testing.md §4-b F-4 again, one feature later. A matrix chosen
    // by "nearest all-X chunk" is a matrix chosen without reference to any
    // feature that is rare and spatially structured, so it will keep missing
    // them, and each miss looks exactly like a pass that works.
    //
    // (21, 11) is the strongest ravine chunk inside 40 chunks of the origin
    // that is still single-biome: 205 of its 256 columns are carved, up to
    // 4,135 cells, and its `topBlockY` floor is 39 against a shaper minimum of
    // 38. FOREST rather than the marginally closer PLAINS candidates because a
    // ravine that cuts a decorated chunk exercises the interaction the pass
    // order is FOR — see `ravineCutColumns` below and `test/ravine.test.ts`.
    why: 'the only golden chunk a ravine reaches: 205 of 256 columns carved',
  },
]

/**
 * Block id -> the name this repository generates it under. Every id, so a zero
 * is visible.
 *
 * THE ORE AND PLANT TABLES ARE HERE AND NOT IN `BLOCK`, and the summary is the
 * place that difference shows. `domain/ore.ts` and `domain/vegetation.ts` hold
 * their own id tables rather than extending `domain/biome.ts`'s `BLOCK`, because
 * `BLOCK` is re-exported by `index.ts` and therefore sits in `api-lock.md`,
 * whose four-week clock is plan.md §6 Step 3's gate on publishing.
 *
 * The cost of that choice is paid right here: three tables have to be joined by
 * hand, and an id added to one of them and not to this list would be counted as
 * `UNKNOWN_<n>` in every golden summary. `summarise` below does exactly that
 * rather than dropping it, and `test/chunk-golden.test.ts` I-1 fails on it
 * separately, so the failure mode is a loud diff rather than a silent one.
 */
export const BLOCK_NAMES: ReadonlyArray<readonly [string, number]> = [
  ...Object.entries(BLOCK),
  ...Object.entries(ORE_BLOCK).map(([name, id]) => [`${name}_ORE`, id] as const),
  ...Object.entries(PLANT),
].map(([name, id]) => [name, id] as const)

export type GoldenSummary = {
  /** Every id in `BLOCK_NAMES` — terrain, ore and plant — including the zeroes, which is how the unreachable `GRAVEL` of docs/design-notes.md DN-11 was found. */
  readonly blockCounts: Readonly<Record<string, number>>
  /** Every one of the eight biomes, including the zeroes. */
  readonly biomeCounts: Readonly<Record<string, number>>
  /** Y of the topmost water block, min and max over water columns. Null when the chunk is dry. */
  readonly waterSurfaceY: { readonly min: number; readonly max: number } | null
  /**
   * Y of the topmost non-AIR block, min and max over all 256 columns. Water
   * counts, which is why this is not called `topSolidY`: over an ocean chunk it
   * reports the water surface, and reporting the sea bed instead would make the
   * ocean rows silently disagree with `waterSurfaceY` for no reason.
   */
  readonly topBlockY: { readonly min: number; readonly max: number }
  /**
   * AIR inside the carver's band, `CAVE_FLOOR_Y..CAVE_CEILING_Y`.
   *
   * Broken out of `blockCounts.AIR` because otherwise it is not in the diff at
   * all: this band is at most 53/256 of a column and the sky above the terrain
   * dominates the AIR total, so a carver that stopped carving entirely would
   * move `AIR` by a few percent and be indistinguishable from a shaper nudge.
   * docs/testing.md §7 records the reverse direction of the same coupling — the
   * F-1 shaper fix made the carver 34% more expensive.
   */
  readonly caveBandAir: number
  /**
   * Columns whose topmost non-AIR block is below `SEA_LEVEL`. The ravine count.
   *
   * Broken out for the reason `caveBandAir` gives, and the coupling here is
   * worse: a ravine floor lands between y=35 and y=64, which is largely INSIDE
   * `CAVE_FLOOR_Y..CAVE_CEILING_Y`, so without this field a ravine pass that
   * stopped carving would move `caveBandAir` and be indistinguishable from a
   * change to `carveCaves`.
   *
   * It is an exact signature rather than a proxy, and the argument is short
   * enough to check: `domain/terrain.ts` fills water from `surfaceY + 1` to
   * `seaLevel`, so any column with `surfaceY < SEA_LEVEL` has water — which is
   * non-AIR — at `SEA_LEVEL`. A dry column therefore has its top at
   * `SEA_LEVEL` or above, and `carveCaves` cannot lower it because
   * `CAVE_CEILING_Y` is 58. Only a ravine can put the top of a column below
   * sea level. It reads 0 on all ten pre-ravine rows and 114 on the eleventh.
   *
   * It UNDERCOUNTS, deliberately and by a knowable amount: a shallow cut on
   * high ground can leave the floor above sea level, so this is the number of
   * columns cut BELOW SEA LEVEL and not the number of columns carved (205 for
   * that chunk). A drift detector does not need to be a census.
   */
  readonly ravineCutColumns: number
}

export type GoldenEntry = {
  readonly biome: BiomeType
  readonly cx: number
  readonly cz: number
  readonly decorate: boolean
  /** SHA-256 over the 65,536-byte block buffer. */
  readonly blocksSha256: string
  /** SHA-256 over the 256 biome names, newline-joined in column-index order. */
  readonly biomesSha256: string
  readonly summary: GoldenSummary
}

export type GoldenFile = {
  readonly generatedBy: string
  readonly seed: number
  readonly entries: ReadonlyArray<GoldenEntry>
}

export const GOLDEN_FILE_PATH = path.join('test', 'golden', 'chunk-goldens.json')

const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex')

/**
 * The biome digest is taken over NAMES, not over indices into `BIOMES`.
 *
 * `BiomeType` is a closed literal union, so its member set IS the type, and
 * reordering `BIOMES` is a no-op for every consumer. Hashing positions would
 * turn that no-op into a terrain-changed alarm, and — worse — would let a
 * rename slip through unchanged. Names make the digest track the thing callers
 * actually observe.
 */
const biomesDigest = (biomes: ReadonlyArray<BiomeType>): string => sha256(biomes.join('\n'))

export const summarise = (chunk: Chunk): GoldenSummary => {
  const blockCounts: Record<string, number> = {}
  for (const [name] of BLOCK_NAMES) {
    blockCounts[name] = 0
  }
  const biomeCounts: Record<string, number> = {}
  for (const biome of BIOMES) {
    biomeCounts[biome] = 0
  }

  const idToName = new Map<number, string>(BLOCK_NAMES.map(([name, id]) => [id, name]))

  let waterMin = Number.POSITIVE_INFINITY
  let waterMax = Number.NEGATIVE_INFINITY
  let waterColumns = 0
  let topMin = Number.POSITIVE_INFINITY
  let topMax = Number.NEGATIVE_INFINITY
  let caveBandAir = 0
  let ravineCutColumns = 0

  for (let lx = 0; lx < CHUNK_SIZE_XZ; lx += 1) {
    for (let lz = 0; lz < CHUNK_SIZE_XZ; lz += 1) {
      const biome = chunk.biomes[columnIndex(lx, lz)]
      if (biome !== undefined) {
        biomeCounts[biome] = (biomeCounts[biome] ?? 0) + 1
      }

      let columnWaterTop = -1
      let columnTop = -1

      for (let y = 0; y < CHUNK_HEIGHT; y += 1) {
        const id = readBlock(chunk.blocks, blockIndex(lx, y, lz))
        // An unknown id is counted under its number so that the summary still
        // adds up to 65,536 and the discrepancy is visible in the diff rather
        // than swallowed. `test/chunk-golden.test.ts` fails on it separately.
        const name = idToName.get(id) ?? `UNKNOWN_${String(id)}`
        blockCounts[name] = (blockCounts[name] ?? 0) + 1

        if (id === BLOCK.WATER) {
          columnWaterTop = y
        }
        if (id === BLOCK.AIR) {
          if (y >= CAVE_FLOOR_Y && y <= CAVE_CEILING_Y) {
            caveBandAir += 1
          }
        } else {
          columnTop = y
        }
      }

      if (columnWaterTop >= 0) {
        waterColumns += 1
        waterMin = Math.min(waterMin, columnWaterTop)
        waterMax = Math.max(waterMax, columnWaterTop)
      }
      topMin = Math.min(topMin, columnTop)
      topMax = Math.max(topMax, columnTop)
      if (columnTop >= 0 && columnTop < SEA_LEVEL) {
        ravineCutColumns += 1
      }
    }
  }

  return {
    blockCounts,
    biomeCounts,
    waterSurfaceY: waterColumns === 0 ? null : { min: waterMin, max: waterMax },
    topBlockY: { min: topMin, max: topMax },
    caveBandAir,
    ravineCutColumns,
  }
}

export const generateGoldenChunk = (spec: GoldenSpec): Chunk =>
  generateChunkAt(GOLDEN_SEED, spec.cx, spec.cz, { decorate: spec.decorate })

export const goldenEntry = (spec: GoldenSpec): GoldenEntry => {
  const chunk = generateGoldenChunk(spec)
  return {
    biome: spec.biome,
    cx: spec.cx,
    cz: spec.cz,
    decorate: spec.decorate,
    blocksSha256: sha256(chunk.blocks),
    biomesSha256: biomesDigest(chunk.biomes as ReadonlyArray<BiomeType>),
    summary: summarise(chunk),
  }
}

export const buildGoldenFile = (): GoldenFile => ({
  generatedBy: 'pnpm goldens:update — do NOT edit by hand (scripts/update-goldens.ts)',
  seed: GOLDEN_SEED,
  entries: GOLDEN_SPECS.map(goldenEntry),
})

/** Two-space JSON with a trailing newline, so the committed file diffs line by line. */
export const renderGoldenFile = (file: GoldenFile): string => `${JSON.stringify(file, null, 2)}\n`
