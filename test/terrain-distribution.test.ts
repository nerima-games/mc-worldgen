import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { DEFAULT_TERRAIN_LEVELS } from '../src/domain/constants'
import { channelSeed, fbm2D } from '../src/domain/seeded-random'
import { CONTINENTALNESS_CONTRAST, MAX_SURFACE_Y, MIN_SURFACE_Y, surfaceHeightAt } from '../src/domain/terrain'

/**
 * ---------------------------------------------------------------------------
 * The shape of the world, measured — docs/testing.md §4-b F-1.
 * ---------------------------------------------------------------------------
 *
 * `CONTINENTALNESS_CONTRAST` was 2.6, and the comment justifying it carried two
 * measured numbers, both taken over an 800 × 800 block window: that the raw
 * continentalness field spans "about [0.40, 0.72]", and that without the
 * stretch only 3% of columns would fall below sea level. The field's frequency
 * is 1/180, so that window is four terrain features across — enough to locate
 * the middle of the distribution and not remotely enough to see its tails. The
 * true span is [0.053, 0.946] and the true unstretched ocean fraction is 41.7%.
 *
 * Multiplying a distribution that really does reach 0.05 and 0.95 by 2.6
 * saturated both ends: 10.7% of columns pinned to `MIN_SURFACE_Y`, 9.2% to
 * `MAX_SURFACE_Y`, a fifth of the world a perfectly flat clamped plane.
 *
 * So this file exists to make the sample size part of the build. Every
 * distribution below is read from a SURVEY — strided, and wide enough that the
 * tails are in it — and `the survey is wide enough to have tails in it` asserts
 * that width explicitly rather than trusting the constant. docs/testing.md §4-b
 * F-5 records the same narrow-window mistake being made a second time, about
 * biomes, so it is not a one-off.
 *
 * The bench (`docs/testing.md` §7) puts `surfaceHeightAt` at ~0.16 µs per
 * column, so a 262,144-column survey costs well under a tenth of a second. The
 * wide window is affordable. There was never a reason to measure a small one.
 */

/** Wavelength of the continentalness field: `frequency: 1 / 180` in `surfaceHeightAt`. */
const CONTINENTALNESS_WAVELENGTH = 180

/**
 * SURVEY geometry, identical to `pnpm preview --stats`: every 16th block over
 * 8192 × 8192 blocks, 262,144 columns, ~45 continentalness features across.
 * Strided sampling is sound here precisely because the field is smooth at this
 * frequency; what must not be small is the SPAN.
 */
const SURVEY_SPAN = 8192
const SURVEY_STRIDE = 16

/** The window the old comment's numbers came from, kept so the mistake is runnable. */
const NARROW_SPAN = 800
const NARROW_STRIDE = 4

/** The default preview seed, so these numbers are the ones `--stats` prints. */
const SEED = 20260726

const rawContinentalness = (seed: number, wx: number, wz: number): number =>
  fbm2D(channelSeed(seed, 'continentalness'), wx, wz, {
    octaves: 4,
    frequency: 1 / CONTINENTALNESS_WAVELENGTH,
    persistence: 0.5,
  })

type Survey = {
  readonly total: number
  readonly rawMin: number
  readonly rawMax: number
  readonly heightMin: number
  readonly heightMax: number
  readonly pinnedLow: number
  readonly pinnedHigh: number
  readonly belowSea: number
}

const survey = (seed: number, span: number, stride: number): Survey => {
  const half = Math.floor(span / 2)
  let total = 0
  let rawMin = Number.POSITIVE_INFINITY
  let rawMax = Number.NEGATIVE_INFINITY
  let heightMin = Number.POSITIVE_INFINITY
  let heightMax = Number.NEGATIVE_INFINITY
  let pinnedLow = 0
  let pinnedHigh = 0
  let belowSea = 0

  for (let dz = 0; dz < span; dz += stride) {
    for (let dx = 0; dx < span; dx += stride) {
      const wx = dx - half
      const wz = dz - half
      const raw = rawContinentalness(seed, wx, wz)
      const height = surfaceHeightAt(seed, wx, wz)

      total += 1
      rawMin = Math.min(rawMin, raw)
      rawMax = Math.max(rawMax, raw)
      heightMin = Math.min(heightMin, height)
      heightMax = Math.max(heightMax, height)
      if (height >= MAX_SURFACE_Y) {
        pinnedHigh += 1
      }
      if (height <= MIN_SURFACE_Y) {
        pinnedLow += 1
      }
      if (height < DEFAULT_TERRAIN_LEVELS.seaLevel) {
        belowSea += 1
      }
    }
  }

  return { total, rawMin, rawMax, heightMin, heightMax, pinnedLow, pinnedHigh, belowSea }
}

/** The shipped mapping, so the counterfactuals below differ in the constant and nothing else. */
const heightFor = (raw: number, contrast: number): number =>
  Math.floor(
    MIN_SURFACE_Y +
      (MAX_SURFACE_Y - MIN_SURFACE_Y) * Math.min(1, Math.max(0, (raw - 0.5) * contrast + 0.5)),
  )

const wide = survey(SEED, SURVEY_SPAN, SURVEY_STRIDE)

describe('the survey itself', () => {
  /**
   * The methodological assertion, and the first one for a reason: every number
   * in this file is worthless if this fails. 8192 / 180 is about 45 features.
   * The 800-block window that produced the wrong constant is 4.
   */
  it.effect('is wide enough to have tails in it — at least 40 continentalness features', () =>
    Effect.sync(() => {
      expect(SURVEY_SPAN / CONTINENTALNESS_WAVELENGTH).toBeGreaterThanOrEqual(40)
      expect(wide.total).toBe((SURVEY_SPAN / SURVEY_STRIDE) ** 2)
      expect(wide.total).toBeGreaterThanOrEqual(250_000)
    }),
  )

  /**
   * REGRESSION: the narrow window really does hide the tails.
   *
   * This is the `carver.test.ts` pattern — reproduce the bug, do not merely
   * assert its absence. An 800 × 800 window at the origin sees [0.16, 0.83]; the
   * wide survey sees [0.053, 0.946]. Both are honest measurements of what was in
   * frame. Only one of them is a measurement of the generator.
   */
  it.effect('and a narrow window is not: 800 blocks misses both tails', () =>
    Effect.sync(() => {
      const narrow = survey(SEED, NARROW_SPAN, NARROW_STRIDE)

      expect(narrow.rawMin).toBeGreaterThan(wide.rawMin + 0.05)
      expect(narrow.rawMax).toBeLessThan(wide.rawMax - 0.05)
      expect(NARROW_SPAN / CONTINENTALNESS_WAVELENGTH).toBeLessThan(5)
    }),
  )
})

describe('raw continentalness', () => {
  /**
   * The measurement that condemned the old constant. `[0.40, 0.72]` was the
   * claim; anything near it fails here.
   */
  it.effect('spans nearly the whole unit interval — NOT the [0.40, 0.72] the old comment claimed', () =>
    Effect.sync(() => {
      expect(wide.rawMin).toBeLessThan(0.15)
      expect(wide.rawMax).toBeGreaterThan(0.85)
      expect(wide.rawMax - wide.rawMin).toBeGreaterThan(0.8)
    }),
  )

  /**
   * The other wrong number: "3% of columns fall below sea level without the
   * stretch". The counterfactual is computable from the same samples, so it is
   * computed rather than believed — which is what `pnpm preview --stats` does
   * too, and how this was caught.
   */
  it.effect('would already give an ocean with no stretch at all — not the 3% the old comment claimed', () =>
    Effect.sync(() => {
      const half = Math.floor(SURVEY_SPAN / 2)
      let below = 0
      let total = 0
      for (let dz = 0; dz < SURVEY_SPAN; dz += SURVEY_STRIDE) {
        for (let dx = 0; dx < SURVEY_SPAN; dx += SURVEY_STRIDE) {
          total += 1
          if (heightFor(rawContinentalness(SEED, dx - half, dz - half), 1) < DEFAULT_TERRAIN_LEVELS.seaLevel) {
            below += 1
          }
        }
      }

      expect(below / total).toBeGreaterThan(0.3)
      expect(below / total).toBeLessThan(0.5)
    }),
  )
})

describe('the shaper does not clamp the world flat', () => {
  /**
   * The headline. 20.0% before, 0.01% after. The threshold is 1%, two orders of
   * magnitude below what was shipped and two above what is measured, so it is a
   * gate on the defect and not a snapshot of today's noise.
   */
  it.effect('pins less than 1% of columns to MIN_SURFACE_Y or MAX_SURFACE_Y', () =>
    Effect.sync(() => {
      const clamped = (wide.pinnedLow + wide.pinnedHigh) / wide.total

      expect(clamped).toBeLessThan(0.01)
    }),
  )

  /**
   * The load-bearing half. Without this, "less than 1%" could be satisfied by a
   * generator with no relief at all, and the test above would pass for the wrong
   * reason. `MIN_SURFACE_Y` and `MAX_SURFACE_Y` are declared bounds of the
   * shaper; a bound no column reaches is fiction, and choosing 1.15 over 1.00
   * bought exactly this.
   */
  it.effect('still reaches both bounds, so they are limits and not fiction', () =>
    Effect.sync(() => {
      expect(wide.heightMin).toBe(MIN_SURFACE_Y)
      expect(wide.heightMax).toBe(MAX_SURFACE_Y)
      expect(wide.pinnedLow + wide.pinnedHigh).toBeGreaterThan(0)
    }),
  )

  /**
   * REGRESSION: the constant is load-bearing.
   *
   * Re-mapping the same samples at the old 2.6 reproduces the defect — about a
   * fifth of the world flat. A test that only checked the current value would
   * pass just as happily if `stretch` were rewritten to ignore the constant.
   */
  it.effect('and the contrast is what does it: at the old 2.6, a fifth of the world is flat', () =>
    Effect.sync(() => {
      const half = Math.floor(SURVEY_SPAN / 2)
      let flat = 0
      let total = 0
      for (let dz = 0; dz < SURVEY_SPAN; dz += SURVEY_STRIDE) {
        for (let dx = 0; dx < SURVEY_SPAN; dx += SURVEY_STRIDE) {
          const height = heightFor(rawContinentalness(SEED, dx - half, dz - half), 2.6)
          total += 1
          if (height <= MIN_SURFACE_Y || height >= MAX_SURFACE_Y) {
            flat += 1
          }
        }
      }

      expect(flat / total).toBeGreaterThan(0.15)
      expect(CONTINENTALNESS_CONTRAST).toBeLessThan(2.6)
    }),
  )
})

describe('the world still has a sea', () => {
  /**
   * The other half of the design call. The carver's water-floor guard
   * (docs/design-notes.md DN-2) can only be exercised by a world with water in
   * it, and a generator whose ocean quietly vanished would take that guard's
   * regression test down with it without failing it.
   *
   * Contrast barely moves this number — 41.7% at 1.0, 47.5% at 2.6 — because sea
   * level sits near the middle of the height range. That is precisely why paying
   * 20% of the surface for five points of ocean was a bad trade.
   */
  it.effect('puts between a third and a half of columns below sea level', () =>
    Effect.sync(() => {
      const ocean = wide.belowSea / wide.total

      expect(ocean).toBeGreaterThan(0.33)
      expect(ocean).toBeLessThan(0.5)
    }),
  )

  /**
   * Not a property of one seed. The four extra seeds run at a coarser stride to
   * stay inside the test budget; the span — the thing that must not shrink — is
   * unchanged.
   */
  it.effect('holds for other seeds too, so it is a property of the shaper', () =>
    Effect.sync(() => {
      for (const seed of [1, 4242, 999983, 77777]) {
        const other = survey(seed, SURVEY_SPAN, SURVEY_STRIDE * 2)

        expect((other.pinnedLow + other.pinnedHigh) / other.total).toBeLessThan(0.01)
        expect(other.belowSea / other.total).toBeGreaterThan(0.33)
        expect(other.belowSea / other.total).toBeLessThan(0.5)
      }
    }),
  )
})
