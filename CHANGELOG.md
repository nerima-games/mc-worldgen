# @nerima-games/mc-worldgen

## 0.4.0

### Minor Changes

- [#25](https://github.com/nerima-games/mc-worldgen/pull/25) [`e3996be`](https://github.com/nerima-games/mc-worldgen/commit/e3996be8cb3a021597a061cbf78a8647ef302851) Thanks [@takeokunn](https://github.com/takeokunn)! - Widened the chunk block buffer from one byte per block (`Uint8Array`, ceiling 255) to two bytes per block (`Uint16Array`, ceiling `BLOCK_ID_MAX` = 65535), matching `@nerima-games/mc-kernel`'s own `BlockState` width. The registry currently tops out at id 122 (kernel 0.7.0), so nothing was truncating yet — this closes the gap before it could, as recorded in the 0.3.1 changeset. `domain/chunk.ts`'s `Chunk.blocks`, `emptyBlocks`, `readBlock` and `setBlockAt` all changed type; every generation-pass function that takes a block buffer (`terrain.ts`, `carver.ts`, `ravine.ts`, `ore.ts`, `vegetation.ts`, `lake-generator.ts`, `end-features.ts`, `end-vegetation.ts`, `natural-structure-application.ts`) changed its parameter type to match.
  
  The persisted chunk format (`domain/chunk-format.ts`) bumped from version 1 to version 2 and now encodes the block buffer as base64 over two bytes per element, little-endian, sized `CHUNK_VOLUME * BYTES_PER_ELEMENT` (kernel's own constant, not a second hardcoded `2`). `@nerima-games/mc-save`'s `decodeSave` has no automatic version-upgrade path (confirmed against mc-save's own `test/migration.test.ts`, 0.4.2) — the version 1 format is kept, unexported changes aside, as a read-only `CHUNK_FORMAT_V1`, and `application/chunk-persistence.ts` now tries `CHUNK_FORMAT` first and falls back to `CHUNK_FORMAT_V1` plus a new `migrateChunkV1ToV2` widening step when the stored envelope's version is 1. A world saved before this change still loads; every chunk saved after it is written in the v2 format, and nothing re-writes an untouched v1 save on load.
  
  `scripts/golden-fixture.ts`'s `blocksSha256` now hashes an explicit little-endian packing (`packBlocksV2`, newly exported from `domain/chunk-format.ts`) rather than a `Uint16Array`'s own host-endian memory, so the digest cannot depend on which machine produced it. `test/golden/chunk-goldens.json`'s sixteen `blocksSha256` entries all moved as a result — this is the storage width doubling the byte sequence being hashed, not a change to generated terrain; every other invariant the golden suite checks (bedrock floor, sea level, ore/tree/water counts, biome digests) is unchanged.
  
  No public API removed: `Chunk`, `emptyBlocks`, `readBlock`, `setBlockAt`, `computeWaterFloorYs`, `carveCaves` keep their names and are still exported from `src/index.ts`, only their `blocks` parameter's type widened. `CHUNK_FORMAT_V1`, `migrateChunkV1ToV2` and `packBlocksV2` are new named exports of `domain/chunk-format.ts`, used by `application/chunk-persistence.ts` and `scripts/golden-fixture.ts`; `src/index.ts` re-exports only `CHUNK_FORMAT` from that module (its existing, deliberately narrow barrel selection — see `src/index.ts:33`), so these three stay internal to the package rather than widening its public surface. A consumer that needs migration-aware loading already gets it through `makeChunkPersistence`/`ChunkPersistence.load`, which is exported.
  
  `typecheck`, `lint`, `test` (429/429), `test:coverage` (100% statements/branches/functions/lines), `build`, and `package:verify` all pass.

## 0.3.2

### Patch Changes

- [#23](https://github.com/nerima-games/mc-worldgen/pull/23) [`3b0a74c`](https://github.com/nerima-games/mc-worldgen/commit/3b0a74cd9a158609472e4f7b47229d5ca4943ac0) Thanks [@takeokunn](https://github.com/takeokunn)! - Align internal pins to the current published versions
  
  - `@nerima-games/mc-noise` to 0.3.1
  Each of these upstream releases contained a pin change and no source change,
  so no behaviour moves with this bump.

## 0.3.1

### Patch Changes

- [#21](https://github.com/nerima-games/mc-worldgen/pull/21) [`df269bd`](https://github.com/nerima-games/mc-worldgen/commit/df269bd3a57b7c8752929b898e2620cc7ebd2574) Thanks [@takeokunn](https://github.com/takeokunn)! - Pin `@nerima-games/mc-kernel` to 0.7.0 and `@nerima-games/mc-save` to 0.4.1. No source changes were required: this package never imports the kernel's binary chunk codec (`encodeChunk`/`decodeChunk`/`EncodedChunk`) — its own persisted chunk format (`domain/chunk-format.ts`) is an independent `Uint8Array`-per-block schema defined through `mc-save`'s `defineFormat`, unrelated to kernel's wire layout — and never consumes `BLOCK_ID_MAX`, whose meaning widened from an 8-bit ceiling (255) to a 16-bit one (65535) in this kernel release. The registry kernel 0.7.0 ships today still tops out at block id 122, well inside this package's own `Uint8Array` storage ceiling, so no truncation occurs; that ceiling is implicit in the generation buffer's storage type rather than derived from any kernel constant, and is worth re-checking if the registry ever grows past 256 entries. `typecheck`, `lint`, `test` (416/416), `test:coverage` (100% statements/branches/functions/lines), `build`, and `package:verify` all pass. The golden-chunk suite (`test/chunk-golden.test.ts`) reproduces its committed digests exactly, confirming generated terrain for the goldens' fixed seeds is byte-identical to before the bump.

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
