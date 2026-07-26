/**
 * @nerima-games/mc-worldgen — biomes, terrain, carvers and vegetation.
 *
 * PRE-AUDIT FIRST CUT (叩き台). See README.md 現状.
 *
 * mc-worldgen is tier 2 of the four-tier architecture (plan.md §2.2): a
 * foundation that owns state and services — nouns — on which the experience
 * modules sit. It depends on mc-kernel, mc-noise and mc-save, and on nothing
 * else. In particular it contains no renderer: the reference implementation's
 * `packages/world` imports THREE.js zero times, and preserving that is what
 * lets world generation run in a worker, in Node, and in a test with no canvas.
 *
 * Two things to know before reading further:
 *
 *  1. **`SEA_LEVEL` is 63, not 48. `LAKE_LEVEL` is the same value, not 62.**
 *     plan.md §3.7 states both incorrectly. See `domain/constants.ts`.
 *  2. The carver's water-floor guard is not an improvement over the reference
 *     — it is a port OF the reference's fix. See `domain/carver.ts`.
 *  3. **`ChunkStore` lives here, not in mc-sim.** plan.md leaves the owner of
 *     the block WRITE path genuinely unassigned between §3.7 and §3.8; the
 *     argument for settling it here — and the one clause of §3.8 that
 *     settlement contradicts — is in `application/chunk-store.ts`'s header and
 *     in docs/public-api.md §6.
 */

// --- Domain: pure values and transitions -----------------------------------
export * from './domain/biome'
export * from './domain/carver'
export * from './domain/chunk'
export * from './domain/chunk-store-state'
export * from './domain/constants'
export * from './domain/kernel-vocabulary'
export * from './domain/seeded-random'
export * from './domain/terrain'
export * from './domain/tree-placement'

// --- Application: Effect services -------------------------------------------
export * from './application/chunk-store'
