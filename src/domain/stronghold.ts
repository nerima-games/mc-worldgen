import { BLOCK } from './biome'
import { setBlockAt, worldX, worldZ } from './chunk'
import { CHUNK_SIZE_XZ } from './constants'
import { BlockId, type ChunkCoord } from './kernel-vocabulary'
import type { Dimension } from './nether-travel'
import { channelSeed, latticeValue } from './seeded-random'
import {
  STRONGHOLD_FLOOR_Y,
  strongholdSitesNearChunk,
  type StrongholdSite,
} from './structure-siting'

export const STRONGHOLD_ROOM_HALF = 5
export const STRONGHOLD_ROOM_AIR_HEIGHT = 5
export const STRONGHOLD_SHELL_HALF_EXTENT = STRONGHOLD_ROOM_HALF + 1
export const STRONGHOLD_CEILING_Y = STRONGHOLD_FLOOR_Y + STRONGHOLD_ROOM_AIR_HEIGHT + 1

export const STRONGHOLD_BLOCK = {
  COBBLESTONE: BlockId(17),
  PLANKS: BlockId(12),
  LAVA: BlockId(11),
  END_PORTAL_FRAME: BlockId(87),
  END_PORTAL_FRAME_FILLED: BlockId(88),
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

const FRAME_OFFSETS = [
  [-1, -2, 'south'], [0, -2, 'south'], [1, -2, 'south'], [2, -1, 'west'], [2, 0, 'west'], [2, 1, 'west'],
  [1, 2, 'north'], [0, 2, 'north'], [-1, 2, 'north'], [-2, 1, 'east'], [-2, 0, 'east'], [-2, -1, 'east'],
] as const
export const STRONGHOLD_PLAN_HALF_EXTENT = 30

/** Builds one complete plan before chunks select their slices; coordinate keys prevent duplicate writes. */
export const generateStrongholdPlan = (seed: number, site: StrongholdSite, dimension: Dimension = 'overworld'): StrongholdPlan | undefined => {
  if (dimension !== 'overworld') return undefined
  const mutations = new Map<string, StrongholdMutation>()
  const put = (x: number, y: number, z: number, block: BlockId): void => { mutations.set(`${x},${y},${z}`, { x, y, z, block }) }
  const room = (minX: number, maxX: number, minZ: number, maxZ: number, floor: number, ceiling: number, wall = STRONGHOLD_BLOCK.COBBLESTONE): void => {
    for (let x = minX; x <= maxX; x += 1) for (let z = minZ; z <= maxZ; z += 1) for (let y = floor; y <= ceiling; y += 1) {
      put(x, y, z, y === floor || y === ceiling || x === minX || x === maxX || z === minZ || z === maxZ ? wall : BLOCK.AIR)
    }
  }
  room(site.x - 6, site.x + 6, site.z - 6, site.z + 6, STRONGHOLD_FLOOR_Y, STRONGHOLD_CEILING_Y)
  room(site.x + 6, site.x + 21, site.z - 2, site.z + 2, STRONGHOLD_FLOOR_Y, STRONGHOLD_FLOOR_Y + 4)
  room(site.x + 20, site.x + 30, site.z - 7, site.z + 7, STRONGHOLD_FLOOR_Y + 2, STRONGHOLD_FLOOR_Y + 8, STRONGHOLD_BLOCK.PLANKS)
  for (let step = 0; step <= 8; step += 1) {
    const x = site.x + 13 + step
    const floor = STRONGHOLD_FLOOR_Y + Math.floor(step / 4)
    for (let z = site.z - 1; z <= site.z + 1; z += 1) put(x, floor, z, STRONGHOLD_BLOCK.COBBLESTONE)
  }
  for (let x = site.x + 22; x <= site.x + 28; x += 2) for (let z = site.z - 5; z <= site.z + 5; z += 10) {
    for (let y = STRONGHOLD_FLOOR_Y + 3; y <= STRONGHOLD_FLOOR_Y + 6; y += 1) put(x, y, z, STRONGHOLD_BLOCK.COBBLESTONE)
  }
  for (const dx of [-4, 4]) for (let dz = -2; dz <= 2; dz += 1) {
    put(site.x + dx, STRONGHOLD_FLOOR_Y + 1, site.z + dz, STRONGHOLD_BLOCK.LAVA)
  }
  const frames: StrongholdFrame[] = FRAME_OFFSETS.map(([dx, dz, facing], index) => {
    const eye = latticeValue(channelSeed(seed, `stronghold-eye-${index}`), site.x, site.z) < 0.1
    const frame = { x: site.x + dx, y: STRONGHOLD_FLOOR_Y + 1, z: site.z + dz, block: eye ? STRONGHOLD_BLOCK.END_PORTAL_FRAME_FILLED : STRONGHOLD_BLOCK.END_PORTAL_FRAME, facing, eye }
    put(frame.x, frame.y, frame.z, frame.block)
    return frame
  })
  return { dimension, site, pieces: [{ kind: 'portal-room' }, { kind: 'corridor' }, { kind: 'stair' }, { kind: 'library' }], mutations: [...mutations.values()], frames }
}

/** Returns the stronghold block at a world position, or undefined outside its room. */
export const strongholdBlockAt = (
  site: StrongholdSite,
  wx: number,
  y: number,
  wz: number,
): BlockId | undefined => {
  const dx = Math.abs(wx - site.x)
  const dz = Math.abs(wz - site.z)

  if (dx > STRONGHOLD_SHELL_HALF_EXTENT || dz > STRONGHOLD_SHELL_HALF_EXTENT) {
    return undefined
  }
  if (y < STRONGHOLD_FLOOR_Y || y > STRONGHOLD_CEILING_Y) return undefined

  if (
    y === STRONGHOLD_FLOOR_Y ||
    y === STRONGHOLD_CEILING_Y ||
    dx === STRONGHOLD_SHELL_HALF_EXTENT ||
    dz === STRONGHOLD_SHELL_HALF_EXTENT
  ) {
    return STRONGHOLD_BLOCK.COBBLESTONE
  }

  if (
    y === STRONGHOLD_FLOOR_Y + 1 &&
    ((dz === 2 && dx <= 1) || (dx === 2 && dz <= 1))
  ) {
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
    if (plan === undefined) continue
    for (const mutation of plan.mutations) {
      const lx = mutation.x - worldX(coord, 0)
      const lz = mutation.z - worldZ(coord, 0)
      if (lx >= 0 && lx < CHUNK_SIZE_XZ && lz >= 0 && lz < CHUNK_SIZE_XZ) setBlockAt(blocks, lx, mutation.y, lz, mutation.block)
    }
  }
}
