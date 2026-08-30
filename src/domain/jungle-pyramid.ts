import { JUNGLE_PYRAMID_BLOCK, JUNGLE_PYRAMID_LAYOUT } from './jungle-pyramid-data.js'
import type {
  NaturalStructureBlockPlacement,
  NaturalStructureMarker,
  NaturalStructurePosition,
} from './natural-structure.js'
import type { OverworldTerrainSample, OverworldTerrainSampler } from './structure-siting.js'
import type { BlockId } from '@nerima-games/mc-kernel'
import { CHUNK_HEIGHT } from './constants.js'
import { Option } from 'effect'

type JunglePyramidCandidate = { readonly x: number; readonly z: number }

export type JunglePyramidDraft = {
  readonly origin: NaturalStructurePosition
  readonly blocks: ReadonlyArray<NaturalStructureBlockPlacement>
  readonly markers: ReadonlyArray<NaturalStructureMarker>
}

const UNIT_STEP = 1
const MIN_WORLD_Y = 0
const FIRST_WALL_Y_OFFSET = 1
const FIRST_WALL_LAYER = 0
const ENTRANCE_X_OFFSET = 0
const TORCH_X_OFFSET = 2
const PYRAMID_GROUND_PROBE_OFFSET = JUNGLE_PYRAMID_LAYOUT.baseHalfExtent

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
  candidate: JunglePyramidCandidate,
  sampleTerrain: OverworldTerrainSampler,
): ReadonlyArray<OverworldTerrainSample> => [
    sampleTerrain(candidate.x, candidate.z),
    sampleTerrain(candidate.x - PYRAMID_GROUND_PROBE_OFFSET, candidate.z),
    sampleTerrain(candidate.x + PYRAMID_GROUND_PROBE_OFFSET, candidate.z),
    sampleTerrain(candidate.x, candidate.z - PYRAMID_GROUND_PROBE_OFFSET),
    sampleTerrain(candidate.x, candidate.z + PYRAMID_GROUND_PROBE_OFFSET),
  ]

const terrainIsSuitable = (probes: ReadonlyArray<OverworldTerrainSample>): boolean =>
  probes.every((probe) => probe.biome === 'JUNGLE' && probe.surfaceY > probe.seaLevel + JUNGLE_PYRAMID_LAYOUT.minDryClearance)

const structureYFits = (baseY: number): boolean => {
  const chamberFloorY = baseY - JUNGLE_PYRAMID_LAYOUT.chamberFloorYOffset
  const roofY = baseY + FIRST_WALL_Y_OFFSET + JUNGLE_PYRAMID_LAYOUT.templeWallHeight
  return baseY >= MIN_WORLD_Y && chamberFloorY >= MIN_WORLD_Y && roofY < CHUNK_HEIGHT
}

const baseYForProbes = (probes: ReadonlyArray<OverworldTerrainSample>): Option.Option<number> => {
  const surfaces = probes.map((probe) => probe.surfaceY)
  const minimumSurfaceY = Math.min(...surfaces)
  const maximumSurfaceY = Math.max(...surfaces)
  if (maximumSurfaceY - minimumSurfaceY > JUNGLE_PYRAMID_LAYOUT.maxSurfaceVariation) {return Option.none()}
  const baseY = maximumSurfaceY + JUNGLE_PYRAMID_LAYOUT.baseYClearance
  if (!structureYFits(baseY)) {return Option.none()}
  return Option.some(baseY)
}

const terrainFits = (
  candidate: JunglePyramidCandidate,
  sampleTerrain: OverworldTerrainSampler,
): Option.Option<number> => {
  const probes = terrainProbesFor(candidate, sampleTerrain)
  if (!terrainIsSuitable(probes)) {return Option.none()}
  return baseYForProbes(probes)
}

const isBoundary = (offsetX: number, offsetZ: number, halfExtent: number): boolean =>
  Math.abs(offsetX) === halfExtent || Math.abs(offsetZ) === halfExtent

const foundationBlockAt = (offsetX: number, offsetZ: number): BlockId => {
  if (isBoundary(offsetX, offsetZ, JUNGLE_PYRAMID_LAYOUT.baseHalfExtent)) {return JUNGLE_PYRAMID_BLOCK.COBBLESTONE}
  return JUNGLE_PYRAMID_BLOCK.OAK_PLANKS
}

const wallBlockAt = (layer: number): BlockId => {
  if (layer === FIRST_WALL_LAYER) {return JUNGLE_PYRAMID_BLOCK.COBBLESTONE}
  return JUNGLE_PYRAMID_BLOCK.STONE
}

const roofBlockAt = (offsetX: number, offsetZ: number): BlockId => {
  if (isBoundary(offsetX, offsetZ, JUNGLE_PYRAMID_LAYOUT.roofHalfExtent)) {return JUNGLE_PYRAMID_BLOCK.SANDSTONE}
  return JUNGLE_PYRAMID_BLOCK.STONE
}

const addFoundation = (
  blocks: Map<string, NaturalStructureBlockPlacement>,
  candidate: JunglePyramidCandidate,
  baseY: number,
): void => {
  for (let offsetX = -JUNGLE_PYRAMID_LAYOUT.baseHalfExtent; offsetX <= JUNGLE_PYRAMID_LAYOUT.baseHalfExtent; offsetX += UNIT_STEP) {
    for (let offsetZ = -JUNGLE_PYRAMID_LAYOUT.baseHalfExtent; offsetZ <= JUNGLE_PYRAMID_LAYOUT.baseHalfExtent; offsetZ += UNIT_STEP) {
      addBlock(
        blocks,
        foundationBlockAt(offsetX, offsetZ),
        candidate.x + offsetX,
        baseY,
        candidate.z + offsetZ,
      )
    }
  }
}

const addTempleFloor = (
  blocks: Map<string, NaturalStructureBlockPlacement>,
  candidate: JunglePyramidCandidate,
  floorY: number,
): void => {
  for (let offsetX = -JUNGLE_PYRAMID_LAYOUT.roofHalfExtent; offsetX <= JUNGLE_PYRAMID_LAYOUT.roofHalfExtent; offsetX += UNIT_STEP) {
    for (let offsetZ = -JUNGLE_PYRAMID_LAYOUT.roofHalfExtent; offsetZ <= JUNGLE_PYRAMID_LAYOUT.roofHalfExtent; offsetZ += UNIT_STEP) {
      addBlock(blocks, JUNGLE_PYRAMID_BLOCK.SANDSTONE, candidate.x + offsetX, floorY, candidate.z + offsetZ)
    }
  }
}

const addTempleWalls = (
  blocks: Map<string, NaturalStructureBlockPlacement>,
  candidate: JunglePyramidCandidate,
  baseY: number,
): void => {
  for (let layer = 0; layer < JUNGLE_PYRAMID_LAYOUT.templeWallHeight; layer += UNIT_STEP) {
    const y = baseY + FIRST_WALL_Y_OFFSET + layer
    for (let offsetX = -JUNGLE_PYRAMID_LAYOUT.roofHalfExtent; offsetX <= JUNGLE_PYRAMID_LAYOUT.roofHalfExtent; offsetX += UNIT_STEP) {
      for (let offsetZ = -JUNGLE_PYRAMID_LAYOUT.roofHalfExtent; offsetZ <= JUNGLE_PYRAMID_LAYOUT.roofHalfExtent; offsetZ += UNIT_STEP) {
        const entrance = offsetX === ENTRANCE_X_OFFSET && offsetZ === JUNGLE_PYRAMID_LAYOUT.roofHalfExtent
        const wall = isBoundary(offsetX, offsetZ, JUNGLE_PYRAMID_LAYOUT.roofHalfExtent)
          && !(entrance && layer < JUNGLE_PYRAMID_LAYOUT.templeWallHeight - UNIT_STEP)
        if (wall) {
          addBlock(
            blocks,
            wallBlockAt(layer),
            candidate.x + offsetX,
            y,
            candidate.z + offsetZ,
          )
        }
      }
    }
  }
}

const addRoof = (
  blocks: Map<string, NaturalStructureBlockPlacement>,
  candidate: JunglePyramidCandidate,
  baseY: number,
): void => {
  const roofY = baseY + FIRST_WALL_Y_OFFSET + JUNGLE_PYRAMID_LAYOUT.templeWallHeight
  for (let offsetX = -JUNGLE_PYRAMID_LAYOUT.roofHalfExtent; offsetX <= JUNGLE_PYRAMID_LAYOUT.roofHalfExtent; offsetX += UNIT_STEP) {
    for (let offsetZ = -JUNGLE_PYRAMID_LAYOUT.roofHalfExtent; offsetZ <= JUNGLE_PYRAMID_LAYOUT.roofHalfExtent; offsetZ += UNIT_STEP) {
      addBlock(
        blocks,
        roofBlockAt(offsetX, offsetZ),
        candidate.x + offsetX,
        roofY,
        candidate.z + offsetZ,
      )
    }
  }
}

const addChamberShell = (
  blocks: Map<string, NaturalStructureBlockPlacement>,
  candidate: JunglePyramidCandidate,
  floorY: number,
): void => {
  const chamberTopY = floorY + JUNGLE_PYRAMID_LAYOUT.chamberHeight - UNIT_STEP
  for (let y = floorY; y <= chamberTopY; y += UNIT_STEP) {
    for (let offsetX = -JUNGLE_PYRAMID_LAYOUT.chamberHalfExtent; offsetX <= JUNGLE_PYRAMID_LAYOUT.chamberHalfExtent; offsetX += UNIT_STEP) {
      for (let offsetZ = -JUNGLE_PYRAMID_LAYOUT.chamberHalfExtent; offsetZ <= JUNGLE_PYRAMID_LAYOUT.chamberHalfExtent; offsetZ += UNIT_STEP) {
        if (y === floorY || y === chamberTopY || isBoundary(offsetX, offsetZ, JUNGLE_PYRAMID_LAYOUT.chamberHalfExtent)) {
          addBlock(blocks, JUNGLE_PYRAMID_BLOCK.SANDSTONE, candidate.x + offsetX, y, candidate.z + offsetZ)
        }
      }
    }
  }
}

const addChamberDetails = (
  blocks: Map<string, NaturalStructureBlockPlacement>,
  markers: Array<NaturalStructureMarker>,
  candidate: JunglePyramidCandidate,
  floorY: number,
): void => {
  const detailY = floorY + UNIT_STEP
  addBlock(blocks, JUNGLE_PYRAMID_BLOCK.TNT, candidate.x, detailY, candidate.z)
  for (const offsetX of [-JUNGLE_PYRAMID_LAYOUT.chestOffset, JUNGLE_PYRAMID_LAYOUT.chestOffset]) {
    const x = candidate.x + offsetX
    addBlock(blocks, JUNGLE_PYRAMID_BLOCK.CHEST, x, detailY, candidate.z)
    addMarker(markers, { kind: 'loot-chest', lootTable: 'jungle-pyramid', x, y: detailY, z: candidate.z })
  }
}

const addTempleDetails = (
  blocks: Map<string, NaturalStructureBlockPlacement>,
  candidate: JunglePyramidCandidate,
  baseY: number,
): void => {
  const floorY = baseY + FIRST_WALL_Y_OFFSET
  for (let offsetZ = JUNGLE_PYRAMID_LAYOUT.roofHalfExtent; offsetZ >= UNIT_STEP; offsetZ -= UNIT_STEP) {
    addBlock(blocks, JUNGLE_PYRAMID_BLOCK.OAK_PLANKS, candidate.x, floorY, candidate.z + offsetZ)
  }
  const torchY = baseY + FIRST_WALL_Y_OFFSET + UNIT_STEP
  addBlock(blocks, JUNGLE_PYRAMID_BLOCK.TORCH, candidate.x - TORCH_X_OFFSET * UNIT_STEP, torchY, candidate.z)
  addBlock(blocks, JUNGLE_PYRAMID_BLOCK.TORCH, candidate.x + TORCH_X_OFFSET * UNIT_STEP, torchY, candidate.z)
}

type JunglePyramidPlanBuffers = {
  readonly blocks: Map<string, NaturalStructureBlockPlacement>
  readonly markers: Array<NaturalStructureMarker>
}

const buildJunglePyramidPlan = (
  candidate: JunglePyramidCandidate,
  baseY: number,
): JunglePyramidPlanBuffers => {
  const blocks = new Map<string, NaturalStructureBlockPlacement>()
  const markers: Array<NaturalStructureMarker> = []
  addFoundation(blocks, candidate, baseY)
  addTempleFloor(blocks, candidate, baseY + FIRST_WALL_Y_OFFSET)
  addTempleWalls(blocks, candidate, baseY)
  addRoof(blocks, candidate, baseY)
  addChamberShell(blocks, candidate, baseY - JUNGLE_PYRAMID_LAYOUT.chamberFloorYOffset)
  addChamberDetails(blocks, markers, candidate, baseY - JUNGLE_PYRAMID_LAYOUT.chamberFloorYOffset)
  addTempleDetails(blocks, candidate, baseY)
  return { blocks, markers }
}

/** Plans a deterministic compact jungle pyramid using only blocks registered by mc-kernel. */
export const planJunglePyramidForCandidate = (
  candidate: JunglePyramidCandidate,
  sampleTerrain: OverworldTerrainSampler,
): Option.Option<JunglePyramidDraft> => {
  const baseYOption = terrainFits(candidate, sampleTerrain)
  if (Option.isNone(baseYOption)) {return Option.none()}
  const { blocks, markers } = buildJunglePyramidPlan(candidate, baseYOption.value)
  return Option.some(Object.freeze({
    blocks: Object.freeze([...blocks.values()]),
    markers: Object.freeze(markers),
    origin: Object.freeze({ x: candidate.x, y: baseYOption.value, z: candidate.z }),
  }))
}
