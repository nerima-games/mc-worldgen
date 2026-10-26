/**
 * @nerima-games/mc-worldgen — biomes, terrain, carvers and vegetation.
 *
 * This package exposes the current generation API and its domain types.
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
export * from './domain/biome.js'
export * from './domain/biome-classifier.js'
export * from './domain/carver.js'
export { biomeAt, columnIndex, getBlockAt, readBlock } from './domain/chunk.js'
export type { Chunk } from './domain/chunk.js'
export { chunkCoord } from '@nerima-games/mc-kernel'
export { chunkKeyOf } from '@nerima-games/mc-kernel'
export type { ChunkCoord } from '@nerima-games/mc-kernel'
export { NoiseSeed } from '@nerima-games/mc-noise'
export { CHUNK_FORMAT } from './domain/chunk-format.js'
export {
  CHUNK_NOT_LOADED,
  EMPTY_DIRTY_BATCH,
  LIGHT_CHUNK_NOT_LOADED,
  LIGHT_OUT_OF_WORLD,
  OUT_OF_WORLD,
  WRITE_CHUNK_NOT_LOADED,
  WRITE_OUT_OF_WORLD,
  blockAt,
  blockReading,
  chunkSnapshotOf,
  drained,
  emptyChunkStoreState,
  isWorldY,
  lightAt,
  lightReading,
  neighboursOf,
  residentChunk,
  residentCoords,
  subscribed,
  unsubscribed,
  wasWritten,
  withBlockAt,
  withChunk,
  withoutChunk,
} from './domain/chunk-store-state.js'
export type {
  BlockReading,
  BlockWriteOutcome,
  ChunkDirtyBatch,
  ChunkNeighbours,
  ChunkStoreState,
  DirtySubscriberState,
  LightReading,
} from './domain/chunk-store-state.js'
export * from './domain/constants.js'
export * from './domain/end-features.js'
export * from './domain/end-gateway.js'
export * from './domain/end-terrain.js'
export * from './domain/end-vegetation.js'
export * from './domain/end-portal.js'
export * from './domain/light.js'
export {
  InvalidNaturalStructureCoordinate,
  MAX_NATURAL_STRUCTURE_BLOCKS,
  MAX_NATURAL_STRUCTURE_MARKERS,
  NATURAL_STRUCTURE_BLOCK,
  NATURAL_STRUCTURE_GRID,
  applyNaturalStructurePlansToChunk,
  naturalStructurePlansForChunk,
  naturalStructureSliceForChunk,
  planBastionRemnantForRegion,
  planCompactStructureForRegion,
  planDesertPyramidForRegion,
  planDesertWellForRegion,
  planEndCityForRegion,
  planIglooForRegion,
  planJunglePyramidForRegion,
  planMineshaftForRegion,
  planNaturalStructureForRegion,
  planOceanMonumentForRegion,
  planOceanRuinForRegion,
  planPillagerOutpostForRegion,
  planRuinedNetherPortalForRegion,
  planShipwreckForRegion,
  planStrongholdForRegion,
  planVillageForRegion,
} from './domain/natural-structure.js'
export type {
  AppliedNaturalStructureMarker,
  EndStructureTerrainSampler,
  NaturalStructureBlockPlacement,
  NaturalStructureBounds,
  NaturalStructureChunk,
  NaturalStructureChunkSlice,
  NaturalStructureGrid,
  NaturalStructureKind,
  NaturalStructureMarker,
  NaturalStructurePlan,
  NaturalStructurePlanResult,
  NaturalStructurePosition,
  NaturalStructureRegion,
  NaturalStructureRegionPlanRequest,
  NaturalStructureSamplers,
  NetherStructureTerrainSample,
  NetherStructureTerrainSampler,
} from './domain/natural-structure.js'
export {
  FORTRESS_BLAZE_RADIUS,
  FORTRESS_FLOOR_Y,
  FORTRESS_LAYOUT,
  FORTRESS_MIN_HEADROOM,
  FORTRESS_REGION_SIZE,
  FORTRESS_REGION_SPAWN_PERMILLE,
  FORTRESS_SITE_MARGIN,
  NETHER_FORTRESS_BLOCK,
  NETHER_FORTRESS_GRID,
  isNearFortressSite,
  planNetherFortressForRegion,
} from './domain/nether-fortress.js'
export * from './domain/nether-link.js'
export * from './domain/nether-terrain.js'
// `Dimension` is re-exported from worldgen for its existing public API, but the
// Canonical union and guard are owned by mc-kernel 0.9.0.
export * from './domain/nether-travel.js'
export * from './domain/portal-frame.js'
export * from './domain/portal-registry.js'
export * from './domain/portal-registry-format.js'
export {
  STRONGHOLD_FLOOR_Y,
  STRONGHOLD_REGION_SIZE,
  STRONGHOLD_REGION_SPAWN_PERMILLE,
  STRONGHOLD_SEARCH_RADIUS,
  STRONGHOLD_SITE_MARGIN,
  VILLAGE_HALF_EXTENT,
  VILLAGE_REGION_SIZE,
  VILLAGE_REGION_SPAWN_PERMILLE,
  VILLAGE_SITE_MARGIN,
  locateStronghold,
  nearestStrongholdSite,
  strongholdSiteForRegion,
  strongholdSitesNearChunk,
  villageSiteForRegion,
  villageSitesNearChunk,
} from './domain/structure-siting.js'
export type {
  OverworldTerrainSample,
  OverworldTerrainSampler,
  StrongholdOrigin,
  StrongholdSite,
  VillageSite,
} from './domain/structure-siting.js'
export * from './domain/stronghold.js'
export * from './domain/terrain.js'
export * from './domain/tree-placement.js'
export {
  VILLAGE_BLOCK,
  villageBlockAt,
  villageVillagerSpawnsForChunk,
  villageVillagerSpawnsForSite,
} from './domain/village.js'
export type { VillageVillagerProfession, VillageVillagerSpawn } from './domain/village.js'

// --- Application: Effect services -------------------------------------------
export * from './application/chunk-store.js'
export * from './application/chunk-persistence.js'
export * from './application/portal-registry.js'
export * from './application/terrain-worker-pool-port.js'
