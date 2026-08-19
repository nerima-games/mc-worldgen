/** Deterministic, immutable plans for cross-chunk natural structures. */
import { type BastionRemnantDraft, planBastionRemnantForCandidate } from './bastion-remnant'
import { CHUNK_HEIGHT, CHUNK_SIZE_XZ } from './constants'
import { type Chunk, setBlockAt } from './chunk'
import { type DesertPyramidDraft, planDesertPyramidForCandidate } from './desert-pyramid'
import { END_OUTER_ISLAND_START, endSurfaceHeightAt } from './end-terrain'
import { type IglooDraft, planIglooForCandidate } from './igloo'
import { type JunglePyramidDraft, planJunglePyramidForCandidate } from './jungle-pyramid'
import { type MineshaftDraft, planMineshaftForCandidate } from './mineshaft'
import { type OceanMonumentDraft, planOceanMonumentForCandidate } from './ocean-monument'
import { type OceanRuinDraft, planOceanRuinForCandidate } from './ocean-ruin'
import { Option, Predicate } from 'effect'
import {
  type OverworldTerrainSampler,
  VILLAGE_HALF_EXTENT,
  VILLAGE_REGION_SIZE,
  VILLAGE_SITE_MARGIN,
  type VillageSite,
  villageSiteForRegion,
} from './structure-siting'
import { type PillagerOutpostDraft, planPillagerOutpostForCandidate } from './pillager-outpost'
import { type ShipwreckDraft, planShipwreckForCandidate } from './shipwreck'
import { type VillageVillagerSpawn, villageBlockAt, villageVillagerSpawnsForSite } from './village'
import { channelSeed, latticeValue } from '@nerima-games/mc-noise'
import { BASTION_REMNANT_GRID } from './bastion-remnant-data'
import type { BlockId } from '@nerima-games/mc-kernel'
import { DESERT_PYRAMID_GRID } from './desert-pyramid-data'
import type { Dimension } from './nether-travel'
import { IGLOO_GRID } from './igloo-data'
import { JUNGLE_PYRAMID_GRID } from './jungle-pyramid-data'
import { MINESHAFT_GRID } from './mineshaft-data'
import { NATURAL_STRUCTURE_BLOCK } from './natural-structure-data'
import { NETHER_FORTRESS_GRID } from './nether-fortress-data'
import { OCEAN_MONUMENT_GRID } from './ocean-monument-data'
import { OCEAN_RUIN_GRID } from './ocean-ruin-data'
import { PILLAGER_OUTPOST_GRID } from './pillager-outpost-data'
import { SHIPWRECK_GRID } from './shipwreck-data'
import { planNetherFortressForRegion } from './nether-fortress'

export { NATURAL_STRUCTURE_BLOCK } from './natural-structure-data'

/** Advances a loop counter, or a coordinate offset, by one unit. */
const UNIT_STEP = 1

export type NaturalStructureKind = 'desert-pyramid' | 'igloo' | 'jungle-pyramid' | 'mineshaft' | 'ocean-monument' | 'ocean-ruin' | 'pillager-outpost' | 'shipwreck' | 'village' | 'ruined-nether-portal' | 'nether-fortress' | 'bastion-remnant' | 'end-city'

export type NaturalStructureGrid = {
  /** Distance between candidate-region origins, in blocks. */
  readonly spacing: number
  /** Guaranteed minimum distance between candidates in adjacent regions, in blocks. */
  readonly separation: number
  /** Fraction of regions that reach terrain validation, in permille. */
  readonly spawnPermille: number
}

const VILLAGE_SEPARATION_MULTIPLIER = 2

export const NATURAL_STRUCTURE_GRID: Readonly<Record<NaturalStructureKind, NaturalStructureGrid>> = Object.freeze({
  'bastion-remnant': BASTION_REMNANT_GRID,
  'desert-pyramid': DESERT_PYRAMID_GRID,
  'end-city': Object.freeze({ separation: 176, spacing: 320, spawnPermille: 350 }),
  igloo: IGLOO_GRID,
  'jungle-pyramid': JUNGLE_PYRAMID_GRID,
  mineshaft: MINESHAFT_GRID,
  'nether-fortress': NETHER_FORTRESS_GRID,
  'ocean-monument': OCEAN_MONUMENT_GRID,
  'ocean-ruin': OCEAN_RUIN_GRID,
  'pillager-outpost': PILLAGER_OUTPOST_GRID,
  'ruined-nether-portal': Object.freeze({ separation: 64, spacing: 192, spawnPermille: 300 }),
  shipwreck: SHIPWRECK_GRID,
  village: Object.freeze({
    separation: VILLAGE_SITE_MARGIN * VILLAGE_SEPARATION_MULTIPLIER,
    spacing: VILLAGE_REGION_SIZE,
    spawnPermille: 120,
  }),
})

export const MAX_NATURAL_STRUCTURE_BLOCKS = 4096
export const MAX_NATURAL_STRUCTURE_MARKERS = 32

export type NaturalStructureRegion = { readonly x: number; readonly z: number }
export type NaturalStructurePosition = { readonly x: number; readonly y: number; readonly z: number }
export type NaturalStructureBounds = {
  readonly minX: number
  readonly maxX: number
  readonly minY: number
  readonly maxY: number
  readonly minZ: number
  readonly maxZ: number
}
export type NaturalStructureBlockPlacement = NaturalStructurePosition & { readonly block: BlockId }

export type NaturalStructureMarker = NaturalStructurePosition & (
  | { readonly kind: 'loot-chest'; readonly lootTable: 'desert-pyramid' | 'igloo' | 'jungle-pyramid' | 'mineshaft' | 'ocean-monument' | 'ocean-ruin' | 'pillager-outpost' | 'shipwreck' | 'village' | 'ruined-nether-portal' | 'nether-fortress' | 'bastion-remnant' | 'end-city' | 'end-ship' }
  | { readonly kind: 'entity-spawn'; readonly entity: 'villager'; readonly profession: 'farmer' | 'toolsmith' }
  | { readonly kind: 'entity-spawn'; readonly entity: 'zombie-villager' }
  | { readonly kind: 'entity-spawn'; readonly entity: 'pillager' }
  | { readonly kind: 'entity-spawn'; readonly entity: 'blaze' | 'wither-skeleton' }
  | { readonly kind: 'entity-spawn'; readonly entity: 'piglin' | 'piglin-brute' }
  | { readonly kind: 'spawner'; readonly entity: 'shulker' | 'blaze' }
  | { readonly kind: 'portal-frame'; readonly axis: 'x' | 'z'; readonly complete: false }
  | { readonly kind: 'end-ship' }
)

export type NaturalStructurePlan = {
  readonly id: string
  readonly kind: NaturalStructureKind
  readonly dimension: Dimension
  readonly region: NaturalStructureRegion
  readonly origin: NaturalStructurePosition
  readonly bounds: NaturalStructureBounds
  readonly blocks: ReadonlyArray<NaturalStructureBlockPlacement>
  readonly markers: ReadonlyArray<NaturalStructureMarker>
}

export type NaturalStructureChunkSlice = {
  readonly chunkX: number
  readonly chunkZ: number
  readonly blocks: ReadonlyArray<NaturalStructureBlockPlacement>
  readonly markers: ReadonlyArray<NaturalStructureMarker>
}

export type AppliedNaturalStructureMarker = NaturalStructureMarker & {
  readonly structureId: string
  readonly structureKind: NaturalStructureKind
}

/** A normal chunk with generation-time semantic markers kept for downstream systems. */
export type NaturalStructureChunk = Chunk & {
  readonly naturalStructureIds: ReadonlyArray<string>
  readonly naturalStructureMarkers: ReadonlyArray<AppliedNaturalStructureMarker>
}

export type NaturalStructureSamplers = {
  readonly nether?: NetherStructureTerrainSampler
  readonly end?: EndStructureTerrainSampler
  readonly overworld?: OverworldTerrainSampler
}

export type NetherStructureTerrainSample = {
  readonly surfaceY: number
  readonly ceilingY: number
}
export type NetherStructureTerrainSampler = (x: number, z: number) => NetherStructureTerrainSample | undefined
export type EndStructureTerrainSampler = (x: number, z: number) => number | undefined

type Candidate = NaturalStructureRegion
type MutablePlan = {
  readonly blocks: Map<string, NaturalStructureBlockPlacement>
  readonly markers: Array<NaturalStructureMarker>
}

const keyOf = (x: number, y: number, z: number): string => `${String(x)},${String(y)},${String(z)}`
const floorDiv = (value: number, divisor: number): number => Math.floor(value / divisor)

const PERMILLE_DENOMINATOR = 1000
const CANDIDATE_MARGIN_DIVISOR = 2

const candidateForRegion = (
  seed: number,
  dimension: Dimension,
  kind: NaturalStructureKind,
  region: NaturalStructureRegion,
): Option.Option<Candidate> => {
  const grid = NATURAL_STRUCTURE_GRID[kind]
  if (latticeValue(channelSeed(seed, `${dimension}:${kind}:present`), region.x, region.z) >= grid.spawnPermille / PERMILLE_DENOMINATOR) {
    return Option.none()
  }
  const margin = grid.separation / CANDIDATE_MARGIN_DIVISOR
  const span = grid.spacing - grid.separation
  return Option.some(Object.freeze({
    x: region.x * grid.spacing + margin + Math.floor(latticeValue(channelSeed(seed, `${dimension}:${kind}:x`), region.x, region.z) * span),
    z: region.z * grid.spacing + margin + Math.floor(latticeValue(channelSeed(seed, `${dimension}:${kind}:z`), region.x, region.z) * span),
  }))
}

const NATURAL_STRUCTURE_WORLD_MIN_Y = 0

const addBlock = (mutable: MutablePlan, placement: NaturalStructureBlockPlacement): void => {
  const { block, x, y, z } = placement
  if (y < NATURAL_STRUCTURE_WORLD_MIN_Y || y >= CHUNK_HEIGHT) {return}
  const key = keyOf(x, y, z)
  /**
   * UNREACHABLE TODAY, NOT PROVABLY DEAD — weaker than the other guards this
   * repository marks this way, and deliberately not deleted for that reason.
   * `addBlock` is module-private, so the cap can only be approached through
   * the fixed-geometry natural-structure planners. The guard stays live
   * because future structure geometry or a terrain sampler with much more Y
   * variation could raise the block count; the cap is not a type-level
   * invariant.
   */
  // oxlint-disable-next-line capitalized-comments -- v8 coverage directive, case-sensitive
  /* v8 ignore next */
  if (!mutable.blocks.has(key) && mutable.blocks.size >= MAX_NATURAL_STRUCTURE_BLOCKS) {return}
  mutable.blocks.set(key, Object.freeze({ block, x, y, z }))
}

const addMarker = (mutable: MutablePlan, marker: NaturalStructureMarker): void => {
  if (mutable.markers.length < MAX_NATURAL_STRUCTURE_MARKERS) {mutable.markers.push(Object.freeze(marker))}
}

/** Everything about a plan except its accumulated blocks and markers. */
type NaturalStructureDraftMeta = {
  readonly dimension: Dimension
  readonly id: string
  readonly kind: NaturalStructureKind
  readonly origin: NaturalStructurePosition
  readonly region: NaturalStructureRegion
}

const finishPlan = (meta: NaturalStructureDraftMeta, mutable: MutablePlan): NaturalStructurePlan => {
  const blocks = Object.freeze([...mutable.blocks.values()])
  const markers = Object.freeze([...mutable.markers])
  const positions: ReadonlyArray<NaturalStructurePosition> = [...blocks, ...markers]
  const xs = positions.map((position) => position.x)
  const ys = positions.map((position) => position.y)
  const zs = positions.map((position) => position.z)
  const bounds = Object.freeze({
    maxX: Math.max(...xs), maxY: Math.max(...ys), maxZ: Math.max(...zs),
    minX: Math.min(...xs), minY: Math.min(...ys), minZ: Math.min(...zs),
  })
  return Object.freeze({
    blocks,
    bounds,
    dimension: meta.dimension,
    id: meta.id,
    kind: meta.kind,
    markers,
    origin: Object.freeze(meta.origin),
    region: Object.freeze(meta.region),
  })
}

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
): Option.Option<NaturalStructurePlan> => {
  const candidateOption = candidateForRegion(seed, 'overworld', 'desert-pyramid', { x: regionX, z: regionZ })
  if (Option.isNone(candidateOption)) {return Option.none()}
  const draftOption = planDesertPyramidForCandidate(candidateOption.value, sampleTerrain)
  if (Option.isNone(draftOption)) {return Option.none()}
  return Option.some(finishDesertPyramidPlan(seed, regionX, regionZ, draftOption.value))
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
): Option.Option<NaturalStructurePlan> => {
  const candidateOption = candidateForRegion(seed, 'overworld', 'igloo', { x: regionX, z: regionZ })
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
): Option.Option<NaturalStructurePlan> => {
  const candidateOption = candidateForRegion(seed, 'overworld', 'jungle-pyramid', { x: regionX, z: regionZ })
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
): NaturalStructurePlan => {
  const mutable: MutablePlan = { blocks: new Map(), markers: [] }
  for (const block of draft.blocks) {addBlock(mutable, block)}
  for (const marker of draft.markers) {addMarker(mutable, marker)}
  return finishPlan(
    {
      dimension: 'overworld',
      id: `mineshaft:${String(seed)}:${String(regionX)}:${String(regionZ)}`,
      kind: 'mineshaft',
      origin: draft.origin,
      region: { x: regionX, z: regionZ },
    },
    mutable,
  )
}

/** Plans the supported underground mineshaft network on a level terrain site. */
export const planMineshaftForRegion = (
  seed: number,
  regionX: number,
  regionZ: number,
  sampleTerrain: OverworldTerrainSampler,
): Option.Option<NaturalStructurePlan> => {
  const candidateOption = candidateForRegion(seed, 'overworld', 'mineshaft', { x: regionX, z: regionZ })
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
): NaturalStructurePlan => {
  const mutable: MutablePlan = { blocks: new Map(), markers: [] }
  for (const block of draft.blocks) {addBlock(mutable, block)}
  for (const marker of draft.markers) {addMarker(mutable, marker)}
  return finishPlan(
    {
      dimension: 'overworld',
      id: `ocean-ruin:${String(seed)}:${String(regionX)}:${String(regionZ)}`,
      kind: 'ocean-ruin',
      origin: draft.origin,
      region: { x: regionX, z: regionZ },
    },
    mutable,
  )
}

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
): Option.Option<NaturalStructurePlan> => {
  const candidateOption = candidateForRegion(seed, 'overworld', 'ocean-monument', { x: regionX, z: regionZ })
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
): Option.Option<NaturalStructurePlan> => {
  const candidateOption = candidateForRegion(seed, 'overworld', 'ocean-ruin', { x: regionX, z: regionZ })
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
): Option.Option<NaturalStructurePlan> => {
  const candidateOption = candidateForRegion(seed, 'overworld', 'shipwreck', { x: regionX, z: regionZ })
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
): Option.Option<NaturalStructurePlan> => {
  const candidateOption = candidateForRegion(seed, 'overworld', 'pillager-outpost', { x: regionX, z: regionZ })
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
): Option.Option<NaturalStructurePlan> => {
  const candidateOption = candidateForRegion(seed, 'nether', 'bastion-remnant', { x: regionX, z: regionZ })
  if (Option.isNone(candidateOption)) {return Option.none()}
  const draftOption = planBastionRemnantForCandidate(candidateOption.value, sampleTerrain)
  if (Option.isNone(draftOption)) {return Option.none()}
  return Option.some(finishBastionRemnantPlan(seed, regionX, regionZ, draftOption.value))
}

const PORTAL_PROBE_OFFSET = 3
const PORTAL_BASE_Y_CLEARANCE = 1
const PORTAL_MAX_SURFACE_VARIATION = 6
const PORTAL_MIN_CEILING_CLEARANCE = 7

const portalTerrainFits = (
  candidate: Candidate,
  sample: NetherStructureTerrainSampler,
): Option.Option<number> => {
  const probes = [
    sample(candidate.x, candidate.z),
    sample(candidate.x - PORTAL_PROBE_OFFSET, candidate.z),
    sample(candidate.x + PORTAL_PROBE_OFFSET, candidate.z),
    sample(candidate.x, candidate.z - PORTAL_PROBE_OFFSET),
    sample(candidate.x, candidate.z + PORTAL_PROBE_OFFSET),
  ]
  const validProbes = probes.filter(Predicate.isNotUndefined)
  if (validProbes.length !== probes.length) {return Option.none()}

  const surfaces = validProbes.map((probe) => probe.surfaceY)
  const baseY = Math.max(...surfaces) + PORTAL_BASE_Y_CLEARANCE
  if (
    Math.max(...surfaces) - Math.min(...surfaces) > PORTAL_MAX_SURFACE_VARIATION
    || validProbes.some((probe) => probe.ceilingY - baseY < PORTAL_MIN_CEILING_CLEARANCE)
  ) {
    return Option.none()
  }
  return Option.some(baseY)
}

const PORTAL_RUIN_AXIS_CHANCE = 0.5
const PORTAL_RUIN_DAMAGE_VARIANTS = 4
const PORTAL_RUIN_FLOOR_ACROSS_HALF_EXTENT = 3
const PORTAL_RUIN_FLOOR_ALONG_HALF_EXTENT = 2
const PORTAL_RUIN_FLOOR_Y_OFFSET = 1
const PORTAL_RUIN_FRAME_WIDTH = 4
const PORTAL_RUIN_FRAME_HEIGHT = 5
const PORTAL_RUIN_FRAME_FIRST_COLUMN = 0
const PORTAL_RUIN_FRAME_LAST_COLUMN = 3
const PORTAL_RUIN_FRAME_FIRST_ROW = 0
const PORTAL_RUIN_FRAME_LAST_ROW = 4
const PORTAL_RUIN_FRAME_HORIZONTAL_ORIGIN_OFFSET = 1
const PORTAL_RUIN_CHEST_OFFSET_ACROSS = 3
const PORTAL_RUIN_CHEST_OFFSET_ALONG = 2

const naturalAxisFromChance = (chance: number): 'x' | 'z' => {
  if (chance < PORTAL_RUIN_AXIS_CHANCE) {
    return 'x'
  }
  return 'z'
}

/** Rotates an (across, along) offset pair into world (x, z) for the ruin's chosen axis. */
const acrossAlongToXZ = (candidate: Candidate, axis: 'x' | 'z', across: number, along: number): NaturalStructureRegion => {
  if (axis === 'x') {
    return { x: candidate.x + across, z: candidate.z + along }
  }
  return { x: candidate.x + along, z: candidate.z + across }
}

const carvePortalRuinFloor = (mutable: MutablePlan, candidate: Candidate, axis: 'x' | 'z', baseY: number): void => {
  for (let across = -PORTAL_RUIN_FLOOR_ACROSS_HALF_EXTENT; across <= PORTAL_RUIN_FLOOR_ACROSS_HALF_EXTENT; across += UNIT_STEP) {
    for (let along = -PORTAL_RUIN_FLOOR_ALONG_HALF_EXTENT; along <= PORTAL_RUIN_FLOOR_ALONG_HALF_EXTENT; along += UNIT_STEP) {
      const { x, z } = acrossAlongToXZ(candidate, axis, across, along)
      addBlock(mutable, { block: NATURAL_STRUCTURE_BLOCK.NETHERRACK, x, y: baseY - PORTAL_RUIN_FLOOR_Y_OFFSET, z })
    }
  }
}

const portalFrameColumnXZ = (candidate: Candidate, axis: 'x' | 'z', horizontal: number): NaturalStructureRegion => {
  const offset = horizontal - PORTAL_RUIN_FRAME_HORIZONTAL_ORIGIN_OFFSET
  if (axis === 'x') {
    return { x: candidate.x + offset, z: candidate.z }
  }
  return { x: candidate.x, z: candidate.z + offset }
}

const isPortalFrameBorderCell = (horizontal: number, vertical: number): boolean =>
  horizontal === PORTAL_RUIN_FRAME_FIRST_COLUMN ||
  horizontal === PORTAL_RUIN_FRAME_LAST_COLUMN ||
  vertical === PORTAL_RUIN_FRAME_FIRST_ROW ||
  vertical === PORTAL_RUIN_FRAME_LAST_ROW

type PortalRuinFrameParams = {
  readonly axis: 'x' | 'z'
  readonly baseY: number
  readonly missing: number
}

const carvePortalRuinFrame = (mutable: MutablePlan, candidate: Candidate, params: PortalRuinFrameParams): void => {
  const { axis, baseY, missing } = params
  for (let horizontal = 0; horizontal < PORTAL_RUIN_FRAME_WIDTH; horizontal += UNIT_STEP) {
    for (let vertical = 0; vertical < PORTAL_RUIN_FRAME_HEIGHT; vertical += UNIT_STEP) {
      if (isPortalFrameBorderCell(horizontal, vertical) && (horizontal + vertical) % PORTAL_RUIN_DAMAGE_VARIANTS !== missing) {
        const { x, z } = portalFrameColumnXZ(candidate, axis, horizontal)
        addBlock(mutable, { block: NATURAL_STRUCTURE_BLOCK.OBSIDIAN, x, y: baseY + vertical, z })
      }
    }
  }
}

const placePortalRuinLoot = (mutable: MutablePlan, candidate: Candidate, baseY: number, axis: 'x' | 'z'): void => {
  const lootX = candidate.x + PORTAL_RUIN_CHEST_OFFSET_ACROSS
  const lootZ = candidate.z + PORTAL_RUIN_CHEST_OFFSET_ALONG
  addBlock(mutable, { block: NATURAL_STRUCTURE_BLOCK.CHEST, x: lootX, y: baseY, z: lootZ })
  addMarker(mutable, { axis, complete: false, kind: 'portal-frame', x: candidate.x, y: baseY, z: candidate.z })
  addMarker(mutable, { kind: 'loot-chest', lootTable: 'ruined-nether-portal', x: lootX, y: baseY, z: lootZ })
}

type PortalRuinSite = { readonly candidate: Candidate; readonly baseY: number }

const portalRuinSiteForRegion = (
  seed: number,
  region: NaturalStructureRegion,
  sampleTerrain: NetherStructureTerrainSampler,
): Option.Option<PortalRuinSite> => {
  const candidateOption = candidateForRegion(seed, 'nether', 'ruined-nether-portal', region)
  if (Option.isNone(candidateOption)) {return Option.none()}
  const candidate = candidateOption.value
  const baseYOption = portalTerrainFits(candidate, sampleTerrain)
  if (Option.isNone(baseYOption)) {return Option.none()}
  return Option.some({ baseY: baseYOption.value, candidate })
}

/** Plans an intentionally incomplete, unlit Nether portal ruin. */
export const planRuinedNetherPortalForRegion = (
  seed: number,
  regionX: number,
  regionZ: number,
  sampleTerrain: NetherStructureTerrainSampler,
): Option.Option<NaturalStructurePlan> => {
  const siteOption = portalRuinSiteForRegion(seed, { x: regionX, z: regionZ }, sampleTerrain)
  if (Option.isNone(siteOption)) {return Option.none()}
  const { candidate, baseY } = siteOption.value
  const axis = naturalAxisFromChance(latticeValue(channelSeed(seed, 'nether:ruined-nether-portal:axis'), regionX, regionZ))
  const mutable: MutablePlan = { blocks: new Map(), markers: [] }
  carvePortalRuinFloor(mutable, candidate, axis, baseY)
  carvePortalRuinFrame(mutable, candidate, {
    axis,
    baseY,
    missing: Math.floor(
      latticeValue(channelSeed(seed, 'nether:ruined-nether-portal:damage'), regionX, regionZ) * PORTAL_RUIN_DAMAGE_VARIANTS,
    ),
  })
  placePortalRuinLoot(mutable, candidate, baseY, axis)
  return Option.some(finishPlan(
    {
      dimension: 'nether',
      id: `ruined-nether-portal:${String(seed)}:${String(regionX)}:${String(regionZ)}`,
      kind: 'ruined-nether-portal',
      origin: { x: candidate.x, y: baseY, z: candidate.z },
      region: { x: regionX, z: regionZ },
    },
    mutable,
  ))
}

const END_CITY_PROBE_OFFSET = 6
const END_CITY_MAX_SURFACE_VARIATION = 5
const END_CITY_BASE_Y_CLEARANCE = 1

const endTerrainFits = (candidate: Candidate, sample: EndStructureTerrainSampler): Option.Option<number> => {
  if (Math.hypot(candidate.x, candidate.z) < END_OUTER_ISLAND_START) {return Option.none()}
  const heights = [
    sample(candidate.x, candidate.z),
    sample(candidate.x - END_CITY_PROBE_OFFSET, candidate.z),
    sample(candidate.x + END_CITY_PROBE_OFFSET, candidate.z),
    sample(candidate.x, candidate.z - END_CITY_PROBE_OFFSET),
    sample(candidate.x, candidate.z + END_CITY_PROBE_OFFSET),
  ]
  if (heights.some(Predicate.isUndefined)) {return Option.none()}
  const present = heights.filter(Predicate.isNotUndefined)
  if (Math.max(...present) - Math.min(...present) > END_CITY_MAX_SURFACE_VARIATION) {return Option.none()}
  return Option.some(Math.max(...present) + END_CITY_BASE_Y_CLEARANCE)
}

const END_TOWER_HEIGHT = 20
const END_TOWER_HALF_EXTENT = 3
const END_TOWER_PILLAR_INTERVAL = 5
const END_TOWER_PILLAR_PHASE = 0

const endTowerBlockAt = (y: number): BlockId => {
  if (y % END_TOWER_PILLAR_INTERVAL === END_TOWER_PILLAR_PHASE) {
    return NATURAL_STRUCTURE_BLOCK.PURPUR_PILLAR
  }
  return NATURAL_STRUCTURE_BLOCK.PURPUR
}

const addEndTower = (mutable: MutablePlan, x: number, baseY: number, z: number): void => {
  for (let y = baseY; y <= baseY + END_TOWER_HEIGHT; y += UNIT_STEP) {
    for (let dx = -END_TOWER_HALF_EXTENT; dx <= END_TOWER_HALF_EXTENT; dx += UNIT_STEP) {
      for (let dz = -END_TOWER_HALF_EXTENT; dz <= END_TOWER_HALF_EXTENT; dz += UNIT_STEP) {
        const boundary = Math.abs(dx) === END_TOWER_HALF_EXTENT || Math.abs(dz) === END_TOWER_HALF_EXTENT
        if (y === baseY || y === baseY + END_TOWER_HEIGHT || boundary) {
          addBlock(mutable, { block: endTowerBlockAt(y), x: x + dx, y, z: z + dz })
        }
      }
    }
  }
}

const END_SHIP_HALF_LENGTH = 7
const END_SHIP_MIN_HALF_WIDTH = 1
const END_SHIP_MAX_HALF_WIDTH = 4
const END_SHIP_TAPER_DIVISOR = 2
const END_SHIP_MAST_HEIGHT = 8
const END_SHIP_DECK_Y_OFFSET = 1
const END_SHIP_CHEST_OFFSET_X = 4
const END_SHIP_END_ROD_OFFSET_X = 5

const addEndShip = (mutable: MutablePlan, x: number, y: number, z: number): void => {
  for (let dx = -END_SHIP_HALF_LENGTH; dx <= END_SHIP_HALF_LENGTH; dx += UNIT_STEP) {
    const halfWidth = Math.max(END_SHIP_MIN_HALF_WIDTH, END_SHIP_MAX_HALF_WIDTH - Math.floor(Math.abs(dx) / END_SHIP_TAPER_DIVISOR))
    for (let dz = -halfWidth; dz <= halfWidth; dz += UNIT_STEP) {addBlock(mutable, { block: NATURAL_STRUCTURE_BLOCK.PURPUR, x: x + dx, y, z: z + dz })}
  }
  for (let mastY = y + END_SHIP_DECK_Y_OFFSET; mastY <= y + END_SHIP_MAST_HEIGHT; mastY += UNIT_STEP) {
    addBlock(mutable, { block: NATURAL_STRUCTURE_BLOCK.PURPUR_PILLAR, x, y: mastY, z })
  }
  addBlock(mutable, { block: NATURAL_STRUCTURE_BLOCK.CHEST, x: x + END_SHIP_CHEST_OFFSET_X, y: y + END_SHIP_DECK_Y_OFFSET, z })
  addBlock(mutable, { block: NATURAL_STRUCTURE_BLOCK.END_ROD, x: x - END_SHIP_END_ROD_OFFSET_X, y: y + END_SHIP_DECK_Y_OFFSET, z })
}

type EndCitySite = { readonly candidate: Candidate; readonly baseY: number }

const endCitySiteForRegion = (
  seed: number,
  region: NaturalStructureRegion,
  sampleTerrain: EndStructureTerrainSampler,
): Option.Option<EndCitySite> => {
  const candidateOption = candidateForRegion(seed, 'end', 'end-city', region)
  if (Option.isNone(candidateOption)) {return Option.none()}
  const candidate = candidateOption.value
  const baseYOption = endTerrainFits(candidate, sampleTerrain)
  if (Option.isNone(baseYOption)) {return Option.none()}
  return Option.some({ baseY: baseYOption.value, candidate })
}

const END_SHIP_DIRECTION_CHANCE = 0.5
const END_SHIP_DIRECTION_NEGATIVE = -1
const END_SHIP_DIRECTION_POSITIVE = 1
const END_SHIP_DISTANCE = 24
const END_SHIP_DECK_HEIGHT_ABOVE_BASE = 14

const endShipDirection = (chance: number): number => {
  if (chance < END_SHIP_DIRECTION_CHANCE) {
    return END_SHIP_DIRECTION_NEGATIVE
  }
  return END_SHIP_DIRECTION_POSITIVE
}

type EndCityShipPosition = { readonly shipX: number; readonly shipY: number }

const endShipPositionFor = (
  seed: number,
  region: NaturalStructureRegion,
  candidate: Candidate,
  baseY: number,
): EndCityShipPosition => {
  const direction = endShipDirection(latticeValue(channelSeed(seed, 'end:end-city:ship-direction'), region.x, region.z))
  return { shipX: candidate.x + direction * END_SHIP_DISTANCE, shipY: baseY + END_SHIP_DECK_HEIGHT_ABOVE_BASE }
}

const END_CITY_CHEST_OFFSET_X = 1
const END_CITY_CHEST_Y_OFFSET = 1
const END_CITY_SPAWNER_Y_OFFSET = 10
const END_SHIP_LOOT_OFFSET_X = 4
const END_SHIP_LOOT_Y_OFFSET = 1

const placeEndCityDecorations = (mutable: MutablePlan, candidate: Candidate, baseY: number, ship: EndCityShipPosition): void => {
  addBlock(mutable, { block: NATURAL_STRUCTURE_BLOCK.END_STONE_BRICKS, x: candidate.x, y: baseY, z: candidate.z })
  addBlock(mutable, {
    block: NATURAL_STRUCTURE_BLOCK.CHEST,
    x: candidate.x + END_CITY_CHEST_OFFSET_X,
    y: baseY + END_CITY_CHEST_Y_OFFSET,
    z: candidate.z,
  })
  addMarker(mutable, { entity: 'shulker', kind: 'spawner', x: candidate.x, y: baseY + END_CITY_SPAWNER_Y_OFFSET, z: candidate.z })
  addMarker(mutable, {
    kind: 'loot-chest',
    lootTable: 'end-city',
    x: candidate.x + END_CITY_CHEST_OFFSET_X,
    y: baseY + END_CITY_CHEST_Y_OFFSET,
    z: candidate.z,
  })
  addMarker(mutable, { kind: 'end-ship', x: ship.shipX, y: ship.shipY, z: candidate.z })
  addMarker(mutable, {
    kind: 'loot-chest',
    lootTable: 'end-ship',
    x: ship.shipX + END_SHIP_LOOT_OFFSET_X,
    y: ship.shipY + END_SHIP_LOOT_Y_OFFSET,
    z: candidate.z,
  })
}

/** Plans an End city tower and its ship on a broad, level outer island. */
export const planEndCityForRegion = (
  seed: number,
  regionX: number,
  regionZ: number,
  sampleTerrain: EndStructureTerrainSampler = (x, z) => endSurfaceHeightAt(seed, x, z),
): Option.Option<NaturalStructurePlan> => {
  const siteOption = endCitySiteForRegion(seed, { x: regionX, z: regionZ }, sampleTerrain)
  if (Option.isNone(siteOption)) {return Option.none()}
  const { candidate, baseY } = siteOption.value
  const ship = endShipPositionFor(seed, { x: regionX, z: regionZ }, candidate, baseY)
  const mutable: MutablePlan = { blocks: new Map(), markers: [] }
  addEndTower(mutable, candidate.x, baseY, candidate.z)
  addEndShip(mutable, ship.shipX, ship.shipY, candidate.z)
  placeEndCityDecorations(mutable, candidate, baseY, ship)
  return Option.some(finishPlan(
    {
      dimension: 'end',
      id: `end-city:${String(seed)}:${String(regionX)}:${String(regionZ)}`,
      kind: 'end-city',
      origin: { x: candidate.x, y: baseY, z: candidate.z },
      region: { x: regionX, z: regionZ },
    },
    mutable,
  ))
}

/** Projects a plan without observing or mutating loaded neighbouring chunks. */
export const naturalStructureSliceForChunk = (
  plan: NaturalStructurePlan,
  chunkX: number,
  chunkZ: number,
): NaturalStructureChunkSlice => Object.freeze({
  blocks: Object.freeze(plan.blocks.filter((block) =>
    floorDiv(block.x, CHUNK_SIZE_XZ) === chunkX && floorDiv(block.z, CHUNK_SIZE_XZ) === chunkZ,
  )),
  chunkX,
  chunkZ,
  markers: Object.freeze(plan.markers.filter((marker) =>
    floorDiv(marker.x, CHUNK_SIZE_XZ) === chunkX && floorDiv(marker.z, CHUNK_SIZE_XZ) === chunkZ,
  )),
})

const plansInStableOrder = (plans: ReadonlyArray<NaturalStructurePlan>): ReadonlyArray<NaturalStructurePlan> =>
  [...new Map(plans.map((plan) => [plan.id, plan])).values()].sort((left, right) => left.id.localeCompare(right.id))

const naturalStructureKindsFor = (dimension: Dimension): ReadonlyArray<NaturalStructureKind> => {
  if (dimension === 'overworld') {
    return ['desert-pyramid', 'igloo', 'jungle-pyramid', 'mineshaft', 'ocean-monument', 'ocean-ruin', 'pillager-outpost', 'shipwreck', 'village']
  }
  if (dimension === 'nether') {
    return ['bastion-remnant', 'ruined-nether-portal', 'nether-fortress']
  }
  return ['end-city']
}

const CHUNK_LOCAL_LAST_INDEX_OFFSET = 1
const CANDIDATE_REGION_HALO = 1

type RegionSpan = {
  readonly maxRegionX: number
  readonly maxRegionZ: number
  readonly minRegionX: number
  readonly minRegionZ: number
}

/** Every candidate-region coordinate whose one-region halo can overlap this chunk. */
const regionSpanForChunk = (coord: { readonly cx: number; readonly cz: number }, grid: NaturalStructureGrid): RegionSpan => {
  const minBlockX = coord.cx * CHUNK_SIZE_XZ
  const minBlockZ = coord.cz * CHUNK_SIZE_XZ
  const maxBlockX = minBlockX + CHUNK_SIZE_XZ - CHUNK_LOCAL_LAST_INDEX_OFFSET
  const maxBlockZ = minBlockZ + CHUNK_SIZE_XZ - CHUNK_LOCAL_LAST_INDEX_OFFSET
  return {
    maxRegionX: floorDiv(maxBlockX, grid.spacing) + CANDIDATE_REGION_HALO,
    maxRegionZ: floorDiv(maxBlockZ, grid.spacing) + CANDIDATE_REGION_HALO,
    minRegionX: floorDiv(minBlockX, grid.spacing) - CANDIDATE_REGION_HALO,
    minRegionZ: floorDiv(minBlockZ, grid.spacing) - CANDIDATE_REGION_HALO,
  }
}

type OverworldWaterStructureKind = 'ocean-monument' | 'ocean-ruin' | 'shipwreck'

type OverworldLandStructureKind = 'jungle-pyramid' | 'mineshaft' | 'pillager-outpost'

const planOverworldWaterKind = (
  seed: number,
  kind: OverworldWaterStructureKind,
  region: NaturalStructureRegion,
  sampleTerrain: OverworldTerrainSampler,
): Option.Option<NaturalStructurePlan> => {
  if (kind === 'ocean-monument') {
    return planOceanMonumentForRegion(seed, region.x, region.z, sampleTerrain)
  }
  if (kind === 'ocean-ruin') {
    return planOceanRuinForRegion(seed, region.x, region.z, sampleTerrain)
  }
  return planShipwreckForRegion(seed, region.x, region.z, sampleTerrain)
}

const planOverworldLandKind = (
  seed: number,
  kind: OverworldLandStructureKind,
  region: NaturalStructureRegion,
  sampleTerrain: OverworldTerrainSampler,
): Option.Option<NaturalStructurePlan> => {
  if (kind === 'mineshaft') {
    return planMineshaftForRegion(seed, region.x, region.z, sampleTerrain)
  }
  if (kind === 'jungle-pyramid') {
    return planJunglePyramidForRegion(seed, region.x, region.z, sampleTerrain)
  }
  return planPillagerOutpostForRegion(seed, region.x, region.z, sampleTerrain)
}

const planOverworldKind = (
  seed: number,
  kind: NaturalStructureKind,
  region: NaturalStructureRegion,
  sampleTerrain: OverworldTerrainSampler,
): Option.Option<NaturalStructurePlan> => {
  if (kind === 'desert-pyramid') {
    return planDesertPyramidForRegion(seed, region.x, region.z, sampleTerrain)
  }
  if (kind === 'igloo') {
    return planIglooForRegion(seed, region.x, region.z, sampleTerrain)
  }
  if (kind === 'jungle-pyramid' || kind === 'mineshaft' || kind === 'pillager-outpost') {
    return planOverworldLandKind(seed, kind, region, sampleTerrain)
  }
  if (kind === 'ocean-monument' || kind === 'ocean-ruin' || kind === 'shipwreck') {
    return planOverworldWaterKind(seed, kind, region, sampleTerrain)
  }
  return planVillageForRegion(seed, region.x, region.z, sampleTerrain)
}

const planOverworldRegion = (
  seed: number,
  kind: NaturalStructureKind,
  region: NaturalStructureRegion,
  sampleTerrain: OverworldTerrainSampler | undefined,
): Option.Option<NaturalStructurePlan> => {
  if (Predicate.isUndefined(sampleTerrain)) {
    return Option.none()
  }
  return planOverworldKind(seed, kind, region, sampleTerrain)
}

const planNetherRegion = (
  seed: number,
  kind: NaturalStructureKind,
  region: NaturalStructureRegion,
  sampleTerrain: NetherStructureTerrainSampler | undefined,
): Option.Option<NaturalStructurePlan> => {
  if (Predicate.isUndefined(sampleTerrain)) {
    return Option.none()
  }
  if (kind === 'bastion-remnant') {
    return planBastionRemnantForRegion(seed, region.x, region.z, sampleTerrain)
  }
  if (kind === 'nether-fortress') {
    return planNetherFortressForRegion(seed, region.x, region.z, sampleTerrain)
  }
  return planRuinedNetherPortalForRegion(seed, region.x, region.z, sampleTerrain)
}

/** Which plan* function, if any, applies to one region in `dimension`. */
const planForRegion = (
  seed: number,
  dimension: Dimension,
  kind: NaturalStructureKind,
  region: NaturalStructureRegion,
  samplers: NaturalStructureSamplers,
): Option.Option<NaturalStructurePlan> => {
  if (dimension === 'overworld') {
    return planOverworldRegion(seed, kind, region, samplers.overworld)
  }
  if (dimension === 'nether') {
    return planNetherRegion(seed, kind, region, samplers.nether)
  }
  return planEndCityForRegion(seed, region.x, region.z, samplers.end)
}

/**
 * Enumerates every candidate region that can overlap a chunk. The one-region
 * halo is wider than every current structure footprint and handles negative
 * coordinates through floor division.
 */
export const naturalStructurePlansForChunk = (
  seed: number,
  dimension: Dimension,
  coord: { readonly cx: number; readonly cz: number },
  samplers: NaturalStructureSamplers = {},
): ReadonlyArray<NaturalStructurePlan> => {
  const plans: Array<NaturalStructurePlan> = []

  for (const kind of naturalStructureKindsFor(dimension)) {
    const grid = NATURAL_STRUCTURE_GRID[kind]
    const { minRegionX, maxRegionX, minRegionZ, maxRegionZ } = regionSpanForChunk(coord, grid)
    for (let regionX = minRegionX; regionX <= maxRegionX; regionX += UNIT_STEP) {
      for (let regionZ = minRegionZ; regionZ <= maxRegionZ; regionZ += UNIT_STEP) {
        const option = planForRegion(seed, dimension, kind, { x: regionX, z: regionZ }, samplers)
        if (Option.isSome(option)) {plans.push(option.value)}
      }
    }
  }
  return Object.freeze(plansInStableOrder(plans))
}

const EMPTY_SLICE_SIZE = 0

type ChunkApplyAccumulator = {
  readonly blocks: Uint8Array
  readonly ids: Array<string>
  readonly markers: Array<AppliedNaturalStructureMarker>
}

/** Writes one plan's slice into `accumulator.blocks` and records its id/markers, unless the slice touches nothing here. */
const applyPlanSlice = (accumulator: ChunkApplyAccumulator, chunk: Chunk, plan: NaturalStructurePlan): void => {
  const slice = naturalStructureSliceForChunk(plan, chunk.coord.cx, chunk.coord.cz)
  if (slice.blocks.length === EMPTY_SLICE_SIZE && slice.markers.length === EMPTY_SLICE_SIZE) {
    return
  }
  accumulator.ids.push(plan.id)
  for (const placement of slice.blocks) {
    setBlockAt(
      accumulator.blocks,
      placement.x - chunk.coord.cx * CHUNK_SIZE_XZ,
      placement.y,
      placement.z - chunk.coord.cz * CHUNK_SIZE_XZ,
      placement.block,
    )
  }
  for (const marker of slice.markers) {
    accumulator.markers.push(Object.freeze({ ...marker, structureId: plan.id, structureKind: plan.kind }))
  }
}

/** Applies cross-chunk plan slices without mutating the terrain chunk or plans. */
export const applyNaturalStructurePlansToChunk = (
  chunk: Chunk,
  plans: ReadonlyArray<NaturalStructurePlan>,
): NaturalStructureChunk => {
  const accumulator: ChunkApplyAccumulator = { blocks: chunk.blocks.slice(), ids: [], markers: [] }
  for (const plan of plansInStableOrder(plans)) {
    applyPlanSlice(accumulator, chunk, plan)
  }
  return {
    ...chunk,
    blocks: accumulator.blocks,
    naturalStructureIds: Object.freeze(accumulator.ids),
    naturalStructureMarkers: Object.freeze(accumulator.markers),
  }
}
