/**
 * ---------------------------------------------------------------------------
 * The biome mix of the world, measured — docs/testing.md §4-b F-5, 完了条件 7.
 * ---------------------------------------------------------------------------
 *
 * This is `test/terrain-distribution.test.ts` applied to the other output of a
 * column. That file exists because a constant was justified by a measurement
 * over too narrow a window; this one exists because the SAME MISTAKE WAS MADE A
 * SECOND TIME IN THIS REPOSITORY, about biomes, and was written up as a finding
 * before anyone noticed it was the same shape as the first.
 *
 * The second occurrence, verbatim from docs/testing.md §4-b F-5: measured over
 * 384 x 384 blocks, the biome report showed FLOWER_FOREST 0.0% and SWAMP 0.0%
 * while the 13-biome roster was not fully visible. A plausible cause was even
 * written down — that
 * `climateAt` applies no `stretch`, so the extremes are never reached. Widening
 * widening the window is required to measure the full roster. The
 * first result was a description of the handful of lattice points that happened
 * to be in frame.
 *
 * ---------------------------------------------------------------------------
 * The window has to be measured against the RIGHT wavelength
 * ---------------------------------------------------------------------------
 *
 * `test/terrain-distribution.test.ts` asserts its survey is at least 40
 * continentalness features wide, 1/180 being the frequency of the field it
 * measures. Reusing that number here would be the F-1 error in miniature: a
 * threshold carried over from a measurement of a different population.
 *
 * Biome selection reads THREE fields with three different frequencies:
 *
 *     temperature      1/320   `climateAt`
 *     humidity         1/280   `climateAt`
 *     continentalness  1/180   `surfaceHeightAt`, via biomeFor's OCEAN/BEACH override
 *
 * The binding one is the LONGEST, 320: a window wide enough for temperature's
 * tails is automatically wide enough for the other two. So the methodological
 * assertion below is written against 320 and demands 25 features, which the
 * 8192-block survey supplies (8192/320 = 25.6). The elevation test's rule —
 * 40 continentalness features — would admit a span of 7200, and 7200 is only
 * 22.5 temperature features.
 *
 * MEASURED, so that "25" is not another recalled number. Sweeping the span over
 * the same five seeds, what degrades as the window narrows is not the PRESENCE
 * of the rare biomes but the STABILITY of their share — the seed-to-seed spread
 * of the rarest climate-derived biomes:
 *
 *     span    temp. features    SWAMP over 5 seeds         spread
 *      4096        12.8          0.14% .. 0.24%            1.7x
 *      8192        25.6          0.14% .. 0.20%            1.4x     <- used
 *
 * All 13 biomes are present in the committed wide survey at every seed. The
 * outright disappearance reproduced below is limited to the two least common
 * refined biomes in the 384-block window.
 *
 * 25 features is therefore chosen as the width at which the bands further down
 * are actually valid, rather than as a round number: at 8192 the wide survey
 * contains at least 25 features of the slowest climate field. A narrower survey
 * does not merely measure less precisely, it measures a different population.
 *
 * ---------------------------------------------------------------------------
 * Bands, not fractions
 * ---------------------------------------------------------------------------
 *
 * Every biome below is asserted to fall inside a BAND roughly a factor of two
 * either side of what five seeds actually produce, for the reason
 * `test/terrain-distribution.test.ts` gives about its own 1% threshold: the
 * number to gate on is the DEFECT, not today's noise. Pinning OCEAN at 0.351
 * would fail on a seed change, on a stride change, and on any deliberate
 * tuning — so it would be relaxed, and a test that gets relaxed on every
 * unrelated change stops being read.
 *
 * What the bands do catch is what actually goes wrong here: a biome falling to
 * zero (F-5's refined biomes), and a biome swallowing the map (the failure the
 * PLAINS fallback invites, since every unmatched climate lands there).
 *
 * MEASURED, seeds 20260726 / 1 / 4242 / 999983 / 77777, SURVEY geometry below,
 * via `pnpm preview --stats`:
 *
 *     OCEAN    33.5 .. 35.1 %        BEACH    15.0 .. 16.0 %
 *     PLAINS    7.9 ..  9.2 %        FOREST    6.6 ..  8.2 %
 *     DESERT    5.6 ..  6.3 %        SNOW      4.5 ..  6.1 %
 *     TAIGA     7.0 ..  8.2 %        SAVANNA   4.0 ..  5.2 %
 *     JUNGLE    3.8 ..  4.7 %        RIVER     2.4 ..  2.9 %
 *     MOUNTAINS 2.8 ..  3.7 %        FLOWER_FOREST 0.8 .. 1.3 %
 *     SWAMP     0.14 .. 0.21 %
 *
 * Regression names (docs/design-notes.md): worldgen-biome-distribution,
 * worldgen-biome-survey-width.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { BIOMES, type BiomeType } from '../src/domain/biome'
import { DEFAULT_TERRAIN_LEVELS } from '../src/domain/constants'
import { biomeFor, surfaceHeightAt } from '../src/domain/terrain'

/**
 * Wavelengths of the three fields biome selection reads, as written in
 * `climateAt` and `surfaceHeightAt`. The survey is judged against the longest.
 */
const TEMPERATURE_WAVELENGTH = 320
const HUMIDITY_WAVELENGTH = 280
const CONTINENTALNESS_WAVELENGTH = 180
const LONGEST_CLIMATE_WAVELENGTH = Math.max(
  TEMPERATURE_WAVELENGTH,
  HUMIDITY_WAVELENGTH,
  CONTINENTALNESS_WAVELENGTH,
)

/** SURVEY geometry, identical to `pnpm preview --stats` and to the elevation test. */
const SURVEY_SPAN = 8192
const SURVEY_STRIDE = 16

/** The window F-5 was measured in, kept so that the mistake stays runnable. */
const NARROW_SPAN = 384
const NARROW_STRIDE = 1

const SEED = 20260726

type BiomeSurvey = {
  readonly total: number
  readonly counts: ReadonlyMap<BiomeType, number>
  /** Columns whose surface is under `seaLevel`, the quantity the elevation test reports as 42.9%. */
  readonly belowSea: number
  /** Columns below sea level that classified as neither OCEAN nor BEACH. Must be 0. */
  readonly submergedButDry: number
  /** Columns classified OCEAN whose surface is NOT below sea level. Must be 0. */
  readonly oceanAboveSea: number
}

const survey = (seed: number, span: number, stride: number): BiomeSurvey => {
  const half = Math.floor(span / 2)
  const counts = new Map<BiomeType, number>()
  let total = 0
  let belowSea = 0
  let submergedButDry = 0
  let oceanAboveSea = 0

  for (let dz = 0; dz < span; dz += stride) {
    for (let dx = 0; dx < span; dx += stride) {
      const wx = dx - half
      const wz = dz - half
      const surfaceY = surfaceHeightAt(seed, wx, wz)
      const biome = biomeFor(seed, wx, wz, surfaceY, DEFAULT_TERRAIN_LEVELS)
      const submerged = surfaceY < DEFAULT_TERRAIN_LEVELS.seaLevel

      total += 1
      counts.set(biome, (counts.get(biome) ?? 0) + 1)
      if (submerged) {
        belowSea += 1
        if (biome !== 'OCEAN' && biome !== 'BEACH') {
          submergedButDry += 1
        }
      }
      if (biome === 'OCEAN' && !submerged) {
        oceanAboveSea += 1
      }
    }
  }

  return { total, counts, belowSea, submergedButDry, oceanAboveSea }
}

const wide = survey(SEED, SURVEY_SPAN, SURVEY_STRIDE)

const shareOf = (result: BiomeSurvey, biome: BiomeType): number =>
  (result.counts.get(biome) ?? 0) / result.total

/**
 * Lower and upper bound per biome. See the header for the measurements these
 * bracket; they are gates on "gone" and on "took over the map", not snapshots.
 */
const BANDS: ReadonlyArray<readonly [BiomeType, number, number]> = [
  ['OCEAN', 0.2, 0.5],
  ['BEACH', 0.07, 0.28],
  ['PLAINS', 0.04, 0.15],
  ['FOREST', 0.03, 0.15],
  ['DESERT', 0.03, 0.1],
  ['SNOW', 0.02, 0.1],
  ['TAIGA', 0.03, 0.12],
  ['SAVANNA', 0.02, 0.08],
  ['JUNGLE', 0.02, 0.08],
  ['RIVER', 0.01, 0.05],
  ['MOUNTAINS', 0.01, 0.08],
  ['FLOWER_FOREST', 0.003, 0.03],
  ['SWAMP', 0.0005, 0.005],
]

describe('the biome survey itself', () => {
  /**
   * First, for the same reason it is first in the elevation test: every number
   * below is worthless if this fails. And note which wavelength it uses — the
   * longest of the three fields biome selection reads, not continentalness's.
   */
  it.effect('is wide enough for the SLOWEST climate field, not merely for continentalness', () =>
    Effect.sync(() => {
      expect(LONGEST_CLIMATE_WAVELENGTH).toBe(TEMPERATURE_WAVELENGTH)
      expect(SURVEY_SPAN / LONGEST_CLIMATE_WAVELENGTH).toBeGreaterThanOrEqual(25)
      expect(wide.total).toBe((SURVEY_SPAN / SURVEY_STRIDE) ** 2)
      expect(wide.total).toBeGreaterThanOrEqual(250_000)
    }),
  )

  /**
   * REGRESSION — docs/testing.md §4-b F-5, reproduced rather than described.
   *
   * The `test/carver.test.ts` pattern: a regression test that only asserts the
   * absence of the bug says that today's code equals today's code. This one
   * re-runs the narrow measurement and asserts it REACHES THE WRONG CONCLUSION,
   * so the claim "the window is what did it" is checked and not merely believed.
   *
   * 384 x 384 at the origin misses FLOWER_FOREST and SWAMP. The exact missing
   * set is intentionally pinned because it is the current narrow-window
   * observation, not a claim that those biomes are unreachable globally.
   */
  it.effect('and a narrow window is not: 384 blocks reports biomes that do not exist as missing', () =>
    Effect.sync(() => {
      const narrow = survey(SEED, NARROW_SPAN, NARROW_STRIDE)
      const missing = BIOMES.filter((biome) => (narrow.counts.get(biome) ?? 0) === 0)

      expect(missing.length).toBeGreaterThanOrEqual(2)
      expect(missing).toStrictEqual(['FLOWER_FOREST', 'SWAMP'])
      expect(NARROW_SPAN / LONGEST_CLIMATE_WAVELENGTH).toBeLessThan(2)
    }),
  )
})

describe('every biome in the roster is actually generated', () => {
  /**
   * The headline, and the direct answer to F-5. A closed literal union whose
   * members are declared but unreachable is a roster that lies: `BIOME_SURFACES`
   * and `BIOME_TREE_DENSITY` both have a row for DESERT, `test/biome-and-trees.test.ts`
   * checks those rows are total over `BIOMES`, and none of that notices if no
   * column in the world ever classifies as one.
   */
  it.effect('reaches all 13 declared biomes', () =>
    Effect.sync(() => {
      for (const biome of BIOMES) {
        expect(wide.counts.get(biome) ?? 0, `${biome} was never generated`).toBeGreaterThan(0)
      }
      expect(wide.counts.size).toBe(BIOMES.length)
    }),
  )

  it.effect('and generates nothing outside it', () =>
    Effect.sync(() => {
      const roster = new Set<string>(BIOMES)

      for (const biome of wide.counts.keys()) {
        expect(roster.has(biome)).toBe(true)
      }
    }),
  )
})

describe('the mix', () => {
  it.effect('puts every biome inside its measured band', () =>
    Effect.sync(() => {
      for (const [biome, low, high] of BANDS) {
        const share = shareOf(wide, biome)

        expect(share, `${biome} is below its band at ${share.toFixed(4)}`).toBeGreaterThanOrEqual(low)
        expect(share, `${biome} is above its band at ${share.toFixed(4)}`).toBeLessThanOrEqual(high)
      }
    }),
  )

  /**
   * The bands are per-biome and could all be satisfied while one biome quietly
   * dominated everything interesting. This states the whole-distribution version
   * directly: no biome is half the world.
   *
   * PLAINS is the one to watch, because it is the FALLBACK — every climate that
   * matches no rule lands there (`domain/biome.ts` `FALLBACK_BIOME`). A rule
   * table that stopped matching would not throw; it would produce a planet of
   * grass, with every other band failing only on its lower bound.
   */
  it.effect('is spread out: no biome takes half the map, and the fallback is not the map', () =>
    Effect.sync(() => {
      for (const biome of BIOMES) {
        expect(shareOf(wide, biome), `${biome} dominates`).toBeLessThan(0.5)
      }
      expect(shareOf(wide, 'PLAINS')).toBeLessThan(shareOf(wide, 'OCEAN') + shareOf(wide, 'BEACH'))
    }),
  )

  /**
   * Not a property of one seed. Coarser stride to stay inside the test budget;
   * the SPAN — the thing that must not shrink — is unchanged, which is the whole
   * lesson of F-1 and F-5.
   */
  it.effect('holds for other seeds too, so it is a property of the classifier', () =>
    Effect.sync(() => {
      for (const seed of [1, 4242, 999983, 77777]) {
        const other = survey(seed, SURVEY_SPAN, SURVEY_STRIDE * 2)

        for (const [biome, low, high] of BANDS) {
          const share = (other.counts.get(biome) ?? 0) / other.total
          expect(share, `${biome} out of band on seed ${String(seed)} at ${share.toFixed(4)}`).toBeGreaterThanOrEqual(
            low,
          )
          expect(share, `${biome} out of band on seed ${String(seed)} at ${share.toFixed(4)}`).toBeLessThanOrEqual(
            high,
          )
        }
      }
    }),
  )
})

/**
 * ---------------------------------------------------------------------------
 * The structural half — exact, and independent of every band above.
 * ---------------------------------------------------------------------------
 *
 * `biomeFor` applies two height overrides upstream of `classifyBiome`: OCEAN
 * below `seaLevel - 2`, BEACH up to `seaLevel + 1`. Those thresholds bracket
 * `seaLevel` on both sides, so two set inclusions hold for EVERY column, at
 * every seed, with no measurement involved:
 *
 *     OCEAN        subset of   below sea level
 *     below sea    subset of   OCEAN union BEACH
 *
 * These tie the biome distribution to the elevation distribution that
 * `test/terrain-distribution.test.ts` already pins. A band can be widened until
 * it passes; an inclusion cannot.
 */
describe('the height overrides agree with the heights', () => {
  it.effect('no column below sea level classifies as a land biome', () =>
    Effect.sync(() => {
      expect(wide.submergedButDry).toBe(0)
      // Not vacuous: the elevation test measures this at 42.9%.
      expect(wide.belowSea / wide.total).toBeGreaterThan(0.33)
    }),
  )

  it.effect('and no OCEAN column is above sea level', () =>
    Effect.sync(() => {
      expect(wide.oceanAboveSea).toBe(0)
      expect(shareOf(wide, 'OCEAN')).toBeLessThan(wide.belowSea / wide.total)
    }),
  )

  /**
   * The shoreline band is `[seaLevel - 2, seaLevel + 1]`, four blocks of height,
   * so BEACH is a fixed-width slice of the height distribution rather than a
   * climate result. docs/testing.md §4-b F-1 records the consequence being
   * observed: flattening the shaper widened BEACH from 7.1% to 15.9% without
   * anyone touching biome classification. This pins the mechanism, so the next
   * person to see BEACH move looks at the shaper and not at `BIOME_RULES`.
   */
  it.effect('BEACH is a height band, so it tracks the shaper and not the climate', () =>
    Effect.sync(() => {
      const half = Math.floor(SURVEY_SPAN / 2)
      let inShorelineBand = 0
      let beach = 0

      for (let dz = 0; dz < SURVEY_SPAN; dz += SURVEY_STRIDE * 2) {
        for (let dx = 0; dx < SURVEY_SPAN; dx += SURVEY_STRIDE * 2) {
          const wx = dx - half
          const wz = dz - half
          const surfaceY = surfaceHeightAt(SEED, wx, wz)
          if (
            surfaceY >= DEFAULT_TERRAIN_LEVELS.seaLevel - 2 &&
            surfaceY <= DEFAULT_TERRAIN_LEVELS.seaLevel + 1
          ) {
            inShorelineBand += 1
          }
          if (biomeFor(SEED, wx, wz, surfaceY, DEFAULT_TERRAIN_LEVELS) === 'BEACH') {
            beach += 1
          }
        }
      }

      expect(inShorelineBand).toBeGreaterThan(0)
      expect(beach).toBe(inShorelineBand)
    }),
  )
})
