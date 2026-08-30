import { BASTION_REMNANT_BLOCK, BASTION_REMNANT_LAYOUT } from './bastion-remnant-data.js'
import type {
  NaturalStructureBlockPlacement,
  NaturalStructureMarker,
  NaturalStructurePosition,
  NetherStructureTerrainSample,
  NetherStructureTerrainSampler,
} from './natural-structure.js'
import { Option, Predicate } from 'effect'
import type { BlockId } from '@nerima-games/mc-kernel'
import { CHUNK_HEIGHT } from './constants.js'

type BastionRemnantCandidate = {
  readonly x: number
  readonly z: number
}

export type BastionRemnantDraft = {
  readonly blocks: ReadonlyArray<NaturalStructureBlockPlacement>
  readonly markers: ReadonlyArray<NaturalStructureMarker>
  readonly origin: NaturalStructurePosition
}

const UNIT_STEP = 1
const MIN_WORLD_Y = 0
const ENTITY_OFFSET = 2
const GOLD_EDGE_INSET = 2

const keyOf = (x: number, y: number, z: number): string => `${String(x)}:${String(y)}:${String(z)}`

const addBlock = (blocks: Map<string, NaturalStructureBlockPlacement>, block: BlockId, x: number, y: number, z: number): void => {
  blocks.set(keyOf(x, y, z), Object.freeze({ block, x, y, z }))
}

const addMarker = (markers: Array<NaturalStructureMarker>, marker: NaturalStructureMarker): void => {
  markers.push(Object.freeze(marker))
}

const terrainProbesFor = (candidate: BastionRemnantCandidate, sampleTerrain: NetherStructureTerrainSampler): ReadonlyArray<NetherStructureTerrainSample | undefined> => {
  const { halfExtent } = BASTION_REMNANT_LAYOUT
  return [
    sampleTerrain(candidate.x, candidate.z),
    sampleTerrain(candidate.x - halfExtent, candidate.z),
    sampleTerrain(candidate.x + halfExtent, candidate.z),
    sampleTerrain(candidate.x, candidate.z - halfExtent),
    sampleTerrain(candidate.x, candidate.z + halfExtent),
  ]
}

const isValidTerrainSample = (sample: NetherStructureTerrainSample | undefined): sample is NetherStructureTerrainSample => {
  if (Predicate.isUndefined(sample)) {return false}
  return Number.isFinite(sample.ceilingY)
    && Number.isFinite(sample.surfaceY)
    && sample.ceilingY > sample.surfaceY
    && sample.surfaceY >= MIN_WORLD_Y
    && sample.surfaceY < CHUNK_HEIGHT
}

const highestSurfaceYFor = (probes: ReadonlyArray<NetherStructureTerrainSample>): number =>
  Math.max(...probes.map((probe) => probe.surfaceY))

const hasValidBastionBounds = (
  probes: ReadonlyArray<NetherStructureTerrainSample>,
  baseY: number,
): boolean => {
  const surfaces = probes.map((probe) => probe.surfaceY)
  const lowestSurfaceY = Math.min(...surfaces)
  const topY = baseY + BASTION_REMNANT_LAYOUT.centralTowerHeight
  return highestSurfaceYFor(probes) - lowestSurfaceY <= BASTION_REMNANT_LAYOUT.maxSurfaceVariation
    && probes.every((probe) => probe.ceilingY - baseY >= BASTION_REMNANT_LAYOUT.minHeadroom)
    && baseY >= MIN_WORLD_Y
    && topY < CHUNK_HEIGHT
}

const bastionBaseYFor = (
  candidate: BastionRemnantCandidate,
  sampleTerrain: NetherStructureTerrainSampler,
): Option.Option<number> => {
  const probes = terrainProbesFor(candidate, sampleTerrain)
  const validProbes = probes.filter(isValidTerrainSample)
  if (validProbes.length !== probes.length) {return Option.none()}

  const baseY = highestSurfaceYFor(validProbes) + UNIT_STEP
  if (!hasValidBastionBounds(validProbes, baseY)) {
    return Option.none()
  }
  return Option.some(baseY)
}

const isBoundary = (x: number, z: number, halfExtent: number): boolean =>
  Math.abs(x) === halfExtent || Math.abs(z) === halfExtent

const placeFoundation = (
  blocks: Map<string, NaturalStructureBlockPlacement>,
  candidate: BastionRemnantCandidate,
  baseY: number,
): void => {
  const { halfExtent } = BASTION_REMNANT_LAYOUT
  for (let dx = -halfExtent; dx <= halfExtent; dx += UNIT_STEP) {
    for (let dz = -halfExtent; dz <= halfExtent; dz += UNIT_STEP) {
      let block = BASTION_REMNANT_BLOCK.NETHERRACK
      if (isBoundary(dx, dz, halfExtent)) {
        block = BASTION_REMNANT_BLOCK.NETHER_BRICK
      }
      addBlock(blocks, block, candidate.x + dx, baseY, candidate.z + dz)
    }
  }
}

const placeOuterWalls = (
  blocks: Map<string, NaturalStructureBlockPlacement>,
  candidate: BastionRemnantCandidate,
  baseY: number,
): void => {
  const { halfExtent, outerWallHeight } = BASTION_REMNANT_LAYOUT
  for (let y = baseY + UNIT_STEP; y <= baseY + outerWallHeight; y += UNIT_STEP) {
    for (let dx = -halfExtent; dx <= halfExtent; dx += UNIT_STEP) {
      for (let dz = -halfExtent; dz <= halfExtent; dz += UNIT_STEP) {
        if (isBoundary(dx, dz, halfExtent)) {
          addBlock(blocks, BASTION_REMNANT_BLOCK.NETHER_BRICK, candidate.x + dx, y, candidate.z + dz)
        }
      }
    }
  }
}

const placeBridge = (
  blocks: Map<string, NaturalStructureBlockPlacement>,
  candidate: BastionRemnantCandidate,
  baseY: number,
  axis: 'x' | 'z',
): void => {
  const { bridgeHalfWidth, bridgeHeightOffset, halfExtent } = BASTION_REMNANT_LAYOUT
  const bridgeY = baseY + bridgeHeightOffset
  for (let along = -halfExtent; along <= halfExtent; along += UNIT_STEP) {
    for (let across = -bridgeHalfWidth; across <= bridgeHalfWidth; across += UNIT_STEP) {
      let x = candidate.x + across
      let z = candidate.z + along
      if (axis === 'x') {
        x = candidate.x + along
        z = candidate.z + across
      }
      addBlock(blocks, BASTION_REMNANT_BLOCK.NETHER_BRICK, x, bridgeY, z)
    }
  }
}

const placeCentralTower = (
  blocks: Map<string, NaturalStructureBlockPlacement>,
  candidate: BastionRemnantCandidate,
  baseY: number,
): void => {
  const { centralTowerHalfExtent, centralTowerHeight } = BASTION_REMNANT_LAYOUT
  for (let y = baseY + UNIT_STEP; y <= baseY + centralTowerHeight; y += UNIT_STEP) {
    for (let dx = -centralTowerHalfExtent; dx <= centralTowerHalfExtent; dx += UNIT_STEP) {
      for (let dz = -centralTowerHalfExtent; dz <= centralTowerHalfExtent; dz += UNIT_STEP) {
        if (isBoundary(dx, dz, centralTowerHalfExtent) || y === baseY + centralTowerHeight) {
          addBlock(blocks, BASTION_REMNANT_BLOCK.SMOOTH_BASALT, candidate.x + dx, y, candidate.z + dz)
        }
      }
    }
  }
}

const placeGoldDetails = (
  blocks: Map<string, NaturalStructureBlockPlacement>,
  candidate: BastionRemnantCandidate,
  baseY: number,
): void => {
  const goldOffset = BASTION_REMNANT_LAYOUT.halfExtent - GOLD_EDGE_INSET
  const goldY = baseY + UNIT_STEP
  const goldCorners: ReadonlyArray<readonly [number, number]> = [
    [-goldOffset, -goldOffset],
    [-goldOffset, goldOffset],
    [goldOffset, -goldOffset],
    [goldOffset, goldOffset],
  ]
  for (const [dx, dz] of goldCorners) {
    addBlock(blocks, BASTION_REMNANT_BLOCK.GOLD_BLOCK, candidate.x + dx, goldY, candidate.z + dz)
  }
}

const placeLootAndEntities = (
  blocks: Map<string, NaturalStructureBlockPlacement>,
  markers: Array<NaturalStructureMarker>,
  candidate: BastionRemnantCandidate,
  baseY: number,
): void => {
  const chestY = baseY + BASTION_REMNANT_LAYOUT.chestYOffset
  addBlock(blocks, BASTION_REMNANT_BLOCK.CHEST, candidate.x, chestY, candidate.z)
  addMarker(markers, { kind: 'loot-chest', lootTable: 'bastion-remnant', x: candidate.x, y: chestY, z: candidate.z })
  addMarker(markers, { entity: 'piglin', kind: 'entity-spawn', x: candidate.x - ENTITY_OFFSET, y: baseY + UNIT_STEP, z: candidate.z })
  addMarker(markers, { entity: 'piglin-brute', kind: 'entity-spawn', x: candidate.x + ENTITY_OFFSET, y: baseY + UNIT_STEP, z: candidate.z })
}

const buildBastionRemnant = (
  candidate: BastionRemnantCandidate,
  baseY: number,
): BastionRemnantDraft => {
  const blocks = new Map<string, NaturalStructureBlockPlacement>()
  const markers: Array<NaturalStructureMarker> = []
  placeFoundation(blocks, candidate, baseY)
  placeOuterWalls(blocks, candidate, baseY)
  placeBridge(blocks, candidate, baseY, 'x')
  placeBridge(blocks, candidate, baseY, 'z')
  placeCentralTower(blocks, candidate, baseY)
  placeGoldDetails(blocks, candidate, baseY)
  placeLootAndEntities(blocks, markers, candidate, baseY)
  return Object.freeze({
    blocks: Object.freeze([...blocks.values()]),
    markers: Object.freeze(markers),
    origin: Object.freeze({ x: candidate.x, y: baseY, z: candidate.z }),
  })
}

/** Plans a compact registry-backed bastion remnant on a level Nether shelf. */
export const planBastionRemnantForCandidate = (
  candidate: BastionRemnantCandidate,
  sampleTerrain: NetherStructureTerrainSampler,
): Option.Option<BastionRemnantDraft> => {
  const baseOption = bastionBaseYFor(candidate, sampleTerrain)
  if (Option.isNone(baseOption)) {return Option.none()}
  return Option.some(buildBastionRemnant(candidate, baseOption.value))
}
