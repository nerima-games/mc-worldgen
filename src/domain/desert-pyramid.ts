import type {
  NaturalStructureBlockPlacement,
  NaturalStructureMarker,
  NaturalStructurePosition,
} from './natural-structure.js'
import { type BlockId } from '@nerima-games/mc-kernel'
import { DESERT_PYRAMID_LAYOUT } from './desert-pyramid-data.js'
import { NATURAL_STRUCTURE_BLOCK } from './natural-structure-data.js'
import { Option } from 'effect'
import type { OverworldTerrainSampler } from './structure-siting.js'

type DesertPyramidCandidate = { readonly x: number; readonly z: number }

export type DesertPyramidDraft = {
  readonly origin: NaturalStructurePosition
  readonly blocks: ReadonlyArray<NaturalStructureBlockPlacement>
  readonly markers: ReadonlyArray<NaturalStructureMarker>
}

const UNIT_STEP = 1
const FIRST_LEVEL = 0
const PYRAMID_GROUND_PROBE_OFFSET = DESERT_PYRAMID_LAYOUT.baseHalfExtent

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

const terrainFits = (
  candidate: DesertPyramidCandidate,
  sampleTerrain: OverworldTerrainSampler,
): Option.Option<number> => {
  const probes = [
    sampleTerrain(candidate.x, candidate.z),
    sampleTerrain(candidate.x - PYRAMID_GROUND_PROBE_OFFSET, candidate.z),
    sampleTerrain(candidate.x + PYRAMID_GROUND_PROBE_OFFSET, candidate.z),
    sampleTerrain(candidate.x, candidate.z - PYRAMID_GROUND_PROBE_OFFSET),
    sampleTerrain(candidate.x, candidate.z + PYRAMID_GROUND_PROBE_OFFSET),
  ]
  if (probes.some((probe) => probe.biome !== 'DESERT' || probe.surfaceY <= probe.seaLevel + DESERT_PYRAMID_LAYOUT.minDryClearance)) {
    return Option.none()
  }
  const surfaces = probes.map((probe) => probe.surfaceY)
  const minimumSurfaceY = Math.min(...surfaces)
  const maximumSurfaceY = Math.max(...surfaces)
  if (maximumSurfaceY - minimumSurfaceY > DESERT_PYRAMID_LAYOUT.maxSurfaceVariation) {
    return Option.none()
  }
  return Option.some(maximumSurfaceY + DESERT_PYRAMID_LAYOUT.baseYClearance)
}

const isPyramidBoundary = (x: number, z: number, halfExtent: number): boolean =>
  Math.abs(x) === halfExtent || Math.abs(z) === halfExtent

const addPyramid = (
  blocks: Map<string, NaturalStructureBlockPlacement>,
  candidate: DesertPyramidCandidate,
  baseY: number,
): void => {
  for (let level = FIRST_LEVEL; level < DESERT_PYRAMID_LAYOUT.levelCount; level += UNIT_STEP) {
    const halfExtent = DESERT_PYRAMID_LAYOUT.baseHalfExtent - level * DESERT_PYRAMID_LAYOUT.levelInset
    const y = baseY + level
    for (let dx = -halfExtent; dx <= halfExtent; dx += UNIT_STEP) {
      for (let dz = -halfExtent; dz <= halfExtent; dz += UNIT_STEP) {
        if (level === FIRST_LEVEL || isPyramidBoundary(dx, dz, halfExtent)) {
          addBlock(blocks, NATURAL_STRUCTURE_BLOCK.SANDSTONE, candidate.x + dx, y, candidate.z + dz)
        }
      }
    }
  }
}

const addChamberShell = (
  blocks: Map<string, NaturalStructureBlockPlacement>,
  candidate: DesertPyramidCandidate,
  floorY: number,
): void => {
  const chamberTopY = floorY + DESERT_PYRAMID_LAYOUT.chamberFloorYOffset - UNIT_STEP
  for (let y = floorY; y <= chamberTopY; y += UNIT_STEP) {
    for (let dx = -DESERT_PYRAMID_LAYOUT.chamberHalfExtent; dx <= DESERT_PYRAMID_LAYOUT.chamberHalfExtent; dx += UNIT_STEP) {
      for (let dz = -DESERT_PYRAMID_LAYOUT.chamberHalfExtent; dz <= DESERT_PYRAMID_LAYOUT.chamberHalfExtent; dz += UNIT_STEP) {
        if (y === floorY || y === chamberTopY || isPyramidBoundary(dx, dz, DESERT_PYRAMID_LAYOUT.chamberHalfExtent)) {
          addBlock(blocks, NATURAL_STRUCTURE_BLOCK.SANDSTONE, candidate.x + dx, y, candidate.z + dz)
        }
      }
    }
  }
}

const addChamberTnt = (
  blocks: Map<string, NaturalStructureBlockPlacement>,
  candidate: DesertPyramidCandidate,
  tntY: number,
): void => {
  for (let dx = -DESERT_PYRAMID_LAYOUT.tntHalfExtent; dx <= DESERT_PYRAMID_LAYOUT.tntHalfExtent; dx += UNIT_STEP) {
    for (let dz = -DESERT_PYRAMID_LAYOUT.tntHalfExtent; dz <= DESERT_PYRAMID_LAYOUT.tntHalfExtent; dz += UNIT_STEP) {
      addBlock(blocks, NATURAL_STRUCTURE_BLOCK.TNT, candidate.x + dx, tntY, candidate.z + dz)
    }
  }
}

const addChamberChests = (
  blocks: Map<string, NaturalStructureBlockPlacement>,
  markers: Array<NaturalStructureMarker>,
  candidate: DesertPyramidCandidate,
  chestY: number,
): void => {
  for (const dx of [-DESERT_PYRAMID_LAYOUT.chestOffset, DESERT_PYRAMID_LAYOUT.chestOffset]) {
    for (const dz of [-DESERT_PYRAMID_LAYOUT.chestOffset, DESERT_PYRAMID_LAYOUT.chestOffset]) {
      const x = candidate.x + dx
      const z = candidate.z + dz
      addBlock(blocks, NATURAL_STRUCTURE_BLOCK.CHEST, x, chestY, z)
      addMarker(markers, { kind: 'loot-chest', lootTable: 'desert-pyramid', x, y: chestY, z })
    }
  }
}

const addChamber = (
  blocks: Map<string, NaturalStructureBlockPlacement>,
  markers: Array<NaturalStructureMarker>,
  candidate: DesertPyramidCandidate,
  baseY: number,
): void => {
  const floorY = baseY - DESERT_PYRAMID_LAYOUT.chamberFloorYOffset
  addChamberShell(blocks, candidate, floorY)
  const tntY = floorY + UNIT_STEP
  addChamberTnt(blocks, candidate, tntY)
  const chestY = floorY + DESERT_PYRAMID_LAYOUT.tntHalfExtent + UNIT_STEP
  addChamberChests(blocks, markers, candidate, chestY)
}

/** Plans the supported sandstone desert-pyramid geometry on a dry, level desert site. */
export const planDesertPyramidForCandidate = (
  candidate: DesertPyramidCandidate,
  sampleTerrain: OverworldTerrainSampler,
): Option.Option<DesertPyramidDraft> => {
  const baseYOption = terrainFits(candidate, sampleTerrain)
  if (Option.isNone(baseYOption)) {return Option.none()}
  const blocks = new Map<string, NaturalStructureBlockPlacement>()
  const markers: Array<NaturalStructureMarker> = []
  addPyramid(blocks, candidate, baseYOption.value)
  addChamber(blocks, markers, candidate, baseYOption.value)
  return Option.some(Object.freeze({
    blocks: Object.freeze([...blocks.values()]),
    markers: Object.freeze(markers),
    origin: Object.freeze({ x: candidate.x, y: baseYOption.value, z: candidate.z }),
  }))
}
