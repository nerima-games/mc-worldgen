import {
  COMPACT_STRUCTURE_BLOCK,
  COMPACT_STRUCTURE_DESCRIPTORS,
  type CompactStructureKind,
} from './compact-structure-data.js'
import type {
  NaturalStructureBlockPlacement,
  NaturalStructureMarker,
  NaturalStructurePosition,
} from './natural-structure.js'
import type { BlockId } from '@nerima-games/mc-kernel'
import { Option } from 'effect'
import type { OverworldTerrainSampler } from './structure-siting.js'

type CompactStructureCandidate = Readonly<{
  x: number
  z: number
}>

export type CompactStructureDraft = Readonly<{
  origin: NaturalStructurePosition
  blocks: ReadonlyArray<NaturalStructureBlockPlacement>
  markers: ReadonlyArray<NaturalStructureMarker>
}>

const PROBE_OFFSETS = Object.freeze([
  { x: 0, z: 0 },
  { x: 6, z: 0 },
  { x: -6, z: 0 },
  { x: 0, z: 6 },
  { x: 0, z: -6 },
])

const MAX_SURFACE_VARIATION = 6
const ORIGIN_SAMPLE_INDEX = 0
const CHEST_HEIGHT_OFFSET = 1
const FOUNDATION_LEVEL = 0
const STRUCTURE_STEP = 1

const blockKey = (x: number, y: number, z: number): string => `${x},${y},${z}`

const isBoundary = (dx: number, dz: number, radius: number): boolean =>
  Math.abs(dx) === radius || Math.abs(dz) === radius

const structureBlockAt = (
  kind: CompactStructureKind,
  dx: number,
  dy: number,
  dz: number,
): Option.Option<BlockId> => {
  const descriptor = COMPACT_STRUCTURE_DESCRIPTORS[kind]
  if (dy === FOUNDATION_LEVEL) {
    return Option.some(descriptor.foundation)
  }
  if (isBoundary(dx, dz, descriptor.radius)) {
    return Option.some(descriptor.wall)
  }
  if (dy === descriptor.height) {
    return Option.some(descriptor.roof)
  }
  return Option.none()
}

const siteIsValid = (
  kind: CompactStructureKind,
  samples: ReadonlyArray<ReturnType<OverworldTerrainSampler>>,
): boolean => {
  const descriptor = COMPACT_STRUCTURE_DESCRIPTORS[kind]
  if (
    samples.some(
      (sample) =>
        !descriptor.allowedBiomes.includes(sample.biome) ||
        sample.surfaceY <= sample.seaLevel + descriptor.minSurfaceDelta,
    )
  ) {
    return false
  }
  const heights = samples.map((sample) => sample.surfaceY)
  const highest = Math.max(...heights)
  const lowest = Math.min(...heights)
  return highest - lowest <= MAX_SURFACE_VARIATION
}

const addBlock = (
  blocks: Map<string, NaturalStructureBlockPlacement>,
  x: number,
  y: number,
  z: number,
  block: BlockId,
): void => {
  blocks.set(blockKey(x, y, z), { block, x, y, z })
}

const structureBlocksForCandidate = (
  kind: CompactStructureKind,
  candidate: CompactStructureCandidate,
  baseY: number,
): Map<string, NaturalStructureBlockPlacement> => {
  const descriptor = COMPACT_STRUCTURE_DESCRIPTORS[kind]
  const blocks = new Map<string, NaturalStructureBlockPlacement>()
  for (let dy = 0; dy <= descriptor.height; dy += STRUCTURE_STEP) {
    for (let dx = -descriptor.radius; dx <= descriptor.radius; dx += STRUCTURE_STEP) {
      for (let dz = -descriptor.radius; dz <= descriptor.radius; dz += STRUCTURE_STEP) {
        const blockOption = structureBlockAt(kind, dx, dy, dz)
        if (Option.isSome(blockOption)) {
          addBlock(blocks, candidate.x + dx, baseY + dy, candidate.z + dz, blockOption.value)
        }
      }
    }
  }
  return blocks
}

const addLootChest = (
  blocks: Map<string, NaturalStructureBlockPlacement>,
  kind: CompactStructureKind,
  candidate: CompactStructureCandidate,
  baseY: number,
): NaturalStructureMarker => {
  const chestY = baseY + CHEST_HEIGHT_OFFSET
  addBlock(blocks, candidate.x, chestY, candidate.z, COMPACT_STRUCTURE_BLOCK.CHEST)
  return Object.freeze({
    kind: 'loot-chest',
    lootTable: kind,
    x: candidate.x,
    y: chestY,
    z: candidate.z,
  })
}

export const planCompactStructureForCandidate = (
  kind: CompactStructureKind,
  candidate: CompactStructureCandidate,
  sampleTerrain: OverworldTerrainSampler,
): Option.Option<CompactStructureDraft> => {
  const samples = PROBE_OFFSETS.map((offset) =>
    sampleTerrain(candidate.x + offset.x, candidate.z + offset.z),
  ) as [ReturnType<OverworldTerrainSampler>, ...ReturnType<OverworldTerrainSampler>[]]
  if (!siteIsValid(kind, samples)) {
    return Option.none()
  }

  const descriptor = COMPACT_STRUCTURE_DESCRIPTORS[kind]
  const baseY = samples[ORIGIN_SAMPLE_INDEX].surfaceY + descriptor.baseOffset
  const blocks = structureBlocksForCandidate(kind, candidate, baseY)
  const marker = addLootChest(blocks, kind, candidate, baseY)
  const origin = Object.freeze({ x: candidate.x, y: baseY, z: candidate.z })
  return Option.some(
    Object.freeze({
      blocks: Object.freeze([...blocks.values()]),
      markers: Object.freeze([marker]),
      origin,
    }),
  )
}
