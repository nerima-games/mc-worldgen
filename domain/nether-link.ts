/**
 * The COORDINATE RELATION between the Overworld and the Nether.
 *
 * One block travelled in the Nether is eight blocks travelled in the Overworld.
 * That ratio, the scaling in both directions, and the search for an existing
 * portal near a scaled destination are the whole of this file. Nothing below
 * reads a block, holds a state, or knows what an entity is: it maps coordinates
 * to coordinates, which is the same kind of thing `@nerima-games/mc-kernel`'s
 * `chunkCoordOfBlock` is.
 *
 * ---------------------------------------------------------------------------
 * Why this is in mc-worldgen, and where that was already settled
 * ---------------------------------------------------------------------------
 *
 * `docs/responsibility.md` §6's closing table had already adjudicated this file
 * before a line of it was written, under the heading 「残りの半分は誰のものか」:
 *
 *   `overworldToNether` / `netherToOverworld`  ->  **ここ**（未移植）
 *   `findNearestPortal`                        ->  **ここ**（未移植、注記つき）
 *
 * The reason recorded there is the reason it is here: 「8:1 の座標スケーリング。
 * 2 つの次元の座標空間の関係であって、入力も出力も座標しかない」. This commit is
 * that row's 未移植 being spent, not a new argument.
 *
 * The NOTE on `findNearestPortal` is spent too, and it is spent by KEEPING it.
 * §6 says the nearest-portal search belongs here 「ただし『世界に存在するポータル
 * の一覧』を所有するのが誰かは別問題で、それはまだ誰にも割り当てられていない」.
 * That is exactly why `candidates` is a PARAMETER — the same injection shape as
 * `./portal-frame`'s `BlockAt` and `./constants`' `TerrainLevels` — and the
 * unassigned owner stays unassigned rather than being decided here by accident.
 * The reference implementation's owner is a service
 * (`packages/world/application/nether-service.ts`, `getPortals(dimension)`), and
 * a service is a noun with a save file behind it; this repository is not going
 * to grow one as a side effect of porting a distance comparison.
 *
 * ---------------------------------------------------------------------------
 * Constants, cited or declared unjustified
 * ---------------------------------------------------------------------------
 *
 * `docs/testing.md` §4-b records that this repository has shipped a constant
 * justified by a measurement of the wrong population three separate times, so
 * every number here says where it came from.
 *
 * `NETHER_HORIZONTAL_RATIO = 8` — TRANSCRIBED, and corroborated. The reference's
 * `packages/world/domain/nether/nether-link.ts:16` declares it, and its header
 * states the rule it encodes in prose (「one block travelled in the Nether
 * corresponds to eight blocks in the Overworld」). I am not going to dress a
 * recollection of the vanilla ratio up as a derivation, but unlike
 * `MAX_PORTAL_WIDTH` this one is not merely carried: it is USED IN BOTH
 * DIRECTIONS by two functions that must invert each other, and
 * `test/nether-travel.test.ts` pins the round trip. A wrong value there is a
 * failing test rather than a silent halving of the Nether.
 */
import { Option } from 'effect'
import { blockPosition, type BlockPosition } from "@nerima-games/mc-kernel"

/**
 * Overworld blocks per Nether block, on the horizontal axes only.
 *
 * `packages/world/domain/nether/nether-link.ts:16`.
 */
export const NETHER_HORIZONTAL_RATIO = 8

/**
 * Scale an Overworld cell into the Nether.
 *
 * `Math.floor` rather than a truncation, which matters and is the reference's
 * own choice (`nether-link.ts:20-22`): `-1 / 8` truncates to `-0` and floors to
 * `-1`, and only the second keeps the mapping monotone across the origin. It is
 * the same `floorDiv` `@nerima-games/mc-kernel`'s `chunkCoordOfBlock` uses to find
 * the chunk that owns a cell, for the same reason and with the same argument.
 *
 * Y IS CARRIED ACROSS UNCHANGED. The reference's header says callers clamp it to
 * the destination dimension's build height; this repository has no Nether build
 * height to clamp to — `./constants` describes one world — so the clamp is the
 * caller's in fact and not merely by convention. Naming a Nether ceiling here
 * would be inventing a number no generator in this repository honours.
 */
export const overworldToNether = (pos: BlockPosition): BlockPosition =>
  blockPosition(
    Math.floor(pos.x / NETHER_HORIZONTAL_RATIO),
    pos.y,
    Math.floor(pos.z / NETHER_HORIZONTAL_RATIO),
  )

/**
 * Scale a Nether cell back into the Overworld.
 *
 * NOT the inverse of `overworldToNether`, and the asymmetry is the rule rather
 * than a defect: eight Overworld cells share one Nether cell, so the round trip
 * Overworld -> Nether -> Overworld lands on the multiple of eight at or below
 * where it started. Nether -> Overworld -> Nether IS the identity.
 * `test/nether-travel.test.ts` pins both directions, because a "round trips"
 * test that only ran the identity direction would pass on an implementation
 * that had quietly made the lossy direction lossless.
 */
export const netherToOverworld = (pos: BlockPosition): BlockPosition =>
  blockPosition(pos.x * NETHER_HORIZONTAL_RATIO, pos.y, pos.z * NETHER_HORIZONTAL_RATIO)

/** Squared Euclidean distance. Squared because nothing here needs the root. */
const distanceSquared = (a: BlockPosition, b: BlockPosition): number => {
  const dx = a.x - b.x
  const dy = a.y - b.y
  const dz = a.z - b.z
  return dx * dx + dy * dy + dz * dz
}

/**
 * The portal nearest to `target` within `maxDistance`, or `None`.
 *
 * Euclidean and THREE-DIMENSIONAL, including the Y term, which is the
 * reference's shape (`nether-link.ts:32-37`) and worth stating because a
 * horizontal-only search is the plausible alternative and would answer a
 * different question.
 *
 * TIES RESOLVE TO THE EARLIEST CANDIDATE. The comparison keeps the incumbent on
 * an exact tie, which models 「reuse the first portal found」 — and, more
 * usefully here, makes the answer a function of the candidate ORDER rather than
 * of floating-point luck. Whoever eventually owns the portal list therefore owns
 * the tie-break too, and can make it deterministic by ordering the list.
 *
 * ONE DELIBERATE DIVERGENCE FROM THE REFERENCE, declared rather than hidden. The
 * reference computes `maxDistance * maxDistance` unguarded, so a NEGATIVE radius
 * squares into a POSITIVE acceptance window and a caller asking for "nothing
 * within -1 blocks" gets everything within 1. That is the non-inert direction:
 * it silently reuses a portal where the caller asked for none. A non-finite or
 * negative radius here accepts nothing instead, which is what the words mean.
 * The reachable case — `resolveNetherTravel`'s default of 128 — is unaffected,
 * and `test/nether-travel.test.ts` pins the guard so that a later "simplification"
 * back to the reference's arithmetic fails a named test.
 */
export const findNearestPortal = (
  candidates: ReadonlyArray<BlockPosition>,
  target: BlockPosition,
  maxDistance: number,
): Option.Option<BlockPosition> => {
  if (!Number.isFinite(maxDistance) || maxDistance < 0) {
    return Option.none()
  }
  const maxSq = maxDistance * maxDistance

  return candidates.reduce<Option.Option<BlockPosition>>((best, candidate) => {
    const candidateSq = distanceSquared(candidate, target)
    if (candidateSq > maxSq) {
      return best
    }
    const incumbent = Option.getOrNull(best)
    if (incumbent === null) {
      return Option.some(candidate)
    }
    return distanceSquared(incumbent, target) <= candidateSq ? best : Option.some(candidate)
  }, Option.none())
}
