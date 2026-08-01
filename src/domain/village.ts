// eslint-disable-next-line sort-imports -- Domain imports follow dependency order.
import { BLOCK } from './biome'
// eslint-disable-next-line sort-imports -- Domain imports follow dependency order.
import { setBlockAt, worldX, worldZ } from './chunk'
// eslint-disable-next-line sort-imports -- Domain imports follow dependency order.
import { CHUNK_HEIGHT, CHUNK_SIZE_XZ } from './constants'
// eslint-disable-next-line new-cap, sort-imports -- BlockId is the established branded-value constructor.
import { BlockId, type ChunkCoord } from './kernel-vocabulary'
import {
  type VillageSite,
  type VillageTerrainSampler,
  villageSitesNearChunk,
} from './structure-siting'

export const VILLAGE_BLOCK = {
  // eslint-disable-next-line new-cap, no-magic-numbers -- 17 is the stable cobblestone protocol id.
  FOUNDATION: BlockId(17),
  ROAD: BLOCK.GRAVEL,
  TIMBER: BLOCK.LOG,
} as const

// eslint-disable-next-line id-length -- x/z are canonical world axes.
type House = { readonly x: number; readonly z: number }
// eslint-disable-next-line id-length, no-magic-numbers -- Fixed offsets define the compact village plan.
const HOUSES: ReadonlyArray<House> = [{ x: -14, z: -10 }, { x: 14, z: 10 }]
const HOUSE_HALF_X = 4
const HOUSE_HALF_Z = 3
const HOUSE_WALL_HEIGHT = 4

const houseFloorY = (site: VillageSite, house: House, sample: VillageTerrainSampler): number => {
  let highest = 0
  // eslint-disable-next-line id-length, no-magic-numbers -- dx is the conventional local x offset.
  for (let dx = -HOUSE_HALF_X; dx <= HOUSE_HALF_X; dx += 1) {
    // eslint-disable-next-line id-length, no-magic-numbers -- dz is the conventional local z offset.
    for (let dz = -HOUSE_HALF_Z; dz <= HOUSE_HALF_Z; dz += 1) {
      highest = Math.max(highest, sample(site.x + house.x + dx, site.z + house.z + dz).surfaceY)
    }
  }
  // eslint-disable-next-line no-magic-numbers -- The floor sits one block above the highest ground.
  return highest + 1
}

// eslint-disable-next-line max-params, max-statements -- A pure block resolver needs all three axes plus site and terrain.
const houseBlockAt = (
  site: VillageSite,
  house: House,
  wx: number,
  // eslint-disable-next-line id-length -- y is the canonical vertical axis.
  y: number,
  wz: number,
  sample: VillageTerrainSampler,
): BlockId | undefined => {
  const dx = wx - (site.x + house.x)
  const dz = wz - (site.z + house.z)
  // eslint-disable-next-line no-undefined -- Absence means this coordinate is outside the house.
  if (Math.abs(dx) > HOUSE_HALF_X || Math.abs(dz) > HOUSE_HALF_Z) { return undefined }

  const floorY = houseFloorY(site, house, sample)
  const { surfaceY } = sample(wx, wz)
  if (y >= surfaceY && y < floorY) { return VILLAGE_BLOCK.FOUNDATION }
  // eslint-disable-next-line no-magic-numbers -- Roof is one block above the wall height.
  if (y === floorY || y === floorY + HOUSE_WALL_HEIGHT + 1) { return VILLAGE_BLOCK.TIMBER }
  // eslint-disable-next-line no-magic-numbers, no-undefined -- Outside the vertical house span preserves terrain.
  if (y < floorY + 1 || y > floorY + HOUSE_WALL_HEIGHT) { return undefined }

  const boundary = Math.abs(dx) === HOUSE_HALF_X || Math.abs(dz) === HOUSE_HALF_Z
  let doorZ = -HOUSE_HALF_Z
  // eslint-disable-next-line no-magic-numbers -- Zero separates north-facing from south-facing houses.
  if (house.z < 0) { doorZ = HOUSE_HALF_Z }
  // eslint-disable-next-line no-magic-numbers -- The doorway is two blocks high and centered on the wall.
  const door = dz === doorZ && dx === 0 && y <= floorY + 2
  if (boundary && !door) { return VILLAGE_BLOCK.TIMBER }
  return BLOCK.AIR
}

/** Resolves one world-space village block, including cleared walking/interior space. */
// eslint-disable-next-line max-params, max-statements -- Public point sampling requires world axes and terrain context.
export const villageBlockAt = (
  site: VillageSite,
  wx: number,
  // eslint-disable-next-line id-length -- y is the canonical vertical axis.
  y: number,
  wz: number,
  sample: VillageTerrainSampler,
): BlockId | undefined => {
  for (const house of HOUSES) {
    const block = houseBlockAt(site, house, wx, y, wz, sample)
    // eslint-disable-next-line no-undefined -- Undefined is the resolver's no-structure sentinel.
    if (block !== undefined) { return block }
  }

  const dx = Math.abs(wx - site.x)
  const dz = Math.abs(wz - site.z)
  // eslint-disable-next-line no-magic-numbers -- Roads are three blocks wide and extend 28 blocks from the centre.
  const onRoad = (dx <= 1 && dz <= 28) || (dz <= 1 && dx <= 28)
  // eslint-disable-next-line no-undefined -- Absence preserves terrain beyond the road footprint.
  if (!onRoad) { return undefined }
  const { surfaceY } = sample(wx, wz)
  if (y === surfaceY) { return VILLAGE_BLOCK.ROAD }
  // eslint-disable-next-line no-magic-numbers -- Two air blocks provide walking headroom.
  if (y === surfaceY + 1 || y === surfaceY + 2) { return BLOCK.AIR }
  // eslint-disable-next-line no-undefined -- Absence preserves blocks outside road surface/headroom.
  return undefined
}

/** Writes only the current chunk's slice; no loaded-neighbour state is observed. */
// eslint-disable-next-line max-params, max-statements -- Chunk mutation needs buffer, identity, coordinate and sampler.
export const writeVillageBlocksForChunk = (
  blocks: Uint8Array,
  seed: number,
  coord: ChunkCoord,
  sampleTerrain: VillageTerrainSampler,
): void => {
  const sites = villageSitesNearChunk(seed, coord.cx, coord.cz, sampleTerrain)
  for (const site of sites) {
    // eslint-disable-next-line no-magic-numbers -- Local chunk coordinates advance one block at a time.
    for (let lz = 0; lz < CHUNK_SIZE_XZ; lz += 1) {
      const wz = worldZ(coord, lz)
      // eslint-disable-next-line no-magic-numbers -- Local chunk coordinates advance one block at a time.
      for (let lx = 0; lx < CHUNK_SIZE_XZ; lx += 1) {
        const wx = worldX(coord, lx)
        const { surfaceY } = sampleTerrain(wx, wz)
        // eslint-disable-next-line id-length, no-magic-numbers -- 24 covers foundations through roof on accepted terrain.
        for (let y = surfaceY; y < Math.min(CHUNK_HEIGHT, surfaceY + 24); y += 1) {
          const block = villageBlockAt(site, wx, y, wz, sampleTerrain)
          // eslint-disable-next-line no-undefined -- Undefined means the existing terrain remains unchanged.
          if (block !== undefined) { setBlockAt(blocks, lx, y, lz, block) }
        }
      }
    }
  }
}
