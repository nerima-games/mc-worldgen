/**
 * Nether portal FRAME DETECTION — is there a portal-shaped hole here?
 *
 * A valid Nether portal is a rectangular ring of OBSIDIAN standing in a vertical
 * plane aligned to either the X or the Z axis. The hollow interior — the cells
 * that become portal blocks when something lights them — is between
 * `MIN_PORTAL_WIDTH` and `MAX_PORTAL_WIDTH` wide, `MIN_PORTAL_HEIGHT` to
 * `MAX_PORTAL_HEIGHT` tall, and entirely AIR. The four CORNERS of the ring are
 * not required to be obsidian, matching modern vanilla.
 *
 * ---------------------------------------------------------------------------
 * Why a portal rule is in mc-worldgen at all
 * ---------------------------------------------------------------------------
 *
 * plan.md §3.11 gives 「ポータル / 次元移動ルール」 to mx-gameplay, and that
 * assignment is not wrong — it is about the VERB. This file is the other half,
 * and the split is not a compromise reached to justify the port; it is visible
 * in the reference implementation's own file layout, which had already made it:
 *
 *   packages/world/domain/nether/portal-frame.ts   <- the shape. THIS FILE.
 *   packages/app/.../interaction-flint-steel-portal.ts  <- the item use
 *   packages/app/.../physics-stage-portal.ts             <- moving the player
 *
 * Only the first of those three is in the world domain, and it is the one whose
 * entire input is block data. mx-gameplay's `docs/testing.md` §3-1 currently
 * argues portals are mc-physics'/mc-sim' because they 「move an entity that has a
 * position」. That is true of the second and third files and FALSE of this one:
 * nothing below knows what an entity is. It has no velocity, no roster, no
 * player. It reads blocks and returns a rectangle.
 *
 * The clearest evidence is a line of code that DISAPPEARED in the port. The
 * reference's entry point opens with
 *
 *     const x = Math.floor(ignition.x)   // portal-frame.ts:133-135
 *
 * because its `Position` is an entity's floating-point position, and an entity
 * standing at x = 3.7 is in the block at x = 3. Here the parameter is a
 * `BlockPosition`, which `mc-kernel` brands as a safe integer, so the
 * flooring has nothing left to do and is gone. The only entity-shaped thing in
 * the reference's version of this rule was a cast applied to its argument.
 *
 * This closes the DETECTION half of that responsibility. `docs/responsibility.md`
 * §6 records the boundary so the two repositories' documents do not contradict.
 *
 * ---------------------------------------------------------------------------
 * The block accessor is injected, and this is the same argument as §3.2
 * ---------------------------------------------------------------------------
 *
 * `detectNetherPortal` takes a `BlockAt` rather than reaching into
 * `application/chunk-store.ts`. This repository has made that call twice before
 * — `TerrainLevels` is a parameter rather than an import (`docs/responsibility.md`
 * §3-2) and `CarveOptions` likewise — and the reason is the same each time: a
 * rule that takes a store cannot be tested without standing one up, and a test
 * that needs a store stops being a test of the rule.
 *
 * It also decides WHO may call this. An ignition handler in mx-gameplay, a
 * structure verifier in this repository, and the preview all have block data and
 * none of them has the same block data: the preview reads generated chunks with
 * an overlay on top, and mx-gameplay reads a `ChunkStore` that has been written
 * to. A rule that named one of those sources would be usable from only that one.
 */
import { Option } from 'effect'
import { BLOCK } from './biome'
import { blockPosition, type BlockPosition } from '@nerima-games/mc-kernel'

/**
 * Reads the block at an integer world coordinate.
 *
 * BOTH HALVES OF THIS SIGNATURE ARE UNBRANDED, and neither is an oversight.
 *
 * Three numbers rather than a `BlockPosition`: detection probes on the order of
 * `width × height` cells plus the ring — up to ~530 for a maximum-sized frame —
 * and a `BlockPosition` per probe is an object allocation plus three
 * `Brand.refined` validations to read one byte. The reference implementation
 * carries a recorded performance finding on exactly this path
 * (`.serena/memories/performance/portal-ignition-chunk-fetch-allocation.md`:
 * removing one layer of per-chunk-lookup overhead from portal ignition).
 *
 * `number` rather than `BlockId` on the way out, for a blunter reason: a chunk
 * is a `Uint8Array`, and reading one yields a number. Every accessor this
 * repository already has says so — `domain/chunk.ts`'s `readBlock` and
 * `getBlockAt` both return `number`. Demanding a `BlockId` here would put a
 * brand construction, and its validation, on every probe of every caller, to
 * re-establish a fact the buffer's own element type already guarantees. The
 * comparisons below still typecheck against `BLOCK.AIR` and `BLOCK.OBSIDIAN`
 * because `BlockId` is a refinement OF `number`, so the branded constants are
 * usable as the thing being compared to without either side loosening.
 *
 * The branded type is still what the RESULT is made of, where each position is
 * built once and then travels.
 */
export type BlockAt = (x: number, y: number, z: number) => number

/** The horizontal axis that the portal's vertical plane runs along. */
export type PortalAxis = 'x' | 'z'

export type PortalFrame = {
  readonly axis: PortalAxis
  readonly width: number
  readonly height: number
  /** The interior cells, AIR today, that become portal blocks when lit. */
  readonly interior: ReadonlyArray<BlockPosition>
}

/**
 * The four size bounds, transcribed from the reference implementation's
 * `packages/world/domain/nether/portal-frame.ts:33-36`.
 *
 * TWO OF THESE ARE JUSTIFIED AND TWO ARE MERELY TRANSCRIBED. Saying which is
 * which is a house rule here: `docs/testing.md` §4-b records that this
 * repository has now shipped a constant justified by a measurement of the wrong
 * population three separate times (F-1, F-5, and the biome-distribution span),
 * so a number that arrives without a derivation gets to say so rather than
 * borrow the credibility of the ones next to it.
 *
 * MIN 2 × 3 — JUSTIFIED, and corroborated inside the reference rather than from
 * a wiki. `nether-travel.ts:23-24` independently defines the size of an
 * AUTO-GENERATED portal as `DEFAULT_PORTAL_WIDTH = 2` / `DEFAULT_PORTAL_HEIGHT = 3`,
 * with the comment 「Auto-generated portals use the vanilla minimum interior」.
 * Two files that never import each other's constants agree that the minimum is
 * 2 × 3, and the generator would produce an undetectable portal if they did not.
 * `test/portal-frame.test.ts` pins that agreement as a round trip.
 *
 * MAX 21 × 21 — TRANSCRIBED, NOT JUSTIFIED. I could not derive 21 from anything
 * in the reference implementation or in this repository, and I am not going to
 * dress up a recollection of the vanilla limit as a derivation. What can be said
 * precisely is what the code needs from it, which is weaker than the number:
 *
 *   - as an ACCEPTANCE bound it only has to be at least as large as any frame we
 *     are willing to detect, and nothing here or downstream builds one bigger;
 *   - as a TERMINATION bound it has real work to do. `countAir` walks until it
 *     stops seeing air, and the air above an obsidian ring built on open ground
 *     is unbounded. The cap is what makes that walk finite, and the guards below
 *     then reject the over-sized measurement it returns.
 *
 * So the safe direction to be wrong in is UP: too large costs a longer walk on
 * malformed input, too small silently refuses portals a player legitimately
 * built. If a real limit is ever established, it belongs here with a citation
 * and `test/portal-frame.test.ts` asserts `>=` rather than `===` on these two so
 * that raising them is not a test edit.
 */
export const MIN_PORTAL_WIDTH = 2
export const MAX_PORTAL_WIDTH = 21
export const MIN_PORTAL_HEIGHT = 3
export const MAX_PORTAL_HEIGHT = 21

/**
 * Reads one cell of the plane without allocating.
 *
 * `(h, y)` are in-plane coordinates: `h` runs along `axis` and `fixed` is the
 * constant coordinate on the other horizontal axis. The reference built a
 * `PlaneMap` closure returning a `Position` object per probe
 * (`portal-frame.ts:44-52`); the two-line branch here is the same mapping with
 * the object removed, for the reason in `BlockAt`'s comment.
 */
const probe = (blockAt: BlockAt, axis: PortalAxis, fixed: number, h: number, y: number): number =>
  axis === 'x' ? blockAt(h, y, fixed) : blockAt(fixed, y, h)

/** The same mapping, materialised. Called once per cell of the RESULT. */
const positionAt = (axis: PortalAxis, fixed: number, h: number, y: number): BlockPosition =>
  axis === 'x' ? blockPosition(h, y, fixed) : blockPosition(fixed, y, h)

/**
 * Counts consecutive AIR cells from `(h0, y0)` inclusive, stepping `(dh, dy)`.
 *
 * Capped at `max` so that an unbounded region of air terminates the walk — see
 * the TERMINATION note on `MAX_PORTAL_WIDTH`. Callers pass `MAX + 1` so that an
 * over-sized run is measurable as over-sized rather than clamping to the legal
 * maximum and being accepted.
 */
const countAir = (
  blockAt: BlockAt,
  axis: PortalAxis,
  fixed: number,
  h0: number,
  y0: number,
  dh: number,
  dy: number,
  max: number,
): number => {
  let n = 0
  while (n < max) {
    if (probe(blockAt, axis, fixed, h0 + dh * n, y0 + dy * n) !== BLOCK.AIR) break
    n += 1
  }
  return n
}

/** Resolves a frame in one plane, anchored at an interior AIR cell `(h0, y0)`. */
const detectInPlane = (
  blockAt: BlockAt,
  axis: PortalAxis,
  fixed: number,
  h0: number,
  y0: number,
): Option.Option<PortalFrame> => {
  // Walk to the bottom-left interior corner. The caller has already established
  // that the anchor itself is AIR, so both counts are at least 1 and the `- 1`
  // cannot push the corner past the anchor.
  const bottomY = y0 - (countAir(blockAt, axis, fixed, h0, y0, 0, -1, MAX_PORTAL_HEIGHT + 1) - 1)
  const leftH = h0 - (countAir(blockAt, axis, fixed, h0, bottomY, -1, 0, MAX_PORTAL_WIDTH + 1) - 1)

  // Measure the interior from that corner, one past the maximum in each axis.
  const width = countAir(blockAt, axis, fixed, leftH, bottomY, 1, 0, MAX_PORTAL_WIDTH + 1)
  const height = countAir(blockAt, axis, fixed, leftH, bottomY, 0, 1, MAX_PORTAL_HEIGHT + 1)

  if (width < MIN_PORTAL_WIDTH) return Option.none()
  if (width > MAX_PORTAL_WIDTH) return Option.none()
  if (height < MIN_PORTAL_HEIGHT) return Option.none()
  if (height > MAX_PORTAL_HEIGHT) return Option.none()

  // The bottom row and left column were measured; the rest of the rectangle was
  // not. An L-shaped cavity passes both measurements and is not a portal, so the
  // interior is swept in full.
  for (let h = leftH; h < leftH + width; h++) {
    for (let y = bottomY; y < bottomY + height; y++) {
      if (probe(blockAt, axis, fixed, h, y) !== BLOCK.AIR) return Option.none()
    }
  }

  // The obsidian ring, corners EXCLUDED. Requiring corners would reject the
  // four-cornerless portal that vanilla accepts and that players actually build
  // to save obsidian; `generatePortalLayout` below still fills them in, because
  // building a corner is free and detecting one is a rule.
  for (let h = leftH; h < leftH + width; h++) {
    if (probe(blockAt, axis, fixed, h, bottomY - 1) !== BLOCK.OBSIDIAN) return Option.none()
    if (probe(blockAt, axis, fixed, h, bottomY + height) !== BLOCK.OBSIDIAN) return Option.none()
  }
  for (let y = bottomY; y < bottomY + height; y++) {
    if (probe(blockAt, axis, fixed, leftH - 1, y) !== BLOCK.OBSIDIAN) return Option.none()
    if (probe(blockAt, axis, fixed, leftH + width, y) !== BLOCK.OBSIDIAN) return Option.none()
  }

  const interior: BlockPosition[] = []
  for (let h = leftH; h < leftH + width; h++) {
    for (let y = bottomY; y < bottomY + height; y++) {
      interior.push(positionAt(axis, fixed, h, y))
    }
  }

  return Option.some({ axis, width, height, interior })
}

/**
 * Detects a valid Nether portal frame around `ignition`.
 *
 * `ignition` is the cell something is trying to light — the interior cell a
 * flint and steel was used on, or any interior cell when verifying a generated
 * structure. Any interior cell resolves the same frame, because detection walks
 * to the bottom-left corner first rather than assuming it was handed one.
 *
 * The X plane is tried before the Z plane. A cell can in principle be the
 * interior of a valid frame in both planes at once (two portals sharing one
 * hole), and this makes the answer deterministic rather than correct: there is
 * no correct answer to pick, and a deterministic one at least means detection
 * and any later re-detection of the same world agree.
 *
 * Returns `None` when the ignition cell is not AIR. A frame whose interior is
 * already full of portal blocks is therefore NOT detected, which is the
 * behaviour the caller wants — an already-lit portal is not a portal waiting to
 * be lit — and is why this rule does not need to name the portal block at all.
 */
export const detectNetherPortal = (blockAt: BlockAt, ignition: BlockPosition): Option.Option<PortalFrame> => {
  if (blockAt(ignition.x, ignition.y, ignition.z) !== BLOCK.AIR) return Option.none()
  return Option.orElse(detectInPlane(blockAt, 'x', ignition.z, ignition.x, ignition.y), () =>
    detectInPlane(blockAt, 'z', ignition.x, ignition.z, ignition.y),
  )
}

/** The cells a portal occupies: its obsidian ring, and the hole inside it. */
export type PortalLayout = {
  /** The complete rectangular ring, corners INCLUDED. */
  readonly frame: ReadonlyArray<BlockPosition>
  /** The interior cells, which stay AIR until something lights them. */
  readonly interior: ReadonlyArray<BlockPosition>
}

/**
 * Generates the cells of a portal whose interior bottom-left corner is `origin`.
 *
 * This is the inverse of `detectNetherPortal`, and it is in this repository for
 * a reason `docs/responsibility.md` §1 already states: plan.md §3.7 gives
 * mc-worldgen 「構造物（村/ポータル/End）」, and a generated portal is a structure.
 *
 * It also makes detection FALSIFIABLE. A detector tested only against frames a
 * test file spelled out by hand is tested against one author's idea of a portal;
 * `test/portal-frame.test.ts` instead sweeps every legal size through this
 * function and back through detection, which is a test the two would have to
 * agree to break together. It is the same reason `test/carver.test.ts` searches
 * for its fixture instead of hard-coding one.
 *
 * The ring here includes the corners even though detection does not require
 * them: generating a portal with four holes in it to demonstrate that the four
 * holes are legal would be showing off at the expense of the thing built.
 */
export const generatePortalLayout = (
  origin: BlockPosition,
  axis: PortalAxis,
  width: number,
  height: number,
): PortalLayout => {
  const fixed = axis === 'x' ? origin.z : origin.x
  const leftH = axis === 'x' ? origin.x : origin.z
  const bottomY = origin.y

  const interior: BlockPosition[] = []
  for (let h = leftH; h < leftH + width; h++) {
    for (let y = bottomY; y < bottomY + height; y++) {
      interior.push(positionAt(axis, fixed, h, y))
    }
  }

  // The bounding rectangle one cell larger on every side, minus its inside. A
  // cell is on the ring exactly when it sits on the outer row or column.
  const frame: BlockPosition[] = []
  for (let h = leftH - 1; h <= leftH + width; h++) {
    for (let y = bottomY - 1; y <= bottomY + height; y++) {
      if (h === leftH - 1 || h === leftH + width || y === bottomY - 1 || y === bottomY + height) {
        frame.push(positionAt(axis, fixed, h, y))
      }
    }
  }

  return { frame, interior }
}
