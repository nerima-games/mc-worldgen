/**
 * Nether portal frame detection.
 *
 * The reference implementation's own test file
 * (`packages/world/domain/nether/portal-frame.test.ts`, 145 LOC / 17 tests) is
 * ported in full and then strengthened in three places, each of which is a
 * "vacuous success" of the kind `docs/testing.md` §6 asks to be prevented:
 *
 *   THE SIZE SWEEP. The reference tests three sizes: 2×3, 2×3 on the other axis
 *   and 4×5. A detector that hard-coded any bound between 5 and 21 would pass
 *   all three. Here every legal size on both axes goes out through
 *   `generatePortalLayout` and back through `detectNetherPortal` — 760 frames —
 *   which is what makes the claim in that function's header ("this is what makes
 *   detection falsifiable") true rather than aspirational.
 *
 *   EVERY INTERIOR CELL. The reference ignites once from the centre. That
 *   establishes that detection does not REQUIRE the bottom-left corner; it does
 *   not establish that every cell resolves the SAME frame, which is the property
 *   the walk-to-the-corner code exists for.
 *
 *   THE CORNERS. The reference never removes one. "Corners are not required" is
 *   the single most-cited sentence in the rule's header and nothing in the
 *   reference's suite would notice if the code demanded them.
 *
 * Regression names (docs/design-notes.md): worldgen-portal-frame-corners,
 * worldgen-portal-frame-size-bounds.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect, Option } from 'effect'
import { BLOCK } from '../domain/biome'
import { blockPosition, type BlockPosition } from "@nerima-games/mc-kernel"
import {
  detectNetherPortal,
  generatePortalLayout,
  MAX_PORTAL_HEIGHT,
  MAX_PORTAL_WIDTH,
  MIN_PORTAL_HEIGHT,
  MIN_PORTAL_WIDTH,
  type BlockAt,
  type PortalAxis,
} from '../domain/portal-frame'

const key = (x: number, y: number, z: number): string => `${String(x)},${String(y)},${String(z)}`

const keyOf = (p: BlockPosition): string => key(p.x, p.y, p.z)

/**
 * A world that is obsidian at the given cells and AIR absolutely everywhere
 * else — including 60 blocks straight up, which is the input that makes the
 * `countAir` cap load-bearing rather than decorative.
 */
const obsidianAt = (cells: ReadonlyArray<BlockPosition>): BlockAt => {
  const set = new Set(cells.map(keyOf))
  return (x, y, z) => (set.has(key(x, y, z)) ? BLOCK.OBSIDIAN : BLOCK.AIR)
}

const portalAt = (origin: BlockPosition, axis: PortalAxis, width: number, height: number): BlockAt =>
  obsidianAt(generatePortalLayout(origin, axis, width, height).frame)

const ORIGIN = blockPosition(0, 64, 0)

const AXES: ReadonlyArray<PortalAxis> = ['x', 'z']

describe('generatePortalLayout', () => {
  it.effect('produces exactly width × height interior cells', () =>
    Effect.sync(() => {
      expect(generatePortalLayout(ORIGIN, 'x', 2, 3).interior).toHaveLength(6)
      expect(generatePortalLayout(ORIGIN, 'x', 4, 5).interior).toHaveLength(20)
    }),
  )

  it.effect('rings the interior without overlapping it', () =>
    Effect.sync(() => {
      const { frame, interior } = generatePortalLayout(ORIGIN, 'x', 4, 5)
      const inside = new Set(interior.map(keyOf))

      // The ring of a w×h interior is the (w+2)×(h+2) rectangle minus the
      // inside: 2(w+2) + 2h = 2*6 + 2*5 = 22. Asserting the COUNT and not just
      // "non-empty" (the reference's assertion) is what would catch a ring that
      // forgot one of its four sides.
      expect(frame).toHaveLength(22)
      for (const cell of frame) expect(inside.has(keyOf(cell))).toBe(false)
    }),
  )

  it.effect('keeps the whole portal in one vertical plane', () =>
    Effect.sync(() => {
      // An x-aligned portal varies x and y and holds z; a z-aligned one holds x.
      // A portal that leaked onto the third axis would be a wall, not a frame.
      const xAligned = generatePortalLayout(blockPosition(5, 64, 10), 'x', 3, 4)
      for (const cell of [...xAligned.interior, ...xAligned.frame]) expect(cell.z).toBe(10)

      const zAligned = generatePortalLayout(blockPosition(10, 64, 5), 'z', 3, 4)
      for (const cell of [...zAligned.interior, ...zAligned.frame]) expect(cell.x).toBe(10)
    }),
  )

  it.effect('anchors the interior at the origin, which is what detection walks back to', () =>
    Effect.sync(() => {
      const origin = blockPosition(5, 70, -3)
      const { interior } = generatePortalLayout(origin, 'x', 2, 3)
      const cells = new Set(interior.map(keyOf))

      expect(cells.has(keyOf(origin))).toBe(true)
      // Bottom-LEFT: nothing below it and nothing to its left.
      expect(cells.has(key(origin.x, origin.y - 1, origin.z))).toBe(false)
      expect(cells.has(key(origin.x - 1, origin.y, origin.z))).toBe(false)
    }),
  )
})

describe('detectNetherPortal', () => {
  it.effect('detects the minimal portal on both axes', () =>
    Effect.sync(() => {
      for (const axis of AXES) {
        const found = detectNetherPortal(portalAt(ORIGIN, axis, 2, 3), ORIGIN)
        expect(Option.isSome(found)).toBe(true)
        expect(Option.getOrThrow(found).width).toBe(2)
        expect(Option.getOrThrow(found).height).toBe(3)
        expect(Option.getOrThrow(found).axis).toBe(axis)
      }
    }),
  )

  it.effect('round-trips EVERY legal size on both axes', () =>
    Effect.sync(() => {
      let checked = 0

      for (const axis of AXES) {
        for (let width = MIN_PORTAL_WIDTH; width <= MAX_PORTAL_WIDTH; width++) {
          for (let height = MIN_PORTAL_HEIGHT; height <= MAX_PORTAL_HEIGHT; height++) {
            const layout = generatePortalLayout(ORIGIN, axis, width, height)
            const found = detectNetherPortal(obsidianAt(layout.frame), ORIGIN)

            expect({ axis, width, height, some: Option.isSome(found) }).toStrictEqual({
              axis,
              width,
              height,
              some: true,
            })

            const frame = Option.getOrThrow(found)
            // The measurements AND the cells. A detector that returned the right
            // numbers and the wrong rectangle would pass a size-only assertion.
            expect({ w: frame.width, h: frame.height, axis: frame.axis }).toStrictEqual({
              w: width,
              h: height,
              axis,
            })
            expect(new Set(frame.interior.map(keyOf))).toStrictEqual(new Set(layout.interior.map(keyOf)))
            checked += 1
          }
        }
      }

      // Not vacuous: 2 axes × 20 widths × 19 heights.
      expect(checked).toBe(760)
    }),
  )

  it.effect('resolves the same frame from EVERY interior cell, not just the corner', () =>
    Effect.sync(() => {
      const layout = generatePortalLayout(ORIGIN, 'x', 4, 5)
      const blockAt = obsidianAt(layout.frame)
      const expected = new Set(layout.interior.map(keyOf))

      for (const ignition of layout.interior) {
        const found = detectNetherPortal(blockAt, ignition)
        expect({ at: keyOf(ignition), some: Option.isSome(found) }).toStrictEqual({
          at: keyOf(ignition),
          some: true,
        })
        expect(new Set(Option.getOrThrow(found).interior.map(keyOf))).toStrictEqual(expected)
      }

      expect(layout.interior).toHaveLength(20)
    }),
  )

  it.effect('does NOT require the four corners, which is the rule vanilla actually has', () =>
    Effect.sync(() => {
      const width = 3
      const height = 4
      const layout = generatePortalLayout(ORIGIN, 'x', width, height)
      const corners = new Set([
        key(ORIGIN.x - 1, ORIGIN.y - 1, ORIGIN.z),
        key(ORIGIN.x + width, ORIGIN.y - 1, ORIGIN.z),
        key(ORIGIN.x - 1, ORIGIN.y + height, ORIGIN.z),
        key(ORIGIN.x + width, ORIGIN.y + height, ORIGIN.z),
      ])

      // The corners really are in the generated ring, so removing them is a
      // change and not a no-op. `generatePortalLayout` fills them deliberately.
      expect(layout.frame.filter((cell) => corners.has(keyOf(cell)))).toHaveLength(4)

      const cornerless = layout.frame.filter((cell) => !corners.has(keyOf(cell)))
      expect(Option.isSome(detectNetherPortal(obsidianAt(cornerless), ORIGIN))).toBe(true)
    }),
  )

  it.effect('refuses a ring with any NON-corner cell missing', () =>
    Effect.sync(() => {
      const width = 3
      const height = 4
      const layout = generatePortalLayout(ORIGIN, 'x', width, height)
      const corners = new Set([
        key(ORIGIN.x - 1, ORIGIN.y - 1, ORIGIN.z),
        key(ORIGIN.x + width, ORIGIN.y - 1, ORIGIN.z),
        key(ORIGIN.x - 1, ORIGIN.y + height, ORIGIN.z),
        key(ORIGIN.x + width, ORIGIN.y + height, ORIGIN.z),
      ])
      const required = layout.frame.filter((cell) => !corners.has(keyOf(cell)))

      // Every one of the 14, one at a time. Knocking out a single hand-picked
      // block (what the reference does) tests one of the four edge loops.
      for (const hole of required) {
        const punctured = layout.frame.filter((cell) => keyOf(cell) !== keyOf(hole))
        expect({ hole: keyOf(hole), some: Option.isSome(detectNetherPortal(obsidianAt(punctured), ORIGIN)) })
          .toStrictEqual({ hole: keyOf(hole), some: false })
      }

      // Ring of a 3×4 interior: 2(w+2) + 2h = 10 + 8 = 18 cells, less 4 corners.
      expect(layout.frame).toHaveLength(18)
      expect(required).toHaveLength(14)
    }),
  )

  it.effect('refuses an interior with anything in it', () =>
    Effect.sync(() => {
      const layout = generatePortalLayout(ORIGIN, 'x', 4, 5)

      for (const blocked of layout.interior) {
        const blockAt = obsidianAt([...layout.frame, blocked])
        // Igniting on the obstruction itself is refused by the AIR check; the
        // interesting cell is a DIFFERENT one, which reaches the interior sweep.
        const ignition = layout.interior.find((cell) => keyOf(cell) !== keyOf(blocked))
        expect(ignition).toBeDefined()
        if (ignition === undefined) return

        expect({ blocked: keyOf(blocked), some: Option.isSome(detectNetherPortal(blockAt, ignition)) })
          .toStrictEqual({ blocked: keyOf(blocked), some: false })
      }
    }),
  )

  it.effect('refuses when the ignition cell is not AIR', () =>
    Effect.sync(() => {
      // Ported from the reference, and kept for the shape rather than the
      // strength: a lone obsidian block in an empty world is refused by the
      // SIZE guards long before the AIR check matters. The test below is the one
      // that holds that line. See its comment.
      expect(Option.isNone(detectNetherPortal(obsidianAt([ORIGIN]), ORIGIN))).toBe(true)
    }),
  )

  it.effect('refuses ignition ON the ring, which is the only thing the AIR check catches', () =>
    Effect.sync(() => {
      const layout = generatePortalLayout(ORIGIN, 'x', 4, 5)
      const blockAt = obsidianAt(layout.frame)
      // The bottom-middle ring block, directly under the interior.
      //
      // This input is chosen, not arbitrary. Detection's first move is to walk
      // DOWN to the bottom of the air column; from a non-air cell that walk
      // counts zero and the `- 1` therefore steps UP by one — landing precisely
      // on the interior's bottom row. Every measurement after that succeeds, the
      // interior sweep passes, the ring validates, and the rule reports a
      // perfectly good 4x5 portal for an ignition on solid obsidian.
      //
      // So the AIR check is not a fast path, it is the whole of the refusal. It
      // was verified by deleting that one line: every other test in this file
      // stayed green, including the two above that look like they cover it.
      const onRing = blockPosition(ORIGIN.x, ORIGIN.y - 1, ORIGIN.z)

      expect(blockAt(onRing.x, onRing.y, onRing.z)).toBe(BLOCK.OBSIDIAN)
      expect(Option.isNone(detectNetherPortal(blockAt, onRing))).toBe(true)
    }),
  )

  it.effect('refuses an already-lit portal, because a lit interior is not AIR', () =>
    Effect.sync(() => {
      // The reason this rule never needs to name `nether_portal` (kernel id 118).
      // A world where the interior holds portal blocks is modelled here as "not
      // AIR", which is all the rule ever asks.
      const layout = generatePortalLayout(ORIGIN, 'x', 2, 3)
      const lit = new Set(layout.interior.map(keyOf))
      const frame = new Set(layout.frame.map(keyOf))
      const blockAt: BlockAt = (x, y, z) => {
        if (frame.has(key(x, y, z))) return BLOCK.OBSIDIAN
        return lit.has(key(x, y, z)) ? BLOCK.STONE : BLOCK.AIR
      }

      expect(Option.isNone(detectNetherPortal(blockAt, ORIGIN))).toBe(true)
    }),
  )

  it.effect('refuses frames below the minimum on either axis', () =>
    Effect.sync(() => {
      for (const axis of AXES) {
        // 1 wide and 2 tall are the sizes immediately under each bound. Both
        // generate a perfectly well-formed ring; only the guard rejects them.
        expect(Option.isNone(detectNetherPortal(portalAt(ORIGIN, axis, 1, 3), ORIGIN))).toBe(true)
        expect(Option.isNone(detectNetherPortal(portalAt(ORIGIN, axis, 2, 2), ORIGIN))).toBe(true)
      }
    }),
  )

  it.effect('refuses frames one cell over the maximum on either axis', () =>
    Effect.sync(() => {
      for (const axis of AXES) {
        const tooWide = portalAt(ORIGIN, axis, MAX_PORTAL_WIDTH + 1, 3)
        const tooTall = portalAt(ORIGIN, axis, 2, MAX_PORTAL_HEIGHT + 1)
        expect(Option.isNone(detectNetherPortal(tooWide, ORIGIN))).toBe(true)
        expect(Option.isNone(detectNetherPortal(tooTall, ORIGIN))).toBe(true)
      }
    }),
  )

  it.effect('terminates in a world of nothing but air', () =>
    Effect.sync(() => {
      // The input the `countAir` cap exists for. With no cap this walks until
      // the numbers stop being integers; the assertion is that it returns.
      expect(Option.isNone(detectNetherPortal(obsidianAt([]), ORIGIN))).toBe(true)
    }),
  )

  it.effect('works at negative coordinates and below sea level', () =>
    Effect.sync(() => {
      // `blockPosition` normalises -0 to 0 (`@nerima-games/mc-kernel`), so a portal
      // straddling the origin is the case where a detected cell could compare
      // unequal to the generated one under `toStrictEqual` despite `===`.
      const origin = blockPosition(-1, 12, -7)
      const layout = generatePortalLayout(origin, 'z', 3, 4)
      const found = detectNetherPortal(obsidianAt(layout.frame), origin)

      expect(Option.isSome(found)).toBe(true)
      expect(Option.getOrThrow(found).interior).toStrictEqual(layout.interior)
    }),
  )
})

describe('portal frame size bounds', () => {
  it.effect('agrees with the reference on the minimum, in both files that state it', () =>
    Effect.sync(() => {
      // `portal-frame.ts:33,35` in the reference. The corroboration is that
      // `nether-travel.ts:23-24` independently sizes an AUTO-GENERATED portal
      // 2×3 — so a minimum above either number would make the reference's own
      // generator emit portals its own detector refuses. That round trip is the
      // justification, and it is asserted rather than described.
      expect(MIN_PORTAL_WIDTH).toBe(2)
      expect(MIN_PORTAL_HEIGHT).toBe(3)
      expect(Option.isSome(detectNetherPortal(portalAt(ORIGIN, 'x', 2, 3), ORIGIN))).toBe(true)
    }),
  )

  it.effect('holds the maximum at 21 with >=, because it is transcribed and not derived', () =>
    Effect.sync(() => {
      // `portal-frame.ts:34,36`. The rule's header says plainly that no
      // derivation for 21 was found, and that the safe direction to be wrong in
      // is UP. `>=` is that sentence in assertion form: raising the bound is not
      // a test edit, lowering it is.
      expect(MAX_PORTAL_WIDTH).toBeGreaterThanOrEqual(21)
      expect(MAX_PORTAL_HEIGHT).toBeGreaterThanOrEqual(21)
      expect(MAX_PORTAL_WIDTH).toBeGreaterThan(MIN_PORTAL_WIDTH)
      expect(MAX_PORTAL_HEIGHT).toBeGreaterThan(MIN_PORTAL_HEIGHT)
    }),
  )
})
