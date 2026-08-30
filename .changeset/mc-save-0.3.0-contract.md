---
"@nerima-games/mc-worldgen": minor
---

Adopted @nerima-games/mc-save 0.3.0's new contract: removed `MigrationError` from the exported `ChunkPersistenceError` and `PortalRegistryPersistenceError` unions (mc-save dropped its migration-chain feature — `SaveFormat.migrations` and `validateMigrationChain` no longer exist), and switched the two tests that write directly through `StoragePort.put` to seal their envelopes with mc-save's `sealSaveEnvelope()`, since `SaveEnvelope.integrity` is now required. No change to chunk or portal-registry persistence behavior; `application/chunk-persistence.ts` and `application/portal-registry.ts` already went through mc-save's own `saveTo`/`loadFrom`, which seal internally.
