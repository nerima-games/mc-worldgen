/** Deterministic chorus vegetation for End outer islands. */
import { AIR_BLOCK_ID, type BlockId, type ChunkCoord } from '@nerima-games/mc-kernel'
import { CHUNK_HEIGHT, CHUNK_SIZE_XZ, blockIndex } from './constants.js'
import { type Chunk, readBlock, setBlockAt } from './chunk.js'
import {
  END_CHORUS_BRANCH_CHANCE,
  END_CHORUS_BRANCH_DIRECTIONS,
  END_CHORUS_CANDIDATE_OFFSETS,
  END_CHORUS_HEIGHT_VARIATION,
  END_CHORUS_MIN_HEIGHT,
  END_CHORUS_PLACEMENT_CHANCE,
  END_VEGETATION_BLOCK,
} from './end-vegetation-data.js'
import { channelSeed, latticeValue } from '@nerima-games/mc-noise'

export { END_VEGETATION_BLOCK } from './end-vegetation-data.js'

const PLACEMENT_CHANNEL = 'end-chorus-placement'
const HEIGHT_CHANNEL = 'end-chorus-height'
const BRANCH_CHANNEL = 'end-chorus-branch'
const DIRECTION_CHANNEL = 'end-chorus-direction'
const MIN_Y = 0
const ONE = 1

export type EndSurfaceHeightAt = (seed: number, worldX: number, worldZ: number) => number | undefined
export type EndOuterIslandAt = (worldX: number, worldZ: number) => boolean

export type EndChorusPlanInput = {
  readonly seed: number
  readonly coord: ChunkCoord
  readonly isOuterIsland: EndOuterIslandAt
  readonly surfaceHeightAt: EndSurfaceHeightAt
}

export type EndChorusPlacement = {
  readonly block: BlockId
  readonly x: number
  readonly y: number
  readonly z: number
}

export type EndChorusPlant = {
  readonly baseX: number
  readonly baseY: number
  readonly baseZ: number
  readonly placements: ReadonlyArray<EndChorusPlacement>
}

export type EndChorusPlan = {
  readonly dimension: 'end'
  readonly id: string
  readonly plants: ReadonlyArray<EndChorusPlant>
}

const worldOrigin = (coord: ChunkCoord): readonly [number, number] => [
  coord.cx * CHUNK_SIZE_XZ,
  coord.cz * CHUNK_SIZE_XZ,
]

const validSurfaceY = (surfaceY: number): boolean =>
  Number.isInteger(surfaceY) &&
  surfaceY >= MIN_Y &&
  surfaceY < CHUNK_HEIGHT - END_CHORUS_MIN_HEIGHT - END_CHORUS_HEIGHT_VARIATION - ONE

const placement = (block: BlockId, x: number, y: number, z: number): EndChorusPlacement =>
  Object.freeze({ block, x, y, z })

type EndChorusSeed = ReturnType<typeof channelSeed>

type EndChorusSeeds = {
  readonly branch: EndChorusSeed
  readonly direction: EndChorusSeed
  readonly height: EndChorusSeed
  readonly placement: EndChorusSeed
}

type EndChorusStem = {
  readonly baseY: number
  readonly placements: Array<EndChorusPlacement>
  readonly stemTopY: number
}

const chorusSeedsFor = (seed: number): EndChorusSeeds => ({
  branch: channelSeed(seed, BRANCH_CHANNEL),
  direction: channelSeed(seed, DIRECTION_CHANNEL),
  height: channelSeed(seed, HEIGHT_CHANNEL),
  placement: channelSeed(seed, PLACEMENT_CHANNEL),
})

const stemForCandidate = (
  worldX: number,
  worldZ: number,
  surfaceY: number,
  heightSeed: EndChorusSeed,
): EndChorusStem => {
  const baseY = surfaceY + ONE
  const height = END_CHORUS_MIN_HEIGHT + Math.floor(
    latticeValue(heightSeed, worldX, worldZ) * END_CHORUS_HEIGHT_VARIATION,
  )
  const stemTopY = baseY + height - ONE
  const placements: Array<EndChorusPlacement> = []

  for (let y = baseY; y <= stemTopY; y += ONE) {
    placements.push(placement(END_VEGETATION_BLOCK.CHORUS_PLANT, worldX, y, worldZ))
  }
  placements.push(placement(END_VEGETATION_BLOCK.CHORUS_FLOWER, worldX, stemTopY + ONE, worldZ))

  return { baseY, placements, stemTopY }
}

const branchPlacements = (
  worldX: number,
  worldZ: number,
  stemTopY: number,
  branchSeed: EndChorusSeed,
  directionSeed: EndChorusSeed,
): ReadonlyArray<EndChorusPlacement> => {
  if (latticeValue(branchSeed, worldX, worldZ) >= END_CHORUS_BRANCH_CHANCE) {
    return []
  }

  const direction = END_CHORUS_BRANCH_DIRECTIONS[Math.floor(
    latticeValue(directionSeed, worldX, worldZ) * END_CHORUS_BRANCH_DIRECTIONS.length,
  )] as readonly [number, number]
  const [deltaX, deltaZ] = direction
  const branchX = worldX + deltaX
  const branchZ = worldZ + deltaZ

  return [
    placement(END_VEGETATION_BLOCK.CHORUS_PLANT, branchX, stemTopY, branchZ),
    placement(END_VEGETATION_BLOCK.CHORUS_FLOWER, branchX, stemTopY + ONE, branchZ),
  ]
}

const plantForCandidate = (
  input: EndChorusPlanInput,
  worldX: number,
  worldZ: number,
  seeds: EndChorusSeeds,
): EndChorusPlant | null => {
  if (!input.isOuterIsland(worldX, worldZ)) {
    return null
  }

  const surfaceY = input.surfaceHeightAt(input.seed, worldX, worldZ)
  if (typeof surfaceY !== 'number' || !validSurfaceY(surfaceY)) {
    return null
  }

  if (latticeValue(seeds.placement, worldX, worldZ) >= END_CHORUS_PLACEMENT_CHANCE) {
    return null
  }

  const stem = stemForCandidate(worldX, worldZ, surfaceY, seeds.height)
  const placements = [
    ...stem.placements,
    ...branchPlacements(worldX, worldZ, stem.stemTopY, seeds.branch, seeds.direction),
  ]

  return Object.freeze({
    baseX: worldX,
    baseY: stem.baseY,
    baseZ: worldZ,
    placements: Object.freeze(placements),
  })
}

const candidatePlants = (
  input: EndChorusPlanInput,
  seeds: EndChorusSeeds,
): Array<EndChorusPlant> => {
  const [originX, originZ] = worldOrigin(input.coord)
  const plants: Array<EndChorusPlant> = []

  for (const localX of END_CHORUS_CANDIDATE_OFFSETS) {
    for (const localZ of END_CHORUS_CANDIDATE_OFFSETS) {
      const plant = plantForCandidate(input, originX + localX, originZ + localZ, seeds)
      if (plant !== null) {
        plants.push(plant)
      }
    }
  }

  return plants
}

/** Build one immutable chorus plan from the owning chunk and terrain queries. */
export const endChorusPlanForChunk = (input: EndChorusPlanInput): EndChorusPlan =>
  Object.freeze({
    dimension: 'end' as const,
    id: `end-chorus:${String(input.seed)}:${String(input.coord.cx)}:${String(input.coord.cz)}`,
    plants: Object.freeze(candidatePlants(input, chorusSeedsFor(input.seed))),
  })

const stablePlans = (plans: ReadonlyArray<EndChorusPlan>): ReadonlyArray<EndChorusPlan> => {
  const deduplicated = new Map(plans.map((plan) => [plan.id, plan]))
  return Object.freeze([...deduplicated.values()].sort((left, right) => left.id.localeCompare(right.id)))
}

const isLocalCoordinate = (value: number): boolean => value >= MIN_Y && value < CHUNK_SIZE_XZ
const isLocalY = (value: number): boolean => value >= MIN_Y && value < CHUNK_HEIGHT

type LocalTarget = {
  readonly index: number
  readonly localX: number
  readonly localZ: number
}

const localTargetFor = (coord: ChunkCoord, target: EndChorusPlacement): LocalTarget | null => {
  const originX = coord.cx * CHUNK_SIZE_XZ
  const originZ = coord.cz * CHUNK_SIZE_XZ
  const localX = target.x - originX
  const localZ = target.z - originZ

  if (!isLocalCoordinate(localX) || !isLocalCoordinate(localZ) || !isLocalY(target.y)) {
    return null
  }

  return { index: blockIndex(localX, target.y, localZ), localX, localZ }
}

const plantCanBeApplied = (blocks: Uint16Array, coord: ChunkCoord, plant: EndChorusPlant): boolean => {
  const originX = coord.cx * CHUNK_SIZE_XZ
  const originZ = coord.cz * CHUNK_SIZE_XZ
  const baseX = plant.baseX - originX
  const baseZ = plant.baseZ - originZ

  return isLocalCoordinate(baseX) &&
    isLocalCoordinate(baseZ) &&
    isLocalY(plant.baseY) &&
    plant.baseY > MIN_Y &&
    readBlock(blocks, blockIndex(baseX, plant.baseY - ONE, baseZ)) === END_VEGETATION_BLOCK.END_STONE
}

const applyPlant = (blocks: Uint16Array, coord: ChunkCoord, plant: EndChorusPlant): void => {
  if (!plantCanBeApplied(blocks, coord, plant)) {
    return
  }

  for (const target of plant.placements) {
    const localTarget = localTargetFor(coord, target)
    if (localTarget !== null && readBlock(blocks, localTarget.index) === AIR_BLOCK_ID) {
      setBlockAt(blocks, localTarget.localX, target.y, localTarget.localZ, target.block)
    }
  }
}

const applyPlansToBlocks = (
  blocks: Uint16Array,
  coord: ChunkCoord,
  plans: ReadonlyArray<EndChorusPlan>,
): void => {
  for (const plan of stablePlans(plans)) {
    for (const plant of plan.plants) {
      applyPlant(blocks, coord, plant)
    }
  }
}

/** Apply chorus plans without mutating the source chunk or any plan. */
export const applyEndChorusPlansToChunk = (
  chunk: Chunk,
  plans: ReadonlyArray<EndChorusPlan>,
): Chunk => {
  const blocks = chunk.blocks.slice()
  applyPlansToBlocks(blocks, chunk.coord, plans)

  return { ...chunk, blocks }
}
