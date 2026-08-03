/**
 * The Nether coordinate relation and the travel resolver.
 *
 * The reference implementation's two test files
 * (`packages/world/test/nether-link.test.ts`, 10 tests, and
 * `packages/world/test/nether-travel.test.ts`, 6 tests) are ported in full and
 * then strengthened in five places, each of which is a "vacuous success" of the
 * kind `docs/testing.md` §6 asks to be prevented:
 *
 *   THE ROUND TRIP, IN BOTH DIRECTIONS. The reference asserts the two scalings
 *   against hand-written pairs and never composes them. Nether -> Overworld ->
 *   Nether is the identity and Overworld -> Nether -> Overworld is NOT, and the
 *   second is the interesting one: an implementation that had quietly made the
 *   lossy direction lossless — by rounding instead of flooring, say — passes
 *   every assertion the reference makes.
 *
 *   THE PLANNED PORTAL IS DETECTABLE. `domain/portal-frame.ts`'s bounds note
 *   justifies `MIN_PORTAL_WIDTH`/`MIN_PORTAL_HEIGHT` by citing this file's
 *   `DEFAULT_PORTAL_WIDTH`/`DEFAULT_PORTAL_HEIGHT` as independent corroboration.
 *   Now that both ends are in this repository the citation is checkable: a
 *   planned portal goes through `detectNetherPortal` and comes back. The
 *   reference asserts `interior` has six cells, which a generator producing six
 *   cells in the wrong shape would also satisfy.
 *
 *   THE RADIUS BOUNDARY. The reference tests "inside" and "far outside" and
 *   never the edge. `findNearestPortal` accepts `distance === maxDistance`
 *   (`dSq > maxSq` rejects), and a `>=` there is a one-character change no
 *   reference test would notice.
 *
 *   THE Y TERM IS REALLY IN THE DISTANCE. Every candidate in the reference's
 *   suite shares the target's `y`, so a search that dropped the vertical term
 *   entirely passes all six of its cases.
 *
 *   THE `'end'` BRANCH AND THE NEGATIVE RADIUS. Neither is exercised by the
 *   reference. The first is a transcribed fall-through and the second is this
 *   repository's one declared divergence from it; both are pinned so that they
 *   are decisions rather than things nobody looked at.
 *
 * Regression names (docs/design-notes.md): worldgen-nether-ratio-round-trip,
 * worldgen-nether-search-radius-boundary, worldgen-nether-negative-radius.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect, Option } from 'effect'
import { BLOCK } from '../src/domain/biome'
import { blockPosition, type BlockPosition } from '../src/domain/kernel-vocabulary'
import {
  NETHER_HORIZONTAL_RATIO,
  findNearestPortal,
  netherToOverworld,
  overworldToNether,
} from '../src/domain/nether-link'
import {
  PORTAL_SEARCH_RADIUS,
  resolveNetherTravel,
  type Dimension,
} from '../src/domain/nether-travel'
import { detectNetherPortal, type BlockAt } from '../src/domain/portal-frame'

const at = (x: number, y: number, z: number): BlockPosition => blockPosition(x, y, z)

const plain = (p: BlockPosition): { x: number; y: number; z: number } => ({ x: p.x, y: p.y, z: p.z })

const TARGET = at(0, 64, 0)

describe('the 8:1 ratio', () => {
  it.effect('is 8', () =>
    Effect.sync(() => {
      expect(NETHER_HORIZONTAL_RATIO).toBe(8)
    }),
  )

  it.effect('divides the horizontal axes and carries y across', () =>
    Effect.sync(() => {
      expect(plain(overworldToNether(at(80, 64, 160)))).toStrictEqual({ x: 10, y: 64, z: 20 })
    }),
  )

  it.effect('floors toward negative infinity rather than truncating', () =>
    Effect.sync(() => {
      // -9 / 8 is -1.125: floor gives -2, truncation would give -1. -1 / 8 is
      // -0.125, where truncation gives the `-0` that `blockPosition` normalises
      // and floor gives -1 — two different cells, not two spellings of one.
      expect(plain(overworldToNether(at(-9, 70, -1)))).toStrictEqual({ x: -2, y: 70, z: -1 })
    }),
  )

  it.effect('multiplies the horizontal axes on the way back and carries y across', () =>
    Effect.sync(() => {
      expect(plain(netherToOverworld(at(10, 64, 20)))).toStrictEqual({ x: 80, y: 64, z: 160 })
      expect(plain(netherToOverworld(at(-2, 70, -1)))).toStrictEqual({ x: -16, y: 70, z: -8 })
    }),
  )

  it.effect('normalises the negative zero that flooring produces at the origin', () =>
    Effect.sync(() => {
      // `Math.floor(-0 / 8)` is `-0`, which `toStrictEqual` distinguishes from 0
      // and which `chunkKeyOf` would spell as "-0,3". The brand collapses it.
      const scaled = overworldToNether(at(-0, 64, -0))
      expect(Object.is(scaled.x, 0)).toBe(true)
      expect(Object.is(scaled.z, 0)).toBe(true)
    }),
  )

  it.effect('Nether -> Overworld -> Nether is the identity', () =>
    Effect.sync(() => {
      for (const cell of [at(0, 64, 0), at(10, 64, 20), at(-2, 70, -1), at(-1000, 5, 999)]) {
        expect(plain(overworldToNether(netherToOverworld(cell)))).toStrictEqual(plain(cell))
      }
    }),
  )

  it.effect('Overworld -> Nether -> Overworld is NOT — it lands on the multiple of 8 below', () =>
    Effect.sync(() => {
      // Eight Overworld cells share one Nether cell, so the trip is lossy BY THE
      // RULE. A test that only ran the identity direction above would pass on an
      // implementation that had made this one lossless too.
      expect(plain(netherToOverworld(overworldToNether(at(85, 64, 161))))).toStrictEqual({
        x: 80,
        y: 64,
        z: 160,
      })
      expect(plain(netherToOverworld(overworldToNether(at(-9, 70, -1))))).toStrictEqual({
        x: -16,
        y: 70,
        z: -8,
      })
    }),
  )
})

describe('findNearestPortal', () => {
  it.effect('finds nothing among no candidates', () =>
    Effect.sync(() => {
      expect(Option.isNone(findNearestPortal([], TARGET, PORTAL_SEARCH_RADIUS))).toBe(true)
    }),
  )

  it.effect('finds nothing when every candidate is out of range', () =>
    Effect.sync(() => {
      const far = [at(1000, 64, 0), at(0, 64, 1000)]
      expect(Option.isNone(findNearestPortal(far, TARGET, PORTAL_SEARCH_RADIUS))).toBe(true)
    }),
  )

  it.effect('finds the only candidate in range', () =>
    Effect.sync(() => {
      const only = at(10, 64, 0)
      expect(plain(Option.getOrThrow(findNearestPortal([only], TARGET, PORTAL_SEARCH_RADIUS)))).toStrictEqual(
        plain(only),
      )
    }),
  )

  it.effect('finds the nearest of several', () =>
    Effect.sync(() => {
      const near = at(5, 64, 0)
      const mid = at(20, 64, 0)
      expect(
        plain(Option.getOrThrow(findNearestPortal([mid, near], TARGET, PORTAL_SEARCH_RADIUS))),
      ).toStrictEqual(plain(near))
    }),
  )

  it.effect('keeps the earliest candidate on an exact tie', () =>
    Effect.sync(() => {
      const first = at(10, 64, 0)
      const second = at(0, 64, 10)
      expect(
        plain(Option.getOrThrow(findNearestPortal([first, second], TARGET, PORTAL_SEARCH_RADIUS))),
      ).toStrictEqual(plain(first))
      // ...and it is the ORDER that decides, not the coordinates: the same two
      // cells the other way round give the other answer.
      expect(
        plain(Option.getOrThrow(findNearestPortal([second, first], TARGET, PORTAL_SEARCH_RADIUS))),
      ).toStrictEqual(plain(second))
    }),
  )

  it.effect('skips out-of-range candidates while choosing an in-range one', () =>
    Effect.sync(() => {
      const far = at(1000, 64, 0)
      const near = at(12, 64, 0)
      expect(
        plain(Option.getOrThrow(findNearestPortal([far, near], TARGET, PORTAL_SEARCH_RADIUS))),
      ).toStrictEqual(plain(near))
    }),
  )

  it.effect('accepts a candidate at exactly the radius and rejects one a block past it', () =>
    Effect.sync(() => {
      // The comparison is `dSq > maxSq`, so the boundary is INCLUSIVE. A `>=`
      // there is a one-character change nothing in the reference's suite sees.
      expect(Option.isSome(findNearestPortal([at(128, 64, 0)], TARGET, 128))).toBe(true)
      expect(Option.isNone(findNearestPortal([at(129, 64, 0)], TARGET, 128))).toBe(true)
    }),
  )

  it.effect('measures vertically too — a portal straight overhead can be out of range', () =>
    Effect.sync(() => {
      // Every candidate in the reference's suite shares the target's y, so a
      // search that dropped the vertical term passes all of it.
      expect(Option.isNone(findNearestPortal([at(0, 264, 0)], TARGET, 128))).toBe(true)
      expect(Option.isSome(findNearestPortal([at(0, 164, 0)], TARGET, 128))).toBe(true)
    }),
  )

  it.effect('DIVERGENCE: a negative or non-finite radius accepts nothing', () =>
    Effect.sync(() => {
      // The reference squares the radius unguarded, so -1 admits everything
      // within 1 block. See the note on `findNearestPortal`: this is the one
      // place this port does not transcribe, and it is pinned so that
      // "simplifying" back to the reference's arithmetic fails here.
      const beside = [at(0, 64, 0), at(1, 64, 0)]
      expect(Option.isNone(findNearestPortal(beside, TARGET, -1))).toBe(true)
      expect(Option.isNone(findNearestPortal(beside, TARGET, Number.NaN))).toBe(true)
      expect(Option.isSome(findNearestPortal(beside, TARGET, 0))).toBe(true)
    }),
  )
})

describe('resolveNetherTravel', () => {
  it.effect('searches 128 blocks by default', () =>
    Effect.sync(() => {
      expect(PORTAL_SEARCH_RADIUS).toBe(128)
    }),
  )

  it.effect('overworld -> nether reuses an existing portal near the scaled destination', () =>
    Effect.sync(() => {
      const existing = at(12, 64, 20)
      const plan = resolveNetherTravel('overworld', at(80, 64, 160), [existing])

      expect(plan.toDimension).toBe('nether')
      // THE PORTAL'S CELL, not the scaled point two blocks away. Arriving beside
      // an existing portal rather than at it is how a world grows two portals
      // ten blocks apart.
      expect(plain(plan.destination)).toStrictEqual(plain(existing))
      expect(Option.isNone(plan.portalToCreate)).toBe(true)
    }),
  )

  it.effect('overworld -> nether plans a portal at the scaled destination when none is in range', () =>
    Effect.sync(() => {
      const plan = resolveNetherTravel('overworld', at(800, 64, 160), [])

      expect(plan.toDimension).toBe('nether')
      expect(plain(plan.destination)).toStrictEqual({ x: 100, y: 64, z: 20 })
      expect(Option.getOrThrow(plan.portalToCreate).interior).toHaveLength(6)
    }),
  )

  it.effect('nether -> overworld scales up and plans a portal when none is in range', () =>
    Effect.sync(() => {
      const plan = resolveNetherTravel('nether', at(10, 64, 20), [])

      expect(plan.toDimension).toBe('overworld')
      expect(plain(plan.destination)).toStrictEqual({ x: 80, y: 64, z: 160 })
      expect(Option.isSome(plan.portalToCreate)).toBe(true)
    }),
  )

  it.effect('nether -> overworld reuses a nearby portal', () =>
    Effect.sync(() => {
      const existing = at(80, 64, 165)
      const plan = resolveNetherTravel('nether', at(10, 64, 20), [existing])

      expect(plan.toDimension).toBe('overworld')
      expect(plain(plan.destination)).toStrictEqual(plain(existing))
      expect(Option.isNone(plan.portalToCreate)).toBe(true)
    }),
  )

  it.effect('honours a caller-supplied radius', () =>
    Effect.sync(() => {
      // 30 blocks away: inside the default 128, outside the 10 asked for.
      const plan = resolveNetherTravel('overworld', at(80, 64, 160), [at(40, 64, 20)], 10)

      expect(Option.isSome(plan.portalToCreate)).toBe(true)
      expect(plain(plan.destination)).toStrictEqual({ x: 10, y: 64, z: 20 })
    }),
  )

  it.effect('from the End, a nether portal returns to the Overworld and scales up', () =>
    Effect.sync(() => {
      // Transcribed fall-through, pinned so it is a decision. The reference maps
      // everything that is not `'overworld'` to `'overworld'`; the End's own
      // portal is a different rule that never calls this one.
      const plan = resolveNetherTravel('end', at(1, 64, 2), [])

      expect(plan.toDimension).toBe('overworld')
      expect(plain(plan.destination)).toStrictEqual({ x: 8, y: 64, z: 16 })
    }),
  )

  it.effect('never plans travel INTO the End', () =>
    Effect.sync(() => {
      const dimensions: ReadonlyArray<Dimension> = ['overworld', 'nether', 'end']
      for (const from of dimensions) {
        expect(resolveNetherTravel(from, at(0, 64, 0), []).toDimension).not.toBe('end')
      }
    }),
  )

  it.effect('plans a portal that detection actually accepts', () =>
    Effect.sync(() => {
      // THE CORROBORATION `domain/portal-frame.ts`'s bounds note relies on, made
      // checkable. That file justifies MIN 2 x 3 by citing this rule's
      // auto-generated size as an independent second source; with both ends in
      // one repository the citation can be RUN. A generator that stopped
      // agreeing with the detector's minimum would produce a portal nothing can
      // light, and the reference's `interior.toHaveLength(6)` would still pass.
      const layout = Option.getOrThrow(resolveNetherTravel('overworld', at(800, 64, 160), []).portalToCreate)

      const key = (x: number, y: number, z: number): string => `${String(x)},${String(y)},${String(z)}`
      const obsidian = new Set(layout.frame.map((cell) => key(cell.x, cell.y, cell.z)))
      const blockAt: BlockAt = (x, y, z) => (obsidian.has(key(x, y, z)) ? BLOCK.OBSIDIAN : BLOCK.AIR)

      for (const cell of layout.interior) {
        const detected = detectNetherPortal(blockAt, cell)
        expect(Option.isSome(detected)).toBe(true)
        const frame = Option.getOrThrow(detected)
        expect(frame.width).toBe(2)
        expect(frame.height).toBe(3)
      }
    }),
  )
})
