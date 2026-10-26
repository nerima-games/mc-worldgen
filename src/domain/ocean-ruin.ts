import type {
  NaturalStructureBlockPlacementDraft,
  NaturalStructureMarkerDraft,
  NaturalStructurePositionDraft,
} from './natural-structure-types.js'
import { OCEAN_RUIN_BLOCK, OCEAN_RUIN_LAYOUT } from './ocean-ruin-data.js'
import type { OverworldTerrainSample, OverworldTerrainSampler } from './structure-siting.js'
import type { BlockId } from '@nerima-games/mc-kernel'
import { CHUNK_HEIGHT } from './constants.js'
import { Option } from 'effect'
import { blockAxis } from './coordinate-compatibility.js'

type OceanRuinCandidate = { readonly x: number; readonly z: number }

export type OceanRuinDraft = {
  readonly origin: NaturalStructurePositionDraft
  readonly blocks: ReadonlyArray<NaturalStructureBlockPlacementDraft>
  readonly markers: ReadonlyArray<NaturalStructureMarkerDraft>
}

const UNIT_STEP = 1
const MIN_WORLD_Y = 0
const MODULO_THREE = 3
const MODULO_FOUR = 4
const ZERO_REMAINDER = 0
const ZERO_OFFSET = 0
const CHEST_Z_OFFSET = 2

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
  candidate: OceanRuinCandidate,
  sampleTerrain: OverworldTerrainSampler,
): ReadonlyArray<OverworldTerrainSample> => {
  const probeExtent = OCEAN_RUIN_LAYOUT.halfExtent
  return [
    sampleTerrain(blockAxis(candidate.x), blockAxis(candidate.z)),
    sampleTerrain(blockAxis(candidate.x - probeExtent), blockAxis(candidate.z)),
    sampleTerrain(blockAxis(candidate.x + probeExtent), blockAxis(candidate.z)),
    sampleTerrain(blockAxis(candidate.x), blockAxis(candidate.z - probeExtent)),
    sampleTerrain(blockAxis(candidate.x), blockAxis(candidate.z + probeExtent)),
  ]
}

const probesAreSuitable = (probes: ReadonlyArray<OverworldTerrainSample>): boolean =>
  !probes.some((probe) => probe.biome !== 'OCEAN' || probe.surfaceY > probe.seaLevel - OCEAN_RUIN_LAYOUT.minWaterDepth)

const surfaceBoundsFor = (probes: ReadonlyArray<OverworldTerrainSample>): { readonly minimum: number; readonly maximum: number } => {
  const surfaces = probes.map((probe) => probe.surfaceY)
  return Object.freeze({ maximum: Math.max(...surfaces), minimum: Math.min(...surfaces) })
}

const baseYForProbes = (probes: ReadonlyArray<OverworldTerrainSample>): Option.Option<number> => {
  const { minimum: minimumSurfaceY, maximum: maximumSurfaceY } = surfaceBoundsFor(probes)
  if (maximumSurfaceY - minimumSurfaceY > OCEAN_RUIN_LAYOUT.maxSurfaceVariation) {return Option.none()}

  const baseY = maximumSurfaceY + UNIT_STEP
  const topY = baseY + OCEAN_RUIN_LAYOUT.wallHeight - UNIT_STEP
  if (baseY < MIN_WORLD_Y || topY >= CHUNK_HEIGHT) {
    return Option.none()
  }
  return Option.some(baseY)
}

const terrainFits = (
  candidate: OceanRuinCandidate,
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

const foundationBlockAt = (dx: number, dz: number): BlockId => {
  if (isBoundary(dx, dz, OCEAN_RUIN_LAYOUT.halfExtent)) {
    return OCEAN_RUIN_BLOCK.COBBLESTONE
  }
  if ((dx + dz) % MODULO_THREE === ZERO_REMAINDER) {
    return OCEAN_RUIN_BLOCK.GRAVEL
  }
  return OCEAN_RUIN_BLOCK.STONE
}

const wallBlockAt = (dx: number, dz: number, y: number): BlockId => {
  if ((dx - dz + y) % MODULO_THREE === ZERO_REMAINDER) {
    return OCEAN_RUIN_BLOCK.PRISMARINE
  }
  if ((dx + dz + y) % MODULO_FOUR === ZERO_REMAINDER) {
    return OCEAN_RUIN_BLOCK.SANDSTONE
  }
  return OCEAN_RUIN_BLOCK.COBBLESTONE
}

const addFoundation = (
  blocks: Map<string, NaturalStructureBlockPlacementDraft>,
  candidate: OceanRuinCandidate,
  baseY: number,
): void => {
  for (let dx = -OCEAN_RUIN_LAYOUT.halfExtent; dx <= OCEAN_RUIN_LAYOUT.halfExtent; dx += UNIT_STEP) {
    for (let dz = -OCEAN_RUIN_LAYOUT.halfExtent; dz <= OCEAN_RUIN_LAYOUT.halfExtent; dz += UNIT_STEP) {
      addBlock(blocks, foundationBlockAt(dx, dz), candidate.x + dx, baseY, candidate.z + dz)
    }
  }
}

const addWalls = (
  blocks: Map<string, NaturalStructureBlockPlacementDraft>,
  candidate: OceanRuinCandidate,
  baseY: number,
): void => {
  for (let y = baseY + UNIT_STEP; y < baseY + OCEAN_RUIN_LAYOUT.wallHeight; y += UNIT_STEP) {
    for (let dx = -OCEAN_RUIN_LAYOUT.halfExtent; dx <= OCEAN_RUIN_LAYOUT.halfExtent; dx += UNIT_STEP) {
      for (let dz = -OCEAN_RUIN_LAYOUT.halfExtent; dz <= OCEAN_RUIN_LAYOUT.halfExtent; dz += UNIT_STEP) {
        if (isBoundary(dx, dz, OCEAN_RUIN_LAYOUT.halfExtent)) {
          addBlock(blocks, wallBlockAt(dx, dz, y), candidate.x + dx, y, candidate.z + dz)
        }
      }
    }
  }
}

const addDebrisAndLoot = (
  blocks: Map<string, NaturalStructureBlockPlacementDraft>,
  markers: Array<NaturalStructureMarkerDraft>,
  candidate: OceanRuinCandidate,
  baseY: number,
): void => {
  const interiorY = baseY + UNIT_STEP
  addBlock(blocks, OCEAN_RUIN_BLOCK.SAND, candidate.x - UNIT_STEP, interiorY, candidate.z - UNIT_STEP)
  addBlock(blocks, OCEAN_RUIN_BLOCK.GRAVEL, candidate.x + UNIT_STEP, interiorY, candidate.z + UNIT_STEP)
  const chestX = candidate.x
  const chestZ = candidate.z - CHEST_Z_OFFSET
  addBlock(blocks, OCEAN_RUIN_BLOCK.CHEST, chestX, interiorY, chestZ)
  addMarker(markers, { kind: 'loot-chest', lootTable: 'ocean-ruin', x: chestX, y: interiorY, z: chestZ })
}

type OceanRuinPlanBuffers = {
  readonly blocks: Map<string, NaturalStructureBlockPlacementDraft>
  readonly markers: Array<NaturalStructureMarkerDraft>
}

const buildOceanRuinPlan = (
  candidate: OceanRuinCandidate,
  baseY: number,
): OceanRuinPlanBuffers => {
  const blocks = new Map<string, NaturalStructureBlockPlacementDraft>()
  const markers: Array<NaturalStructureMarkerDraft> = []
  addFoundation(blocks, candidate, baseY)
  addWalls(blocks, candidate, baseY)
  addDebrisAndLoot(blocks, markers, candidate, baseY)
  return { blocks, markers }
}

const translateBlock = (
  placement: NaturalStructureBlockPlacementDraft,
  candidate: OceanRuinCandidate,
  baseY: number,
): NaturalStructureBlockPlacementDraft => Object.freeze({
  block: placement.block,
  x: candidate.x + placement.x,
  y: baseY + placement.y,
  z: candidate.z + placement.z,
})

const translateMarker = (
  marker: NaturalStructureMarkerDraft,
  candidate: OceanRuinCandidate,
  baseY: number,
): NaturalStructureMarkerDraft => Object.freeze({
  ...marker,
  x: candidate.x + marker.x,
  y: baseY + marker.y,
  z: candidate.z + marker.z,
})

const oceanRuinRelativePlan = (() => {
  const plan = buildOceanRuinPlan({ x: ZERO_OFFSET, z: ZERO_OFFSET }, ZERO_OFFSET)
  return Object.freeze({
    blocks: Object.freeze([...plan.blocks.values()]),
    markers: Object.freeze(plan.markers),
  })
})()

/** Plans a registry-backed submerged stone ruin on a level ocean floor. */
export const planOceanRuinForCandidate = (
  candidate: OceanRuinCandidate,
  sampleTerrain: OverworldTerrainSampler,
): Option.Option<OceanRuinDraft> => {
  const baseYOption = terrainFits(candidate, sampleTerrain)
  if (Option.isNone(baseYOption)) {
    return Option.none()
  }

  const blocks = Object.freeze(oceanRuinRelativePlan.blocks.map((placement) =>
    translateBlock(placement, candidate, baseYOption.value),
  ))
  const markers = Object.freeze(oceanRuinRelativePlan.markers.map((marker) =>
    translateMarker(marker, candidate, baseYOption.value),
  ))
  return Option.some(Object.freeze({
    blocks,
    markers,
    origin: Object.freeze({ x: candidate.x, y: baseYOption.value, z: candidate.z }),
  }))
}
