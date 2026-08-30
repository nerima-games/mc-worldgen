import { DESERT_WELL_BLOCK, DESERT_WELL_LAYOUT } from './desert-well-data.js'
import type {
  NaturalStructureBlockPlacement,
  NaturalStructurePosition,
} from './natural-structure.js'
import type { OverworldTerrainSample, OverworldTerrainSampler } from './structure-siting.js'
import type { BlockId } from '@nerima-games/mc-kernel'
import { CHUNK_HEIGHT } from './constants.js'
import { Option } from 'effect'

type DesertWellCandidate = { readonly x: number; readonly z: number }

export type DesertWellDraft = {
  readonly origin: NaturalStructurePosition
  readonly blocks: ReadonlyArray<NaturalStructureBlockPlacement>
  readonly markers: readonly []
}

const UNIT_STEP = 1
const MIN_WORLD_Y = 0
const CENTER_OFFSET = 0

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

const terrainProbesFor = (
  candidate: DesertWellCandidate,
  sampleTerrain: OverworldTerrainSampler,
): ReadonlyArray<OverworldTerrainSample> => {
  const probeExtent = DESERT_WELL_LAYOUT.baseHalfExtent
  return [
    sampleTerrain(candidate.x, candidate.z),
    sampleTerrain(candidate.x - probeExtent, candidate.z),
    sampleTerrain(candidate.x + probeExtent, candidate.z),
    sampleTerrain(candidate.x, candidate.z - probeExtent),
    sampleTerrain(candidate.x, candidate.z + probeExtent),
  ]
}

const probesAreSuitable = (probes: ReadonlyArray<OverworldTerrainSample>): boolean =>
  !probes.some((probe) => probe.biome !== 'DESERT' || probe.surfaceY <= probe.seaLevel + DESERT_WELL_LAYOUT.minDryClearance)

const surfaceBoundsFor = (probes: ReadonlyArray<OverworldTerrainSample>): { readonly minimum: number; readonly maximum: number } => {
  const surfaces = probes.map((probe) => probe.surfaceY)
  return Object.freeze({ maximum: Math.max(...surfaces), minimum: Math.min(...surfaces) })
}

const baseYForProbes = (probes: ReadonlyArray<OverworldTerrainSample>): Option.Option<number> => {
  const { minimum: minimumSurfaceY, maximum: maximumSurfaceY } = surfaceBoundsFor(probes)
  if (maximumSurfaceY - minimumSurfaceY > DESERT_WELL_LAYOUT.maxSurfaceVariation) {return Option.none()}

  const baseY = maximumSurfaceY + DESERT_WELL_LAYOUT.baseYClearance
  const roofY = baseY + DESERT_WELL_LAYOUT.roofOffsetY
  if (baseY < MIN_WORLD_Y || roofY >= CHUNK_HEIGHT) {
    return Option.none()
  }
  return Option.some(baseY)
}

const terrainFits = (
  candidate: DesertWellCandidate,
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

const addFoundation = (
  blocks: Map<string, NaturalStructureBlockPlacement>,
  candidate: DesertWellCandidate,
  baseY: number,
): void => {
  for (let dx = -DESERT_WELL_LAYOUT.baseHalfExtent; dx <= DESERT_WELL_LAYOUT.baseHalfExtent; dx += UNIT_STEP) {
    for (let dz = -DESERT_WELL_LAYOUT.baseHalfExtent; dz <= DESERT_WELL_LAYOUT.baseHalfExtent; dz += UNIT_STEP) {
      addBlock(blocks, DESERT_WELL_BLOCK.SANDSTONE, candidate.x + dx, baseY, candidate.z + dz)
    }
  }
}

const addWater = (
  blocks: Map<string, NaturalStructureBlockPlacement>,
  candidate: DesertWellCandidate,
  baseY: number,
): void => {
  for (let dx = -DESERT_WELL_LAYOUT.waterHalfExtent; dx <= DESERT_WELL_LAYOUT.waterHalfExtent; dx += UNIT_STEP) {
    for (let dz = -DESERT_WELL_LAYOUT.waterHalfExtent; dz <= DESERT_WELL_LAYOUT.waterHalfExtent; dz += UNIT_STEP) {
      addBlock(blocks, DESERT_WELL_BLOCK.WATER, candidate.x + dx, baseY + UNIT_STEP, candidate.z + dz)
    }
  }
}

const addPillars = (
  blocks: Map<string, NaturalStructureBlockPlacement>,
  candidate: DesertWellCandidate,
  baseY: number,
): void => {
  const halfExtent = DESERT_WELL_LAYOUT.baseHalfExtent
  for (const dx of [-halfExtent, halfExtent]) {
    for (const dz of [-halfExtent, halfExtent]) {
      for (let offsetY = UNIT_STEP; offsetY <= DESERT_WELL_LAYOUT.pillarTopOffset; offsetY += UNIT_STEP) {
        addBlock(blocks, DESERT_WELL_BLOCK.SANDSTONE, candidate.x + dx, baseY + offsetY, candidate.z + dz)
      }
    }
  }
}

const addRoof = (
  blocks: Map<string, NaturalStructureBlockPlacement>,
  candidate: DesertWellCandidate,
  baseY: number,
): void => {
  const halfExtent = DESERT_WELL_LAYOUT.baseHalfExtent
  const roofY = baseY + DESERT_WELL_LAYOUT.roofOffsetY
  for (let dx = -halfExtent; dx <= halfExtent; dx += UNIT_STEP) {
    for (let dz = -halfExtent; dz <= halfExtent; dz += UNIT_STEP) {
      if (isBoundary(dx, dz, halfExtent) || (dx === CENTER_OFFSET && dz === CENTER_OFFSET)) {
        addBlock(blocks, DESERT_WELL_BLOCK.SANDSTONE, candidate.x + dx, roofY, candidate.z + dz)
      }
    }
  }
}

const buildWell = (
  blocks: Map<string, NaturalStructureBlockPlacement>,
  candidate: DesertWellCandidate,
  baseY: number,
): void => {
  addFoundation(blocks, candidate, baseY)
  addWater(blocks, candidate, baseY)
  addPillars(blocks, candidate, baseY)
  addRoof(blocks, candidate, baseY)
}

/** Plans registry-backed desert-well geometry on a dry, level desert site. */
export const planDesertWellForCandidate = (
  candidate: DesertWellCandidate,
  sampleTerrain: OverworldTerrainSampler,
): Option.Option<DesertWellDraft> => {
  const baseYOption = terrainFits(candidate, sampleTerrain)
  if (Option.isNone(baseYOption)) {
    return Option.none()
  }

  const blocks = new Map<string, NaturalStructureBlockPlacement>()
  buildWell(blocks, candidate, baseYOption.value)
  return Option.some(Object.freeze({
    blocks: Object.freeze([...blocks.values()]),
    markers: Object.freeze([] as const),
    origin: Object.freeze({ x: candidate.x, y: baseYOption.value, z: candidate.z }),
  }))
}
