---
"@nerima-games/mc-worldgen": minor
---

Remove the duplicate `domain/portal-frame.ts` (export set identical to `@nerima-games/mc-kernel`'s) and repoint `nether-travel.ts`, its tests, and the `preview-terrain` app to import `detectNetherPortal`, `generatePortalLayout`, `PortalFrame`, `PortalLayout`, `PortalAxis`, `BlockAt`, and the `MIN_PORTAL_*`/`MAX_PORTAL_*` bounds from `@nerima-games/mc-kernel` (pinned to 0.5.1). `detectNetherPortal` now returns `PortalFrame | undefined` (kernel's convention) instead of `Option.Option<PortalFrame>`; callers that pattern-matched on `Option` have been updated. `src/index.ts` no longer re-exports these symbols — consumers must import them from `@nerima-games/mc-kernel` directly.
