import { blockAxis } from './coordinate-compatibility.js'
import { IGLOO_BLOCK, IGLOO_LAYOUT } from './igloo-data.js'
import type {
  NaturalStructureBlockPlacementDraft,
  NaturalStructureMarkerDraft,
  NaturalStructurePositionDraft,
} from './natural-structure-types.js'
import type { OverworldTerrainSample, OverworldTerrainSampler } from './structure-siting.js'
import type { BlockId } from '@nerima-games/mc-kernel'
import { CHUNK_HEIGHT } from './constants.js'
import { Option } from 'effect'

type IglooCandidate = { readonly x: number; readonly z: number }

export type IglooDraft = {
  readonly origin: NaturalStructurePositionDraft
  readonly blocks: ReadonlyArray<NaturalStructureBlockPlacementDraft>
  readonly markers: ReadonlyArray<NaturalStructureMarkerDraft>
}

const UNIT_STEP = 1
const BASEMENT_FLOOR_OFFSET = IGLOO_LAYOUT.basementDepth
const DOME_FIRST_LEVEL = 0
const MIN_WORLD_Y = 0

const keyOf = (x: number, y: number, z: number): string => `${String(x)},${String(y)},${String(z)}`

const addBlock = (
  blocks: Map<string, NaturalStructureBlockPlacementDraft>,
  block: BlockId,
  x: number,
  y: number,
  z: number,
): void => {
  blocks.set(keyOf(x, y, z), Object.freeze({ block, x, y, z }))
}

const addMarker = (markers: Array<NaturalStructureMarkerDraft>, marker: NaturalStructureMarkerDraft): void => {
  markers.push(Object.freeze(marker))
}

const terrainProbesFor = (
  candidate: IglooCandidate,
  sampleTerrain: OverworldTerrainSampler,
): ReadonlyArray<OverworldTerrainSample> => {
  const probeExtent = IGLOO_LAYOUT.domeHalfExtent
  return [
    sampleTerrain(blockAxis(candidate.x), blockAxis(candidate.z)),
    sampleTerrain(blockAxis(candidate.x - probeExtent), blockAxis(candidate.z)),
    sampleTerrain(blockAxis(candidate.x + probeExtent), blockAxis(candidate.z)),
    sampleTerrain(blockAxis(candidate.x), blockAxis(candidate.z - probeExtent)),
    sampleTerrain(blockAxis(candidate.x), blockAxis(candidate.z + probeExtent)),
  ]
}

const probesAreSuitable = (probes: ReadonlyArray<OverworldTerrainSample>): boolean =>
  !probes.some((probe) => probe.biome !== 'SNOW' || probe.surfaceY <= probe.seaLevel + IGLOO_LAYOUT.minDryClearance)

const surfaceBoundsFor = (probes: ReadonlyArray<OverworldTerrainSample>): { readonly minimum: number; readonly maximum: number } => {
  const surfaces = probes.map((probe) => probe.surfaceY)
  return Object.freeze({ maximum: Math.max(...surfaces), minimum: Math.min(...surfaces) })
}

const baseYForProbes = (probes: ReadonlyArray<OverworldTerrainSample>): Option.Option<number> => {
  const { minimum: minimumSurfaceY, maximum: maximumSurfaceY } = surfaceBoundsFor(probes)
  if (maximumSurfaceY - minimumSurfaceY > IGLOO_LAYOUT.maxSurfaceVariation) {return Option.none()}

  const baseY = maximumSurfaceY + UNIT_STEP
  const basementFloorY = baseY - BASEMENT_FLOOR_OFFSET
  const domeTopY = baseY + IGLOO_LAYOUT.domeLevelCount - UNIT_STEP
  if (basementFloorY < MIN_WORLD_Y || domeTopY >= CHUNK_HEIGHT) {
    return Option.none()
  }
  return Option.some(baseY)
}

const terrainFits = (
  candidate: IglooCandidate,
  sampleTerrain: OverworldTerrainSampler,
): Option.Option<number> => {
  const probes = terrainProbesFor(candidate, sampleTerrain)
  if (!probesAreSuitable(probes)) {
    return Option.none()
  }
  return baseYForProbes(probes)
}

const isBoundary = (x: number, z: number, halfExtent: number): boolean =>
  Math.abs(x) === halfExtent || Math.abs(z) === halfExtent

const domeHalfExtentForLevel = (level: number): number =>
  Math.max(UNIT_STEP, IGLOO_LAYOUT.domeHalfExtent - Math.floor(level / IGLOO_LAYOUT.domeLevelRadiusStep))

const addDomeLevel = (
  blocks: Map<string, NaturalStructureBlockPlacementDraft>,
  candidate: IglooCandidate,
  baseY: number,
  level: number,
): void => {
  const halfExtent = domeHalfExtentForLevel(level)
  const y = baseY + level
  for (let dx = -halfExtent; dx <= halfExtent; dx += UNIT_STEP) {
    for (let dz = -halfExtent; dz <= halfExtent; dz += UNIT_STEP) {
      if (level === DOME_FIRST_LEVEL || isBoundary(dx, dz, halfExtent)) {
        addBlock(blocks, IGLOO_BLOCK.SNOW, candidate.x + dx, y, candidate.z + dz)
      }
    }
  }
}

const addDome = (
  blocks: Map<string, NaturalStructureBlockPlacementDraft>,
  candidate: IglooCandidate,
  baseY: number,
): void => {
  for (let level = DOME_FIRST_LEVEL; level < IGLOO_LAYOUT.domeLevelCount; level += UNIT_STEP) {
    addDomeLevel(blocks, candidate, baseY, level)
  }
}

const basementBlockAt = (y: number, floorY: number, dx: number, dz: number): BlockId => {
  if (y === floorY || isBoundary(dx, dz, IGLOO_LAYOUT.basementHalfExtent)) {
    return IGLOO_BLOCK.COBBLESTONE
  }
  return IGLOO_BLOCK.AIR
}

const addBasementShell = (
  blocks: Map<string, NaturalStructureBlockPlacementDraft>,
  candidate: IglooCandidate,
  baseY: number,
): void => {
  const floorY = baseY - BASEMENT_FLOOR_OFFSET
  for (let y = floorY; y < baseY; y += UNIT_STEP) {
    for (let dx = -IGLOO_LAYOUT.basementHalfExtent; dx <= IGLOO_LAYOUT.basementHalfExtent; dx += UNIT_STEP) {
      for (let dz = -IGLOO_LAYOUT.basementHalfExtent; dz <= IGLOO_LAYOUT.basementHalfExtent; dz += UNIT_STEP) {
        addBlock(blocks, basementBlockAt(y, floorY, dx, dz), candidate.x + dx, y, candidate.z + dz)
      }
    }
  }
}

const addBasementFloor = (
  blocks: Map<string, NaturalStructureBlockPlacementDraft>,
  candidate: IglooCandidate,
  baseY: number,
): void => {
  const floorY = baseY - BASEMENT_FLOOR_OFFSET
  for (let dx = -IGLOO_LAYOUT.basementHalfExtent + UNIT_STEP; dx < IGLOO_LAYOUT.basementHalfExtent; dx += UNIT_STEP) {
    for (let dz = -IGLOO_LAYOUT.basementHalfExtent + UNIT_STEP; dz < IGLOO_LAYOUT.basementHalfExtent; dz += UNIT_STEP) {
      addBlock(blocks, IGLOO_BLOCK.OAK_PLANKS, candidate.x + dx, floorY + UNIT_STEP, candidate.z + dz)
    }
  }
}

const addBasement = (
  blocks: Map<string, NaturalStructureBlockPlacementDraft>,
  candidate: IglooCandidate,
  baseY: number,
): void => {
  addBasementShell(blocks, candidate, baseY)
  addBasementFloor(blocks, candidate, baseY)
}

const addShaftLadder = (
  blocks: Map<string, NaturalStructureBlockPlacementDraft>,
  candidate: IglooCandidate,
  baseY: number,
): void => {
  const floorY = baseY - BASEMENT_FLOOR_OFFSET
  const shaftZ = candidate.z + IGLOO_LAYOUT.basementHalfExtent
  for (let y = floorY + UNIT_STEP; y <= baseY + IGLOO_LAYOUT.shaftTopOffset; y += UNIT_STEP) {
    addBlock(blocks, IGLOO_BLOCK.AIR, candidate.x, y, shaftZ)
    if (y < baseY) {
      addBlock(blocks, IGLOO_BLOCK.LADDER, candidate.x, y, shaftZ)
    }
  }
}

const addShaftDoor = (
  blocks: Map<string, NaturalStructureBlockPlacementDraft>,
  candidate: IglooCandidate,
  baseY: number,
): void => {
  for (let y = baseY; y < baseY + IGLOO_LAYOUT.doorHeight; y += UNIT_STEP) {
    addBlock(blocks, IGLOO_BLOCK.AIR, candidate.x, y, candidate.z + IGLOO_LAYOUT.doorOffsetZ)
  }
}

const addShaft = (
  blocks: Map<string, NaturalStructureBlockPlacementDraft>,
  candidate: IglooCandidate,
  baseY: number,
): void => {
  addShaftLadder(blocks, candidate, baseY)
  addShaftDoor(blocks, candidate, baseY)
}

type InteriorOffset = { readonly x: number; readonly z: number }

const addOffsetBlock = (
  blocks: Map<string, NaturalStructureBlockPlacementDraft>,
  block: BlockId,
  candidate: IglooCandidate,
  y: number,
  offset: InteriorOffset,
): void => {
  addBlock(blocks, block, candidate.x + offset.x, y, candidate.z + offset.z)
}

const interiorYFor = (baseY: number): number => baseY - BASEMENT_FLOOR_OFFSET + UNIT_STEP

const addInteriorChest = (
  blocks: Map<string, NaturalStructureBlockPlacementDraft>,
  markers: Array<NaturalStructureMarkerDraft>,
  candidate: IglooCandidate,
  baseY: number,
): void => {
  const interiorY = interiorYFor(baseY)
  const { chest } = IGLOO_LAYOUT.interior
  const chestX = candidate.x + chest.x
  const chestZ = candidate.z + chest.z
  addBlock(blocks, IGLOO_BLOCK.CHEST, chestX, interiorY, chestZ)
  addMarker(markers, { kind: 'loot-chest', lootTable: 'igloo', x: chestX, y: interiorY, z: chestZ })
}

const addInteriorFurniture = (
  blocks: Map<string, NaturalStructureBlockPlacementDraft>,
  candidate: IglooCandidate,
  baseY: number,
): void => {
  const interiorY = interiorYFor(baseY)
  addOffsetBlock(blocks, IGLOO_BLOCK.BED, candidate, interiorY, IGLOO_LAYOUT.interior.bed)
  addOffsetBlock(blocks, IGLOO_BLOCK.FURNACE, candidate, interiorY, IGLOO_LAYOUT.interior.furnace)
  addOffsetBlock(blocks, IGLOO_BLOCK.CRAFTING_TABLE, candidate, interiorY, IGLOO_LAYOUT.interior.craftingTable)
  addOffsetBlock(blocks, IGLOO_BLOCK.CAULDRON, candidate, interiorY, IGLOO_LAYOUT.interior.cauldron)
}

const addInteriorSpawns = (
  markers: Array<NaturalStructureMarkerDraft>,
  candidate: IglooCandidate,
  baseY: number,
): void => {
  const spawnY = interiorYFor(baseY) + IGLOO_LAYOUT.entityHeightOffset
  const { villager, zombieVillager } = IGLOO_LAYOUT.interior

  addMarker(markers, {
    entity: 'villager',
    kind: 'entity-spawn',
    profession: 'farmer',
    x: candidate.x + villager.x,
    y: spawnY,
    z: candidate.z + villager.z,
  })
  addMarker(markers, {
    entity: 'zombie-villager',
    kind: 'entity-spawn',
    x: candidate.x + zombieVillager.x,
    y: spawnY,
    z: candidate.z + zombieVillager.z,
  })
}

const addInterior = (
  blocks: Map<string, NaturalStructureBlockPlacementDraft>,
  markers: Array<NaturalStructureMarkerDraft>,
  candidate: IglooCandidate,
  baseY: number,
): void => {
  addInteriorChest(blocks, markers, candidate, baseY)
  addInteriorFurniture(blocks, candidate, baseY)
  addInteriorSpawns(markers, candidate, baseY)
}

/** Plans the registry-backed snow-dome and basement geometry on a dry, level snow site. */
export const planIglooForCandidate = (
  candidate: IglooCandidate,
  sampleTerrain: OverworldTerrainSampler,
): Option.Option<IglooDraft> => {
  const baseYOption = terrainFits(candidate, sampleTerrain)
  if (Option.isNone(baseYOption)) {
    return Option.none()
  }

  const blocks = new Map<string, NaturalStructureBlockPlacementDraft>()
  const markers: Array<NaturalStructureMarkerDraft> = []
  addBasement(blocks, candidate, baseYOption.value)
  addDome(blocks, candidate, baseYOption.value)
  addShaft(blocks, candidate, baseYOption.value)
  addInterior(blocks, markers, candidate, baseYOption.value)
  return Option.some(Object.freeze({
    blocks: Object.freeze([...blocks.values()]),
    markers: Object.freeze(markers),
    origin: Object.freeze({ x: candidate.x, y: baseYOption.value, z: candidate.z }),
  }))
}
