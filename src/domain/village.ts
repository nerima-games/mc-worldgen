import {
  type OverworldTerrainSampler,
  type VillageSite,
  villageSitesNearChunk,
} from './structure-siting'
// eslint-disable-next-line sort-imports -- Domain imports follow dependency order.
import { BLOCK } from './biome'
// eslint-disable-next-line sort-imports -- Domain imports follow dependency order.
import { CHUNK_SIZE_XZ } from './constants'
// eslint-disable-next-line sort-imports -- Domain imports follow dependency order.
import { blockIdOf, type BlockId } from '@nerima-games/mc-kernel'

export const VILLAGE_BLOCK = {
  FOUNDATION: blockIdOf('cobblestone'),
  ROAD: BLOCK.GRAVEL,
  TIMBER: BLOCK.LOG,
} as const

// eslint-disable-next-line id-length -- x/z are canonical world axes.
export type VillageVillagerProfession = 'farmer' | 'toolsmith'

export type VillageVillagerSpawn = {
  readonly id: string
  readonly profession: VillageVillagerProfession
  readonly villageSite: VillageSite
  // eslint-disable-next-line id-length -- x/y/z are canonical world axes.
  readonly x: number
  // eslint-disable-next-line id-length -- x/y/z are canonical world axes.
  readonly y: number
  // eslint-disable-next-line id-length -- x/y/z are canonical world axes.
  readonly z: number
}

// eslint-disable-next-line id-length -- x/z are canonical world axes.
type House = { readonly x: number; readonly z: number; readonly profession: VillageVillagerProfession }

type HouseBlockRequest = {
  readonly site: VillageSite
  readonly house: House
  readonly wx: number
  readonly y: number
  readonly wz: number
  readonly sampleTerrain: OverworldTerrainSampler
}

// eslint-disable-next-line id-length, no-magic-numbers -- Fixed offsets define the compact village plan.
const HOUSES: ReadonlyArray<House> = [
  // eslint-disable-next-line id-length, no-magic-numbers -- Fixed x/z offsets define the compact village plan.
  { profession: 'farmer', x: -14, z: -10 },
  // eslint-disable-next-line id-length, no-magic-numbers -- Fixed x/z offsets define the compact village plan.
  { profession: 'toolsmith', x: 14, z: 10 },
]
const HOUSE_HALF_X = 4
const HOUSE_HALF_Z = 3
const HOUSE_WALL_HEIGHT = 4
const HOUSE_ROOF_TOP_OFFSET = 1
const HOUSE_DOOR_TOP_OFFSET = 2
const HOUSE_AXIS_ORIGIN = 0

const houseFloorY = (site: VillageSite, house: House, sample: OverworldTerrainSampler): number => {
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

/** One stable spawn per generated house, standing on that house's actual floor. */
// eslint-disable-next-line id-length -- Spawn descriptors expose canonical world axes.
export const villageVillagerSpawnsForSite = (
  seed: number,
  site: VillageSite,
  sampleTerrain: OverworldTerrainSampler,
): ReadonlyArray<VillageVillagerSpawn> => HOUSES.map((house, houseIndex) => ({
  id: `village:${String(seed)}:${String(site.x)}:${String(site.z)}:house:${String(houseIndex)}`,
  profession: house.profession,
  villageSite: site,
  // eslint-disable-next-line id-length -- x is the canonical world axis.
  x: site.x + house.x,
  // eslint-disable-next-line id-length, no-magic-numbers -- y is the canonical axis; feet occupy air above the floor.
  y: houseFloorY(site, house, sampleTerrain) + 1,
  // eslint-disable-next-line id-length -- z is the canonical world axis.
  z: site.z + house.z,
}))

/** Enumerates only the stable village spawns owned by this chunk. */
// eslint-disable-next-line max-params -- Chunk lookup requires its seed, two coordinates and terrain sampler.
export const villageVillagerSpawnsForChunk = (
  seed: number,
  chunkX: number,
  chunkZ: number,
  sampleTerrain: OverworldTerrainSampler,
): ReadonlyArray<VillageVillagerSpawn> => villageSitesNearChunk(seed, chunkX, chunkZ, sampleTerrain)
  .flatMap((site) => villageVillagerSpawnsForSite(seed, site, sampleTerrain))
  .filter((spawn) =>
    Math.floor(spawn.x / CHUNK_SIZE_XZ) === chunkX && Math.floor(spawn.z / CHUNK_SIZE_XZ) === chunkZ,
  )

const isInsideHouseFootprint = (dx: number, dz: number): boolean =>
  Math.abs(dx) <= HOUSE_HALF_X && Math.abs(dz) <= HOUSE_HALF_Z

const isHouseFoundation = (y: number, surfaceY: number, floorY: number): boolean =>
  y >= surfaceY && y < floorY

const isHouseRoof = (y: number, floorY: number): boolean =>
  y === floorY || y === floorY + HOUSE_WALL_HEIGHT + HOUSE_ROOF_TOP_OFFSET

const isOutsideHouseWallHeight = (y: number, floorY: number): boolean =>
  y <= floorY || y > floorY + HOUSE_WALL_HEIGHT

const isHouseBoundary = (dx: number, dz: number): boolean =>
  Math.abs(dx) === HOUSE_HALF_X || Math.abs(dz) === HOUSE_HALF_Z

const houseDoorZ = (house: House): number => {
  if (house.z < HOUSE_AXIS_ORIGIN) { return HOUSE_HALF_Z }
  return -HOUSE_HALF_Z
}

const isHouseDoor = (house: House, dx: number, dz: number, y: number, floorY: number): boolean =>
  dz === houseDoorZ(house) && dx === HOUSE_AXIS_ORIGIN && y <= floorY + HOUSE_DOOR_TOP_OFFSET

type HouseBlockWithinFootprintRequest = {
  readonly house: House
  readonly dx: number
  readonly dz: number
  readonly y: number
  readonly floorY: number
  readonly surfaceY: number
}

const houseBlockWithinFootprint = ({
  house,
  dx,
  dz,
  y,
  floorY,
  surfaceY,
}: HouseBlockWithinFootprintRequest): BlockId | undefined => {
  if (isHouseFoundation(y, surfaceY, floorY)) { return VILLAGE_BLOCK.FOUNDATION }
  if (isHouseRoof(y, floorY)) { return VILLAGE_BLOCK.TIMBER }
  // eslint-disable-next-line no-undefined -- Outside the vertical house span preserves terrain.
  if (isOutsideHouseWallHeight(y, floorY)) { return undefined }

  if (isHouseBoundary(dx, dz) && !isHouseDoor(house, dx, dz, y, floorY)) {
    return VILLAGE_BLOCK.TIMBER
  }
  return BLOCK.AIR
}

const houseBlockAt = ({ site, house, wx, y, wz, sampleTerrain }: HouseBlockRequest): BlockId | undefined => {
  const dx = wx - (site.x + house.x)
  const dz = wz - (site.z + house.z)
  // eslint-disable-next-line no-undefined -- Absence means this coordinate is outside the house.
  if (!isInsideHouseFootprint(dx, dz)) { return undefined }

  const floorY = houseFloorY(site, house, sampleTerrain)
  const { surfaceY } = sampleTerrain(wx, wz)
  return houseBlockWithinFootprint({ dx, dz, floorY, house, surfaceY, y })
}

/** Resolves one world-space village block, including cleared walking/interior space. */
// eslint-disable-next-line max-params, max-statements -- Public point sampling requires world axes and terrain context.
export const villageBlockAt = (
  site: VillageSite,
  wx: number,
  // eslint-disable-next-line id-length -- y is the canonical vertical axis.
  y: number,
  wz: number,
  sample: OverworldTerrainSampler,
): BlockId | undefined => {
  for (const house of HOUSES) {
    const block = houseBlockAt({ house, sampleTerrain: sample, site, wx, wz, y })
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
