import { BLOCK } from './biome'
import { setBlockAt, worldX, worldZ } from './chunk'
import { CHUNK_SIZE_XZ } from './constants'
import { BlockId, type ChunkCoord } from './kernel-vocabulary'
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
  END_PORTAL_FRAME: BlockId(87),
} as const

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
    STRONGHOLD_SHELL_HALF_EXTENT,
  )

  for (const site of sites) {
    for (let lz = 0; lz < CHUNK_SIZE_XZ; lz += 1) {
      const wz = worldZ(coord, lz)
      for (let lx = 0; lx < CHUNK_SIZE_XZ; lx += 1) {
        const wx = worldX(coord, lx)
        for (let y = STRONGHOLD_FLOOR_Y; y <= STRONGHOLD_CEILING_Y; y += 1) {
          const block = strongholdBlockAt(site, wx, y, wz)
          if (block !== undefined) setBlockAt(blocks, lx, y, lz, block)
        }
      }
    }
  }
}
