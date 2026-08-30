import type {
  NaturalStructureBlockPlacement,
  NaturalStructureMarker,
  NaturalStructurePosition,
} from './natural-structure'
import { OCEAN_MONUMENT_BLOCK, OCEAN_MONUMENT_LAYOUT } from './ocean-monument-data'
import type { OverworldTerrainSample, OverworldTerrainSampler } from './structure-siting'
import type { BlockId } from '@nerima-games/mc-kernel'
import { CHUNK_HEIGHT } from './constants'
import { Option } from 'effect'

type OceanMonumentCandidate = { readonly x: number; readonly z: number }

export type OceanMonumentDraft = {
  readonly origin: NaturalStructurePosition
  readonly blocks: ReadonlyArray<NaturalStructureBlockPlacement>
  readonly markers: ReadonlyArray<NaturalStructureMarker>
}

const UNIT_STEP = 1
const FIRST_STRUCTURE_LAYER = 1
const MIN_WORLD_Y = 0

const keyOf = (x: number, y: number, z: number): string => `${String(x)},${String(y)},${String(z)}`

const addBlock = (
  blocks: Map<string, NaturalStructureBlockPlacement>,
  block: BlockId,
  x: number,
  y: number,
  z: number,
): void => {
  blocks.set(keyOf(x, y, z), Object.freeze({ block, x, y, z }))
}

const addMarker = (markers: Array<NaturalStructureMarker>, marker: NaturalStructureMarker): void => {
  markers.push(Object.freeze(marker))
}

const terrainProbesFor = (
  candidate: OceanMonumentCandidate,
  sampleTerrain: OverworldTerrainSampler,
): ReadonlyArray<OverworldTerrainSample> => {
  const probeExtent = OCEAN_MONUMENT_LAYOUT.halfExtent
  return [
    sampleTerrain(candidate.x, candidate.z),
    sampleTerrain(candidate.x - probeExtent, candidate.z),
    sampleTerrain(candidate.x + probeExtent, candidate.z),
    sampleTerrain(candidate.x, candidate.z - probeExtent),
    sampleTerrain(candidate.x, candidate.z + probeExtent),
  ]
}

const probesAreSuitable = (probes: ReadonlyArray<OverworldTerrainSample>): boolean =>
  !probes.some((probe) => probe.biome !== 'OCEAN' || probe.surfaceY > probe.seaLevel - OCEAN_MONUMENT_LAYOUT.minWaterDepth)

const surfaceBoundsFor = (probes: ReadonlyArray<OverworldTerrainSample>): { readonly minimum: number; readonly maximum: number } => {
  const surfaces = probes.map((probe) => probe.surfaceY)
  return Object.freeze({ maximum: Math.max(...surfaces), minimum: Math.min(...surfaces) })
}

const structureYFits = (baseY: number, probes: ReadonlyArray<OverworldTerrainSample>): boolean => {
  const topY = baseY + OCEAN_MONUMENT_LAYOUT.centralTowerHeight
  if (baseY < MIN_WORLD_Y) {return false}
  if (topY >= CHUNK_HEIGHT) {return false}
  const minimumSeaLevel = Math.min(...probes.map((probe) => probe.seaLevel))
  return topY < minimumSeaLevel
}

const terrainFits = (
  candidate: OceanMonumentCandidate,
  sampleTerrain: OverworldTerrainSampler,
): Option.Option<number> => {
  const probes = terrainProbesFor(candidate, sampleTerrain)
  if (!probesAreSuitable(probes)) {return Option.none()}
  const { minimum: minimumSurfaceY, maximum: maximumSurfaceY } = surfaceBoundsFor(probes)
  if (maximumSurfaceY - minimumSurfaceY > OCEAN_MONUMENT_LAYOUT.maxSurfaceVariation) {return Option.none()}
  const baseY = maximumSurfaceY + UNIT_STEP
  if (!structureYFits(baseY, probes)) {return Option.none()}
  return Option.some(baseY)
}

const isBoundary = (x: number, z: number, halfExtent: number): boolean =>
  Math.abs(x) === halfExtent || Math.abs(z) === halfExtent

const foundationBlockAt = (dx: number, dz: number): BlockId => {
  if (isBoundary(dx, dz, OCEAN_MONUMENT_LAYOUT.halfExtent)) {
    return OCEAN_MONUMENT_BLOCK.PRISMARINE
  }
  return OCEAN_MONUMENT_BLOCK.STONE
}

const addFoundation = (
  blocks: Map<string, NaturalStructureBlockPlacement>,
  candidate: OceanMonumentCandidate,
  baseY: number,
): void => {
  for (let dx = -OCEAN_MONUMENT_LAYOUT.halfExtent; dx <= OCEAN_MONUMENT_LAYOUT.halfExtent; dx += UNIT_STEP) {
    for (let dz = -OCEAN_MONUMENT_LAYOUT.halfExtent; dz <= OCEAN_MONUMENT_LAYOUT.halfExtent; dz += UNIT_STEP) {
      addBlock(blocks, foundationBlockAt(dx, dz), candidate.x + dx, baseY, candidate.z + dz)
    }
  }
}

const addInteriorWater = (
  blocks: Map<string, NaturalStructureBlockPlacement>,
  candidate: OceanMonumentCandidate,
  baseY: number,
): void => {
  const interiorHalfExtent = OCEAN_MONUMENT_LAYOUT.halfExtent - UNIT_STEP
  for (let y = baseY + FIRST_STRUCTURE_LAYER; y <= baseY + OCEAN_MONUMENT_LAYOUT.interiorWaterHeight; y += UNIT_STEP) {
    for (let dx = -interiorHalfExtent; dx <= interiorHalfExtent; dx += UNIT_STEP) {
      for (let dz = -interiorHalfExtent; dz <= interiorHalfExtent; dz += UNIT_STEP) {
        addBlock(blocks, OCEAN_MONUMENT_BLOCK.WATER, candidate.x + dx, y, candidate.z + dz)
      }
    }
  }
}

const addOuterWalls = (
  blocks: Map<string, NaturalStructureBlockPlacement>,
  candidate: OceanMonumentCandidate,
  baseY: number,
): void => {
  for (let y = baseY + FIRST_STRUCTURE_LAYER; y <= baseY + OCEAN_MONUMENT_LAYOUT.outerWallHeight; y += UNIT_STEP) {
    for (let dx = -OCEAN_MONUMENT_LAYOUT.halfExtent; dx <= OCEAN_MONUMENT_LAYOUT.halfExtent; dx += UNIT_STEP) {
      for (let dz = -OCEAN_MONUMENT_LAYOUT.halfExtent; dz <= OCEAN_MONUMENT_LAYOUT.halfExtent; dz += UNIT_STEP) {
        if (isBoundary(dx, dz, OCEAN_MONUMENT_LAYOUT.halfExtent)) {
          addBlock(blocks, OCEAN_MONUMENT_BLOCK.PRISMARINE, candidate.x + dx, y, candidate.z + dz)
        }
      }
    }
  }
}

const addCentralTower = (
  blocks: Map<string, NaturalStructureBlockPlacement>,
  candidate: OceanMonumentCandidate,
  baseY: number,
): void => {
  const halfExtent = OCEAN_MONUMENT_LAYOUT.centralTowerHalfExtent
  for (let y = baseY + FIRST_STRUCTURE_LAYER; y <= baseY + OCEAN_MONUMENT_LAYOUT.centralTowerHeight; y += UNIT_STEP) {
    const solidLayer = y === baseY + FIRST_STRUCTURE_LAYER || y === baseY + OCEAN_MONUMENT_LAYOUT.centralTowerHeight
    for (let dx = -halfExtent; dx <= halfExtent; dx += UNIT_STEP) {
      for (let dz = -halfExtent; dz <= halfExtent; dz += UNIT_STEP) {
        if (solidLayer || isBoundary(dx, dz, halfExtent)) {
          addBlock(blocks, OCEAN_MONUMENT_BLOCK.PRISMARINE, candidate.x + dx, y, candidate.z + dz)
        }
      }
    }
  }
}

const addLoot = (
  blocks: Map<string, NaturalStructureBlockPlacement>,
  markers: Array<NaturalStructureMarker>,
  candidate: OceanMonumentCandidate,
  baseY: number,
): void => {
  const chestY = baseY + OCEAN_MONUMENT_LAYOUT.chestYOffset
  addBlock(blocks, OCEAN_MONUMENT_BLOCK.CHEST, candidate.x, chestY, candidate.z)
  addMarker(markers, { kind: 'loot-chest', lootTable: 'ocean-monument', x: candidate.x, y: chestY, z: candidate.z })
}

const buildOceanMonumentDraft = (candidate: OceanMonumentCandidate, baseY: number): OceanMonumentDraft => {
  const blocks = new Map<string, NaturalStructureBlockPlacement>()
  const markers: Array<NaturalStructureMarker> = []
  addFoundation(blocks, candidate, baseY)
  addInteriorWater(blocks, candidate, baseY)
  addOuterWalls(blocks, candidate, baseY)
  addCentralTower(blocks, candidate, baseY)
  addLoot(blocks, markers, candidate, baseY)
  return Object.freeze({
    blocks: Object.freeze([...blocks.values()]),
    markers: Object.freeze(markers),
    origin: Object.freeze({ x: candidate.x, y: baseY, z: candidate.z }),
  })
}

/** Plans a compact registry-backed submerged ocean monument. */
export const planOceanMonumentForCandidate = (
  candidate: OceanMonumentCandidate,
  sampleTerrain: OverworldTerrainSampler,
): Option.Option<OceanMonumentDraft> => {
  const baseYOption = terrainFits(candidate, sampleTerrain)
  if (Option.isNone(baseYOption)) {return Option.none()}
  return Option.some(buildOceanMonumentDraft(candidate, baseYOption.value))
}
