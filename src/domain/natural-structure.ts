/** Deterministic, immutable plans for cross-chunk natural structures. */
import { type BastionRemnantDraft, planBastionRemnantForCandidate } from './bastion-remnant.js'
import {
  COMPACT_STRUCTURE_KINDS,
  type CompactStructureKind,
} from './compact-structure-data.js'
import {
  type Candidate,
  type CandidateChannelInput,
  type InvalidNaturalStructureCoordinate,
  type MutablePlan,
  UNIT_STEP,
  addBlock,
  addMarker,
  candidateForRegion,
  finishPlan,
  finishPlanFromValidatedPlacements,
  validateNaturalStructureRegion,
} from './natural-structure-plan-builder.js'
import { type CompactStructureDraft, planCompactStructureForCandidate } from './compact-structure.js'
import { type DesertPyramidDraft, planDesertPyramidForCandidate } from './desert-pyramid.js'
import { type DesertWellDraft, planDesertWellForCandidate } from './desert-well.js'
import { type IglooDraft, planIglooForCandidate } from './igloo.js'
import { type JunglePyramidDraft, planJunglePyramidForCandidate } from './jungle-pyramid.js'
import { type MineshaftDraft, planMineshaftForCandidate } from './mineshaft.js'
import type {
  NaturalStructureKind,
  NaturalStructurePlan,
  NaturalStructureRegion,
  NaturalStructureSamplers,
  NetherStructureTerrainSampler,
} from './natural-structure-types.js'
import {
  type NaturalStructureRegionPlanRequest,
  naturalStructurePlansForChunk as enumerateNaturalStructurePlansForChunk,
} from './natural-structure-chunk-planner.js'
export type { NaturalStructureRegionPlanRequest } from './natural-structure-chunk-planner.js'
import { type OceanMonumentDraft, planOceanMonumentForCandidate } from './ocean-monument.js'
import { type OceanRuinDraft, planOceanRuinForCandidate } from './ocean-ruin.js'
import { Option, Predicate, Result } from 'effect'
import {
  type OverworldTerrainSampler,
  VILLAGE_HALF_EXTENT,
  type VillageSite,
  villageSiteForRegion,
} from './structure-siting.js'
import { type PillagerOutpostDraft, planPillagerOutpostForCandidate } from './pillager-outpost.js'
import { type ShipwreckDraft, planShipwreckForCandidate } from './shipwreck.js'
import { type VillageVillagerSpawn, villageBlockAt, villageVillagerSpawnsForSite } from './village.js'
import { CHUNK_HEIGHT } from './constants.js'
import type { ChunkCoord, Dimension } from '@nerima-games/mc-kernel'
import { blockAxisFromKnownSafeInteger } from './coordinate-compatibility.js'
import { NATURAL_STRUCTURE_BLOCK } from './natural-structure-data.js'
import { planEndCityForRegion } from './natural-structure-end-city.js'
import { planNetherFortressForRegion } from './nether-fortress.js'
import { planRuinedNetherPortalForRegion } from './natural-structure-portal.js'
import { planStrongholdForRegion } from './stronghold-structure.js'

export { NATURAL_STRUCTURE_BLOCK } from './natural-structure-data.js'
export {
  MAX_NATURAL_STRUCTURE_BLOCKS,
  MAX_NATURAL_STRUCTURE_MARKERS,
  NATURAL_STRUCTURE_GRID,
} from './natural-structure-grid-data.js'
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
  NaturalStructurePosition,
  NaturalStructureRegion,
  NaturalStructureSamplers,
  NetherStructureTerrainSample,
  NetherStructureTerrainSampler,
} from './natural-structure-types.js'
export {
  applyNaturalStructurePlansToChunk,
  naturalStructureSliceForChunk,
} from './natural-structure-application.js'
export { planEndCityForRegion } from './natural-structure-end-city.js'
export { planRuinedNetherPortalForRegion } from './natural-structure-portal.js'
export { planStrongholdForRegion } from './stronghold-structure.js'
export { InvalidNaturalStructureCoordinate } from './natural-structure-plan-builder.js'

export type NaturalStructurePlanResult = Result.Result<Option.Option<NaturalStructurePlan>, InvalidNaturalStructureCoordinate>

const planForValidatedRegion = (
  kind: NaturalStructureKind,
  regionX: number,
  regionZ: number,
  plan: () => NaturalStructurePlanResult,
): NaturalStructurePlanResult => {
  const validation = validateNaturalStructureRegion(kind, { x: regionX, z: regionZ })
  if (Result.isFailure(validation)) {return Result.fail(validation.failure)}
  return plan()
}

type CandidateStructureRegionPlanRequest<Draft> = {
  readonly candidateChannelInput?: CandidateChannelInput | undefined
  readonly dimension: Dimension
  readonly finish: (draft: Draft) => Result.Result<NaturalStructurePlan, InvalidNaturalStructureCoordinate>
  readonly kind: NaturalStructureKind
  readonly regionX: number
  readonly regionZ: number
  readonly sampleCandidate: (candidate: Candidate) => Option.Option<Draft>
  readonly seed: NoiseSeed
}

const planCandidateStructureForRegion = <Draft>({
  candidateChannelInput,
  dimension,
  finish,
  kind,
  regionX,
  regionZ,
  sampleCandidate,
  seed,
}: CandidateStructureRegionPlanRequest<Draft>): NaturalStructurePlanResult => planForValidatedRegion(kind, regionX, regionZ, () => {
  const candidateOption = candidateForRegion(seed, dimension, kind, { x: regionX, z: regionZ }, candidateChannelInput)
  if (Option.isNone(candidateOption)) {return Result.succeed(Option.none())}
  const draftOption = sampleCandidate(candidateOption.value)
  if (Option.isNone(draftOption)) {return Result.succeed(Option.none())}
  return Result.map(finish(draftOption.value), Option.some)
})

const finishCompactStructurePlan = (
  seed: NoiseSeed,
  regionX: number,
  regionZ: number,
  kind: CompactStructureKind,
  draft: CompactStructureDraft,
): Result.Result<NaturalStructurePlan, InvalidNaturalStructureCoordinate> => {
  const mutable: MutablePlan = { blocks: new Map(), markers: [] }
  for (const block of draft.blocks) {addBlock(mutable, block)}
  for (const marker of draft.markers) {addMarker(mutable, marker)}
  return finishPlan(
    {
      dimension: 'overworld',
      id: `${kind}:${String(seed)}:${String(regionX)}:${String(regionZ)}`,
      kind,
      origin: draft.origin,
      region: { x: regionX, z: regionZ },
    },
    mutable,
  )
}

/** Plans a compact deterministic representation for an overworld structure kind. */
type CompactStructureRegionPlanRequest = {
  readonly seed: NoiseSeed
  readonly kind: CompactStructureKind
  readonly regionX: number
  readonly regionZ: number
  readonly sampleTerrain: OverworldTerrainSampler
  readonly presenceChannelSeed?: CandidateChannelInput | undefined
}

const planCompactStructureForRegionWithPresence = ({
  kind,
  regionX,
  regionZ,
  sampleTerrain,
  seed,
  presenceChannelSeed,
}: CompactStructureRegionPlanRequest): NaturalStructurePlanResult => planForValidatedRegion(kind, regionX, regionZ, () => {
  const candidateOption = candidateForRegion(seed, 'overworld', kind, { x: regionX, z: regionZ }, presenceChannelSeed)
  if (Option.isNone(candidateOption)) {return Result.succeed(Option.none())}
  const draftOption = planCompactStructureForCandidate(kind, candidateOption.value, sampleTerrain)
  if (Option.isNone(draftOption)) {return Result.succeed(Option.none())}
  return Result.map(finishCompactStructurePlan(seed, regionX, regionZ, kind, draftOption.value), Option.some)
})

export const planCompactStructureForRegion = (
  seed: NoiseSeed,
  kind: CompactStructureKind,
  regionX: number,
  regionZ: number,
  sampleTerrain: OverworldTerrainSampler,
): NaturalStructurePlanResult => planCompactStructureForRegionWithPresence({
  kind,
  regionX,
  regionZ,
  sampleTerrain,
  seed,
})

const VILLAGE_STRUCTURE_HEIGHT = 16
const VILLAGE_LOOT_CHEST_OFFSET_X = 1
const FIRST_SPAWN_INDEX = 0

/** Carves one village's building interiors and exteriors into `mutable`. */
import type { NoiseSeed } from '@nerima-games/mc-noise'
const carveVillageBlocks = (mutable: MutablePlan, site: VillageSite, sampleTerrain: OverworldTerrainSampler): void => {
  // Village site selection already checked the full extent against BlockAxis.
  for (let x = site.x - VILLAGE_HALF_EXTENT; x <= site.x + VILLAGE_HALF_EXTENT; x += UNIT_STEP) {
    for (let z = site.z - VILLAGE_HALF_EXTENT; z <= site.z + VILLAGE_HALF_EXTENT; z += UNIT_STEP) {
      const { surfaceY } = sampleTerrain(blockAxisFromKnownSafeInteger(x), blockAxisFromKnownSafeInteger(z))
      for (let y = Number(surfaceY); y < Math.min(CHUNK_HEIGHT, surfaceY + VILLAGE_STRUCTURE_HEIGHT); y += UNIT_STEP) {
        const block = villageBlockAt(
          site,
          blockAxisFromKnownSafeInteger(x),
          blockAxisFromKnownSafeInteger(y),
          blockAxisFromKnownSafeInteger(z),
          sampleTerrain,
        )
        if (Predicate.isNotUndefined(block)) {addBlock(mutable, { block, x, y, z })}
      }
    }
  }
}

/** Marks every villager spawn, and drops one loot chest beside the first. */
const placeVillageSpawnsAndLoot = (mutable: MutablePlan, spawns: ReadonlyArray<VillageVillagerSpawn>): void => {
  for (const [spawnIndex, spawn] of spawns.entries()) {
    addMarker(mutable, { entity: 'villager', kind: 'entity-spawn', profession: spawn.profession, x: spawn.x, y: spawn.y, z: spawn.z })
    if (spawnIndex === FIRST_SPAWN_INDEX) {
      const lootX = spawn.x + VILLAGE_LOOT_CHEST_OFFSET_X
      addBlock(mutable, { block: NATURAL_STRUCTURE_BLOCK.CHEST, x: lootX, y: spawn.y, z: spawn.z })
      addMarker(mutable, { kind: 'loot-chest', lootTable: 'village', x: lootX, y: spawn.y, z: spawn.z })
    }
  }
}

const createVillagePlan = (
  seed: NoiseSeed,
  regionX: number,
  regionZ: number,
  site: VillageSite,
  sampleTerrain: OverworldTerrainSampler,
): NaturalStructurePlanResult => {
  const mutable: MutablePlan = { blocks: new Map(), markers: [] }
  carveVillageBlocks(mutable, site, sampleTerrain)
  placeVillageSpawnsAndLoot(mutable, villageVillagerSpawnsForSite(seed, site, sampleTerrain))
  return Result.map(finishPlan(
    {
      dimension: 'overworld',
      id: `village:${String(seed)}:${String(regionX)}:${String(regionZ)}`,
      kind: 'village',
      origin: { x: site.x, y: sampleTerrain(site.x, site.z).surfaceY, z: site.z },
      region: { x: regionX, z: regionZ },
    },
    mutable,
  ), Option.some)
}

/** Plans the same village layout used by the Overworld chunk generator. */
export const planVillageForRegion = (
  seed: NoiseSeed,
  regionX: number,
  regionZ: number,
  sampleTerrain: OverworldTerrainSampler,
): NaturalStructurePlanResult => {
  const siteResult = villageSiteForRegion(seed, regionX, regionZ, sampleTerrain)
  if (Result.isFailure(siteResult)) {return Result.fail(siteResult.failure)}
  const siteOption = siteResult.success
  if (Option.isNone(siteOption)) {return Result.succeed(Option.none())}
  return createVillagePlan(seed, regionX, regionZ, siteOption.value, sampleTerrain)
}

const finishDesertPyramidPlan = (
  seed: NoiseSeed,
  regionX: number,
  regionZ: number,
  draft: DesertPyramidDraft,
): Result.Result<NaturalStructurePlan, InvalidNaturalStructureCoordinate> => {
  const mutable: MutablePlan = { blocks: new Map(), markers: [] }
  for (const block of draft.blocks) {addBlock(mutable, block)}
  for (const marker of draft.markers) {addMarker(mutable, marker)}
  return finishPlan(
    {
      dimension: 'overworld',
      id: `desert-pyramid:${String(seed)}:${String(regionX)}:${String(regionZ)}`,
      kind: 'desert-pyramid',
      origin: draft.origin,
      region: { x: regionX, z: regionZ },
    },
    mutable,
  )
}

/** Plans the supported desert-pyramid geometry on a dry, level desert site. */
export const planDesertPyramidForRegion = (
  seed: NoiseSeed,
  regionX: number,
  regionZ: number,
  sampleTerrain: OverworldTerrainSampler,
  presenceChannelSeed?: CandidateChannelInput,
): NaturalStructurePlanResult => planForValidatedRegion('desert-pyramid', regionX, regionZ, () => {
  const candidateOption = candidateForRegion(seed, 'overworld', 'desert-pyramid', { x: regionX, z: regionZ }, presenceChannelSeed)
  if (Option.isNone(candidateOption)) {return Result.succeed(Option.none())}
  const draftOption = planDesertPyramidForCandidate(candidateOption.value, sampleTerrain)
  if (Option.isNone(draftOption)) {return Result.succeed(Option.none())}
  return Result.map(finishDesertPyramidPlan(seed, regionX, regionZ, draftOption.value), Option.some)
})

const finishDesertWellPlan = (
  seed: NoiseSeed,
  regionX: number,
  regionZ: number,
  draft: DesertWellDraft,
): Result.Result<NaturalStructurePlan, InvalidNaturalStructureCoordinate> => {
  const mutable: MutablePlan = { blocks: new Map(), markers: [] }
  for (const block of draft.blocks) {addBlock(mutable, block)}
  return finishPlan(
    {
      dimension: 'overworld',
      id: `desert-well:${String(seed)}:${String(regionX)}:${String(regionZ)}`,
      kind: 'desert-well',
      origin: draft.origin,
      region: { x: regionX, z: regionZ },
    },
    mutable,
  )
}

/** Plans the supported desert-well geometry on a dry, level desert site. */
export const planDesertWellForRegion = (
  seed: NoiseSeed,
  regionX: number,
  regionZ: number,
  sampleTerrain: OverworldTerrainSampler,
  presenceChannelSeed?: CandidateChannelInput,
): NaturalStructurePlanResult => planCandidateStructureForRegion<DesertWellDraft>({
  candidateChannelInput: presenceChannelSeed,
  dimension: 'overworld',
  finish: (draft) => finishDesertWellPlan(seed, regionX, regionZ, draft),
  kind: 'desert-well',
  regionX,
  regionZ,
  sampleCandidate: (candidate) => planDesertWellForCandidate(candidate, sampleTerrain),
  seed,
})

const finishIglooPlan = (
  seed: NoiseSeed,
  regionX: number,
  regionZ: number,
  draft: IglooDraft,
): Result.Result<NaturalStructurePlan, InvalidNaturalStructureCoordinate> => {
  const mutable: MutablePlan = { blocks: new Map(), markers: [] }
  for (const block of draft.blocks) {addBlock(mutable, block)}
  for (const marker of draft.markers) {addMarker(mutable, marker)}
  return finishPlan(
    {
      dimension: 'overworld',
      id: `igloo:${String(seed)}:${String(regionX)}:${String(regionZ)}`,
      kind: 'igloo',
      origin: draft.origin,
      region: { x: regionX, z: regionZ },
    },
    mutable,
  )
}

/** Plans the supported igloo geometry on a dry, level snow site. */
export const planIglooForRegion = (
  seed: NoiseSeed,
  regionX: number,
  regionZ: number,
  sampleTerrain: OverworldTerrainSampler,
  presenceChannelSeed?: CandidateChannelInput,
): NaturalStructurePlanResult => planCandidateStructureForRegion<IglooDraft>({
  candidateChannelInput: presenceChannelSeed,
  dimension: 'overworld',
  finish: (draft) => finishIglooPlan(seed, regionX, regionZ, draft),
  kind: 'igloo',
  regionX,
  regionZ,
  sampleCandidate: (candidate) => planIglooForCandidate(candidate, sampleTerrain),
  seed,
})

const finishJunglePyramidPlan = (
  seed: NoiseSeed,
  regionX: number,
  regionZ: number,
  draft: JunglePyramidDraft,
): Result.Result<NaturalStructurePlan, InvalidNaturalStructureCoordinate> => {
  const mutable: MutablePlan = { blocks: new Map(), markers: [] }
  for (const block of draft.blocks) {addBlock(mutable, block)}
  for (const marker of draft.markers) {addMarker(mutable, marker)}
  return finishPlan(
    {
      dimension: 'overworld',
      id: `jungle-pyramid:${String(seed)}:${String(regionX)}:${String(regionZ)}`,
      kind: 'jungle-pyramid',
      origin: draft.origin,
      region: { x: regionX, z: regionZ },
    },
    mutable,
  )
}

/** Plans the supported compact jungle-pyramid geometry on a dry, level jungle site. */
export const planJunglePyramidForRegion = (
  seed: NoiseSeed,
  regionX: number,
  regionZ: number,
  sampleTerrain: OverworldTerrainSampler,
  presenceChannelSeed?: CandidateChannelInput,
): NaturalStructurePlanResult => planCandidateStructureForRegion<JunglePyramidDraft>({
  candidateChannelInput: presenceChannelSeed,
  dimension: 'overworld',
  finish: (draft) => finishJunglePyramidPlan(seed, regionX, regionZ, draft),
  kind: 'jungle-pyramid',
  regionX,
  regionZ,
  sampleCandidate: (candidate) => planJunglePyramidForCandidate(candidate, sampleTerrain),
  seed,
})

const finishMineshaftPlan = (
  seed: NoiseSeed,
  regionX: number,
  regionZ: number,
  draft: MineshaftDraft,
): Result.Result<NaturalStructurePlan, InvalidNaturalStructureCoordinate> => finishPlanFromValidatedPlacements(
    {
      dimension: 'overworld',
      id: `mineshaft:${String(seed)}:${String(regionX)}:${String(regionZ)}`,
      kind: 'mineshaft',
      origin: draft.origin,
      region: { x: regionX, z: regionZ },
    },
    draft.blocks,
    draft.markers,
  )

/** Plans the supported underground mineshaft network on a level terrain site. */
export const planMineshaftForRegion = (
  seed: NoiseSeed,
  regionX: number,
  regionZ: number,
  sampleTerrain: OverworldTerrainSampler,
  presenceChannelSeed?: CandidateChannelInput,
): NaturalStructurePlanResult => planCandidateStructureForRegion<MineshaftDraft>({
  candidateChannelInput: presenceChannelSeed,
  dimension: 'overworld',
  finish: (draft) => finishMineshaftPlan(seed, regionX, regionZ, draft),
  kind: 'mineshaft',
  regionX,
  regionZ,
  sampleCandidate: (candidate) => planMineshaftForCandidate(candidate, sampleTerrain),
  seed,
})

const finishOceanRuinPlan = (
  seed: NoiseSeed,
  regionX: number,
  regionZ: number,
  draft: OceanRuinDraft,
): Result.Result<NaturalStructurePlan, InvalidNaturalStructureCoordinate> => finishPlanFromValidatedPlacements(
    {
      dimension: 'overworld',
      id: `ocean-ruin:${String(seed)}:${String(regionX)}:${String(regionZ)}`,
      kind: 'ocean-ruin',
      origin: draft.origin,
      region: { x: regionX, z: regionZ },
    },
    draft.blocks,
    draft.markers,
  )

const finishOceanMonumentPlan = (
  seed: NoiseSeed,
  regionX: number,
  regionZ: number,
  draft: OceanMonumentDraft,
): Result.Result<NaturalStructurePlan, InvalidNaturalStructureCoordinate> => {
  const mutable: MutablePlan = { blocks: new Map(), markers: [] }
  for (const block of draft.blocks) {addBlock(mutable, block)}
  for (const marker of draft.markers) {addMarker(mutable, marker)}
  return finishPlan(
    {
      dimension: 'overworld',
      id: `ocean-monument:${String(seed)}:${String(regionX)}:${String(regionZ)}`,
      kind: 'ocean-monument',
      origin: draft.origin,
      region: { x: regionX, z: regionZ },
    },
    mutable,
  )
}

/** Plans the supported compact ocean-monument geometry on a deep ocean floor. */
export const planOceanMonumentForRegion = (
  seed: NoiseSeed,
  regionX: number,
  regionZ: number,
  sampleTerrain: OverworldTerrainSampler,
  presenceChannelSeed?: CandidateChannelInput,
): NaturalStructurePlanResult => planCandidateStructureForRegion<OceanMonumentDraft>({
  candidateChannelInput: presenceChannelSeed,
  dimension: 'overworld',
  finish: (draft) => finishOceanMonumentPlan(seed, regionX, regionZ, draft),
  kind: 'ocean-monument',
  regionX,
  regionZ,
  sampleCandidate: (candidate) => planOceanMonumentForCandidate(candidate, sampleTerrain),
  seed,
})

/** Plans the supported submerged ocean-ruin geometry on a dry-free, level ocean floor. */
export const planOceanRuinForRegion = (
  seed: NoiseSeed,
  regionX: number,
  regionZ: number,
  sampleTerrain: OverworldTerrainSampler,
  presenceChannelSeed?: CandidateChannelInput,
): NaturalStructurePlanResult => planCandidateStructureForRegion<OceanRuinDraft>({
  candidateChannelInput: presenceChannelSeed,
  dimension: 'overworld',
  finish: (draft) => finishOceanRuinPlan(seed, regionX, regionZ, draft),
  kind: 'ocean-ruin',
  regionX,
  regionZ,
  sampleCandidate: (candidate) => planOceanRuinForCandidate(candidate, sampleTerrain),
  seed,
})

const finishShipwreckPlan = (
  seed: NoiseSeed,
  regionX: number,
  regionZ: number,
  draft: ShipwreckDraft,
): Result.Result<NaturalStructurePlan, InvalidNaturalStructureCoordinate> => {
  const mutable: MutablePlan = { blocks: new Map(), markers: [] }
  for (const block of draft.blocks) {addBlock(mutable, block)}
  for (const marker of draft.markers) {addMarker(mutable, marker)}
  return finishPlan(
    {
      dimension: 'overworld',
      id: `shipwreck:${String(seed)}:${String(regionX)}:${String(regionZ)}`,
      kind: 'shipwreck',
      origin: draft.origin,
      region: { x: regionX, z: regionZ },
    },
    mutable,
  )
}

/** Plans the supported submerged shipwreck geometry on a level ocean floor. */
export const planShipwreckForRegion = (
  seed: NoiseSeed,
  regionX: number,
  regionZ: number,
  sampleTerrain: OverworldTerrainSampler,
  presenceChannelSeed?: CandidateChannelInput,
): NaturalStructurePlanResult => planCandidateStructureForRegion<ShipwreckDraft>({
  candidateChannelInput: presenceChannelSeed,
  dimension: 'overworld',
  finish: (draft) => finishShipwreckPlan(seed, regionX, regionZ, draft),
  kind: 'shipwreck',
  regionX,
  regionZ,
  sampleCandidate: (candidate) => planShipwreckForCandidate(candidate, sampleTerrain),
  seed,
})

const finishPillagerOutpostPlan = (
  seed: NoiseSeed,
  regionX: number,
  regionZ: number,
  draft: PillagerOutpostDraft,
): Result.Result<NaturalStructurePlan, InvalidNaturalStructureCoordinate> => {
  const mutable: MutablePlan = { blocks: new Map(), markers: [] }
  for (const block of draft.blocks) {addBlock(mutable, block)}
  for (const marker of draft.markers) {addMarker(mutable, marker)}
  return finishPlan(
    {
      dimension: 'overworld',
      id: `pillager-outpost:${String(seed)}:${String(regionX)}:${String(regionZ)}`,
      kind: 'pillager-outpost',
      origin: draft.origin,
      region: { x: regionX, z: regionZ },
    },
    mutable,
  )
}

/** Plans the supported dry pillager outpost geometry. */
export const planPillagerOutpostForRegion = (
  seed: NoiseSeed,
  regionX: number,
  regionZ: number,
  sampleTerrain: OverworldTerrainSampler,
  presenceChannelSeed?: CandidateChannelInput,
): NaturalStructurePlanResult => planCandidateStructureForRegion<PillagerOutpostDraft>({
  candidateChannelInput: presenceChannelSeed,
  dimension: 'overworld',
  finish: (draft) => finishPillagerOutpostPlan(seed, regionX, regionZ, draft),
  kind: 'pillager-outpost',
  regionX,
  regionZ,
  sampleCandidate: (candidate) => planPillagerOutpostForCandidate(candidate, sampleTerrain),
  seed,
})

const finishBastionRemnantPlan = (
  seed: NoiseSeed,
  regionX: number,
  regionZ: number,
  draft: BastionRemnantDraft,
): Result.Result<NaturalStructurePlan, InvalidNaturalStructureCoordinate> => {
  const mutable: MutablePlan = { blocks: new Map(), markers: [] }
  for (const block of draft.blocks) {addBlock(mutable, block)}
  for (const marker of draft.markers) {addMarker(mutable, marker)}
  return finishPlan(
    {
      dimension: 'nether',
      id: `bastion-remnant:${String(seed)}:${String(regionX)}:${String(regionZ)}`,
      kind: 'bastion-remnant',
      origin: draft.origin,
      region: { x: regionX, z: regionZ },
    },
    mutable,
  )
}

/** Plans the supported compact bastion remnant geometry. */
export const planBastionRemnantForRegion = (
  seed: NoiseSeed,
  regionX: number,
  regionZ: number,
  sampleTerrain: NetherStructureTerrainSampler,
  presenceChannelSeed?: CandidateChannelInput,
): NaturalStructurePlanResult => planCandidateStructureForRegion<BastionRemnantDraft>({
  candidateChannelInput: presenceChannelSeed,
  dimension: 'nether',
  finish: (draft) => finishBastionRemnantPlan(seed, regionX, regionZ, draft),
  kind: 'bastion-remnant',
  regionX,
  regionZ,
  sampleCandidate: (candidate) => planBastionRemnantForCandidate(candidate, sampleTerrain),
  seed,
})

type OverworldWaterStructureKind = 'ocean-monument' | 'ocean-ruin' | 'shipwreck'

type OverworldLandStructureKind = 'jungle-pyramid' | 'mineshaft' | 'pillager-outpost'

type OverworldSurfaceStructureKind = 'desert-pyramid' | 'desert-well' | 'igloo'

const isCompactStructureKind = (kind: NaturalStructureKind): kind is CompactStructureKind =>
  COMPACT_STRUCTURE_KINDS.some((compactKind) => compactKind === kind)

const planOverworldWaterKind = (
  seed: NoiseSeed,
  kind: OverworldWaterStructureKind,
  region: NaturalStructureRegion,
  sampleTerrain: OverworldTerrainSampler,
  presenceChannelSeed?: CandidateChannelInput,
): NaturalStructurePlanResult => {
  if (kind === 'ocean-monument') {
    return planOceanMonumentForRegion(seed, region.x, region.z, sampleTerrain, presenceChannelSeed)
  }
  if (kind === 'ocean-ruin') {
    return planOceanRuinForRegion(seed, region.x, region.z, sampleTerrain, presenceChannelSeed)
  }
  return planShipwreckForRegion(seed, region.x, region.z, sampleTerrain, presenceChannelSeed)
}

const planOverworldLandKind = (
  seed: NoiseSeed,
  kind: OverworldLandStructureKind,
  region: NaturalStructureRegion,
  sampleTerrain: OverworldTerrainSampler,
  presenceChannelSeed?: CandidateChannelInput,
): NaturalStructurePlanResult => {
  if (kind === 'mineshaft') {
    return planMineshaftForRegion(seed, region.x, region.z, sampleTerrain, presenceChannelSeed)
  }
  if (kind === 'jungle-pyramid') {
    return planJunglePyramidForRegion(seed, region.x, region.z, sampleTerrain, presenceChannelSeed)
  }
  return planPillagerOutpostForRegion(seed, region.x, region.z, sampleTerrain, presenceChannelSeed)
}

const planOverworldSurfaceKind = (
  seed: NoiseSeed,
  kind: OverworldSurfaceStructureKind,
  region: NaturalStructureRegion,
  sampleTerrain: OverworldTerrainSampler,
  presenceChannelSeed?: CandidateChannelInput,
): NaturalStructurePlanResult => {
  if (kind === 'desert-pyramid') {
    return planDesertPyramidForRegion(seed, region.x, region.z, sampleTerrain, presenceChannelSeed)
  }
  if (kind === 'desert-well') {
    return planDesertWellForRegion(seed, region.x, region.z, sampleTerrain, presenceChannelSeed)
  }
  return planIglooForRegion(seed, region.x, region.z, sampleTerrain, presenceChannelSeed)
}

const planOverworldKind = (
  seed: NoiseSeed,
  kind: NaturalStructureKind,
  region: NaturalStructureRegion,
  sampleTerrain: OverworldTerrainSampler,
  presenceChannelSeed?: CandidateChannelInput,
): NaturalStructurePlanResult => {
  if (kind === 'desert-pyramid' || kind === 'desert-well' || kind === 'igloo') {
    return planOverworldSurfaceKind(seed, kind, region, sampleTerrain, presenceChannelSeed)
  }
  if (isCompactStructureKind(kind)) {
    return planCompactStructureForRegionWithPresence({
      kind,
      presenceChannelSeed,
      regionX: region.x,
      regionZ: region.z,
      sampleTerrain,
      seed,
    })
  }
  if (kind === 'jungle-pyramid' || kind === 'mineshaft' || kind === 'pillager-outpost') {
    return planOverworldLandKind(seed, kind, region, sampleTerrain, presenceChannelSeed)
  }
  if (kind === 'ocean-monument' || kind === 'ocean-ruin' || kind === 'shipwreck') {
    return planOverworldWaterKind(seed, kind, region, sampleTerrain, presenceChannelSeed)
  }
  return planVillageForRegion(seed, region.x, region.z, sampleTerrain)
}

const planOverworldRegion = (
  seed: NoiseSeed,
  kind: NaturalStructureKind,
  region: NaturalStructureRegion,
  sampleTerrain: OverworldTerrainSampler | undefined,
  presenceChannelSeed?: CandidateChannelInput,
): NaturalStructurePlanResult => {
  if (kind === 'stronghold') {
    return planStrongholdForRegion(seed, region.x, region.z)
  }
  if (Predicate.isUndefined(sampleTerrain)) {
    return planForValidatedRegion(kind, region.x, region.z, () => Result.succeed(Option.none()))
  }
  return planOverworldKind(seed, kind, region, sampleTerrain, presenceChannelSeed)
}

const netherFortressPresenceChannelSeedFor = (
  candidateChannelInput?: CandidateChannelInput,
): NoiseSeed | undefined => {
  if (typeof candidateChannelInput === 'number') {
    return candidateChannelInput
  }
  return candidateChannelInput?.presence
}

const planNetherRegion = (
  seed: NoiseSeed,
  kind: NaturalStructureKind,
  region: NaturalStructureRegion,
  sampleTerrain: NetherStructureTerrainSampler | undefined,
  candidateChannelInput?: CandidateChannelInput,
): NaturalStructurePlanResult => {
  if (Predicate.isUndefined(sampleTerrain)) {
    return planForValidatedRegion(kind, region.x, region.z, () => Result.succeed(Option.none()))
  }
  if (kind === 'bastion-remnant') {
    return planBastionRemnantForRegion(seed, region.x, region.z, sampleTerrain, candidateChannelInput)
  }
  if (kind === 'nether-fortress') {
    return planNetherFortressForRegion(
      seed,
      region.x,
      region.z,
      sampleTerrain,
      netherFortressPresenceChannelSeedFor(candidateChannelInput),
    )
  }
  return planRuinedNetherPortalForRegion(seed, region.x, region.z, sampleTerrain, candidateChannelInput)
}

const planEndRegion = (
  seed: NoiseSeed,
  kind: NaturalStructureKind,
  region: NaturalStructureRegion,
  samplers: NaturalStructureSamplers,
  candidateChannelInput?: CandidateChannelInput,
): NaturalStructurePlanResult => {
  if (kind !== 'end-city') {
    return planForValidatedRegion(kind, region.x, region.z, () => Result.succeed(Option.none()))
  }
  return planEndCityForRegion(seed, region.x, region.z, samplers.end, candidateChannelInput)
}

/** Plans one supported natural structure for a single region. */
export const planNaturalStructureForRegion = ({
  candidateChannelSeeds,
  dimension,
  kind,
  presenceChannelSeed,
  region,
  samplers,
  seed,
}: NaturalStructureRegionPlanRequest): NaturalStructurePlanResult => {
  const candidateChannelInput = candidateChannelSeeds ?? presenceChannelSeed
  if (dimension === 'overworld') {
    if (kind === 'bastion-remnant' || kind === 'end-city' || kind === 'nether-fortress' || kind === 'ruined-nether-portal') {
      return planForValidatedRegion(kind, region.x, region.z, () => Result.succeed(Option.none()))
    }
    return planOverworldRegion(seed, kind, region, samplers.overworld, candidateChannelInput)
  }
  if (dimension === 'nether') {
    if (kind !== 'bastion-remnant' && kind !== 'nether-fortress' && kind !== 'ruined-nether-portal') {
      return planForValidatedRegion(kind, region.x, region.z, () => Result.succeed(Option.none()))
    }
    return planNetherRegion(seed, kind, region, samplers.nether, candidateChannelInput)
  }
  return planEndRegion(seed, kind, region, samplers, candidateChannelInput)
}

/**
 * Enumerates only candidate regions that can overlap a chunk. The bounds are
 * derived from the candidate coordinate interval and handle negative
 * coordinates through floor division.
 */
export const naturalStructurePlansForChunk = (
  seed: NoiseSeed,
  dimension: Dimension,
  coord: ChunkCoord,
  samplers: NaturalStructureSamplers = {},
): Result.Result<ReadonlyArray<NaturalStructurePlan>, InvalidNaturalStructureCoordinate> =>
  enumerateNaturalStructurePlansForChunk(seed, dimension, coord, samplers, planNaturalStructureForRegion)
