---
"@nerima-games/mc-worldgen": patch
---

Migrate to the nerima-games org standard (MIGRATION_RUNBOOK.md): move shipped
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
