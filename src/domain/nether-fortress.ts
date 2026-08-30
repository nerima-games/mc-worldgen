/** Deterministic Nether fortress plans and fortress-proximity queries. */
import {
  FORTRESS_BLAZE_RADIUS,
  FORTRESS_FLOOR_Y,
  FORTRESS_LAYOUT,
  FORTRESS_MIN_HEADROOM,
  FORTRESS_REGION_SIZE,
  FORTRESS_REGION_SPAWN_PERMILLE,
  FORTRESS_SITE_MARGIN,
  NETHER_FORTRESS_BLOCK,
  NETHER_FORTRESS_GRID,
} from './nether-fortress-data.js'
import type {
  NaturalStructureBlockPlacement,
  NaturalStructureMarker,
  NaturalStructurePlan,
  NaturalStructurePosition,
  NaturalStructureRegion,
  NetherStructureTerrainSample,
  NetherStructureTerrainSampler,
} from './natural-structure.js'
import { Option, Predicate } from 'effect'
import { channelSeed, latticeValue } from '@nerima-games/mc-noise'
import { type BlockId } from '@nerima-games/mc-kernel'
import { CHUNK_HEIGHT } from './constants.js'

type FortressCandidate = NaturalStructurePosition
type MutableFortressPlan = {
  readonly blocks: Map<string, NaturalStructureBlockPlacement>
  readonly markers: Array<NaturalStructureMarker>
}

const WORLD_MIN_Y = 0
const PERMILLE_DENOMINATOR = 1000
const UNIT_STEP = 1
const ZERO_OFFSET = 0
const FORTRESS_WALL_OPENING_Y_OFFSET = 2
const FORTRESS_MARKER_OFFSET = 2
const FORTRESS_MAX_BLOCKS = 4096
const FORTRESS_MAX_MARKERS = 32

const keyOf = (position: NaturalStructurePosition): string =>
  `${String(position.x)},${String(position.y)},${String(position.z)}`

const positiveModulo = (value: number, divisor: number): number => ((value % divisor) + divisor) % divisor

const candidateForRegion = (
  seed: number,
  region: NaturalStructureRegion,
  presenceChannelSeed = channelSeed(seed, 'nether:nether-fortress:present'),
): Option.Option<FortressCandidate> => {
  const presence = latticeValue(presenceChannelSeed, region.x, region.z)
  if (presence >= FORTRESS_REGION_SPAWN_PERMILLE / PERMILLE_DENOMINATOR) {
    return Option.none()
  }
  const span = FORTRESS_REGION_SIZE - FORTRESS_SITE_MARGIN - FORTRESS_SITE_MARGIN
  return Option.some(Object.freeze({
    x: region.x * FORTRESS_REGION_SIZE + FORTRESS_SITE_MARGIN + Math.floor(
      latticeValue(channelSeed(seed, 'nether:nether-fortress:x'), region.x, region.z) * span,
    ),
    y: FORTRESS_FLOOR_Y,
    z: region.z * FORTRESS_REGION_SIZE + FORTRESS_SITE_MARGIN + Math.floor(
      latticeValue(channelSeed(seed, 'nether:nether-fortress:z'), region.x, region.z) * span,
    ),
  }))
}

const addBlock = (mutable: MutableFortressPlan, placement: NaturalStructureBlockPlacement): void => {
  const key = keyOf(placement)
  /**
   * Esbuild drops a standalone inline "ignore next" comment during the TS
   * transform (verified empirically against esbuild.transform()). Vitest
   * 4's coverage-v8 provider reads that transformed code, so this
   * repository uses the start/stop hint pair instead: it is read from the
   * original source, which survives the transform.
   */
  // oxlint-disable-next-line capitalized-comments -- v8 coverage directive, case-sensitive
  /* v8 ignore start */
  if (!mutable.blocks.has(key) && mutable.blocks.size >= FORTRESS_MAX_BLOCKS) {return}
  // oxlint-disable-next-line capitalized-comments -- v8 coverage directive, case-sensitive
  /* v8 ignore stop */
  mutable.blocks.set(key, Object.freeze(placement))
}

const addMarker = (mutable: MutableFortressPlan, marker: NaturalStructureMarker): void => {
  /** See `addBlock`'s ignore-hint comment for why this repository's ignore hints use the start/stop form. */
  // oxlint-disable-next-line capitalized-comments -- v8 coverage directive, case-sensitive
  /* v8 ignore start */
  if (mutable.markers.length >= FORTRESS_MAX_MARKERS) {return}
  // oxlint-disable-next-line capitalized-comments -- v8 coverage directive, case-sensitive
  /* v8 ignore stop */
  mutable.markers.push(Object.freeze(marker))
}

const finishPlan = (
  seed: number,
  region: NaturalStructureRegion,
  origin: FortressCandidate,
  mutable: MutableFortressPlan,
): NaturalStructurePlan => {
  const blocks = Object.freeze([...mutable.blocks.values()])
  const markers = Object.freeze([...mutable.markers])
  const positions: ReadonlyArray<NaturalStructurePosition> = [...blocks, ...markers]
  const xs = positions.map((position) => position.x)
  const ys = positions.map((position) => position.y)
  const zs = positions.map((position) => position.z)
  const bounds = Object.freeze({
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
    maxZ: Math.max(...zs),
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    minZ: Math.min(...zs),
  })
  return Object.freeze({
    blocks,
    bounds,
    dimension: 'nether',
    id: `nether-fortress:${String(seed)}:${String(region.x)}:${String(region.z)}`,
    kind: 'nether-fortress',
    markers,
    origin: Object.freeze(origin),
    region: Object.freeze(region),
  })
}

const inXCorridor = (candidate: FortressCandidate, x: number, z: number): boolean =>
  Math.abs(x - candidate.x) <= FORTRESS_LAYOUT.corridorHalfLength &&
  Math.abs(z - candidate.z) <= FORTRESS_LAYOUT.corridorHalfWidth

const inZCorridor = (candidate: FortressCandidate, x: number, z: number): boolean =>
  Math.abs(z - candidate.z) <= FORTRESS_LAYOUT.corridorHalfLength &&
  Math.abs(x - candidate.x) <= FORTRESS_LAYOUT.corridorHalfWidth

type FortressBlockContext = {
  readonly candidate: FortressCandidate
  readonly dx: number
  readonly dz: number
  readonly floorY: number
  readonly inX: boolean
  readonly inZ: boolean
  readonly x: number
  readonly y: number
  readonly z: number
}

const fortressBlockContext = (
  candidate: FortressCandidate,
  floorY: number,
  x: number,
  y: number,
  z: number,
): FortressBlockContext => Object.freeze({
  candidate,
  dx: x - candidate.x,
  dz: z - candidate.z,
  floorY,
  inX: inXCorridor(candidate, x, z),
  inZ: inZCorridor(candidate, x, z),
  x,
  y,
  z,
})

const isCorridorInterior = (context: FortressBlockContext): boolean =>
  (context.inX && Math.abs(context.dz) < FORTRESS_LAYOUT.corridorHalfWidth) ||
  (context.inZ && Math.abs(context.dx) < FORTRESS_LAYOUT.corridorHalfWidth)

const isXCorridorEdge = (context: FortressBlockContext): boolean =>
  context.inX && Math.abs(context.dz) === FORTRESS_LAYOUT.corridorHalfWidth && !context.inZ

const isZCorridorEdge = (context: FortressBlockContext): boolean =>
  context.inZ && Math.abs(context.dx) === FORTRESS_LAYOUT.corridorHalfWidth && !context.inX

const corridorEdgeOffset = (context: FortressBlockContext, onXEdge: boolean): number => {
  if (onXEdge) {
    return context.dx
  }
  return context.dz
}

const fortressWindowBlockAt = (
  context: FortressBlockContext,
  onXEdge: boolean,
): BlockId | null => {
  if (context.y !== context.floorY + FORTRESS_WALL_OPENING_Y_OFFSET) {
    return null
  }
  const along = corridorEdgeOffset(context, onXEdge)
  if (positiveModulo(along, FORTRESS_LAYOUT.windowInterval) === ZERO_OFFSET) {
    return NETHER_FORTRESS_BLOCK.AIR
  }
  return null
}

const isFortressWallLevel = (context: FortressBlockContext): boolean =>
  context.y > context.floorY && context.y <= context.floorY + FORTRESS_LAYOUT.wallHeight

const fortressWallEdgeBlockAt = (
  context: FortressBlockContext,
  onXEdge: boolean,
  onZEdge: boolean,
): BlockId | null => {
  if (!onXEdge && !onZEdge) {
    return null
  }
  const windowBlock = fortressWindowBlockAt(context, onXEdge)
  if (windowBlock !== null) {
    return windowBlock
  }
  return NETHER_FORTRESS_BLOCK.NETHER_BRICK
}

const fortressWallBlockAt = (context: FortressBlockContext): BlockId | null => {
  if (!isFortressWallLevel(context)) {
    return null
  }
  if (isCorridorInterior(context)) {
    return NETHER_FORTRESS_BLOCK.AIR
  }
  return fortressWallEdgeBlockAt(context, isXCorridorEdge(context), isZCorridorEdge(context))
}

const isFortressRoofBlock = (context: FortressBlockContext): boolean =>
  context.y === context.floorY || context.y === context.floorY + FORTRESS_LAYOUT.wallHeight + UNIT_STEP

const fortressBlockAt = (
  candidate: FortressCandidate,
  floorY: number,
  x: number,
  y: number,
  z: number,
): BlockId | null => {
  const context = fortressBlockContext(candidate, floorY, x, y, z)
  if (isFortressRoofBlock(context)) {
    return NETHER_FORTRESS_BLOCK.NETHER_BRICK
  }
  return fortressWallBlockAt(context)
}

const writeFortressColumn = (
  mutable: MutableFortressPlan,
  candidate: FortressCandidate,
  floorY: number,
  x: number,
  z: number,
): void => {
  const roofY = floorY + FORTRESS_LAYOUT.wallHeight + UNIT_STEP
  for (let y = WORLD_MIN_Y; y <= roofY; y += UNIT_STEP) {
    const block = fortressBlockAt(candidate, floorY, x, y, z)
    if (block !== null) {addBlock(mutable, { block, x, y, z })}
  }
}

const fortressArmPosition = (
  candidate: FortressCandidate,
  axis: 'x' | 'z',
  offset: number,
  across: number,
): { readonly x: number; readonly z: number } => {
  if (axis === 'x') {
    return { x: candidate.x + offset, z: candidate.z + across }
  }
  return { x: candidate.x + across, z: candidate.z + offset }
}

const writeFortressArm = (
  mutable: MutableFortressPlan,
  candidate: FortressCandidate,
  floorY: number,
  axis: 'x' | 'z',
): void => {
  const { corridorHalfLength, corridorHalfWidth } = FORTRESS_LAYOUT
  for (let offset = -corridorHalfLength; offset <= corridorHalfLength; offset += UNIT_STEP) {
    for (let across = -corridorHalfWidth; across <= corridorHalfWidth; across += UNIT_STEP) {
      const position = fortressArmPosition(candidate, axis, offset, across)
      writeFortressColumn(mutable, candidate, floorY, position.x, position.z)
    }
  }
}

const writeFortressBlocks = (
  mutable: MutableFortressPlan,
  candidate: FortressCandidate,
  floorY: number,
): void => {
  writeFortressArm(mutable, candidate, floorY, 'x')
  writeFortressArm(mutable, candidate, floorY, 'z')
}

const placeFortressChest = (mutable: MutableFortressPlan, candidate: FortressCandidate, floorY: number): void => {
  const spawnY = floorY + UNIT_STEP
  const chest = { x: candidate.x, y: spawnY, z: candidate.z + UNIT_STEP }
  addBlock(mutable, { block: NETHER_FORTRESS_BLOCK.CHEST, ...chest })
  addMarker(mutable, { kind: 'loot-chest', lootTable: 'nether-fortress', ...chest })
}

const placeFortressFarm = (mutable: MutableFortressPlan, candidate: FortressCandidate, floorY: number): void => {
  const spawnY = floorY + UNIT_STEP
  for (let offset = -UNIT_STEP; offset <= UNIT_STEP; offset += UNIT_STEP) {
    addBlock(mutable, {
      block: NETHER_FORTRESS_BLOCK.SOUL_SAND,
      x: candidate.x + offset,
      y: floorY,
      z: candidate.z - UNIT_STEP,
    })
    addBlock(mutable, {
      block: NETHER_FORTRESS_BLOCK.NETHER_WART_CROP,
      x: candidate.x + offset,
      y: spawnY,
      z: candidate.z - UNIT_STEP,
    })
  }
}

const placeFortressUtilityBlocks = (mutable: MutableFortressPlan, candidate: FortressCandidate, floorY: number): void => {
  const spawnY = floorY + UNIT_STEP
  addBlock(mutable, { block: NETHER_FORTRESS_BLOCK.BREWING_STAND, x: candidate.x + UNIT_STEP, y: spawnY, z: candidate.z })
  addBlock(mutable, {
    block: NETHER_FORTRESS_BLOCK.WITHER_SKELETON_SKULL,
    x: candidate.x - UNIT_STEP,
    y: spawnY,
    z: candidate.z,
  })
}

const placeFortressBlazeMarkers = (
  mutable: MutableFortressPlan,
  candidate: FortressCandidate,
  floorY: number,
): void => {
  const spawnY = floorY + UNIT_STEP
  addMarker(mutable, { entity: 'blaze', kind: 'spawner', x: candidate.x, y: floorY + FORTRESS_WALL_OPENING_Y_OFFSET, z: candidate.z })
  addMarker(mutable, { entity: 'blaze', kind: 'entity-spawn', x: candidate.x + FORTRESS_MARKER_OFFSET, y: spawnY, z: candidate.z })
}

const placeFortressSkeletonMarkers = (mutable: MutableFortressPlan, candidate: FortressCandidate, floorY: number): void => {
  const spawnY = floorY + UNIT_STEP
  addMarker(mutable, {
    entity: 'wither-skeleton',
    kind: 'entity-spawn',
    x: candidate.x - FORTRESS_LAYOUT.corridorHalfLength + FORTRESS_MARKER_OFFSET,
    y: spawnY,
    z: candidate.z,
  })
  addMarker(mutable, {
    entity: 'wither-skeleton',
    kind: 'entity-spawn',
    x: candidate.x + FORTRESS_LAYOUT.corridorHalfLength - FORTRESS_MARKER_OFFSET,
    y: spawnY,
    z: candidate.z,
  })
}

const placeFortressSpawnMarkers = (mutable: MutableFortressPlan, candidate: FortressCandidate, floorY: number): void => {
  placeFortressBlazeMarkers(mutable, candidate, floorY)
  placeFortressSkeletonMarkers(mutable, candidate, floorY)
}

const placeFortressDecorations = (
  mutable: MutableFortressPlan,
  candidate: FortressCandidate,
  floorY: number,
): void => {
  placeFortressChest(mutable, candidate, floorY)
  placeFortressFarm(mutable, candidate, floorY)
  placeFortressUtilityBlocks(mutable, candidate, floorY)
  placeFortressSpawnMarkers(mutable, candidate, floorY)
}

const isValidFortressTerrainSample = (
  sample: NetherStructureTerrainSample | undefined,
): sample is NetherStructureTerrainSample => {
  if (Predicate.isUndefined(sample)) {
    return false
  }
  return sample.surfaceY >= WORLD_MIN_Y && sample.surfaceY < CHUNK_HEIGHT
}

const hasFortressHeadroom = (sample: NetherStructureTerrainSample, floorY: number): boolean =>
  sample.ceilingY - floorY >= FORTRESS_MIN_HEADROOM && floorY + FORTRESS_MIN_HEADROOM < CHUNK_HEIGHT

const fortressSiteFromCandidate = (
  candidate: FortressCandidate,
  sampleTerrain: NetherStructureTerrainSampler,
): Option.Option<{ readonly candidate: FortressCandidate; readonly floorY: number }> => {
  const sample = sampleTerrain(candidate.x, candidate.z)
  if (!isValidFortressTerrainSample(sample)) {
    return Option.none()
  }
  const floorY = Math.max(sample.surfaceY, FORTRESS_FLOOR_Y)
  if (!hasFortressHeadroom(sample, floorY)) {
    return Option.none()
  }
  return Option.some({ candidate: Object.freeze({ ...candidate, y: floorY }), floorY })
}

const fortressSiteForRegion = (
  seed: number,
  region: NaturalStructureRegion,
  sampleTerrain: NetherStructureTerrainSampler,
  presenceChannelSeed?: number,
): Option.Option<{ readonly candidate: FortressCandidate; readonly floorY: number }> => {
  const candidateOption = candidateForRegion(seed, region, presenceChannelSeed)
  if (Option.isNone(candidateOption)) {return Option.none()}
  return fortressSiteFromCandidate(candidateOption.value, sampleTerrain)
}

/** Plans one cross-shaped fortress and its host-owned mob/loot markers. */
export const planNetherFortressForRegion = (
  seed: number,
  regionX: number,
  regionZ: number,
  sampleTerrain: NetherStructureTerrainSampler,
  presenceChannelSeed?: number,
): Option.Option<NaturalStructurePlan> => {
  const siteOption = fortressSiteForRegion(seed, { x: regionX, z: regionZ }, sampleTerrain, presenceChannelSeed)
  if (Option.isNone(siteOption)) {return Option.none()}
  const { candidate, floorY } = siteOption.value
  const mutable: MutableFortressPlan = { blocks: new Map(), markers: [] }
  writeFortressBlocks(mutable, candidate, floorY)
  placeFortressDecorations(mutable, candidate, floorY)
  return Option.some(finishPlan(seed, { x: regionX, z: regionZ }, candidate, mutable))
}

const regionRange = (value: number, radius: number): readonly [number, number] => [
  Math.floor((value - radius) / FORTRESS_REGION_SIZE),
  Math.floor((value + radius) / FORTRESS_REGION_SIZE),
]

const isNearFortressCandidate = (
  seed: number,
  x: number,
  z: number,
  radius: number,
  region: NaturalStructureRegion,
): boolean => {
  const candidateOption = candidateForRegion(seed, region)
  if (Option.isNone(candidateOption)) {
    return false
  }
  const candidate = candidateOption.value
  const dx = x - candidate.x
  const dz = z - candidate.z
  return dx * dx + dz * dz <= radius * radius
}

/** True when a column is in the deterministic blaze-spawn radius of a fortress. */
export const isNearFortressSite = (
  seed: number,
  x: number,
  z: number,
  radius: number = FORTRESS_BLAZE_RADIUS,
): boolean => {
  const [minRegionX, maxRegionX] = regionRange(x, radius)
  const [minRegionZ, maxRegionZ] = regionRange(z, radius)
  for (let regionX = minRegionX; regionX <= maxRegionX; regionX += UNIT_STEP) {
    for (let regionZ = minRegionZ; regionZ <= maxRegionZ; regionZ += UNIT_STEP) {
      if (isNearFortressCandidate(seed, x, z, radius, { x: regionX, z: regionZ })) {return true}
    }
  }
  return false
}

export {
  FORTRESS_BLAZE_RADIUS,
  FORTRESS_FLOOR_Y,
  FORTRESS_LAYOUT,
  FORTRESS_MIN_HEADROOM,
  FORTRESS_REGION_SIZE,
  FORTRESS_REGION_SPAWN_PERMILLE,
  FORTRESS_SITE_MARGIN,
  NETHER_FORTRESS_BLOCK,
  NETHER_FORTRESS_GRID,
}
