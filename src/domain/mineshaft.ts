import { MINESHAFT_BLOCK, MINESHAFT_LAYOUT } from './mineshaft-data'
import type {
  NaturalStructureBlockPlacement,
  NaturalStructureMarker,
  NaturalStructurePosition,
} from './natural-structure'
import type { OverworldTerrainSample, OverworldTerrainSampler } from './structure-siting'
import type { BlockId } from '@nerima-games/mc-kernel'
import { CHUNK_HEIGHT } from './constants'
import { Option } from 'effect'

type MineshaftCandidate = { readonly x: number; readonly z: number }

export type MineshaftDraft = {
  readonly origin: NaturalStructurePosition
  readonly blocks: ReadonlyArray<NaturalStructureBlockPlacement>
  readonly markers: ReadonlyArray<NaturalStructureMarker>
}

const UNIT_STEP = 1
const MIN_WORLD_Y = 0
const RAIL_Y_OFFSET = 1
const TORCH_Y_OFFSET = 2
const COBWEB_Z_OFFSET = 6
const ZERO_OFFSET = 0

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
  candidate: MineshaftCandidate,
  sampleTerrain: OverworldTerrainSampler,
): ReadonlyArray<OverworldTerrainSample> => {
  const probeExtent = MINESHAFT_LAYOUT.branchHalfExtent
  return [
    sampleTerrain(candidate.x, candidate.z),
    sampleTerrain(candidate.x - probeExtent, candidate.z),
    sampleTerrain(candidate.x + probeExtent, candidate.z),
    sampleTerrain(candidate.x, candidate.z - probeExtent),
    sampleTerrain(candidate.x, candidate.z + probeExtent),
  ]
}

const baseYForProbes = (probes: ReadonlyArray<OverworldTerrainSample>): Option.Option<number> => {
  const surfaces = probes.map((probe) => probe.surfaceY)
  const maximumSurfaceY = Math.max(...surfaces)
  const minimumSurfaceY = Math.min(...surfaces)
  if (maximumSurfaceY - minimumSurfaceY > MINESHAFT_LAYOUT.maxSurfaceVariation) {return Option.none()}

  const baseY = maximumSurfaceY - MINESHAFT_LAYOUT.depthBelowSurface
  const topY = baseY + MINESHAFT_LAYOUT.frameHeight - UNIT_STEP
  if (baseY < MIN_WORLD_Y + MINESHAFT_LAYOUT.minimumBaseY || topY >= CHUNK_HEIGHT) {return Option.none()}
  return Option.some(baseY)
}

const corridorCell = (x: number, z: number): boolean => {
  const mainCorridor = Math.abs(z) <= MINESHAFT_LAYOUT.corridorHalfWidth
    && Math.abs(x) <= MINESHAFT_LAYOUT.branchHalfExtent
  const branchCorridor = MINESHAFT_LAYOUT.branchOffsets.some((branchX) =>
    Math.abs(x - branchX) <= MINESHAFT_LAYOUT.corridorHalfWidth
    && Math.abs(z) <= MINESHAFT_LAYOUT.branchHalfExtent,
  )
  return mainCorridor || branchCorridor
}

type RelativeCell = readonly [number, number]

const MINESHAFT_CORRIDOR_CELLS: ReadonlyArray<RelativeCell> = (() => {
  const cells: Array<RelativeCell> = []
  const extent = MINESHAFT_LAYOUT.branchHalfExtent
  for (let x = -extent; x <= extent; x += UNIT_STEP) {
    for (let z = -extent; z <= extent; z += UNIT_STEP) {
      if (corridorCell(x, z)) {cells.push(Object.freeze([x, z]))}
    }
  }
  return Object.freeze(cells)
})()

const carveCorridors = (
  blocks: Map<string, NaturalStructureBlockPlacement>,
  candidate: MineshaftCandidate,
  baseY: number,
): void => {
  for (const [x, z] of MINESHAFT_CORRIDOR_CELLS) {
    addBlock(blocks, MINESHAFT_BLOCK.OAK_PLANKS, candidate.x + x, baseY, candidate.z + z)
    for (let y = baseY + UNIT_STEP; y < baseY + MINESHAFT_LAYOUT.frameHeight - UNIT_STEP; y += UNIT_STEP) {
      addBlock(blocks, MINESHAFT_BLOCK.AIR, candidate.x + x, y, candidate.z + z)
    }
  }
}

const translateBlock = (
  placement: NaturalStructureBlockPlacement,
  candidate: MineshaftCandidate,
  baseY: number,
): NaturalStructureBlockPlacement => Object.freeze({
  block: placement.block,
  x: candidate.x + placement.x,
  y: baseY + placement.y,
  z: candidate.z + placement.z,
})

const translateMarker = (
  marker: NaturalStructureMarker,
  candidate: MineshaftCandidate,
  baseY: number,
): NaturalStructureMarker => Object.freeze({
  ...marker,
  x: candidate.x + marker.x,
  y: baseY + marker.y,
  z: candidate.z + marker.z,
})

const addSupportFrame = (
  blocks: Map<string, NaturalStructureBlockPlacement>,
  candidate: MineshaftCandidate,
  baseY: number,
  centerX: number,
  centerZ: number,
): void => {
  const topY = baseY + MINESHAFT_LAYOUT.frameHeight - UNIT_STEP
  for (let y = baseY + UNIT_STEP; y <= topY; y += UNIT_STEP) {
    addBlock(blocks, MINESHAFT_BLOCK.OAK_LOG, candidate.x + centerX - MINESHAFT_LAYOUT.frameHalfWidth, y, candidate.z + centerZ)
    addBlock(blocks, MINESHAFT_BLOCK.OAK_LOG, candidate.x + centerX + MINESHAFT_LAYOUT.frameHalfWidth, y, candidate.z + centerZ)
  }
  for (let x = -MINESHAFT_LAYOUT.frameHalfWidth; x <= MINESHAFT_LAYOUT.frameHalfWidth; x += UNIT_STEP) {
    addBlock(blocks, MINESHAFT_BLOCK.OAK_LOG, candidate.x + centerX + x, topY, candidate.z + centerZ)
  }
}

const addSupportFrames = (
  blocks: Map<string, NaturalStructureBlockPlacement>,
  candidate: MineshaftCandidate,
  baseY: number,
): void => {
  const extent = MINESHAFT_LAYOUT.branchHalfExtent
  for (let offset = -extent; offset <= extent; offset += MINESHAFT_LAYOUT.supportSpacing) {
    addSupportFrame(blocks, candidate, baseY, offset, ZERO_OFFSET)
  }
  for (const branchX of MINESHAFT_LAYOUT.branchOffsets) {
    for (let offset = -extent; offset <= extent; offset += MINESHAFT_LAYOUT.supportSpacing) {
      addSupportFrame(blocks, candidate, baseY, branchX, offset)
    }
  }
}

const addRails = (
  blocks: Map<string, NaturalStructureBlockPlacement>,
  candidate: MineshaftCandidate,
  baseY: number,
): void => {
  const extent = MINESHAFT_LAYOUT.branchHalfExtent
  const railY = baseY + RAIL_Y_OFFSET
  for (let x = -extent; x <= extent; x += UNIT_STEP) {
    addBlock(blocks, MINESHAFT_BLOCK.RAIL, candidate.x + x, railY, candidate.z)
  }
  for (const branchX of MINESHAFT_LAYOUT.branchOffsets) {
    for (let z = -extent; z <= extent; z += UNIT_STEP) {
      addBlock(blocks, MINESHAFT_BLOCK.RAIL, candidate.x + branchX, railY, candidate.z + z)
    }
  }
  addBlock(blocks, MINESHAFT_BLOCK.POWERED_RAIL, candidate.x + extent - UNIT_STEP, railY, candidate.z)
}

const addDecorationsAndLoot = (
  blocks: Map<string, NaturalStructureBlockPlacement>,
  markers: Array<NaturalStructureMarker>,
  candidate: MineshaftCandidate,
  baseY: number,
): void => {
  const lootX = candidate.x + MINESHAFT_LAYOUT.lootBranchOffset
  const lootY = baseY + RAIL_Y_OFFSET
  const lootZ = candidate.z + MINESHAFT_LAYOUT.lootOffsetZ
  addBlock(blocks, MINESHAFT_BLOCK.CHEST, lootX, lootY, lootZ)
  addMarker(markers, { kind: 'loot-chest', lootTable: 'mineshaft', x: lootX, y: lootY, z: lootZ })
  addBlock(blocks, MINESHAFT_BLOCK.COBWEB, candidate.x + MINESHAFT_LAYOUT.lootBranchOffset, baseY + TORCH_Y_OFFSET, candidate.z + COBWEB_Z_OFFSET)
  addBlock(blocks, MINESHAFT_BLOCK.TORCH, candidate.x, baseY + TORCH_Y_OFFSET, candidate.z - MINESHAFT_LAYOUT.corridorHalfWidth)
}

type MineshaftPlanBuffers = {
  readonly blocks: Map<string, NaturalStructureBlockPlacement>
  readonly markers: Array<NaturalStructureMarker>
}

const buildMineshaftPlan = (
  candidate: MineshaftCandidate,
  baseY: number,
): MineshaftPlanBuffers => {
  const blocks = new Map<string, NaturalStructureBlockPlacement>()
  const markers: Array<NaturalStructureMarker> = []
  carveCorridors(blocks, candidate, baseY)
  addSupportFrames(blocks, candidate, baseY)
  addRails(blocks, candidate, baseY)
  addDecorationsAndLoot(blocks, markers, candidate, baseY)
  return { blocks, markers }
}

type MineshaftRelativePlan = {
  readonly blocks: ReadonlyArray<NaturalStructureBlockPlacement>
  readonly markers: ReadonlyArray<NaturalStructureMarker>
}

const mineshaftRelativePlan: MineshaftRelativePlan = (() => {
  const plan = buildMineshaftPlan({ x: ZERO_OFFSET, z: ZERO_OFFSET }, ZERO_OFFSET)
  return Object.freeze({
    blocks: Object.freeze([...plan.blocks.values()]),
    markers: Object.freeze(plan.markers),
  })
})()

/** Plans a deterministic, underground mineshaft network from registry-backed blocks. */
export const planMineshaftForCandidate = (
  candidate: MineshaftCandidate,
  sampleTerrain: OverworldTerrainSampler,
): Option.Option<MineshaftDraft> => {
  const probes = terrainProbesFor(candidate, sampleTerrain)
  const baseYOption = baseYForProbes(probes)
  if (Option.isNone(baseYOption)) {return Option.none()}
  const blocks = Object.freeze(mineshaftRelativePlan.blocks.map((placement) =>
    translateBlock(placement, candidate, baseYOption.value),
  ))
  const markers = Object.freeze(mineshaftRelativePlan.markers.map((marker) =>
    translateMarker(marker, candidate, baseYOption.value),
  ))
  return Option.some(Object.freeze({
    blocks,
    markers,
    origin: Object.freeze({ x: candidate.x, y: baseYOption.value, z: candidate.z }),
  }))
}
