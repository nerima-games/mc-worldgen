/** Deterministic, immutable plans for cross-chunk natural structures. */
import { type BastionRemnantDraft, planBastionRemnantForCandidate } from './bastion-remnant'
import {
  COMPACT_STRUCTURE_KINDS,
  type CompactStructureKind,
} from './compact-structure-data'
import {
  type CandidateChannelInput,
  type MutablePlan,
  UNIT_STEP,
  addBlock,
  addMarker,
  candidateForRegion,
  finishPlan,
  finishPlanFromValidatedPlacements,
} from './natural-structure-plan-builder'
import { type CompactStructureDraft, planCompactStructureForCandidate } from './compact-structure'
import { type DesertPyramidDraft, planDesertPyramidForCandidate } from './desert-pyramid'
import { type DesertWellDraft, planDesertWellForCandidate } from './desert-well'
import { type IglooDraft, planIglooForCandidate } from './igloo'
import { type JunglePyramidDraft, planJunglePyramidForCandidate } from './jungle-pyramid'
import { type MineshaftDraft, planMineshaftForCandidate } from './mineshaft'
import type {
  NaturalStructureKind,
  NaturalStructurePlan,
  NaturalStructureRegion,
  NaturalStructureSamplers,
  NetherStructureTerrainSampler,
} from './natural-structure-types'
import {
  type NaturalStructureRegionPlanRequest,
  naturalStructurePlansForChunk as enumerateNaturalStructurePlansForChunk,
} from './natural-structure-chunk-planner'
export type { NaturalStructureRegionPlanRequest } from './natural-structure-chunk-planner'
import { type OceanMonumentDraft, planOceanMonumentForCandidate } from './ocean-monument'
import { type OceanRuinDraft, planOceanRuinForCandidate } from './ocean-ruin'
import { Option, Predicate } from 'effect'
import {
  type OverworldTerrainSampler,
  VILLAGE_HALF_EXTENT,
  type VillageSite,
  villageSiteForRegion,
} from './structure-siting'
import { type PillagerOutpostDraft, planPillagerOutpostForCandidate } from './pillager-outpost'
import { type ShipwreckDraft, planShipwreckForCandidate } from './shipwreck'
import { type VillageVillagerSpawn, villageBlockAt, villageVillagerSpawnsForSite } from './village'
import { CHUNK_HEIGHT } from './constants'
import type { Dimension } from './nether-travel'
import { NATURAL_STRUCTURE_BLOCK } from './natural-structure-data'
import { planEndCityForRegion } from './natural-structure-end-city'
import { planNetherFortressForRegion } from './nether-fortress'
import { planRuinedNetherPortalForRegion } from './natural-structure-portal'
import { planStrongholdForRegion } from './stronghold-structure'

export { NATURAL_STRUCTURE_BLOCK } from './natural-structure-data'
export {
  MAX_NATURAL_STRUCTURE_BLOCKS,
  MAX_NATURAL_STRUCTURE_MARKERS,
  NATURAL_STRUCTURE_GRID,
} from './natural-structure-grid-data'
export * from './natural-structure-types'
export {
  applyNaturalStructurePlansToChunk,
  naturalStructureSliceForChunk,
} from './natural-structure-application'
export { planEndCityForRegion } from './natural-structure-end-city'
export { planRuinedNetherPortalForRegion } from './natural-structure-portal'
export { planStrongholdForRegion } from './stronghold-structure'

const finishCompactStructurePlan = (
  seed: number,
  regionX: number,
  regionZ: number,
  kind: CompactStructureKind,
  draft: CompactStructureDraft,
): NaturalStructurePlan => {
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
  readonly seed: number
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
}: CompactStructureRegionPlanRequest): Option.Option<NaturalStructurePlan> => {
  const candidateOption = candidateForRegion(
    seed,
    'overworld',
    kind,
    { x: regionX, z: regionZ },
    presenceChannelSeed,
  )
  if (Option.isNone(candidateOption)) {return Option.none()}
  const draftOption = planCompactStructureForCandidate(kind, candidateOption.value, sampleTerrain)
  if (Option.isNone(draftOption)) {return Option.none()}
  return Option.some(finishCompactStructurePlan(seed, regionX, regionZ, kind, draftOption.value))
}

export const planCompactStructureForRegion = (
  seed: number,
  kind: CompactStructureKind,
  regionX: number,
  regionZ: number,
  sampleTerrain: OverworldTerrainSampler,
): Option.Option<NaturalStructurePlan> => planCompactStructureForRegionWithPresence({
  kind,
  regionX,
  regionZ,
  sampleTerrain,
  seed,
})

const VILLAGE_STRUCTURE_HEIGHT = 16
const VILLAGE_LOOT_CHEST_OFFSET_X = 1

/** Carves one village's building interiors and exteriors into `mutable`. */
const carveVillageBlocks = (mutable: MutablePlan, site: VillageSite, sampleTerrain: OverworldTerrainSampler): void => {
  for (let x = site.x - VILLAGE_HALF_EXTENT; x <= site.x + VILLAGE_HALF_EXTENT; x += UNIT_STEP) {
    for (let z = site.z - VILLAGE_HALF_EXTENT; z <= site.z + VILLAGE_HALF_EXTENT; z += UNIT_STEP) {
      const { surfaceY } = sampleTerrain(x, z)
      for (let y = surfaceY; y < Math.min(CHUNK_HEIGHT, surfaceY + VILLAGE_STRUCTURE_HEIGHT); y += UNIT_STEP) {
        const block = villageBlockAt(site, x, y, z, sampleTerrain)
        if (Predicate.isNotUndefined(block)) {addBlock(mutable, { block, x, y, z })}
      }
    }
  }
}

/** Marks every villager spawn, and drops one loot chest beside the first. */
const placeVillageSpawnsAndLoot = (mutable: MutablePlan, spawns: ReadonlyArray<VillageVillagerSpawn>): void => {
  for (const spawn of spawns) {
    addMarker(mutable, { entity: 'villager', kind: 'entity-spawn', profession: spawn.profession, x: spawn.x, y: spawn.y, z: spawn.z })
  }
  const [lootSpawn] = spawns
  if (Predicate.isNotUndefined(lootSpawn)) {
    const lootX = lootSpawn.x + VILLAGE_LOOT_CHEST_OFFSET_X
    addBlock(mutable, { block: NATURAL_STRUCTURE_BLOCK.CHEST, x: lootX, y: lootSpawn.y, z: lootSpawn.z })
    addMarker(mutable, { kind: 'loot-chest', lootTable: 'village', x: lootX, y: lootSpawn.y, z: lootSpawn.z })
  }
}

/** Plans the same village layout used by the Overworld chunk generator. */
export const planVillageForRegion = (
  seed: number,
  regionX: number,
  regionZ: number,
  sampleTerrain: OverworldTerrainSampler,
): Option.Option<NaturalStructurePlan> => {
  const siteOption = villageSiteForRegion(seed, regionX, regionZ, sampleTerrain)
  if (Option.isNone(siteOption)) {return Option.none()}
  const site = siteOption.value
  const mutable: MutablePlan = { blocks: new Map(), markers: [] }
  carveVillageBlocks(mutable, site, sampleTerrain)
  placeVillageSpawnsAndLoot(mutable, villageVillagerSpawnsForSite(seed, site, sampleTerrain))
  return Option.some(finishPlan(
    {
      dimension: 'overworld',
      id: `village:${String(seed)}:${String(regionX)}:${String(regionZ)}`,
      kind: 'village',
      origin: { x: site.x, y: sampleTerrain(site.x, site.z).surfaceY, z: site.z },
      region: { x: regionX, z: regionZ },
    },
    mutable,
  ))
}

const finishDesertPyramidPlan = (
  seed: number,
  regionX: number,
  regionZ: number,
  draft: DesertPyramidDraft,
): NaturalStructurePlan => {
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
  seed: number,
  regionX: number,
  regionZ: number,
  sampleTerrain: OverworldTerrainSampler,
  presenceChannelSeed?: CandidateChannelInput,
): Option.Option<NaturalStructurePlan> => {
  const candidateOption = candidateForRegion(seed, 'overworld', 'desert-pyramid', { x: regionX, z: regionZ }, presenceChannelSeed)
  if (Option.isNone(candidateOption)) {return Option.none()}
  const draftOption = planDesertPyramidForCandidate(candidateOption.value, sampleTerrain)
  if (Option.isNone(draftOption)) {return Option.none()}
  return Option.some(finishDesertPyramidPlan(seed, regionX, regionZ, draftOption.value))
}

const finishDesertWellPlan = (
  seed: number,
  regionX: number,
  regionZ: number,
  draft: DesertWellDraft,
): NaturalStructurePlan => {
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
  seed: number,
  regionX: number,
  regionZ: number,
  sampleTerrain: OverworldTerrainSampler,
  presenceChannelSeed?: CandidateChannelInput,
): Option.Option<NaturalStructurePlan> => {
  const candidateOption = candidateForRegion(seed, 'overworld', 'desert-well', { x: regionX, z: regionZ }, presenceChannelSeed)
  if (Option.isNone(candidateOption)) {return Option.none()}
  const draftOption = planDesertWellForCandidate(candidateOption.value, sampleTerrain)
  if (Option.isNone(draftOption)) {return Option.none()}
  return Option.some(finishDesertWellPlan(seed, regionX, regionZ, draftOption.value))
}

const finishIglooPlan = (
  seed: number,
  regionX: number,
  regionZ: number,
  draft: IglooDraft,
): NaturalStructurePlan => {
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
  seed: number,
  regionX: number,
  regionZ: number,
  sampleTerrain: OverworldTerrainSampler,
  presenceChannelSeed?: CandidateChannelInput,
): Option.Option<NaturalStructurePlan> => {
  const candidateOption = candidateForRegion(seed, 'overworld', 'igloo', { x: regionX, z: regionZ }, presenceChannelSeed)
  if (Option.isNone(candidateOption)) {return Option.none()}
  const draftOption = planIglooForCandidate(candidateOption.value, sampleTerrain)
  if (Option.isNone(draftOption)) {return Option.none()}
  return Option.some(finishIglooPlan(seed, regionX, regionZ, draftOption.value))
}

const finishJunglePyramidPlan = (
  seed: number,
  regionX: number,
  regionZ: number,
  draft: JunglePyramidDraft,
): NaturalStructurePlan => {
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
  seed: number,
  regionX: number,
  regionZ: number,
  sampleTerrain: OverworldTerrainSampler,
  presenceChannelSeed?: CandidateChannelInput,
): Option.Option<NaturalStructurePlan> => {
  const candidateOption = candidateForRegion(seed, 'overworld', 'jungle-pyramid', { x: regionX, z: regionZ }, presenceChannelSeed)
  if (Option.isNone(candidateOption)) {return Option.none()}
  const draftOption = planJunglePyramidForCandidate(candidateOption.value, sampleTerrain)
  if (Option.isNone(draftOption)) {return Option.none()}
  return Option.some(finishJunglePyramidPlan(seed, regionX, regionZ, draftOption.value))
}

const finishMineshaftPlan = (
  seed: number,
  regionX: number,
  regionZ: number,
  draft: MineshaftDraft,
): NaturalStructurePlan => finishPlanFromValidatedPlacements(
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
  seed: number,
  regionX: number,
  regionZ: number,
  sampleTerrain: OverworldTerrainSampler,
  presenceChannelSeed?: CandidateChannelInput,
): Option.Option<NaturalStructurePlan> => {
  const candidateOption = candidateForRegion(seed, 'overworld', 'mineshaft', { x: regionX, z: regionZ }, presenceChannelSeed)
  if (Option.isNone(candidateOption)) {return Option.none()}
  const draftOption = planMineshaftForCandidate(candidateOption.value, sampleTerrain)
  if (Option.isNone(draftOption)) {return Option.none()}
  return Option.some(finishMineshaftPlan(seed, regionX, regionZ, draftOption.value))
}

const finishOceanRuinPlan = (
  seed: number,
  regionX: number,
  regionZ: number,
  draft: OceanRuinDraft,
): NaturalStructurePlan => finishPlanFromValidatedPlacements(
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
  seed: number,
  regionX: number,
  regionZ: number,
  draft: OceanMonumentDraft,
): NaturalStructurePlan => {
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
  seed: number,
  regionX: number,
  regionZ: number,
  sampleTerrain: OverworldTerrainSampler,
  presenceChannelSeed?: CandidateChannelInput,
): Option.Option<NaturalStructurePlan> => {
  const candidateOption = candidateForRegion(seed, 'overworld', 'ocean-monument', { x: regionX, z: regionZ }, presenceChannelSeed)
  if (Option.isNone(candidateOption)) {return Option.none()}
  const draftOption = planOceanMonumentForCandidate(candidateOption.value, sampleTerrain)
  if (Option.isNone(draftOption)) {return Option.none()}
  return Option.some(finishOceanMonumentPlan(seed, regionX, regionZ, draftOption.value))
}

/** Plans the supported submerged ocean-ruin geometry on a dry-free, level ocean floor. */
export const planOceanRuinForRegion = (
  seed: number,
  regionX: number,
  regionZ: number,
  sampleTerrain: OverworldTerrainSampler,
  presenceChannelSeed?: CandidateChannelInput,
): Option.Option<NaturalStructurePlan> => {
  const candidateOption = candidateForRegion(seed, 'overworld', 'ocean-ruin', { x: regionX, z: regionZ }, presenceChannelSeed)
  if (Option.isNone(candidateOption)) {return Option.none()}
  const draftOption = planOceanRuinForCandidate(candidateOption.value, sampleTerrain)
  if (Option.isNone(draftOption)) {return Option.none()}
  return Option.some(finishOceanRuinPlan(seed, regionX, regionZ, draftOption.value))
}

const finishShipwreckPlan = (
  seed: number,
  regionX: number,
  regionZ: number,
  draft: ShipwreckDraft,
): NaturalStructurePlan => {
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
  seed: number,
  regionX: number,
  regionZ: number,
  sampleTerrain: OverworldTerrainSampler,
  presenceChannelSeed?: CandidateChannelInput,
): Option.Option<NaturalStructurePlan> => {
  const candidateOption = candidateForRegion(seed, 'overworld', 'shipwreck', { x: regionX, z: regionZ }, presenceChannelSeed)
  if (Option.isNone(candidateOption)) {return Option.none()}
  const draftOption = planShipwreckForCandidate(candidateOption.value, sampleTerrain)
  if (Option.isNone(draftOption)) {return Option.none()}
  return Option.some(finishShipwreckPlan(seed, regionX, regionZ, draftOption.value))
}

const finishPillagerOutpostPlan = (
  seed: number,
  regionX: number,
  regionZ: number,
  draft: PillagerOutpostDraft,
): NaturalStructurePlan => {
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
  seed: number,
  regionX: number,
  regionZ: number,
  sampleTerrain: OverworldTerrainSampler,
  presenceChannelSeed?: CandidateChannelInput,
): Option.Option<NaturalStructurePlan> => {
  const candidateOption = candidateForRegion(seed, 'overworld', 'pillager-outpost', { x: regionX, z: regionZ }, presenceChannelSeed)
  if (Option.isNone(candidateOption)) {return Option.none()}
  const draftOption = planPillagerOutpostForCandidate(candidateOption.value, sampleTerrain)
  if (Option.isNone(draftOption)) {return Option.none()}
  return Option.some(finishPillagerOutpostPlan(seed, regionX, regionZ, draftOption.value))
}

const finishBastionRemnantPlan = (
  seed: number,
  regionX: number,
  regionZ: number,
  draft: BastionRemnantDraft,
): NaturalStructurePlan => {
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
  seed: number,
  regionX: number,
  regionZ: number,
  sampleTerrain: NetherStructureTerrainSampler,
  presenceChannelSeed?: CandidateChannelInput,
): Option.Option<NaturalStructurePlan> => {
  const candidateOption = candidateForRegion(seed, 'nether', 'bastion-remnant', { x: regionX, z: regionZ }, presenceChannelSeed)
  if (Option.isNone(candidateOption)) {return Option.none()}
  const draftOption = planBastionRemnantForCandidate(candidateOption.value, sampleTerrain)
  if (Option.isNone(draftOption)) {return Option.none()}
  return Option.some(finishBastionRemnantPlan(seed, regionX, regionZ, draftOption.value))
}

type OverworldWaterStructureKind = 'ocean-monument' | 'ocean-ruin' | 'shipwreck'

type OverworldLandStructureKind = 'jungle-pyramid' | 'mineshaft' | 'pillager-outpost'

type OverworldSurfaceStructureKind = 'desert-pyramid' | 'desert-well' | 'igloo'

const isCompactStructureKind = (kind: NaturalStructureKind): kind is CompactStructureKind =>
  COMPACT_STRUCTURE_KINDS.includes(kind as CompactStructureKind)

const planOverworldWaterKind = (
  seed: number,
  kind: OverworldWaterStructureKind,
  region: NaturalStructureRegion,
  sampleTerrain: OverworldTerrainSampler,
  presenceChannelSeed?: CandidateChannelInput,
): Option.Option<NaturalStructurePlan> => {
  if (kind === 'ocean-monument') {
    return planOceanMonumentForRegion(seed, region.x, region.z, sampleTerrain, presenceChannelSeed)
  }
  if (kind === 'ocean-ruin') {
    return planOceanRuinForRegion(seed, region.x, region.z, sampleTerrain, presenceChannelSeed)
  }
  return planShipwreckForRegion(seed, region.x, region.z, sampleTerrain, presenceChannelSeed)
}

const planOverworldLandKind = (
  seed: number,
  kind: OverworldLandStructureKind,
  region: NaturalStructureRegion,
  sampleTerrain: OverworldTerrainSampler,
  presenceChannelSeed?: CandidateChannelInput,
): Option.Option<NaturalStructurePlan> => {
  if (kind === 'mineshaft') {
    return planMineshaftForRegion(seed, region.x, region.z, sampleTerrain, presenceChannelSeed)
  }
  if (kind === 'jungle-pyramid') {
    return planJunglePyramidForRegion(seed, region.x, region.z, sampleTerrain, presenceChannelSeed)
  }
  return planPillagerOutpostForRegion(seed, region.x, region.z, sampleTerrain, presenceChannelSeed)
}

const planOverworldSurfaceKind = (
  seed: number,
  kind: OverworldSurfaceStructureKind,
  region: NaturalStructureRegion,
  sampleTerrain: OverworldTerrainSampler,
  presenceChannelSeed?: CandidateChannelInput,
): Option.Option<NaturalStructurePlan> => {
  if (kind === 'desert-pyramid') {
    return planDesertPyramidForRegion(seed, region.x, region.z, sampleTerrain, presenceChannelSeed)
  }
  if (kind === 'desert-well') {
    return planDesertWellForRegion(seed, region.x, region.z, sampleTerrain, presenceChannelSeed)
  }
  return planIglooForRegion(seed, region.x, region.z, sampleTerrain, presenceChannelSeed)
}

const planOverworldKind = (
  seed: number,
  kind: NaturalStructureKind,
  region: NaturalStructureRegion,
  sampleTerrain: OverworldTerrainSampler,
  presenceChannelSeed?: CandidateChannelInput,
): Option.Option<NaturalStructurePlan> => {
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
  seed: number,
  kind: NaturalStructureKind,
  region: NaturalStructureRegion,
  sampleTerrain: OverworldTerrainSampler | undefined,
  presenceChannelSeed?: CandidateChannelInput,
): Option.Option<NaturalStructurePlan> => {
  if (kind === 'stronghold') {
    return planStrongholdForRegion(seed, region.x, region.z)
  }
  if (Predicate.isUndefined(sampleTerrain)) {
    return Option.none()
  }
  return planOverworldKind(seed, kind, region, sampleTerrain, presenceChannelSeed)
}

const netherFortressPresenceChannelSeedFor = (
  candidateChannelInput?: CandidateChannelInput,
): number | undefined => {
  if (typeof candidateChannelInput === 'number') {
    return candidateChannelInput
  }
  return candidateChannelInput?.presence
}

const planNetherRegion = (
  seed: number,
  kind: NaturalStructureKind,
  region: NaturalStructureRegion,
  sampleTerrain: NetherStructureTerrainSampler | undefined,
  candidateChannelInput?: CandidateChannelInput,
): Option.Option<NaturalStructurePlan> => {
  if (Predicate.isUndefined(sampleTerrain)) {
    return Option.none()
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

/** Plans one supported natural structure for a single region. */
export const planNaturalStructureForRegion = ({
  candidateChannelSeeds,
  dimension,
  kind,
  presenceChannelSeed,
  region,
  samplers,
  seed,
}: NaturalStructureRegionPlanRequest): Option.Option<NaturalStructurePlan> => {
  const candidateChannelInput = candidateChannelSeeds ?? presenceChannelSeed
  if (dimension === 'overworld') {
    return planOverworldRegion(seed, kind, region, samplers.overworld, candidateChannelInput)
  }
  if (dimension === 'nether') {
    return planNetherRegion(seed, kind, region, samplers.nether, candidateChannelInput)
  }
  return planEndCityForRegion(seed, region.x, region.z, samplers.end, candidateChannelInput)
}

/**
 * Enumerates only candidate regions that can overlap a chunk. The bounds are
 * derived from the candidate coordinate interval and handle negative
 * coordinates through floor division.
 */
export const naturalStructurePlansForChunk = (
  seed: number,
  dimension: Dimension,
  coord: { readonly cx: number; readonly cz: number },
  samplers: NaturalStructureSamplers = {},
): ReadonlyArray<NaturalStructurePlan> =>
  enumerateNaturalStructurePlansForChunk(seed, dimension, coord, samplers, planNaturalStructureForRegion)
