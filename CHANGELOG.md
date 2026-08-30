# @nerima-games/mc-worldgen

## 0.3.0

### Minor Changes

- [#19](https://github.com/nerima-games/mc-worldgen/pull/19) [`38a1152`](https://github.com/nerima-games/mc-worldgen/commit/38a11525e2356ed35c71b8806bd46ca88dc1f6ec) Thanks [@takeokunn](https://github.com/takeokunn)! - Remove the duplicate `domain/portal-frame.ts` (export set identical to `@nerima-games/mc-kernel`'s) and repoint `nether-travel.ts`, its tests, and the `preview-terrain` app to import `detectNetherPortal`, `generatePortalLayout`, `PortalFrame`, `PortalLayout`, `PortalAxis`, `BlockAt`, and the `MIN_PORTAL_*`/`MAX_PORTAL_*` bounds from `@nerima-games/mc-kernel` (pinned to 0.5.1). `detectNetherPortal` now returns `PortalFrame | undefined` (kernel's convention) instead of `Option.Option<PortalFrame>`; callers that pattern-matched on `Option` have been updated. `src/index.ts` no longer re-exports these symbols — consumers must import them from `@nerima-games/mc-kernel` directly.

### Patch Changes

- [#18](https://github.com/nerima-games/mc-worldgen/pull/18) [`6509a2f`](https://github.com/nerima-games/mc-worldgen/commit/6509a2fb62338c026aa9cd60f49ce7dafc13623e) Thanks [@takeokunn](https://github.com/takeokunn)! - Complete the org toolchain devDependency pin set: knip 6.33.0 (its verify gate arrives in Wave 3; the pin belongs to the Wave 0 table) plus @effect/vitest 0.30.0 where it was missing.

## 0.2.1

### Patch Changes

- [#16](https://github.com/nerima-games/mc-worldgen/pull/16) [`01e756d`](https://github.com/nerima-games/mc-worldgen/commit/01e756d8a37fca67ef240a4d7eb673db294e603b) Thanks [@takeokunn](https://github.com/takeokunn)! - Restore village availability under the expanded biome classifier (worldgen-village-availability). `feat(worldgen): expand climate biome classifier` (2026-08-08) fragmented PLAINS to ~6.6% of real terrain, a week after the single-candidate-per-region village siting design shipped assuming PLAINS was common and contiguous — villages had become effectively extinct on real terrain (zero found within a 1681-region radius-200-chunk search for several seeds). Fixed by trying up to `VILLAGE_SITE_ATTEMPTS` (64) independent seeded candidate offsets per region instead of one, and raising `VILLAGE_REGION_SPAWN_PERMILLE` from 120 to 500 (matching this file's existing `STRONGHOLD_REGION_SPAWN_PERMILLE` precedent) — retries alone cannot help a region whose presence roll was never selected in the first place. Determinism is unchanged: same seed still produces the same village layout. Added a real-sampler availability battery (25 seeds, ≤48 chunk rings) that would have caught the original regression.

## 0.2.0

### Minor Changes

- [#14](https://github.com/nerima-games/mc-worldgen/pull/14) [`02e57c1`](https://github.com/nerima-games/mc-worldgen/commit/02e57c1fe1471e913e580630fad62d7a53b49465) Thanks [@takeokunn](https://github.com/takeokunn)! - Adopted @nerima-games/mc-save 0.3.0's new contract: removed `MigrationError` from the exported `ChunkPersistenceError` and `PortalRegistryPersistenceError` unions (mc-save dropped its migration-chain feature — `SaveFormat.migrations` and `validateMigrationChain` no longer exist), and switched the two tests that write directly through `StoragePort.put` to seal their envelopes with mc-save's `sealSaveEnvelope()`, since `SaveEnvelope.integrity` is now required. No change to chunk or portal-registry persistence behavior; `application/chunk-persistence.ts` and `application/portal-registry.ts` already went through mc-save's own `saveTo`/`loadFrom`, which seal internally.

- [#14](https://github.com/nerima-games/mc-worldgen/pull/14) [`02e57c1`](https://github.com/nerima-games/mc-worldgen/commit/02e57c1fe1471e913e580630fad62d7a53b49465) Thanks [@takeokunn](https://github.com/takeokunn)! - Toolchain frozen to org pin set (TypeScript 7.0.2, vitest 4.1.11, effect 3.22.1, node 24, pnpm 11.24.0); build switched to tsc emit; release workflow added
  
  mc-save 0.3.0 and mc-noise 0.3.0 adopted; mc-save no longer provides a migration chain, so error unions no longer include MigrationError.

### Patch Changes

- [#11](https://github.com/nerima-games/mc-worldgen/pull/11) [`f517022`](https://github.com/nerima-games/mc-worldgen/commit/f517022d099f343b96f2b8fe19bcd9f45a5f8216) Thanks [@takeokunn](https://github.com/takeokunn)! - Fix the CI lint gate: scope oxlint strictness so `test/**`, `scripts/**` and
  `apps/**` get overrides for rules that fire on patterns those directories use
  by design (literal expected values, terse fixtures, console-reporting
  scripts), while `src/**` stays fully strict. Every remaining `src/**`
  violation was fixed in source — named constants replacing magic numbers,
  `if`/`else` replacing ternaries, extracted helper functions replacing
  over-long functions, and parameters bundled into options objects where a
  function had grown past four positional arguments.
  
  No public API changes: `src/index.ts`'s re-exports are unchanged. Three
  internal (non-exported) functions changed shape to fix `max-params` —
  `growVein`, `carveRavines`, and `plantGroundCover` now take an options/target
  object instead of several positional parameters; `chunk.ts`'s `setBlockAt`
  switched its trailing four positional parameters to a labeled rest tuple,
  which type-checks identically at every existing call site.

- [`2bcf227`](https://github.com/nerima-games/mc-worldgen/commit/2bcf227ede8db34b4919340943dc26a36726d3f2) Thanks [@takeokunn](https://github.com/takeokunn)! - Add deterministic End terrain generation with a central island, void ring, outer islands, and End biome serialization.

- [`b32d504`](https://github.com/nerima-games/mc-worldgen/commit/b32d504f7c040f0b1e2a5d69d702fc53b7328009) Thanks [@takeokunn](https://github.com/takeokunn)! - Migrate to the nerima-games org standard (MIGRATION_RUNBOOK.md): move shipped
  source under `src/`, drop the bespoke `api-lock` and
  `check-dependency-whitelist` tooling in favour of `oxlint`'s
  `no-restricted-imports`, SHA-pin third-party GitHub Actions, add Dependabot,
  and adopt changesets.
  
  Also fixes a dependency-graph drift flagged by DEPENDENCY_POLICY.md §4:
  `package.json#dependencies` now declares `@nerima-games/mc-kernel` (0.2.8) and
  `@nerima-games/mc-save` (0.1.0), matching the parents `docs/architecture.md`
  has always said this package depends on.
  `@nerima-games/mc-noise` is intentionally NOT added yet — it has never been
  published to GitHub Packages (confirmed with an authenticated request, which
  returned 404), so declaring it as a dependency today would break `pnpm
  install` for every consumer. That remains open until mc-noise is published.
  
  No public API changes: `src/index.ts`'s re-exports are unchanged.

- [#13](https://github.com/nerima-games/mc-worldgen/pull/13) [`9ef0ea3`](https://github.com/nerima-games/mc-worldgen/commit/9ef0ea3f2cff8c8293d586c5b6e9f24edee603af) Thanks [@takeokunn](https://github.com/takeokunn)! - Land the local main: complete worldgen implementation and artifact verification.
