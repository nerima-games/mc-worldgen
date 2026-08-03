/**
 * WHERE a portal comes out, and whether one has to be built there.
 *
 * The single decision made when something steps through a Nether portal: scale
 * the position into the opposite dimension, reuse the nearest existing portal
 * within `PORTAL_SEARCH_RADIUS`, and otherwise plan a fresh one at the scaled
 * point. It composes `./nether-link` (the coordinate relation) with
 * `./portal-frame`'s `generatePortalLayout` (the shape of a portal) and adds
 * nothing else.
 *
 * ---------------------------------------------------------------------------
 * `docs/responsibility.md` §6 PUT THIS FILE IN mx-gameplay. It is here, and the
 * reason it is here is not the reason §6 was refuted before.
 * ---------------------------------------------------------------------------
 *
 * §6's closing table reads, in the row for this rule:
 *
 *   `nether-travel.ts` の `resolveNetherTravel`  ->  **mx-gameplay**
 *   根拠: 「`playerPos` を受けて**プレイヤーをどこへ動かすか**を返す。
 *          plan.md §3.11 そのもの。上の 3 つを合成するだけなので、
 *          依存の向きも合っている」
 *
 * That row is not the 「位置を持つ実体を動かす」 category error §6 was written to
 * correct; it is a document citation, and plan.md §3.11 really does say
 * 「ポータル / 次元移動ルール」 is mx-gameplay's. So this file has to answer it
 * rather than dismiss it. Three things, in increasing order of weight:
 *
 *   THE ARGUMENT'S OWN SECOND CLAUSE POINTS THE OTHER WAY. 「上の 3 つを合成する
 *   だけ」 — and by §6's own table all three of those are mc-worldgen's:
 *   `overworldToNether`, `netherToOverworld` and `findNearestPortal` are the
 *   rows immediately above, and `generatePortalLayout` is already in
 *   `./portal-frame`. A composition placed away from all four of its parts is
 *   not a dependency direction that 「合っている」; it is four symbols crossing a
 *   repository boundary to save one from crossing it.
 *
 *   `playerPos` IS A `BlockPosition` HERE, AND THAT IS THE SAME EVIDENCE §6
 *   ALREADY ACCEPTED ONCE. §6's strongest argument for the detector is a line of
 *   code that disappeared in the port: the reference opens with
 *   `Math.floor(ignition.x)` because its `Position` is an entity's
 *   floating-point position, and the flooring had nothing left to do once the
 *   parameter was branded. The same thing happens here. The reference's
 *   `playerPos: Position` is an entity's; this parameter is a cell. Nothing in
 *   the signature below is entity-shaped, and nothing in the body knows what a
 *   player is — it is called `playerPos` only because that is the reference's
 *   name for the argument.
 *
 *   plan.md §3.11's 「遷移の発火」 IS SOMEWHERE ELSE, AND IT IS IN mx-gameplay.
 *   The clause names the FIRING of a transition, and firing is a timer: four
 *   seconds of standing in the portal block, then a cooldown before it may fire
 *   again. That rule is `mx-gameplay/domain/portal-dwell.ts`, it holds no
 *   coordinate at all, and it landed with this file. §3.11 is satisfied by that
 *   file rather than contradicted by this one — which is the same shape as
 *   §6's own settlement of the detector, where 「検出」 and 「点火」 went to
 *   different repositories and both readings of plan.md turned out to be right.
 *
 * What this file DOES NOT close is the row after it. Applying the plan — putting
 * something at `destination` and making a dimension current — needs an owner for
 * 「どの次元に居るのか」, and there is none: see the note on `Dimension` below.
 *
 * ---------------------------------------------------------------------------
 * Constants
 * ---------------------------------------------------------------------------
 *
 * `PORTAL_SEARCH_RADIUS = 128` — TRANSCRIBED, NOT JUSTIFIED, in the sense
 * `./portal-frame`'s `MAX_PORTAL_WIDTH` note defines: the reference declares it
 * at `packages/world/domain/nether/nether-travel.ts:20` and calls it 「Vanilla
 * search radius」, and I could not derive 128 from anything in the reference or
 * in this repository. What the code needs from it is weaker than the number: it
 * is a REUSE bound only. Too large reuses a portal further away than a player
 * would expect; too small builds a second portal beside an existing one. Neither
 * is a correctness failure, which is why it is a defaulted parameter rather than
 * a fixed constant — the caller that eventually owns the portal list can pass
 * its own without editing this file.
 *
 * `DEFAULT_PORTAL_WIDTH = 2` / `DEFAULT_PORTAL_HEIGHT = 3` — JUSTIFIED, and this
 * is the OTHER END of the corroboration `./portal-frame`'s bounds note relies
 * on. That file argues `MIN_PORTAL_WIDTH`/`MIN_PORTAL_HEIGHT` are justified
 * because a second reference file — this one, at `nether-travel.ts:23-24` —
 * independently defines the auto-generated size as 2 x 3 with the comment
 * 「Auto-generated portals use the vanilla minimum interior」. Now that both ends
 * are in this repository the corroboration is checkable rather than cited:
 * `test/nether-travel.test.ts` runs a planned portal back through
 * `detectNetherPortal`, so a generator that stopped agreeing with the detector's
 * minimum fails a named test instead of producing an unlightable portal.
 *
 * `DEFAULT_PORTAL_AXIS = 'x'` — TRANSCRIBED. The reference passes the literal
 * `'x'` at `nether-travel.ts:47`. There is no correct answer (a destination
 * cell has no preferred orientation), and a deterministic one at least means two
 * runs over one world plan the same portal — the same reasoning
 * `detectNetherPortal` gives for trying the X plane before the Z plane.
 */
import { Option } from 'effect'
import { type BlockPosition } from './kernel-vocabulary'
import { findNearestPortal, netherToOverworld, overworldToNether } from './nether-link'
import { generatePortalLayout, type PortalAxis, type PortalLayout } from './portal-frame'

/**
 * Which world a cell is in.
 *
 * OWNED HERE. THIS REPOSITORY IS CLAIMING THE WORD, and until recently it was
 * explicitly not — the paragraph this replaces read 「DECLARED HERE
 * PROVISIONALLY, AND THIS REPOSITORY IS NOT CLAIMING THE WORD」 and nominated
 * mc-kernel. The nomination was reasonable and it was not taken.
 *
 * WHAT DECIDED IT was not a new measurement. `docs/responsibility.md` §6's
 * finding still holds exactly as recorded — 「**mc-kernel には `Dimension` 型が
 * 無い**」, re-measured again here and still returning one unrelated comment in
 * `block-registry.ts` — so kernel remained a candidate rather than an incumbent.
 * What changed is that the reference declares its `Dimension` in
 * `packages/world` (`nether-travel.ts:17`), which IS this repository, and a
 * noun's owner being the repository that already owns the rule reading it beats
 * a noun's owner being the repository everything happens to depend on.
 *
 * THE WITHHOLDING HAS THEREFORE EXPIRED. The previous paragraph justified
 * keeping this off `index.ts` on the ground that 「A consumer cannot come to
 * depend on the spelling because no consumer can see it」, which was the right
 * caution for a word with no owner and is a defect for a word with one: mc-sim
 * must record which dimension a player is in, and a name mirrored from a module
 * no barrel exports cannot be repointed. It is published — see `index.ts`.
 *
 * THE HAZARD THAT REPLACES IT is the one plan.md §3.4 describes, 「二つの綴り」,
 * and it is now this repository's to prevent rather than to avoid: the reference
 * itself declares `Dimension` TWICE (`packages/world/domain/nether/nether-travel
 * .ts:17` and `packages/worker/domain/terrain-worker-protocol.ts:18`). Consumers
 * mirror this declaration and only this one; `mc-dev-meta`'s `check:mirrors`
 * is what makes that checkable rather than hoped for.
 *
 * `'end'` is in the union and is NOT a destination of this rule — see
 * `resolveNetherTravel`. It is here because omitting it would make the union
 * describe two dimensions while the reference's `Dimension`
 * (`nether-travel.ts:17`) describes three, and a mirror of two-thirds of a type
 * is the drift every mirror header in the organisation is about.
 */
export type Dimension = 'overworld' | 'nether' | 'end'

/** How far from the scaled destination an existing portal may be and still be reused. */
export const PORTAL_SEARCH_RADIUS = 128

/** The vanilla minimum interior, which is what an auto-generated portal gets. */
const DEFAULT_PORTAL_WIDTH = 2
const DEFAULT_PORTAL_HEIGHT = 3

/** Deterministic rather than correct; see the header. */
const DEFAULT_PORTAL_AXIS: PortalAxis = 'x'

export type PortalTravelPlan = {
  readonly toDimension: Dimension
  /**
   * Where the traveller comes out.
   *
   * When a portal was reused this is THAT PORTAL'S recorded cell rather than the
   * scaled point — the reference does the same (`nether-travel.ts:43`), and the
   * distinction is the whole value of the search: arriving at the scaled point
   * next to an existing portal, rather than at it, is how a world grows two
   * portals ten blocks apart.
   */
  readonly destination: BlockPosition
  /** The portal to build, or `None` when an existing one is being reused. */
  readonly portalToCreate: Option.Option<PortalLayout>
}

/**
 * Resolve where a Nether portal at `playerPos` in `from` comes out.
 *
 * TOTAL and pure. The same four arguments always give the same plan, which is
 * what lets `test/nether-travel.test.ts` enumerate the rule rather than sample
 * it, and it is why this file has no `Effect` in it despite sitting one call
 * away from a chunk write.
 *
 * `from === 'end'` RETURNS TO THE OVERWORLD, which is a transcription of the
 * reference's branch (`nether-travel.ts:40-41`, where anything that is not
 * `'overworld'` maps to `'overworld'`) and NOT an End-portal rule. The reference
 * handles the End in a separate function (`applyEndPortalTravel`) that never
 * calls this one, and its comment says so: 「End dimension is handled separately
 * via End portal; nether portals only toggle overworld<->nether」. What this
 * branch means is "a nether portal in a dimension that has no nether link takes
 * you to the Overworld", and it is reachable only if a caller builds one there.
 * It is pinned by a test so that the behaviour is a decision rather than a
 * fall-through nobody looked at.
 *
 * `knownPortals` ARE THE DESTINATION DIMENSION'S. This rule cannot check that —
 * a `BlockPosition` does not say which world it is in, which is the same missing
 * `Dimension` noun as above — so it is a calling convention, and it is the
 * reference's (`physics-stage-portal.ts:55-57` fetches `getPortals` for the
 * destination before calling). Passing the SOURCE dimension's portals would
 * silently reuse a portal in the world being left, and no type here would stop
 * it. Naming the hazard is the most this file can do about it.
 */
export const resolveNetherTravel = (
  from: Dimension,
  playerPos: BlockPosition,
  knownPortals: ReadonlyArray<BlockPosition>,
  searchRadius: number = PORTAL_SEARCH_RADIUS,
): PortalTravelPlan => {
  const toDimension: Dimension = from === 'overworld' ? 'nether' : 'overworld'
  const destination = from === 'overworld' ? overworldToNether(playerPos) : netherToOverworld(playerPos)
  const nearest = Option.getOrNull(findNearestPortal(knownPortals, destination, searchRadius))

  if (nearest !== null) {
    return { toDimension, destination: nearest, portalToCreate: Option.none() }
  }

  return {
    toDimension,
    destination,
    portalToCreate: Option.some(
      generatePortalLayout(destination, DEFAULT_PORTAL_AXIS, DEFAULT_PORTAL_WIDTH, DEFAULT_PORTAL_HEIGHT),
    ),
  }
}
