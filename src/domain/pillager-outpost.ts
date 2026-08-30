import type {
  NaturalStructureBlockPlacement,
  NaturalStructureMarker,
  NaturalStructurePosition,
} from './natural-structure.js'
import type { OverworldTerrainSample, OverworldTerrainSampler } from './structure-siting.js'
import { PILLAGER_OUTPOST_BLOCK, PILLAGER_OUTPOST_LAYOUT } from './pillager-outpost-data.js'
import type { BlockId } from '@nerima-games/mc-kernel'
import { CHUNK_HEIGHT } from './constants.js'
import { Option } from 'effect'

type PillagerOutpostCandidate = { readonly x: number; readonly z: number }

export type PillagerOutpostDraft = {
  readonly origin: NaturalStructurePosition
  readonly blocks: ReadonlyArray<NaturalStructureBlockPlacement>
  readonly markers: ReadonlyArray<NaturalStructureMarker>
}

const UNIT_STEP = 1
const MIN_WORLD_Y = 0
const FIRST_FLOOR_INDEX = 0
const PILLAGER_POSITIONS = Object.freeze([
  Object.freeze({ x: -1, z: -1 }),
  Object.freeze({ x: 1, z: -1 }),
  Object.freeze({ x: 1, z: 1 }),
])

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
  candidate: PillagerOutpostCandidate,
  sampleTerrain: OverworldTerrainSampler,
): ReadonlyArray<OverworldTerrainSample> => {
  const probeExtent = PILLAGER_OUTPOST_LAYOUT.baseHalfExtent
  return [
    sampleTerrain(candidate.x, candidate.z),
    sampleTerrain(candidate.x - probeExtent, candidate.z),
    sampleTerrain(candidate.x + probeExtent, candidate.z),
    sampleTerrain(candidate.x, candidate.z - probeExtent),
    sampleTerrain(candidate.x, candidate.z + probeExtent),
  ]
}

const OUTPOST_BIOMES: ReadonlyArray<OverworldTerrainSample['biome']> = [
  'DESERT',
  'PLAINS',
  'SAVANNA',
  'SNOW',
  'TAIGA',
]

const isOutpostBiome = (biome: OverworldTerrainSample['biome']): boolean =>
  OUTPOST_BIOMES.some((candidate) => candidate === biome)

const terrainMatchesOutpost = (probes: ReadonlyArray<OverworldTerrainSample>): boolean =>
  !probes.some((probe) => !isOutpostBiome(probe.biome) || probe.surfaceY <= probe.seaLevel + PILLAGER_OUTPOST_LAYOUT.minDryClearance)

const baseYForTerrainProbes = (
  probes: ReadonlyArray<OverworldTerrainSample>,
): Option.Option<number> => {
  const surfaces = probes.map((probe) => probe.surfaceY)
  const maximumSurfaceY = Math.max(...surfaces)
  const minimumSurfaceY = Math.min(...surfaces)
  if (maximumSurfaceY - minimumSurfaceY > PILLAGER_OUTPOST_LAYOUT.maxSurfaceVariation) {
    return Option.none()
  }

  const baseY = maximumSurfaceY + PILLAGER_OUTPOST_LAYOUT.towerBaseYOffset
  const roofY = baseY + PILLAGER_OUTPOST_LAYOUT.towerBaseYOffset + PILLAGER_OUTPOST_LAYOUT.floorCount * PILLAGER_OUTPOST_LAYOUT.floorSpacing
  if (baseY < MIN_WORLD_Y || roofY >= CHUNK_HEIGHT) {
    return Option.none()
  }
  return Option.some(baseY)
}

const terrainFits = (
  candidate: PillagerOutpostCandidate,
  sampleTerrain: OverworldTerrainSampler,
): Option.Option<number> => {
  const probes = terrainProbesFor(candidate, sampleTerrain)
  if (!terrainMatchesOutpost(probes)) {
    return Option.none()
  }
  return baseYForTerrainProbes(probes)
}

const isBoundary = (offsetX: number, offsetZ: number, halfExtent: number): boolean =>
  Math.abs(offsetX) === halfExtent || Math.abs(offsetZ) === halfExtent

const isCorner = (offsetX: number, offsetZ: number, halfExtent: number): boolean =>
  Math.abs(offsetX) === halfExtent && Math.abs(offsetZ) === halfExtent

const floorYFor = (baseY: number, floor: number): number =>
  baseY + PILLAGER_OUTPOST_LAYOUT.towerBaseYOffset + floor * PILLAGER_OUTPOST_LAYOUT.floorSpacing

const roofYFor = (baseY: number): number => floorYFor(baseY, PILLAGER_OUTPOST_LAYOUT.floorCount)

const baseBlockFor = (offsetX: number, offsetZ: number): BlockId => {
  if (isBoundary(offsetX, offsetZ, PILLAGER_OUTPOST_LAYOUT.baseHalfExtent)) {
    return PILLAGER_OUTPOST_BLOCK.COBBLESTONE
  }
  return PILLAGER_OUTPOST_BLOCK.OAK_PLANKS
}

const wallBlockFor = (offsetX: number, offsetZ: number): BlockId => {
  if (isCorner(offsetX, offsetZ, PILLAGER_OUTPOST_LAYOUT.towerHalfExtent)) {
    return PILLAGER_OUTPOST_BLOCK.OAK_LOG
  }
  return PILLAGER_OUTPOST_BLOCK.OAK_PLANKS
}

const roofBlockFor = (offsetX: number, offsetZ: number, halfExtent: number): BlockId => {
  if (isBoundary(offsetX, offsetZ, halfExtent)) {
    return PILLAGER_OUTPOST_BLOCK.OAK_STAIRS
  }
  return PILLAGER_OUTPOST_BLOCK.OAK_PLANKS
}

const addBasePlatform = (
  blocks: Map<string, NaturalStructureBlockPlacement>,
  candidate: PillagerOutpostCandidate,
  baseY: number,
): void => {
  for (let offsetX = -PILLAGER_OUTPOST_LAYOUT.baseHalfExtent; offsetX <= PILLAGER_OUTPOST_LAYOUT.baseHalfExtent; offsetX += UNIT_STEP) {
    for (let offsetZ = -PILLAGER_OUTPOST_LAYOUT.baseHalfExtent; offsetZ <= PILLAGER_OUTPOST_LAYOUT.baseHalfExtent; offsetZ += UNIT_STEP) {
      addBlock(
        blocks,
        baseBlockFor(offsetX, offsetZ),
        candidate.x + offsetX,
        baseY,
        candidate.z + offsetZ,
      )
    }
  }
}

const addFloor = (
  blocks: Map<string, NaturalStructureBlockPlacement>,
  candidate: PillagerOutpostCandidate,
  floorY: number,
): void => {
  for (let offsetX = -PILLAGER_OUTPOST_LAYOUT.towerHalfExtent; offsetX <= PILLAGER_OUTPOST_LAYOUT.towerHalfExtent; offsetX += UNIT_STEP) {
    for (let offsetZ = -PILLAGER_OUTPOST_LAYOUT.towerHalfExtent; offsetZ <= PILLAGER_OUTPOST_LAYOUT.towerHalfExtent; offsetZ += UNIT_STEP) {
      addBlock(blocks, PILLAGER_OUTPOST_BLOCK.OAK_PLANKS, candidate.x + offsetX, floorY, candidate.z + offsetZ)
    }
  }
}

const addWallLayer = (
  blocks: Map<string, NaturalStructureBlockPlacement>,
  candidate: PillagerOutpostCandidate,
  y: number,
): void => {
  for (let offsetX = -PILLAGER_OUTPOST_LAYOUT.towerHalfExtent; offsetX <= PILLAGER_OUTPOST_LAYOUT.towerHalfExtent; offsetX += UNIT_STEP) {
    for (let offsetZ = -PILLAGER_OUTPOST_LAYOUT.towerHalfExtent; offsetZ <= PILLAGER_OUTPOST_LAYOUT.towerHalfExtent; offsetZ += UNIT_STEP) {
      if (isBoundary(offsetX, offsetZ, PILLAGER_OUTPOST_LAYOUT.towerHalfExtent)) {
        addBlock(
          blocks,
          wallBlockFor(offsetX, offsetZ),
          candidate.x + offsetX,
          y,
          candidate.z + offsetZ,
        )
      }
    }
  }
}

const addTower = (
  blocks: Map<string, NaturalStructureBlockPlacement>,
  candidate: PillagerOutpostCandidate,
  baseY: number,
): void => {
  for (let floor = 0; floor < PILLAGER_OUTPOST_LAYOUT.floorCount; floor += UNIT_STEP) {
    const floorY = floorYFor(baseY, floor)
    const nextFloorY = floorYFor(baseY, floor + UNIT_STEP)
    addFloor(blocks, candidate, floorY)
    for (let y = floorY + UNIT_STEP; y < nextFloorY; y += UNIT_STEP) {
      addWallLayer(blocks, candidate, y)
    }
  }
}

const addRoof = (
  blocks: Map<string, NaturalStructureBlockPlacement>,
  candidate: PillagerOutpostCandidate,
  baseY: number,
): void => {
  const roofY = roofYFor(baseY)
  const halfExtent = PILLAGER_OUTPOST_LAYOUT.towerHalfExtent + PILLAGER_OUTPOST_LAYOUT.roofOverhang
  for (let offsetX = -halfExtent; offsetX <= halfExtent; offsetX += UNIT_STEP) {
    for (let offsetZ = -halfExtent; offsetZ <= halfExtent; offsetZ += UNIT_STEP) {
      addBlock(
        blocks,
        roofBlockFor(offsetX, offsetZ, halfExtent),
        candidate.x + offsetX,
        roofY,
        candidate.z + offsetZ,
      )
    }
  }
}

const addMarkersAndDetails = (
  blocks: Map<string, NaturalStructureBlockPlacement>,
  markers: Array<NaturalStructureMarker>,
  candidate: PillagerOutpostCandidate,
  baseY: number,
): void => {
  const firstFloorY = floorYFor(baseY, FIRST_FLOOR_INDEX)
  const chestY = firstFloorY + UNIT_STEP
  addBlock(blocks, PILLAGER_OUTPOST_BLOCK.CHEST, candidate.x, chestY, candidate.z + UNIT_STEP)
  addMarker(markers, { kind: 'loot-chest', lootTable: 'pillager-outpost', x: candidate.x, y: chestY, z: candidate.z + UNIT_STEP })

  for (const position of PILLAGER_POSITIONS) {
    addMarker(markers, {
      entity: 'pillager',
      kind: 'entity-spawn',
      x: candidate.x + position.x,
      y: chestY,
      z: candidate.z + position.z,
    })
  }

  const torchY = roofYFor(baseY) - UNIT_STEP
  addBlock(blocks, PILLAGER_OUTPOST_BLOCK.TORCH, candidate.x - UNIT_STEP, torchY, candidate.z)
  addBlock(blocks, PILLAGER_OUTPOST_BLOCK.TORCH, candidate.x + UNIT_STEP, torchY, candidate.z)
}

type PillagerOutpostPlanBuffers = {
  readonly blocks: Map<string, NaturalStructureBlockPlacement>
  readonly markers: Array<NaturalStructureMarker>
}

const buildPillagerOutpostPlan = (
  candidate: PillagerOutpostCandidate,
  baseY: number,
): PillagerOutpostPlanBuffers => {
  const blocks = new Map<string, NaturalStructureBlockPlacement>()
  const markers: Array<NaturalStructureMarker> = []
  addBasePlatform(blocks, candidate, baseY)
  addTower(blocks, candidate, baseY)
  addRoof(blocks, candidate, baseY)
  addMarkersAndDetails(blocks, markers, candidate, baseY)
  return { blocks, markers }
}

/** Plans a deterministic compact outpost using only blocks registered by mc-kernel. */
export const planPillagerOutpostForCandidate = (
  candidate: PillagerOutpostCandidate,
  sampleTerrain: OverworldTerrainSampler,
): Option.Option<PillagerOutpostDraft> => {
  const baseYOption = terrainFits(candidate, sampleTerrain)
  if (Option.isNone(baseYOption)) {
    return Option.none()
  }
  const { blocks, markers } = buildPillagerOutpostPlan(candidate, baseYOption.value)
  return Option.some(Object.freeze({
    blocks: Object.freeze([...blocks.values()]),
    markers: Object.freeze(markers),
    origin: Object.freeze({ x: candidate.x, y: baseYOption.value, z: candidate.z }),
  }))
}
