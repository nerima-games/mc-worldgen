---
"@nerima-games/mc-worldgen": minor
---

Add atomic copy-on-write `prepare`/`publish` writes with typed stale and invalid-token failures. Publishing copies changed block buffers so earlier read references retain their values. Block and biome helpers also accept readonly chunk views.
