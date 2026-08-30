import type {
  NaturalStructureBlockPlacement,
  NaturalStructureMarker,
  NaturalStructurePosition,
} from './natural-structure.js'
import type { OverworldTerrainSample, OverworldTerrainSampler } from './structure-siting.js'
import { SHIPWRECK_BLOCK, SHIPWRECK_LAYOUT } from './shipwreck-data.js'
import type { BlockId } from '@nerima-games/mc-kernel'
import { CHUNK_HEIGHT } from './constants.js'
import { Option } from 'effect'

type ShipwreckCandidate = { readonly x: number; readonly z: number }

export type ShipwreckDraft = {
  readonly origin: NaturalStructurePosition
  readonly blocks: ReadonlyArray<NaturalStructureBlockPlacement>
  readonly markers: ReadonlyArray<NaturalStructureMarker>
}

const UNIT_STEP = 1
const MIN_WORLD_Y = 0
const BOW_WIDTH_REDUCTION = 1
const CABIN_Z_MARGIN = 1
const KEEL_Y_OFFSET = 0
const DECK_CHEST_Y_OFFSET = 1

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
  candidate: ShipwreckCandidate,
  sampleTerrain: OverworldTerrainSampler,
): ReadonlyArray<OverworldTerrainSample> => {
  const probeExtent = SHIPWRECK_LAYOUT.halfLength
  return [
    sampleTerrain(candidate.x, candidate.z),
    sampleTerrain(candidate.x - probeExtent, candidate.z),
    sampleTerrain(candidate.x + probeExtent, candidate.z),
    sampleTerrain(candidate.x, candidate.z - probeExtent),
    sampleTerrain(candidate.x, candidate.z + probeExtent),
  ]
}

const terrainMatchesOcean = (probes: ReadonlyArray<OverworldTerrainSample>): boolean =>
  !probes.some((probe) => probe.biome !== 'OCEAN' || probe.surfaceY > probe.seaLevel - SHIPWRECK_LAYOUT.minWaterDepth)

const baseYForTerrainProbes = (
  probes: ReadonlyArray<OverworldTerrainSample>,
): Option.Option<number> => {
  const surfaces = probes.map((probe) => probe.surfaceY)
  const maximumSurfaceY = Math.max(...surfaces)
  const minimumSurfaceY = Math.min(...surfaces)
  if (maximumSurfaceY - minimumSurfaceY > SHIPWRECK_LAYOUT.maxSurfaceVariation) {
    return Option.none()
  }

  const baseY = maximumSurfaceY + KEEL_Y_OFFSET + UNIT_STEP
  const topY = baseY + SHIPWRECK_LAYOUT.deckYOffset + SHIPWRECK_LAYOUT.mastHeight - UNIT_STEP
  if (baseY < MIN_WORLD_Y || topY >= CHUNK_HEIGHT) {
    return Option.none()
  }
  return Option.some(baseY)
}

const terrainFits = (
  candidate: ShipwreckCandidate,
  sampleTerrain: OverworldTerrainSampler,
): Option.Option<number> => {
  const probes = terrainProbesFor(candidate, sampleTerrain)
  if (!terrainMatchesOcean(probes)) {
    return Option.none()
  }
  return baseYForTerrainProbes(probes)
}

const hullWidthFor = (x: number): number => {
  if (Math.abs(x) === SHIPWRECK_LAYOUT.halfLength) {
    return SHIPWRECK_LAYOUT.halfWidth - BOW_WIDTH_REDUCTION
  }
  return SHIPWRECK_LAYOUT.halfWidth
}

const addHull = (
  blocks: Map<string, NaturalStructureBlockPlacement>,
  candidate: ShipwreckCandidate,
  baseY: number,
): void => {
  for (let offsetX = -SHIPWRECK_LAYOUT.halfLength; offsetX <= SHIPWRECK_LAYOUT.halfLength; offsetX += UNIT_STEP) {
    const hullWidth = hullWidthFor(offsetX)
    for (let offsetZ = -hullWidth; offsetZ <= hullWidth; offsetZ += UNIT_STEP) {
      addBlock(blocks, SHIPWRECK_BLOCK.OAK_PLANKS, candidate.x + offsetX, baseY + KEEL_Y_OFFSET, candidate.z + offsetZ)
      if (Math.abs(offsetZ) === hullWidth || Math.abs(offsetX) === SHIPWRECK_LAYOUT.halfLength) {
        addBlock(blocks, SHIPWRECK_BLOCK.OAK_LOG, candidate.x + offsetX, baseY + UNIT_STEP, candidate.z + offsetZ)
      }
    }
  }
}

const addDeck = (
  blocks: Map<string, NaturalStructureBlockPlacement>,
  candidate: ShipwreckCandidate,
  deckY: number,
): void => {
  for (let offsetX = -SHIPWRECK_LAYOUT.halfLength + UNIT_STEP; offsetX < SHIPWRECK_LAYOUT.halfLength; offsetX += UNIT_STEP) {
    for (let offsetZ = -SHIPWRECK_LAYOUT.halfWidth + UNIT_STEP; offsetZ < SHIPWRECK_LAYOUT.halfWidth; offsetZ += UNIT_STEP) {
      addBlock(blocks, SHIPWRECK_BLOCK.OAK_PLANKS, candidate.x + offsetX, deckY, candidate.z + offsetZ)
    }
  }
  addBlock(blocks, SHIPWRECK_BLOCK.OAK_STAIRS, candidate.x - SHIPWRECK_LAYOUT.halfLength, deckY, candidate.z)
  addBlock(blocks, SHIPWRECK_BLOCK.OAK_STAIRS, candidate.x + SHIPWRECK_LAYOUT.halfLength, deckY, candidate.z)
}

const addCabinWalls = (
  blocks: Map<string, NaturalStructureBlockPlacement>,
  candidate: ShipwreckCandidate,
  cabinBaseY: number,
  cabinMinZ: number,
  cabinMaxZ: number,
): void => {
  for (let y = cabinBaseY; y < cabinBaseY + SHIPWRECK_LAYOUT.cabinWallHeight; y += UNIT_STEP) {
    for (let offsetX = SHIPWRECK_LAYOUT.cabinStartX; offsetX <= SHIPWRECK_LAYOUT.cabinEndX; offsetX += UNIT_STEP) {
      for (let offsetZ = cabinMinZ; offsetZ <= cabinMaxZ; offsetZ += UNIT_STEP) {
        if (
          offsetX === SHIPWRECK_LAYOUT.cabinStartX
          || offsetX === SHIPWRECK_LAYOUT.cabinEndX
          || Math.abs(offsetZ) === cabinMaxZ
        ) {
          addBlock(blocks, SHIPWRECK_BLOCK.OAK_LOG, candidate.x + offsetX, y, candidate.z + offsetZ)
        }
      }
    }
  }
}

const addCabinRoof = (
  blocks: Map<string, NaturalStructureBlockPlacement>,
  candidate: ShipwreckCandidate,
  roofY: number,
  cabinMinZ: number,
  cabinMaxZ: number,
): void => {
  for (let offsetX = SHIPWRECK_LAYOUT.cabinStartX; offsetX <= SHIPWRECK_LAYOUT.cabinEndX; offsetX += UNIT_STEP) {
    for (let offsetZ = cabinMinZ; offsetZ <= cabinMaxZ; offsetZ += UNIT_STEP) {
      addBlock(blocks, SHIPWRECK_BLOCK.OAK_STAIRS, candidate.x + offsetX, roofY, candidate.z + offsetZ)
    }
  }
}

const addCabin = (
  blocks: Map<string, NaturalStructureBlockPlacement>,
  candidate: ShipwreckCandidate,
  deckY: number,
): void => {
  const cabinBaseY = deckY + UNIT_STEP
  const cabinMinZ = -SHIPWRECK_LAYOUT.halfWidth + CABIN_Z_MARGIN
  const cabinMaxZ = SHIPWRECK_LAYOUT.halfWidth - CABIN_Z_MARGIN
  addCabinWalls(blocks, candidate, cabinBaseY, cabinMinZ, cabinMaxZ)
  addCabinRoof(blocks, candidate, cabinBaseY + SHIPWRECK_LAYOUT.cabinWallHeight, cabinMinZ, cabinMaxZ)
}

const addMast = (
  blocks: Map<string, NaturalStructureBlockPlacement>,
  candidate: ShipwreckCandidate,
  deckY: number,
): void => {
  for (let offsetY = 0; offsetY < SHIPWRECK_LAYOUT.mastHeight; offsetY += UNIT_STEP) {
    addBlock(blocks, SHIPWRECK_BLOCK.OAK_LOG, candidate.x + SHIPWRECK_LAYOUT.mastX, deckY + offsetY, candidate.z)
  }
  const crossbeamY = deckY + SHIPWRECK_LAYOUT.mastHeight - UNIT_STEP
  for (let offsetZ = -SHIPWRECK_LAYOUT.halfWidth + UNIT_STEP; offsetZ <= SHIPWRECK_LAYOUT.halfWidth - UNIT_STEP; offsetZ += UNIT_STEP) {
    addBlock(blocks, SHIPWRECK_BLOCK.OAK_STAIRS, candidate.x + SHIPWRECK_LAYOUT.mastX, crossbeamY, candidate.z + offsetZ)
  }
}

const addLoot = (
  blocks: Map<string, NaturalStructureBlockPlacement>,
  markers: Array<NaturalStructureMarker>,
  candidate: ShipwreckCandidate,
  deckY: number,
): void => {
  for (const offsetX of SHIPWRECK_LAYOUT.lootOffsets) {
    const chestX = candidate.x + offsetX
    const chestY = deckY + DECK_CHEST_Y_OFFSET
    addBlock(blocks, SHIPWRECK_BLOCK.CHEST, chestX, chestY, candidate.z)
    addMarker(markers, { kind: 'loot-chest', lootTable: 'shipwreck', x: chestX, y: chestY, z: candidate.z })
  }
}

type ShipwreckPlanBuffers = {
  readonly blocks: Map<string, NaturalStructureBlockPlacement>
  readonly markers: Array<NaturalStructureMarker>
}

const buildShipwreckPlan = (
  candidate: ShipwreckCandidate,
  baseY: number,
): ShipwreckPlanBuffers => {
  const blocks = new Map<string, NaturalStructureBlockPlacement>()
  const markers: Array<NaturalStructureMarker> = []
  const deckY = baseY + SHIPWRECK_LAYOUT.deckYOffset
  addHull(blocks, candidate, baseY)
  addDeck(blocks, candidate, deckY)
  addCabin(blocks, candidate, deckY)
  addMast(blocks, candidate, deckY)
  addLoot(blocks, markers, candidate, deckY)
  return { blocks, markers }
}

/** Plans a deterministic, submerged shipwreck from registry-backed blocks. */
export const planShipwreckForCandidate = (
  candidate: ShipwreckCandidate,
  sampleTerrain: OverworldTerrainSampler,
): Option.Option<ShipwreckDraft> => {
  const baseYOption = terrainFits(candidate, sampleTerrain)
  if (Option.isNone(baseYOption)) {
    return Option.none()
  }
  const { blocks, markers } = buildShipwreckPlan(candidate, baseYOption.value)
  return Option.some(Object.freeze({
    blocks: Object.freeze([...blocks.values()]),
    markers: Object.freeze(markers),
    origin: Object.freeze({ x: candidate.x, y: baseYOption.value, z: candidate.z }),
  }))
}
