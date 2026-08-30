/** Deterministic End spikes, crystals, and their chunk-local projections. */
import {
  type BlockId,
  type BlockPosition,
  type ChunkCoord,
  blockIdOf,
  blockPosition,
} from '@nerima-games/mc-kernel'
import { CHUNK_HEIGHT, CHUNK_SIZE_XZ } from './constants.js'
import { NoiseSeed, channelSeed, mulberry32 } from '@nerima-games/mc-noise'
import type { NaturalStructureChunk } from './natural-structure.js'
import { setBlockAt } from './chunk.js'

const END_SPIKE_COUNT = 10
const END_SPIKE_DISTANCE = 42
const END_SPIKE_MIN_RADIUS = 2
const END_SPIKE_RADIUS_VARIATION = 3
const END_SPIKE_MIN_HEIGHT = 76
const END_SPIKE_HEIGHT_VARIATION = 3
const END_SPIKE_GUARD_CHANCE = 3
const SPIKE_ANGLE_TURNS = 2
const CRYSTAL_Y_OFFSET = 1
const CAGE_RADIUS = 2
const CAGE_MIN_Y_OFFSET = 1
const CAGE_MAX_Y_OFFSET = 3
const ZERO = 0
const ONE = 1

export const END_FEATURE_BLOCK: Readonly<Record<'CRYSTAL' | 'OBSIDIAN', BlockId>> = Object.freeze({
  CRYSTAL: blockIdOf('end_crystal'),
  OBSIDIAN: blockIdOf('obsidian'),
})

export type EndSpike = {
  readonly centerX: number
  readonly centerZ: number
  readonly radius: number
  readonly height: number
  readonly guarded: boolean
}

export type EndFeaturePlan = {
  readonly id: string
  readonly dimension: 'end'
  readonly crystalInvulnerable: boolean
  readonly spikes: ReadonlyArray<EndSpike>
}

type EndCrystalMarker = {
  readonly kind: 'end-crystal'
  readonly featureId: string
  readonly at: BlockPosition
  readonly block: BlockId
  readonly invulnerable: boolean
}

type EndCrystalCageMarker = {
  readonly kind: 'end-crystal-cage'
  readonly featureId: string
  readonly center: BlockPosition
  readonly radius: number
  readonly minY: number
  readonly maxY: number
  readonly material: 'iron_bars'
}

export type EndFeatureMarker = EndCrystalMarker | EndCrystalCageMarker

export type EndFeatureChunk = NaturalStructureChunk & {
  readonly endFeatureIds: ReadonlyArray<string>
  readonly endFeatureMarkers: ReadonlyArray<EndFeatureMarker>
}

const randomInt = (random: () => number, exclusiveUpperBound: number): number =>
  Math.floor(random() * exclusiveUpperBound)

const spikeForIndex = (random: () => number, index: number): EndSpike => {
  const angle = SPIKE_ANGLE_TURNS * (-Math.PI + Math.PI * index / END_SPIKE_COUNT)

  return Object.freeze({
    centerX: Math.floor(END_SPIKE_DISTANCE * Math.cos(angle)),
    centerZ: Math.floor(END_SPIKE_DISTANCE * Math.sin(angle)),
    guarded: randomInt(random, END_SPIKE_GUARD_CHANCE) === ZERO,
    height: END_SPIKE_MIN_HEIGHT + randomInt(random, END_SPIKE_HEIGHT_VARIATION),
    radius: END_SPIKE_MIN_RADIUS + randomInt(random, END_SPIKE_RADIUS_VARIATION),
  })
}

const shuffledSpikes = (spikes: ReadonlyArray<EndSpike>, random: () => number): ReadonlyArray<EndSpike> => {
  const result = [...spikes]

  for (let index = result.length - ONE; index > ZERO; index -= ONE) {
    const swapIndex = randomInt(random, index + ONE)
    const current = result[index] as EndSpike
    result[index] = result[swapIndex] as EndSpike
    result[swapIndex] = current
  }

  return Object.freeze(result)
}

/** Build the ten deterministic vanilla-shaped End spike definitions for a seed. */
export const endFeaturePlanForSeed = (seed: number): EndFeaturePlan => {
  const random = mulberry32(NoiseSeed(channelSeed(seed, 'end-spikes')))
  const spikes = Array.from({ length: END_SPIKE_COUNT }, (_value, index) => spikeForIndex(random, index))

  return Object.freeze({
    crystalInvulnerable: true,
    dimension: 'end' as const,
    id: `end-spikes:${String(seed)}`,
    spikes: shuffledSpikes(spikes, random),
  })
}

const spikeTouchesChunk = (spike: EndSpike, coord: ChunkCoord): boolean => {
  const chunkMinX = coord.cx * CHUNK_SIZE_XZ
  const chunkMaxX = chunkMinX + CHUNK_SIZE_XZ - ONE
  const chunkMinZ = coord.cz * CHUNK_SIZE_XZ
  const chunkMaxZ = chunkMinZ + CHUNK_SIZE_XZ - ONE

  return spike.centerX + spike.radius >= chunkMinX &&
    spike.centerX - spike.radius <= chunkMaxX &&
    spike.centerZ + spike.radius >= chunkMinZ &&
    spike.centerZ - spike.radius <= chunkMaxZ
}

type SpikeChunkBounds = {
  readonly minLocalX: number
  readonly maxLocalX: number
  readonly minLocalZ: number
  readonly maxLocalZ: number
}

const spikeChunkBounds = (spike: EndSpike, coord: ChunkCoord): SpikeChunkBounds => {
  const originX = coord.cx * CHUNK_SIZE_XZ
  const originZ = coord.cz * CHUNK_SIZE_XZ

  return {
    maxLocalX: Math.min(CHUNK_SIZE_XZ - ONE, spike.centerX + spike.radius - originX),
    maxLocalZ: Math.min(CHUNK_SIZE_XZ - ONE, spike.centerZ + spike.radius - originZ),
    minLocalX: Math.max(ZERO, spike.centerX - spike.radius - originX),
    minLocalZ: Math.max(ZERO, spike.centerZ - spike.radius - originZ),
  }
}

const fillSpikeColumn = (blocks: Uint8Array, spike: EndSpike, localX: number, localZ: number): void => {
  for (let y = ZERO; y < CHUNK_HEIGHT && y <= spike.height; y += ONE) {
    setBlockAt(blocks, localX, y, localZ, END_FEATURE_BLOCK.OBSIDIAN)
  }
}

const spikeContains = (spike: EndSpike, worldX: number, worldZ: number): boolean => {
  const distanceX = worldX - spike.centerX
  const distanceZ = worldZ - spike.centerZ

  return distanceX * distanceX + distanceZ * distanceZ <= spike.radius * spike.radius
}

const applySpikeBlocks = (blocks: Uint8Array, spike: EndSpike, coord: ChunkCoord): void => {
  const originX = coord.cx * CHUNK_SIZE_XZ
  const originZ = coord.cz * CHUNK_SIZE_XZ
  const bounds = spikeChunkBounds(spike, coord)

  for (let localX = bounds.minLocalX; localX <= bounds.maxLocalX; localX += ONE) {
    for (let localZ = bounds.minLocalZ; localZ <= bounds.maxLocalZ; localZ += ONE) {
      const worldX = originX + localX
      const worldZ = originZ + localZ

      if (spikeContains(spike, worldX, worldZ)) {
        fillSpikeColumn(blocks, spike, localX, localZ)
      }
    }
  }
}

const markersForSpike = (plan: EndFeaturePlan, spike: EndSpike): Array<EndFeatureMarker> => {
  const crystal = blockPosition(spike.centerX, spike.height + CRYSTAL_Y_OFFSET, spike.centerZ)
  const markers: Array<EndFeatureMarker> = [Object.freeze({
    at: crystal,
    block: END_FEATURE_BLOCK.CRYSTAL,
    featureId: plan.id,
    invulnerable: plan.crystalInvulnerable,
    kind: 'end-crystal' as const,
  })]

  if (spike.guarded) {
    markers.push(Object.freeze({
      center: crystal,
      featureId: plan.id,
      kind: 'end-crystal-cage',
      material: 'iron_bars',
      maxY: Math.min(CHUNK_HEIGHT - ONE, spike.height + CAGE_MAX_Y_OFFSET),
      minY: Math.max(ZERO, spike.height - CAGE_MIN_Y_OFFSET),
      radius: CAGE_RADIUS,
    }))
  }

  return markers
}

const stablePlans = (plans: ReadonlyArray<EndFeaturePlan>): ReadonlyArray<EndFeaturePlan> => {
  const deduplicated = new Map(plans.map((plan) => [plan.id, plan]))
  return Object.freeze([...deduplicated.values()].sort((left, right) => left.id.localeCompare(right.id)))
}

type AppliedEndFeaturePlan = {
  readonly touched: boolean
  readonly markers: ReadonlyArray<EndFeatureMarker>
}

const applyPlanToChunk = (
  blocks: Uint8Array,
  plan: EndFeaturePlan,
  coord: ChunkCoord,
): AppliedEndFeaturePlan => {
  const markers: Array<EndFeatureMarker> = []
  let touched = false

  for (const spike of plan.spikes) {
    if (spikeTouchesChunk(spike, coord)) {
      touched = true
      applySpikeBlocks(blocks, spike, coord)

      if (
        Math.floor(spike.centerX / CHUNK_SIZE_XZ) === coord.cx &&
        Math.floor(spike.centerZ / CHUNK_SIZE_XZ) === coord.cz
      ) {
        markers.push(...markersForSpike(plan, spike))
      }
    }
  }

  return { markers: Object.freeze(markers), touched }
}

/** Apply the chunk-local obsidian pillars and center-owned crystal markers. */
export const applyEndFeaturePlansToChunk = (
  chunk: NaturalStructureChunk,
  plans: ReadonlyArray<EndFeaturePlan>,
): EndFeatureChunk => {
  const blocks = chunk.blocks.slice()
  const endFeatureIds: Array<string> = []
  const endFeatureMarkers: Array<EndFeatureMarker> = []

  for (const plan of stablePlans(plans)) {
    const applied = applyPlanToChunk(blocks, plan, chunk.coord)

    if (applied.touched) {
      endFeatureIds.push(plan.id)
      endFeatureMarkers.push(...applied.markers)
    }
  }

  return Object.freeze({
    ...chunk,
    blocks,
    endFeatureIds: Object.freeze(endFeatureIds),
    endFeatureMarkers: Object.freeze(endFeatureMarkers),
  })
}
