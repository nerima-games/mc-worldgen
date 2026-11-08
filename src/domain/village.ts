import type { BlockAxis, ChunkAxis } from '@nerima-games/mc-kernel/domain/coordinates'
import { type BlockId, blockIdOf } from '@nerima-games/mc-kernel'
import { Option, Predicate, Result } from 'effect'
import {
  type OverworldTerrainResultSampler,
  type OverworldTerrainSampler,
  type OverworldTerrainSamplingFailure,
  type VillageSite,
  villageSitesNearChunk,
} from './structure-siting.js'
import { BLOCK } from './biome.js'
import { CHUNK_SIZE_XZ } from './constants.js'
import type { InvalidNaturalStructureCoordinate } from './natural-structure-coordinate-validation.js'
import type { NoiseSeed } from '@nerima-games/mc-noise'
import { blockAxisFromKnownSafeInteger } from './coordinate-compatibility.js'
export const VILLAGE_BLOCK: Readonly<Record<'FOUNDATION' | 'ROAD' | 'TIMBER', BlockId>> = {
  FOUNDATION: Option.getOrThrow(blockIdOf('cobblestone')),
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
  readonly x: BlockAxis
  // eslint-disable-next-line id-length -- x/y/z are canonical world axes.
  readonly y: BlockAxis
  // eslint-disable-next-line id-length -- x/y/z are canonical world axes.
  readonly z: BlockAxis
}

type House = { readonly x: number; readonly z: number; readonly profession: VillageVillagerProfession }

type HouseBlockRequest = {
  readonly site: VillageSite
  readonly house: House
  readonly wx: BlockAxis
  readonly y: BlockAxis
  readonly wz: BlockAxis
  readonly sampleTerrain: OverworldTerrainSampler
  readonly floorY?: number
}

type HouseBlockResultRequest = Omit<HouseBlockRequest, 'floorY' | 'sampleTerrain'> & {
  readonly floorY: number
  readonly sampleTerrain: OverworldTerrainResultSampler
}

// eslint-disable-next-line id-length, no-magic-numbers -- Fixed offsets define the compact village plan.
const HOUSES: readonly [House, House] = [
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
const FIRST_HOUSE_INDEX = 0
const SECOND_HOUSE_INDEX = 1

const houseFloorY = (site: VillageSite, house: House, sample: OverworldTerrainSampler): number => {
  let highest = 0
  // eslint-disable-next-line id-length, no-magic-numbers -- dx is the conventional local x offset.
  for (let dx = -HOUSE_HALF_X; dx <= HOUSE_HALF_X; dx += 1) {
    // eslint-disable-next-line id-length, no-magic-numbers -- dz is the conventional local z offset.
    for (let dz = -HOUSE_HALF_Z; dz <= HOUSE_HALF_Z; dz += 1) {
      highest = Math.max(
        highest,
        sample(
          blockAxisFromKnownSafeInteger(site.x + house.x + dx),
          blockAxisFromKnownSafeInteger(site.z + house.z + dz),
        ).surfaceY,
      )
    }
  }
  // eslint-disable-next-line no-magic-numbers -- The floor sits one block above the highest ground.
  return highest + 1
}

export type VillageHouseFloorYs = readonly [number, number]

const houseFloorYWithResult = (
  site: VillageSite,
  house: House,
  sampleTerrain: OverworldTerrainResultSampler,
): Result.Result<number, OverworldTerrainSamplingFailure> => {
  let highest = 0
  // eslint-disable-next-line id-length, no-magic-numbers -- dx is the conventional local x offset.
  for (let dx = -HOUSE_HALF_X; dx <= HOUSE_HALF_X; dx += 1) {
    // eslint-disable-next-line id-length, no-magic-numbers -- dz is the conventional local z offset.
    for (let dz = -HOUSE_HALF_Z; dz <= HOUSE_HALF_Z; dz += 1) {
      const terrain = sampleTerrain(
        blockAxisFromKnownSafeInteger(site.x + house.x + dx),
        blockAxisFromKnownSafeInteger(site.z + house.z + dz),
      )
      if (Result.isFailure(terrain)) {return Result.fail(terrain.failure)}
      highest = Math.max(highest, terrain.success.surfaceY)
    }
  }
  // eslint-disable-next-line no-magic-numbers -- Floor height is one block above the highest sampled ground.
  return Result.succeed(highest + 1)
}

export const villageHouseFloorYsForSite = (
  site: VillageSite,
  sampleTerrain: OverworldTerrainSampler,
): VillageHouseFloorYs => [
  houseFloorY(site, HOUSES[FIRST_HOUSE_INDEX], sampleTerrain),
  houseFloorY(site, HOUSES[SECOND_HOUSE_INDEX], sampleTerrain),
]

export const villageHouseFloorYsForSiteWithResult = (
  site: VillageSite,
  sampleTerrain: OverworldTerrainResultSampler,
): Result.Result<VillageHouseFloorYs, OverworldTerrainSamplingFailure> => {
  const first = houseFloorYWithResult(site, HOUSES[FIRST_HOUSE_INDEX], sampleTerrain)
  if (Result.isFailure(first)) {return Result.fail(first.failure)}
  const second = houseFloorYWithResult(site, HOUSES[SECOND_HOUSE_INDEX], sampleTerrain)
  if (Result.isFailure(second)) {return Result.fail(second.failure)}
  return Result.succeed([first.success, second.success])
}

const villageVillagerSpawnForHouse = (
  seed: NoiseSeed,
  site: VillageSite,
  house: House,
  houseIndex: number,
  floorY: number,
): VillageVillagerSpawn => ({
  id: `village:${String(seed)}:${String(site.x)}:${String(site.z)}:house:${String(houseIndex)}`,
  profession: house.profession,
  villageSite: site,
  // eslint-disable-next-line id-length -- x is the canonical world axis.
  x: blockAxisFromKnownSafeInteger(site.x + house.x),
  // eslint-disable-next-line id-length, no-magic-numbers -- y is the canonical axis; feet occupy air above the floor.
  y: blockAxisFromKnownSafeInteger(floorY + 1),
  // eslint-disable-next-line id-length -- z is the canonical world axis.
  z: blockAxisFromKnownSafeInteger(site.z + house.z),
})

export const villageVillagerSpawnsForSiteWithFloorYs = (
  seed: NoiseSeed,
  site: VillageSite,
  floorYs: VillageHouseFloorYs,
): ReadonlyArray<VillageVillagerSpawn> => [
  villageVillagerSpawnForHouse(
    seed,
    site,
    HOUSES[FIRST_HOUSE_INDEX],
    FIRST_HOUSE_INDEX,
    floorYs[FIRST_HOUSE_INDEX],
  ),
  villageVillagerSpawnForHouse(
    seed,
    site,
    HOUSES[SECOND_HOUSE_INDEX],
    SECOND_HOUSE_INDEX,
    floorYs[SECOND_HOUSE_INDEX],
  ),
]

/** One stable spawn per generated house, standing on that house's actual floor. */
// eslint-disable-next-line id-length -- Spawn descriptors expose canonical world axes.
export const villageVillagerSpawnsForSite = (
  seed: NoiseSeed,
  site: VillageSite,
  sampleTerrain: OverworldTerrainSampler,
): ReadonlyArray<VillageVillagerSpawn> => villageVillagerSpawnsForSiteWithFloorYs(
  seed,
  site,
  villageHouseFloorYsForSite(site, sampleTerrain),
)

/** Enumerates only the stable village spawns owned by this chunk. */
// eslint-disable-next-line max-params -- Chunk lookup requires its seed, two coordinates and terrain sampler.
export const villageVillagerSpawnsForChunk = (
  seed: NoiseSeed,
  chunkX: ChunkAxis,
  chunkZ: ChunkAxis,
  sampleTerrain: OverworldTerrainSampler,
): Result.Result<ReadonlyArray<VillageVillagerSpawn>, InvalidNaturalStructureCoordinate> => {
  const sites = villageSitesNearChunk(seed, chunkX, chunkZ, sampleTerrain)
  if (Result.isFailure(sites)) {return Result.fail(sites.failure)}
  return Result.succeed(sites.success
    .flatMap((site) => villageVillagerSpawnsForSite(seed, site, sampleTerrain))
    .filter((spawn) =>
      Math.floor(spawn.x / CHUNK_SIZE_XZ) === chunkX && Math.floor(spawn.z / CHUNK_SIZE_XZ) === chunkZ,
    ))
}

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

const houseBlockAt = ({ site, house, wx, y, wz, sampleTerrain, floorY }: HouseBlockRequest): BlockId | undefined => {
  const dx = wx - (site.x + house.x)
  const dz = wz - (site.z + house.z)
  // eslint-disable-next-line no-undefined -- Absence means this coordinate is outside the house.
  if (!isInsideHouseFootprint(dx, dz)) { return undefined }

  const resolvedFloorY = floorY ?? houseFloorY(site, house, sampleTerrain)
  const { surfaceY } = sampleTerrain(wx, wz)
  return houseBlockWithinFootprint({ dx, dz, floorY: resolvedFloorY, house, surfaceY, y })
}

const villageRoadBlockAtSurface = (y: BlockAxis, surfaceY: BlockAxis): BlockId | undefined => {
  if (y === surfaceY) { return VILLAGE_BLOCK.ROAD }
  // eslint-disable-next-line no-magic-numbers -- Two air blocks provide walking headroom.
  if (y === surfaceY + 1 || y === surfaceY + 2) { return BLOCK.AIR }
  // eslint-disable-next-line no-undefined -- Absence preserves blocks outside road surface/headroom.
  return undefined
}

const villageRoadBlockAt = (
  site: VillageSite,
  wx: BlockAxis,
  y: BlockAxis,
  wz: BlockAxis,
  sampleTerrain: OverworldTerrainSampler,
): BlockId | undefined => {
  const dx = Math.abs(wx - site.x)
  const dz = Math.abs(wz - site.z)
  // eslint-disable-next-line no-magic-numbers -- Roads are three blocks wide and extend 28 blocks from the centre.
  const onRoad = (dx <= 1 && dz <= 28) || (dz <= 1 && dx <= 28)
  // eslint-disable-next-line no-undefined -- Absence preserves terrain beyond the road footprint.
  if (!onRoad) { return undefined }
  const { surfaceY } = sampleTerrain(wx, wz)
  return villageRoadBlockAtSurface(y, surfaceY)
}

export const villageBlockSamplerForSite = (
  site: VillageSite,
  sampleTerrain: OverworldTerrainSampler,
  floorYs: VillageHouseFloorYs,
): ((wx: BlockAxis, y: BlockAxis, wz: BlockAxis) => BlockId | undefined) =>
  (wx, y, wz) => {
    const first = houseBlockAt({
      floorY: floorYs[FIRST_HOUSE_INDEX],
      house: HOUSES[FIRST_HOUSE_INDEX],
      sampleTerrain,
      site,
      wx,
      wz,
      y,
    })
    if (Predicate.isNotUndefined(first)) {return first}
    const second = houseBlockAt({
      floorY: floorYs[SECOND_HOUSE_INDEX],
      house: HOUSES[SECOND_HOUSE_INDEX],
      sampleTerrain,
      site,
      wx,
      wz,
      y,
    })
    if (Predicate.isNotUndefined(second)) {return second}
    return villageRoadBlockAt(site, wx, y, wz, sampleTerrain)
  }

type VillageResultBlockSampler = (
  wx: BlockAxis,
  y: BlockAxis,
  wz: BlockAxis,
) => Result.Result<BlockId | undefined, OverworldTerrainSamplingFailure>

const houseBlockAtWithResult = ({
  site,
  house,
  wx,
  y,
  wz,
  sampleTerrain,
  floorY,
}: HouseBlockResultRequest): Result.Result<BlockId | undefined, OverworldTerrainSamplingFailure> => {
  const dx = wx - (site.x + house.x)
  const dz = wz - (site.z + house.z)
  if (!isInsideHouseFootprint(dx, dz)) {
    // eslint-disable-next-line no-undefined -- Outside the house keeps terrain unchanged.
    return Result.succeed(undefined)
  }
  const terrain = sampleTerrain(wx, wz)
  if (Result.isFailure(terrain)) {return Result.fail(terrain.failure)}
  return Result.succeed(houseBlockWithinFootprint({
    dx,
    dz,
    floorY,
    house,
    surfaceY: terrain.success.surfaceY,
    y,
  }))
}

const villageRoadBlockAtWithResult = (
  site: VillageSite,
  wx: BlockAxis,
  y: BlockAxis,
  wz: BlockAxis,
  sampleTerrain: OverworldTerrainResultSampler,
): Result.Result<BlockId | undefined, OverworldTerrainSamplingFailure> => {
  const dx = Math.abs(wx - site.x)
  const dz = Math.abs(wz - site.z)
  // eslint-disable-next-line no-magic-numbers -- Roads are three blocks wide and extend 28 blocks from the centre.
  const onRoad = (dx <= 1 && dz <= 28) || (dz <= 1 && dx <= 28)
  if (!onRoad) {
    // eslint-disable-next-line no-undefined -- Outside the road keeps terrain unchanged.
    return Result.succeed(undefined)
  }
  const terrain = sampleTerrain(wx, wz)
  if (Result.isFailure(terrain)) {return Result.fail(terrain.failure)}
  return Result.succeed(villageRoadBlockAtSurface(y, terrain.success.surfaceY))
}

export const villageBlockSamplerForSiteWithResult = (
  site: VillageSite,
  sampleTerrain: OverworldTerrainResultSampler,
  floorYs: VillageHouseFloorYs,
): VillageResultBlockSampler =>
  // eslint-disable-next-line max-statements -- House priority and road fallback mirror the raw sampler's resolver order.
  (wx, y, wz) => {
  const first = houseBlockAtWithResult(
    {
      floorY: floorYs[FIRST_HOUSE_INDEX],
      house: HOUSES[FIRST_HOUSE_INDEX],
      sampleTerrain,
      site,
      wx,
      wz,
      y,
    },
  )
  if (Result.isFailure(first)) {return Result.fail(first.failure)}
  if (Predicate.isNotUndefined(first.success)) {return first}
  const second = houseBlockAtWithResult(
    {
      floorY: floorYs[SECOND_HOUSE_INDEX],
      house: HOUSES[SECOND_HOUSE_INDEX],
      sampleTerrain,
      site,
      wx,
      wz,
      y,
    },
  )
  if (Result.isFailure(second)) {return Result.fail(second.failure)}
  if (Predicate.isNotUndefined(second.success)) {return second}
  return villageRoadBlockAtWithResult(site, wx, y, wz, sampleTerrain)
}

/** Resolves one world-space village block, including cleared walking/interior space. */
// eslint-disable-next-line max-params, max-statements -- Public point sampling requires world axes and terrain context.
export const villageBlockAt = (
  site: VillageSite,
  wx: BlockAxis,
  // eslint-disable-next-line id-length -- y is the canonical vertical axis.
  y: BlockAxis,
  wz: BlockAxis,
  sample: OverworldTerrainSampler,
): BlockId | undefined => {
  for (const house of HOUSES) {
    const block = houseBlockAt({ house, sampleTerrain: sample, site, wx, wz, y })
    // eslint-disable-next-line no-undefined -- Undefined is the resolver's no-structure sentinel.
    if (block !== undefined) { return block }
  }

  return villageRoadBlockAt(site, wx, y, wz, sample)
}
