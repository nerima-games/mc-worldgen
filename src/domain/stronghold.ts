import { type BlockId, type ChunkCoord, blockIdOf } from '@nerima-games/mc-kernel'
import {
  STRONGHOLD_FLOOR_Y,
  type StrongholdSite,
  strongholdSitesNearChunk,
} from './structure-siting'
import { channelSeed, latticeValue } from '@nerima-games/mc-noise'
import { worldX, worldZ } from './generator-coordinates'
import { BLOCK } from './biome'
import { CHUNK_SIZE_XZ } from './constants'
import type { Dimension } from './nether-travel'
import { setBlockAt } from './chunk'

const STRONGHOLD_WALL_THICKNESS = 1
const STRONGHOLD_ABOVE_FLOOR_Y_OFFSET = 1
/** The step size for every unit voxel-walk loop in this file. */
const STRONGHOLD_UNIT_STEP = 1

export const STRONGHOLD_ROOM_HALF = 5
export const STRONGHOLD_ROOM_AIR_HEIGHT = 5
export const STRONGHOLD_SHELL_HALF_EXTENT = STRONGHOLD_ROOM_HALF + STRONGHOLD_WALL_THICKNESS
export const STRONGHOLD_CEILING_Y = STRONGHOLD_FLOOR_Y + STRONGHOLD_ROOM_AIR_HEIGHT + STRONGHOLD_WALL_THICKNESS

export const STRONGHOLD_BLOCK = {
  COBBLESTONE: blockIdOf('cobblestone'),
  END_PORTAL_FRAME: blockIdOf('end_portal_frame'),
  END_PORTAL_FRAME_FILLED: blockIdOf('end_portal_frame_filled'),
  LAVA: blockIdOf('lava'),
  PLANKS: blockIdOf('oak_planks'),
} as const

export type StrongholdPieceKind = 'portal-room' | 'corridor' | 'stair' | 'library'
export type StrongholdMutation = { readonly x: number; readonly y: number; readonly z: number; readonly block: BlockId }
export type StrongholdFrame = StrongholdMutation & { readonly facing: 'north' | 'east' | 'south' | 'west'; readonly eye: boolean }
export type StrongholdPlan = {
  readonly dimension: 'overworld'
  readonly site: StrongholdSite
  readonly pieces: ReadonlyArray<{ readonly kind: StrongholdPieceKind }>
  readonly mutations: ReadonlyArray<StrongholdMutation>
  readonly frames: ReadonlyArray<StrongholdFrame>
}

const STRONGHOLD_FRAME_CENTER_OFFSET = 0
const STRONGHOLD_FRAME_NEAR_OFFSET = 1
const STRONGHOLD_FRAME_FAR_OFFSET = 2

const FRAME_OFFSETS = [
  [-STRONGHOLD_FRAME_NEAR_OFFSET, -STRONGHOLD_FRAME_FAR_OFFSET, 'south'],
  [STRONGHOLD_FRAME_CENTER_OFFSET, -STRONGHOLD_FRAME_FAR_OFFSET, 'south'],
  [STRONGHOLD_FRAME_NEAR_OFFSET, -STRONGHOLD_FRAME_FAR_OFFSET, 'south'],
  [STRONGHOLD_FRAME_FAR_OFFSET, -STRONGHOLD_FRAME_NEAR_OFFSET, 'west'],
  [STRONGHOLD_FRAME_FAR_OFFSET, STRONGHOLD_FRAME_CENTER_OFFSET, 'west'],
  [STRONGHOLD_FRAME_FAR_OFFSET, STRONGHOLD_FRAME_NEAR_OFFSET, 'west'],
  [STRONGHOLD_FRAME_NEAR_OFFSET, STRONGHOLD_FRAME_FAR_OFFSET, 'north'],
  [STRONGHOLD_FRAME_CENTER_OFFSET, STRONGHOLD_FRAME_FAR_OFFSET, 'north'],
  [-STRONGHOLD_FRAME_NEAR_OFFSET, STRONGHOLD_FRAME_FAR_OFFSET, 'north'],
  [-STRONGHOLD_FRAME_FAR_OFFSET, STRONGHOLD_FRAME_NEAR_OFFSET, 'east'],
  [-STRONGHOLD_FRAME_FAR_OFFSET, STRONGHOLD_FRAME_CENTER_OFFSET, 'east'],
  [-STRONGHOLD_FRAME_FAR_OFFSET, -STRONGHOLD_FRAME_NEAR_OFFSET, 'east'],
] as const
export const STRONGHOLD_PLAN_HALF_EXTENT = 30

const STRONGHOLD_CORRIDOR_END_X = 21
const STRONGHOLD_CORRIDOR_HALF_WIDTH = 2
const STRONGHOLD_CORRIDOR_CEILING_HEIGHT = 4

const STRONGHOLD_LIBRARY_START_X = 20
const STRONGHOLD_LIBRARY_END_X = 30
const STRONGHOLD_LIBRARY_HALF_WIDTH = 7
const STRONGHOLD_LIBRARY_FLOOR_OFFSET = 2
const STRONGHOLD_LIBRARY_CEILING_OFFSET = 8

const STRONGHOLD_STAIRCASE_STEPS = 8
const STRONGHOLD_STAIRCASE_START_X = 13
const STRONGHOLD_STAIRCASE_STEPS_PER_RISE = 4
const STRONGHOLD_STAIRCASE_HALF_WIDTH = 1

const STRONGHOLD_LIBRARY_PILLAR_START_X = 22
const STRONGHOLD_LIBRARY_PILLAR_END_X = 28
const STRONGHOLD_LIBRARY_PILLAR_SPACING = 2
const STRONGHOLD_LIBRARY_PILLAR_HALF_DEPTH = 5
const STRONGHOLD_LIBRARY_PILLAR_DEPTH_STEP = 10
const STRONGHOLD_LIBRARY_PILLAR_BASE_OFFSET = 3
const STRONGHOLD_LIBRARY_PILLAR_TOP_OFFSET = 6

const STRONGHOLD_LAVA_TRAP_OFFSET_X = 4
const STRONGHOLD_LAVA_TRAP_HALF_WIDTH = 2

const STRONGHOLD_PORTAL_EYE_CHANCE = 0.1

const CHUNK_ORIGIN_LOCAL = 0

type StrongholdRoomBounds = {
  readonly ceiling: number
  readonly floor: number
  readonly maxX: number
  readonly maxZ: number
  readonly minX: number
  readonly minZ: number
}

const putStrongholdMutation = (mutations: Map<string, StrongholdMutation>, mutation: StrongholdMutation): void => {
  mutations.set(`${mutation.x},${mutation.y},${mutation.z}`, mutation)
}

/** Fills one hollow box: floor, ceiling and walls get `wall`; the interior gets air. */
const carveRoomBlocks = (
  mutations: Map<string, StrongholdMutation>,
  bounds: StrongholdRoomBounds,
  wall: BlockId = STRONGHOLD_BLOCK.COBBLESTONE,
): void => {
  for (let x = bounds.minX; x <= bounds.maxX; x += STRONGHOLD_UNIT_STEP) {
    for (let z = bounds.minZ; z <= bounds.maxZ; z += STRONGHOLD_UNIT_STEP) {
      for (let y = bounds.floor; y <= bounds.ceiling; y += STRONGHOLD_UNIT_STEP) {
        const onShell =
          y === bounds.floor || y === bounds.ceiling || x === bounds.minX || x === bounds.maxX || z === bounds.minZ || z === bounds.maxZ
        let block: BlockId = BLOCK.AIR
        if (onShell) {block = wall}
        putStrongholdMutation(mutations, { block, x, y, z })
      }
    }
  }
}

/** The portal room, the corridor leading off it, and the library at the far end. */
const carveStrongholdRooms = (mutations: Map<string, StrongholdMutation>, site: StrongholdSite): void => {
  carveRoomBlocks(mutations, {
    ceiling: STRONGHOLD_CEILING_Y,
    floor: STRONGHOLD_FLOOR_Y,
    maxX: site.x + STRONGHOLD_SHELL_HALF_EXTENT,
    maxZ: site.z + STRONGHOLD_SHELL_HALF_EXTENT,
    minX: site.x - STRONGHOLD_SHELL_HALF_EXTENT,
    minZ: site.z - STRONGHOLD_SHELL_HALF_EXTENT,
  })
  carveRoomBlocks(mutations, {
    ceiling: STRONGHOLD_FLOOR_Y + STRONGHOLD_CORRIDOR_CEILING_HEIGHT,
    floor: STRONGHOLD_FLOOR_Y,
    maxX: site.x + STRONGHOLD_CORRIDOR_END_X,
    maxZ: site.z + STRONGHOLD_CORRIDOR_HALF_WIDTH,
    minX: site.x + STRONGHOLD_SHELL_HALF_EXTENT,
    minZ: site.z - STRONGHOLD_CORRIDOR_HALF_WIDTH,
  })
  carveRoomBlocks(
    mutations,
    {
      ceiling: STRONGHOLD_FLOOR_Y + STRONGHOLD_LIBRARY_CEILING_OFFSET,
      floor: STRONGHOLD_FLOOR_Y + STRONGHOLD_LIBRARY_FLOOR_OFFSET,
      maxX: site.x + STRONGHOLD_LIBRARY_END_X,
      maxZ: site.z + STRONGHOLD_LIBRARY_HALF_WIDTH,
      minX: site.x + STRONGHOLD_LIBRARY_START_X,
      minZ: site.z - STRONGHOLD_LIBRARY_HALF_WIDTH,
    },
    STRONGHOLD_BLOCK.PLANKS,
  )
}

/** The stepped floor connecting the portal room to the library. */
const carveStrongholdStaircase = (mutations: Map<string, StrongholdMutation>, site: StrongholdSite): void => {
  for (let step = 0; step <= STRONGHOLD_STAIRCASE_STEPS; step += STRONGHOLD_UNIT_STEP) {
    const x = site.x + STRONGHOLD_STAIRCASE_START_X + step
    const floor = STRONGHOLD_FLOOR_Y + Math.floor(step / STRONGHOLD_STAIRCASE_STEPS_PER_RISE)
    for (let z = site.z - STRONGHOLD_STAIRCASE_HALF_WIDTH; z <= site.z + STRONGHOLD_STAIRCASE_HALF_WIDTH; z += STRONGHOLD_UNIT_STEP) {
      putStrongholdMutation(mutations, { block: STRONGHOLD_BLOCK.COBBLESTONE, x, y: floor, z })
    }
  }
}

/** The library's interior support columns. */
const carveStrongholdLibraryPillars = (mutations: Map<string, StrongholdMutation>, site: StrongholdSite): void => {
  for (let x = site.x + STRONGHOLD_LIBRARY_PILLAR_START_X; x <= site.x + STRONGHOLD_LIBRARY_PILLAR_END_X; x += STRONGHOLD_LIBRARY_PILLAR_SPACING) {
    for (
      let z = site.z - STRONGHOLD_LIBRARY_PILLAR_HALF_DEPTH;
      z <= site.z + STRONGHOLD_LIBRARY_PILLAR_HALF_DEPTH;
      z += STRONGHOLD_LIBRARY_PILLAR_DEPTH_STEP
    ) {
      for (
        let y = STRONGHOLD_FLOOR_Y + STRONGHOLD_LIBRARY_PILLAR_BASE_OFFSET;
        y <= STRONGHOLD_FLOOR_Y + STRONGHOLD_LIBRARY_PILLAR_TOP_OFFSET;
        y += STRONGHOLD_UNIT_STEP
      ) {
        putStrongholdMutation(mutations, { block: STRONGHOLD_BLOCK.COBBLESTONE, x, y, z })
      }
    }
  }
}

/** The two lava flanks either side of the portal room. */
const placeStrongholdLavaTraps = (mutations: Map<string, StrongholdMutation>, site: StrongholdSite): void => {
  for (const dx of [-STRONGHOLD_LAVA_TRAP_OFFSET_X, STRONGHOLD_LAVA_TRAP_OFFSET_X]) {
    for (let dz = -STRONGHOLD_LAVA_TRAP_HALF_WIDTH; dz <= STRONGHOLD_LAVA_TRAP_HALF_WIDTH; dz += STRONGHOLD_UNIT_STEP) {
      putStrongholdMutation(mutations, {
        block: STRONGHOLD_BLOCK.LAVA,
        x: site.x + dx,
        y: STRONGHOLD_FLOOR_Y + STRONGHOLD_ABOVE_FLOOR_Y_OFFSET,
        z: site.z + dz,
      })
    }
  }
}

/** The ring of 12 end-portal-frame blocks, each independently lit or unlit. */
const buildStrongholdFrames = (
  mutations: Map<string, StrongholdMutation>,
  seed: number,
  site: StrongholdSite,
): ReadonlyArray<StrongholdFrame> =>
  FRAME_OFFSETS.map(([dx, dz, facing], index) => {
    const eye = latticeValue(channelSeed(seed, `stronghold-eye-${index}`), site.x, site.z) < STRONGHOLD_PORTAL_EYE_CHANCE
    let block: BlockId = STRONGHOLD_BLOCK.END_PORTAL_FRAME
    if (eye) {block = STRONGHOLD_BLOCK.END_PORTAL_FRAME_FILLED}
    const frame: StrongholdFrame = {
      block,
      eye,
      facing,
      x: site.x + dx,
      y: STRONGHOLD_FLOOR_Y + STRONGHOLD_ABOVE_FLOOR_Y_OFFSET,
      z: site.z + dz,
    }
    putStrongholdMutation(mutations, frame)
    return frame
  })

/** Builds one complete plan before chunks select their slices; coordinate keys prevent duplicate writes. */
export const generateStrongholdPlan = (seed: number, site: StrongholdSite, dimension: Dimension = 'overworld'): StrongholdPlan | undefined => {
  if (dimension !== 'overworld') {return}
  const mutations = new Map<string, StrongholdMutation>()
  carveStrongholdRooms(mutations, site)
  carveStrongholdStaircase(mutations, site)
  carveStrongholdLibraryPillars(mutations, site)
  placeStrongholdLavaTraps(mutations, site)
  const frames = buildStrongholdFrames(mutations, seed, site)
  return {
    dimension,
    frames,
    mutations: [...mutations.values()],
    pieces: [{ kind: 'portal-room' }, { kind: 'corridor' }, { kind: 'stair' }, { kind: 'library' }],
    site,
  }
}

const isStrongholdFrameCell = (dx: number, dz: number): boolean =>
  (dz === STRONGHOLD_FRAME_FAR_OFFSET && dx <= STRONGHOLD_FRAME_NEAR_OFFSET) ||
  (dx === STRONGHOLD_FRAME_FAR_OFFSET && dz <= STRONGHOLD_FRAME_NEAR_OFFSET)

const isOutsideStrongholdRoom = (dx: number, dz: number, y: number): boolean =>
  dx > STRONGHOLD_SHELL_HALF_EXTENT ||
  dz > STRONGHOLD_SHELL_HALF_EXTENT ||
  y < STRONGHOLD_FLOOR_Y ||
  y > STRONGHOLD_CEILING_Y

const isStrongholdShell = (dx: number, dz: number, y: number): boolean =>
  y === STRONGHOLD_FLOOR_Y ||
  y === STRONGHOLD_CEILING_Y ||
  dx === STRONGHOLD_SHELL_HALF_EXTENT ||
  dz === STRONGHOLD_SHELL_HALF_EXTENT

const isStrongholdFrameLevel = (y: number): boolean =>
  y === STRONGHOLD_FLOOR_Y + STRONGHOLD_ABOVE_FLOOR_Y_OFFSET

/** Returns the stronghold block at a world position, or undefined outside its room. */
export const strongholdBlockAt = (
  site: StrongholdSite,
  wx: number,
  y: number,
  wz: number,
): BlockId | undefined => {
  const dx = Math.abs(wx - site.x)
  const dz = Math.abs(wz - site.z)

  if (isOutsideStrongholdRoom(dx, dz, y)) {
    return
  }

  if (isStrongholdShell(dx, dz, y)) {
    return STRONGHOLD_BLOCK.COBBLESTONE
  }

  if (isStrongholdFrameLevel(y) && isStrongholdFrameCell(dx, dz)) {
    return STRONGHOLD_BLOCK.END_PORTAL_FRAME
  }

  return BLOCK.AIR
}

/** Writes only this chunk's slice so cross-boundary strongholds are order independent. */
export const writeStrongholdBlocksForChunk = (
  blocks: Uint8Array,
  seed: number,
  coord: ChunkCoord,
): void => {
  const sites = strongholdSitesNearChunk(
    seed,
    coord.cx,
    coord.cz,
    STRONGHOLD_PLAN_HALF_EXTENT,
  )

  for (const site of sites) {
    const plan = generateStrongholdPlan(seed, site)
    if (plan) {
      for (const mutation of plan.mutations) {
        const lx = mutation.x - worldX(coord, CHUNK_ORIGIN_LOCAL)
        const lz = mutation.z - worldZ(coord, CHUNK_ORIGIN_LOCAL)
        if (lx >= CHUNK_ORIGIN_LOCAL && lx < CHUNK_SIZE_XZ && lz >= CHUNK_ORIGIN_LOCAL && lz < CHUNK_SIZE_XZ) {
          setBlockAt(blocks, lx, mutation.y, lz, mutation.block)
        }
      }
    }
  }
}
