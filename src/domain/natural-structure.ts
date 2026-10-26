/** Deterministic, immutable plans for cross-chunk natural structures. */
import { type BastionRemnantDraft, planBastionRemnantForCandidate } from './bastion-remnant.js'
import {
  COMPACT_STRUCTURE_KINDS,
  type CompactStructureKind,
} from './compact-structure-data.js'
import {
  type Candidate,
  type CandidateChannelInput,
  type CandidateForRegionContext,
  type InvalidNaturalStructureCoordinate,
  type MutablePlan,
  UNIT_STEP,
  addBlock,
  addMarker,
  candidateForRegion,
  finishPlan,
  finishPlanFromValidatedPlacements,
  isCandidatePresenceValidatedInput,
  isValidatedCandidateChannelInput,
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
  NaturalStructureSamplers,
  NetherStructureTerrainSampler,
} from './natural-structure-types.js'
import {
  type NaturalStructurePlanContext,
  type NaturalStructureRegionPlanRequest,
  type NaturalStructureRegionPlanner,
  type ValidatedNaturalStructureChunkCoordinates,
  naturalStructurePlansForValidatedChunk as enumerateNaturalStructurePlansForValidatedChunk,
  validateNaturalStructureChunkCoordinates,
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
  villageSiteOptionForValidatedRegion,
} from './structure-siting.js'
import { type PillagerOutpostDraft, planPillagerOutpostForCandidate } from './pillager-outpost.js'
import { type ShipwreckDraft, planShipwreckForCandidate } from './shipwreck.js'
import {
  type VillageVillagerSpawn,
  villageBlockSamplerForSite,
  villageHouseFloorYsForSite,
  villageVillagerSpawnsForSiteWithFloorYs,
} from './village.js'
import { CHUNK_HEIGHT } from './constants.js'
import type { ChunkCoord, Dimension } from '@nerima-games/mc-kernel'
import { blockAxisFromKnownSafeInteger } from './coordinate-compatibility.js'
import { NATURAL_STRUCTURE_BLOCK } from './natural-structure-data.js'
import {
  type ValidatedNaturalStructureRegionAxis,
  validatedNaturalStructureRegionAxisFrom,
  validatedNaturalStructureRegionFromAxes,
} from './natural-structure-coordinate-validation.js'
import { planEndCityForRegion, planEndCityForValidatedRegion } from './natural-structure-end-city.js'
import { planNetherFortressForRegion, planNetherFortressForValidatedRegion } from './nether-fortress.js'
import { planRuinedNetherPortalForRegion, planRuinedNetherPortalForValidatedRegion } from './natural-structure-portal.js'
import { planStrongholdForRegion, planStrongholdForValidatedRegion } from './stronghold-structure.js'

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
const NO_NATURAL_STRUCTURE_PLAN: NaturalStructurePlanResult = Result.succeed(Option.none())

const planForValidatedRegion = (
  kind: NaturalStructureKind,
  regionX: number,
  regionZ: number,
  plan: () => NaturalStructurePlanResult,
  validateCoordinates = true,
): NaturalStructurePlanResult => {
  if (validateCoordinates) {
    const validation = validateNaturalStructureRegion(kind, { x: regionX, z: regionZ })
    if (Result.isFailure(validation)) {return Result.fail(validation.failure)}
  }
  return plan()
}

const validatesCandidateRegion = (candidateChannelInput?: CandidateChannelInput): boolean =>
  !isValidatedCandidateChannelInput(candidateChannelInput)

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

const planCandidateStructureForRegion = <Draft>(
  request: CandidateStructureRegionPlanRequest<Draft>,
): NaturalStructurePlanResult => {
  const { candidateChannelInput, finish, kind, regionX, regionZ, sampleCandidate } = request
  return planForValidatedRegion(kind, regionX, regionZ, () => {
    const candidateOption = candidateForRegion(request, kind, regionX, regionZ)
    if (Option.isNone(candidateOption)) {return NO_NATURAL_STRUCTURE_PLAN}
    const draftOption = sampleCandidate(candidateOption.value)
    if (Option.isNone(draftOption)) {return NO_NATURAL_STRUCTURE_PLAN}
    return Result.map(finish(draftOption.value), Option.some)
  }, validatesCandidateRegion(candidateChannelInput))
}

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
const planCompactStructureForRegionWithPresence = (
  context: CandidateForRegionContext,
  kind: CompactStructureKind,
  regionX: number,
  regionZ: number,
  sampleTerrain: OverworldTerrainSampler,
): NaturalStructurePlanResult => planForValidatedRegion(kind, regionX, regionZ, () => {
  const candidateOption = candidateForRegion(context, kind, regionX, regionZ)
  if (Option.isNone(candidateOption)) {return NO_NATURAL_STRUCTURE_PLAN}
  const draftOption = planCompactStructureForCandidate(kind, candidateOption.value, sampleTerrain)
  if (Option.isNone(draftOption)) {return NO_NATURAL_STRUCTURE_PLAN}
  return Result.map(finishCompactStructurePlan(context.seed, regionX, regionZ, kind, draftOption.value), Option.some)
}, validatesCandidateRegion(context.candidateChannelInput))

export const planCompactStructureForRegion = (
  seed: NoiseSeed,
  kind: CompactStructureKind,
  regionX: number,
  regionZ: number,
  sampleTerrain: OverworldTerrainSampler,
): NaturalStructurePlanResult => planCompactStructureForRegionWithPresence(
  { dimension: 'overworld', seed },
  kind,
  regionX,
  regionZ,
  sampleTerrain,
)

const VILLAGE_STRUCTURE_HEIGHT = 16
const VILLAGE_LOOT_CHEST_OFFSET_X = 1
const FIRST_SPAWN_INDEX = 0

/** Carves one village's building interiors and exteriors into `mutable`. */
import type { NoiseSeed } from '@nerima-games/mc-noise'
const carveVillageBlocks = (
  mutable: MutablePlan,
  site: VillageSite,
  sampleTerrain: OverworldTerrainSampler,
  villageBlockAt: ReturnType<typeof villageBlockSamplerForSite>,
): void => {
  // Village site selection already checked the full extent against BlockAxis.
  for (let x = site.x - VILLAGE_HALF_EXTENT; x <= site.x + VILLAGE_HALF_EXTENT; x += UNIT_STEP) {
    for (let z = site.z - VILLAGE_HALF_EXTENT; z <= site.z + VILLAGE_HALF_EXTENT; z += UNIT_STEP) {
      const { surfaceY } = sampleTerrain(blockAxisFromKnownSafeInteger(x), blockAxisFromKnownSafeInteger(z))
      for (let y = Number(surfaceY); y < Math.min(CHUNK_HEIGHT, surfaceY + VILLAGE_STRUCTURE_HEIGHT); y += UNIT_STEP) {
        const block = villageBlockAt(
          blockAxisFromKnownSafeInteger(x),
          blockAxisFromKnownSafeInteger(y),
          blockAxisFromKnownSafeInteger(z),
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
  const houseFloorYs = villageHouseFloorYsForSite(site, sampleTerrain)
  const villageBlockAt = villageBlockSamplerForSite(site, sampleTerrain, houseFloorYs)
  carveVillageBlocks(mutable, site, sampleTerrain, villageBlockAt)
  placeVillageSpawnsAndLoot(mutable, villageVillagerSpawnsForSiteWithFloorYs(seed, site, houseFloorYs))
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
const planVillageForSiteOption = (
  seed: NoiseSeed,
  regionX: number,
  regionZ: number,
  siteOption: Option.Option<VillageSite>,
  sampleTerrain: OverworldTerrainSampler,
): NaturalStructurePlanResult => {
  if (Option.isNone(siteOption)) {return NO_NATURAL_STRUCTURE_PLAN}
  return createVillagePlan(seed, regionX, regionZ, siteOption.value, sampleTerrain)
}

export const planVillageForRegion = (
  seed: NoiseSeed,
  regionX: number,
  regionZ: number,
  sampleTerrain: OverworldTerrainSampler,
): NaturalStructurePlanResult => {
  const siteResult = villageSiteForRegion(seed, regionX, regionZ, sampleTerrain)
  if (Result.isFailure(siteResult)) {return Result.fail(siteResult.failure)}
  return planVillageForSiteOption(seed, regionX, regionZ, siteResult.success, sampleTerrain)
}

const planVillageForValidatedRegion = (
  seed: NoiseSeed,
  regionX: ValidatedNaturalStructureRegionAxis,
  regionZ: ValidatedNaturalStructureRegionAxis,
  sampleTerrain: OverworldTerrainSampler,
  candidateChannelInput?: CandidateChannelInput,
): NaturalStructurePlanResult => planVillageForSiteOption(
  seed,
  regionX,
  regionZ,
  villageSiteOptionForValidatedRegion(
    seed,
    regionX,
    regionZ,
    sampleTerrain,
    isCandidatePresenceValidatedInput(candidateChannelInput),
  ),
  sampleTerrain,
)

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
  const candidateOption = candidateForRegion(
    { candidateChannelInput: presenceChannelSeed, dimension: 'overworld', seed },
    'desert-pyramid',
    regionX,
    regionZ,
  )
  if (Option.isNone(candidateOption)) {return NO_NATURAL_STRUCTURE_PLAN}
  const draftOption = planDesertPyramidForCandidate(candidateOption.value, sampleTerrain)
  if (Option.isNone(draftOption)) {return NO_NATURAL_STRUCTURE_PLAN}
  return Result.map(finishDesertPyramidPlan(seed, regionX, regionZ, draftOption.value), Option.some)
}, validatesCandidateRegion(presenceChannelSeed))

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

const isCompactStructureKind = (kind: NaturalStructureKind): kind is CompactStructureKind =>
  COMPACT_STRUCTURE_KINDS.some((compactKind) => compactKind === kind)

const planOverworldWaterKind = (
  context: NaturalStructurePlanContext,
  regionX: number,
  regionZ: number,
  sampleTerrain: OverworldTerrainSampler,
): NaturalStructurePlanResult => {
  if (context.kind === 'ocean-monument') {
    return planOceanMonumentForRegion(context.seed, regionX, regionZ, sampleTerrain, context.candidateChannelInput)
  }
  if (context.kind === 'ocean-ruin') {
    return planOceanRuinForRegion(context.seed, regionX, regionZ, sampleTerrain, context.candidateChannelInput)
  }
  return planShipwreckForRegion(context.seed, regionX, regionZ, sampleTerrain, context.candidateChannelInput)
}

const planOverworldLandKind = (
  context: NaturalStructurePlanContext,
  regionX: number,
  regionZ: number,
  sampleTerrain: OverworldTerrainSampler,
): NaturalStructurePlanResult => {
  if (context.kind === 'mineshaft') {
    return planMineshaftForRegion(context.seed, regionX, regionZ, sampleTerrain, context.candidateChannelInput)
  }
  if (context.kind === 'jungle-pyramid') {
    return planJunglePyramidForRegion(context.seed, regionX, regionZ, sampleTerrain, context.candidateChannelInput)
  }
  return planPillagerOutpostForRegion(context.seed, regionX, regionZ, sampleTerrain, context.candidateChannelInput)
}

const planOverworldSurfaceKind = (
  context: NaturalStructurePlanContext,
  regionX: number,
  regionZ: number,
  sampleTerrain: OverworldTerrainSampler,
): NaturalStructurePlanResult => {
  if (context.kind === 'desert-pyramid') {
    return planDesertPyramidForRegion(context.seed, regionX, regionZ, sampleTerrain, context.candidateChannelInput)
  }
  if (context.kind === 'desert-well') {
    return planDesertWellForRegion(context.seed, regionX, regionZ, sampleTerrain, context.candidateChannelInput)
  }
  return planIglooForRegion(context.seed, regionX, regionZ, sampleTerrain, context.candidateChannelInput)
}

const planVillageCandidateRegion = (
  context: NaturalStructurePlanContext,
  regionX: ValidatedNaturalStructureRegionAxis,
  regionZ: ValidatedNaturalStructureRegionAxis,
  sampleTerrain: OverworldTerrainSampler,
): NaturalStructurePlanResult => {
  if (validatesCandidateRegion(context.candidateChannelInput)) {
    return planVillageForRegion(context.seed, regionX, regionZ, sampleTerrain)
  }
  return planVillageForValidatedRegion(context.seed, regionX, regionZ, sampleTerrain, context.candidateChannelInput)
}

const planOverworldKind = (
  context: NaturalStructurePlanContext,
  regionX: ValidatedNaturalStructureRegionAxis,
  regionZ: ValidatedNaturalStructureRegionAxis,
  sampleTerrain: OverworldTerrainSampler,
): NaturalStructurePlanResult => {
  if (context.kind === 'desert-pyramid' || context.kind === 'desert-well' || context.kind === 'igloo') {
    return planOverworldSurfaceKind(context, regionX, regionZ, sampleTerrain)
  }
  if (isCompactStructureKind(context.kind)) {
    return planCompactStructureForRegionWithPresence(context, context.kind, regionX, regionZ, sampleTerrain)
  }
  if (context.kind === 'jungle-pyramid' || context.kind === 'mineshaft' || context.kind === 'pillager-outpost') {
    return planOverworldLandKind(context, regionX, regionZ, sampleTerrain)
  }
  if (context.kind === 'ocean-monument' || context.kind === 'ocean-ruin' || context.kind === 'shipwreck') {
    return planOverworldWaterKind(context, regionX, regionZ, sampleTerrain)
  }
  return planVillageCandidateRegion(context, regionX, regionZ, sampleTerrain)
}

const planOverworldRegion = (
  context: NaturalStructurePlanContext,
  regionX: ValidatedNaturalStructureRegionAxis,
  regionZ: ValidatedNaturalStructureRegionAxis,
): NaturalStructurePlanResult => {
  if (context.kind === 'stronghold') {
    if (validatesCandidateRegion(context.candidateChannelInput)) {return planStrongholdForRegion(context.seed, regionX, regionZ)}
    return planStrongholdForValidatedRegion(
      context.seed,
      regionX,
      regionZ,
      isCandidatePresenceValidatedInput(context.candidateChannelInput),
    )
  }
  const { overworld: sampleTerrain } = context.samplers
  if (Predicate.isUndefined(sampleTerrain)) {
    return planForValidatedRegion(context.kind, regionX, regionZ, () => NO_NATURAL_STRUCTURE_PLAN, validatesCandidateRegion(context.candidateChannelInput))
  }
  return planOverworldKind(context, regionX, regionZ, sampleTerrain)
}

const netherFortressPresenceChannelSeedFor = (
  candidateChannelInput?: CandidateChannelInput,
): NoiseSeed | undefined => {
  if (typeof candidateChannelInput === 'number') {
    return candidateChannelInput
  }
  return candidateChannelInput?.presence
}

const planNetherFortressRegion = (
  context: NaturalStructurePlanContext,
  regionX: ValidatedNaturalStructureRegionAxis,
  regionZ: ValidatedNaturalStructureRegionAxis,
  sampleTerrain: NetherStructureTerrainSampler,
): NaturalStructurePlanResult => {
  const presenceSeed = netherFortressPresenceChannelSeedFor(context.candidateChannelInput)
  if (validatesCandidateRegion(context.candidateChannelInput)) {
    return planNetherFortressForRegion(context.seed, regionX, regionZ, sampleTerrain, presenceSeed)
  }
  return planNetherFortressForValidatedRegion(context.seed, regionX, regionZ, sampleTerrain, presenceSeed)
}

const planNetherRegion = (
  context: NaturalStructurePlanContext,
  regionX: ValidatedNaturalStructureRegionAxis,
  regionZ: ValidatedNaturalStructureRegionAxis,
): NaturalStructurePlanResult => {
  const { nether: sampleTerrain } = context.samplers
  if (Predicate.isUndefined(sampleTerrain)) {
    return planForValidatedRegion(context.kind, regionX, regionZ, () => NO_NATURAL_STRUCTURE_PLAN, validatesCandidateRegion(context.candidateChannelInput))
  }
  if (context.kind === 'bastion-remnant') {
    return planBastionRemnantForRegion(context.seed, regionX, regionZ, sampleTerrain, context.candidateChannelInput)
  }
  if (context.kind === 'nether-fortress') {
    return planNetherFortressRegion(context, regionX, regionZ, sampleTerrain)
  }
  if (validatesCandidateRegion(context.candidateChannelInput)) {
    return planRuinedNetherPortalForRegion(context.seed, regionX, regionZ, sampleTerrain, context.candidateChannelInput)
  }
  return planRuinedNetherPortalForValidatedRegion(
    context.seed,
    validatedNaturalStructureRegionFromAxes(regionX, regionZ),
    sampleTerrain,
    context.candidateChannelInput,
  )
}

const planEndRegion = (
  context: NaturalStructurePlanContext,
  regionX: ValidatedNaturalStructureRegionAxis,
  regionZ: ValidatedNaturalStructureRegionAxis,
): NaturalStructurePlanResult => {
  if (context.kind !== 'end-city') {
    return planForValidatedRegion(context.kind, regionX, regionZ, () => NO_NATURAL_STRUCTURE_PLAN, validatesCandidateRegion(context.candidateChannelInput))
  }
  if (validatesCandidateRegion(context.candidateChannelInput)) {
    return planEndCityForRegion(context.seed, regionX, regionZ, context.samplers.end, context.candidateChannelInput)
  }
  return planEndCityForValidatedRegion(context.seed, regionX, regionZ, context.samplers.end, context.candidateChannelInput)
}

const planNaturalStructureForRegionAt = (
  context: NaturalStructurePlanContext,
  regionX: ValidatedNaturalStructureRegionAxis,
  regionZ: ValidatedNaturalStructureRegionAxis,
): NaturalStructurePlanResult => {
  if (context.dimension === 'overworld') {
    if (context.kind === 'bastion-remnant' || context.kind === 'end-city' || context.kind === 'nether-fortress' || context.kind === 'ruined-nether-portal') {
      return planForValidatedRegion(context.kind, regionX, regionZ, () => NO_NATURAL_STRUCTURE_PLAN, validatesCandidateRegion(context.candidateChannelInput))
    }
    return planOverworldRegion(context, regionX, regionZ)
  }
  if (context.dimension === 'nether') {
    if (context.kind !== 'bastion-remnant' && context.kind !== 'nether-fortress' && context.kind !== 'ruined-nether-portal') {
      return planForValidatedRegion(context.kind, regionX, regionZ, () => NO_NATURAL_STRUCTURE_PLAN, validatesCandidateRegion(context.candidateChannelInput))
    }
    return planNetherRegion(context, regionX, regionZ)
  }
  return planEndRegion(context, regionX, regionZ)
}

/** Plans one supported natural structure for a single region. */
export const planNaturalStructureForRegion = (request: NaturalStructureRegionPlanRequest): NaturalStructurePlanResult => {
  const validation = validateNaturalStructureRegion(request.kind, request.region)
  if (Result.isFailure(validation)) {return Result.fail(validation.failure)}
  return planNaturalStructureForRegionAt(
    {
      candidateChannelInput: request.candidateChannelSeeds ?? request.presenceChannelSeed,
      dimension: request.dimension,
      kind: request.kind,
      samplers: request.samplers,
      seed: request.seed,
    },
    validatedNaturalStructureRegionAxisFrom(validation.success, 'x'),
    validatedNaturalStructureRegionAxisFrom(validation.success, 'z'),
  )
}

const planNaturalStructureForChunkRegion: NaturalStructureRegionPlanner = (
  context,
  regionX,
  regionZ,
): NaturalStructurePlanResult => planNaturalStructureForRegionAt(context, regionX, regionZ)

/**
 * Enumerates only candidate regions that can overlap a chunk. The bounds are
 * derived from the candidate coordinate interval and handle negative
 * coordinates through floor division.
 */
/** Plans structures after a caller has validated the complete chunk footprint. */
export const naturalStructurePlansForValidatedChunk = (
  seed: NoiseSeed,
  dimension: Dimension,
  validatedChunk: ValidatedNaturalStructureChunkCoordinates,
  samplers: NaturalStructureSamplers = {},
): Result.Result<ReadonlyArray<NaturalStructurePlan>, InvalidNaturalStructureCoordinate> =>
  enumerateNaturalStructurePlansForValidatedChunk(
    seed,
    dimension,
    validatedChunk,
    samplers,
    planNaturalStructureForChunkRegion,
  )

export const naturalStructurePlansForChunk = (
  seed: NoiseSeed,
  dimension: Dimension,
  coord: ChunkCoord,
  samplers: NaturalStructureSamplers = {},
): Result.Result<ReadonlyArray<NaturalStructurePlan>, InvalidNaturalStructureCoordinate> => {
  const validation = validateNaturalStructureChunkCoordinates(dimension, coord)
  if (Result.isFailure(validation)) {return Result.fail(validation.failure)}
  return naturalStructurePlansForValidatedChunk(seed, dimension, validation.success, samplers)
}
