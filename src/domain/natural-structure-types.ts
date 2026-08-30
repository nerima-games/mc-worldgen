import type { BlockId } from '@nerima-games/mc-kernel'
import type { Chunk } from './chunk.js'
import type { CompactStructureKind } from './compact-structure-data.js'
import type { Dimension } from './nether-travel.js'
import type { OverworldTerrainSampler } from './structure-siting.js'

export type NaturalStructureKind = CompactStructureKind | 'desert-pyramid' | 'desert-well' | 'igloo' | 'jungle-pyramid' | 'mineshaft' | 'ocean-monument' | 'ocean-ruin' | 'pillager-outpost' | 'shipwreck' | 'stronghold' | 'village' | 'ruined-nether-portal' | 'nether-fortress' | 'bastion-remnant' | 'end-city'

type NaturalStructureLootTable = Exclude<NaturalStructureKind, 'desert-well'> | 'end-ship'

export type NaturalStructureGrid = {
  /** Distance between candidate-region origins, in blocks. */
  readonly spacing: number
  /** Guaranteed minimum distance between candidates in adjacent regions, in blocks. */
  readonly separation: number
  /** Fraction of regions that reach terrain validation, in permille. */
  readonly spawnPermille: number
}

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
  | { readonly kind: 'loot-chest'; readonly lootTable: NaturalStructureLootTable }
  | { readonly kind: 'entity-spawn'; readonly entity: 'villager'; readonly profession: 'farmer' | 'toolsmith' }
  | { readonly kind: 'entity-spawn'; readonly entity: 'zombie-villager' }
  | { readonly kind: 'entity-spawn'; readonly entity: 'pillager' }
  | { readonly kind: 'entity-spawn'; readonly entity: 'blaze' | 'wither-skeleton' }
  | { readonly kind: 'entity-spawn'; readonly entity: 'piglin' | 'piglin-brute' }
  | { readonly kind: 'spawner'; readonly entity: 'shulker' | 'blaze' }
  | { readonly kind: 'portal-frame'; readonly axis: 'x' | 'z'; readonly complete: false }
  | { readonly kind: 'end-portal-frame'; readonly facing: 'north' | 'east' | 'south' | 'west'; readonly eye: boolean }
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
