---
"@nerima-games/mc-worldgen": minor
---

Follow the published mc-kernel, mc-noise, and mc-save contracts and adopt the kernel-owned dimension and chunk-key brands. This is a breaking public-type migration: `ChunkKey` is removed from the `@nerima-games/mc-worldgen` root export and consumers must import it from `@nerima-games/mc-kernel`; `chunkKeyOf` remains exported by worldgen. The public generation buffer and worldgen-specific biome vocabulary remain unchanged. The audited downstream source trees (mc-sim, mc-render, mc-playground-kit, and mc-compose) contain no `ChunkKey` import from worldgen.
