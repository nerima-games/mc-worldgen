---
"@nerima-games/mc-worldgen": minor
---

Enforce assertion-free TypeScript boundaries and align the supporting documentation. `ChunkKey` is now a branded string constructed by the chunk-key factory, so consumers can no longer pass arbitrary strings where a validated chunk key is required.
