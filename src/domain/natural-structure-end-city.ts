import {
  type Candidate,
  type CandidateChannelInput,
  type MutablePlan,
  UNIT_STEP,
  addBlock,
  addMarker,
  candidateForRegion,
  finishPlan,
} from './natural-structure-plan-builder'
import { END_OUTER_ISLAND_START, endSurfaceHeightAt } from './end-terrain'
import type {
  EndStructureTerrainSampler,
  NaturalStructurePlan,
  NaturalStructureRegion,
} from './natural-structure-types'
import { Option, Predicate } from 'effect'
import { channelSeed, latticeValue } from '@nerima-games/mc-noise'
import type { BlockId } from '@nerima-games/mc-kernel'
import { NATURAL_STRUCTURE_BLOCK } from './natural-structure-data'

const END_CITY_PROBE_OFFSET = 6
const END_CITY_MAX_SURFACE_VARIATION = 5
const END_CITY_BASE_Y_CLEARANCE = 1

const endTerrainFits = (candidate: Candidate, sample: EndStructureTerrainSampler): Option.Option<number> => {
  if (Math.hypot(candidate.x, candidate.z) < END_OUTER_ISLAND_START) {return Option.none()}
  const heights = [
    sample(candidate.x, candidate.z),
    sample(candidate.x - END_CITY_PROBE_OFFSET, candidate.z),
    sample(candidate.x + END_CITY_PROBE_OFFSET, candidate.z),
    sample(candidate.x, candidate.z - END_CITY_PROBE_OFFSET),
    sample(candidate.x, candidate.z + END_CITY_PROBE_OFFSET),
  ]
  if (heights.some(Predicate.isUndefined)) {return Option.none()}
  const present = heights.filter(Predicate.isNotUndefined)
  if (Math.max(...present) - Math.min(...present) > END_CITY_MAX_SURFACE_VARIATION) {return Option.none()}
  return Option.some(Math.max(...present) + END_CITY_BASE_Y_CLEARANCE)
}

const END_TOWER_HEIGHT = 20
const END_TOWER_HALF_EXTENT = 3
const END_TOWER_PILLAR_INTERVAL = 5
const END_TOWER_PILLAR_PHASE = 0

const endTowerBlockAt = (y: number): BlockId => {
  if (y % END_TOWER_PILLAR_INTERVAL === END_TOWER_PILLAR_PHASE) {
    return NATURAL_STRUCTURE_BLOCK.PURPUR_PILLAR
  }
  return NATURAL_STRUCTURE_BLOCK.PURPUR
}

const addEndTower = (mutable: MutablePlan, x: number, baseY: number, z: number): void => {
  for (let y = baseY; y <= baseY + END_TOWER_HEIGHT; y += UNIT_STEP) {
    for (let dx = -END_TOWER_HALF_EXTENT; dx <= END_TOWER_HALF_EXTENT; dx += UNIT_STEP) {
      for (let dz = -END_TOWER_HALF_EXTENT; dz <= END_TOWER_HALF_EXTENT; dz += UNIT_STEP) {
        const boundary = Math.abs(dx) === END_TOWER_HALF_EXTENT || Math.abs(dz) === END_TOWER_HALF_EXTENT
        if (y === baseY || y === baseY + END_TOWER_HEIGHT || boundary) {
          addBlock(mutable, { block: endTowerBlockAt(y), x: x + dx, y, z: z + dz })
        }
      }
    }
  }
}

const END_SHIP_HALF_LENGTH = 7
const END_SHIP_MIN_HALF_WIDTH = 1
const END_SHIP_MAX_HALF_WIDTH = 4
const END_SHIP_TAPER_DIVISOR = 2
const END_SHIP_MAST_HEIGHT = 8
const END_SHIP_DECK_Y_OFFSET = 1
const END_SHIP_CHEST_OFFSET_X = 4
const END_SHIP_END_ROD_OFFSET_X = 5

const addEndShip = (mutable: MutablePlan, x: number, y: number, z: number): void => {
  for (let dx = -END_SHIP_HALF_LENGTH; dx <= END_SHIP_HALF_LENGTH; dx += UNIT_STEP) {
    const halfWidth = Math.max(END_SHIP_MIN_HALF_WIDTH, END_SHIP_MAX_HALF_WIDTH - Math.floor(Math.abs(dx) / END_SHIP_TAPER_DIVISOR))
    for (let dz = -halfWidth; dz <= halfWidth; dz += UNIT_STEP) {addBlock(mutable, { block: NATURAL_STRUCTURE_BLOCK.PURPUR, x: x + dx, y, z: z + dz })}
  }
  for (let mastY = y + END_SHIP_DECK_Y_OFFSET; mastY <= y + END_SHIP_MAST_HEIGHT; mastY += UNIT_STEP) {
    addBlock(mutable, { block: NATURAL_STRUCTURE_BLOCK.PURPUR_PILLAR, x, y: mastY, z })
  }
  addBlock(mutable, { block: NATURAL_STRUCTURE_BLOCK.CHEST, x: x + END_SHIP_CHEST_OFFSET_X, y: y + END_SHIP_DECK_Y_OFFSET, z })
  addBlock(mutable, { block: NATURAL_STRUCTURE_BLOCK.END_ROD, x: x - END_SHIP_END_ROD_OFFSET_X, y: y + END_SHIP_DECK_Y_OFFSET, z })
}

type EndCitySite = { readonly candidate: Candidate; readonly baseY: number }

const endCitySiteForRegion = (
  seed: number,
  region: NaturalStructureRegion,
  sampleTerrain: EndStructureTerrainSampler,
  presenceChannelSeed?: CandidateChannelInput,
): Option.Option<EndCitySite> => {
  const candidateOption = candidateForRegion(seed, 'end', 'end-city', region, presenceChannelSeed)
  if (Option.isNone(candidateOption)) {return Option.none()}
  const candidate = candidateOption.value
  const baseYOption = endTerrainFits(candidate, sampleTerrain)
  if (Option.isNone(baseYOption)) {return Option.none()}
  return Option.some({ baseY: baseYOption.value, candidate })
}

const END_SHIP_DIRECTION_CHANCE = 0.5
const END_SHIP_DIRECTION_NEGATIVE = -1
const END_SHIP_DIRECTION_POSITIVE = 1
const END_SHIP_DISTANCE = 24
const END_SHIP_DECK_HEIGHT_ABOVE_BASE = 14

const endShipDirection = (chance: number): number => {
  if (chance < END_SHIP_DIRECTION_CHANCE) {
    return END_SHIP_DIRECTION_NEGATIVE
  }
  return END_SHIP_DIRECTION_POSITIVE
}

type EndCityShipPosition = { readonly shipX: number; readonly shipY: number }

const endShipPositionFor = (
  seed: number,
  region: NaturalStructureRegion,
  candidate: Candidate,
  baseY: number,
): EndCityShipPosition => {
  const direction = endShipDirection(latticeValue(channelSeed(seed, 'end:end-city:ship-direction'), region.x, region.z))
  return { shipX: candidate.x + direction * END_SHIP_DISTANCE, shipY: baseY + END_SHIP_DECK_HEIGHT_ABOVE_BASE }
}

const END_CITY_CHEST_OFFSET_X = 1
const END_CITY_CHEST_Y_OFFSET = 1
const END_CITY_SPAWNER_Y_OFFSET = 10
const END_SHIP_LOOT_OFFSET_X = 4
const END_SHIP_LOOT_Y_OFFSET = 1

const placeEndCityDecorations = (mutable: MutablePlan, candidate: Candidate, baseY: number, ship: EndCityShipPosition): void => {
  addBlock(mutable, { block: NATURAL_STRUCTURE_BLOCK.END_STONE_BRICKS, x: candidate.x, y: baseY, z: candidate.z })
  addBlock(mutable, {
    block: NATURAL_STRUCTURE_BLOCK.CHEST,
    x: candidate.x + END_CITY_CHEST_OFFSET_X,
    y: baseY + END_CITY_CHEST_Y_OFFSET,
    z: candidate.z,
  })
  addMarker(mutable, { entity: 'shulker', kind: 'spawner', x: candidate.x, y: baseY + END_CITY_SPAWNER_Y_OFFSET, z: candidate.z })
  addMarker(mutable, {
    kind: 'loot-chest',
    lootTable: 'end-city',
    x: candidate.x + END_CITY_CHEST_OFFSET_X,
    y: baseY + END_CITY_CHEST_Y_OFFSET,
    z: candidate.z,
  })
  addMarker(mutable, { kind: 'end-ship', x: ship.shipX, y: ship.shipY, z: candidate.z })
  addMarker(mutable, {
    kind: 'loot-chest',
    lootTable: 'end-ship',
    x: ship.shipX + END_SHIP_LOOT_OFFSET_X,
    y: ship.shipY + END_SHIP_LOOT_Y_OFFSET,
    z: candidate.z,
  })
}

/** Plans an End city tower and its ship on a broad, level outer island. */
export const planEndCityForRegion = (
  seed: number,
  regionX: number,
  regionZ: number,
  sampleTerrain: EndStructureTerrainSampler = (x, z) => endSurfaceHeightAt(seed, x, z),
  presenceChannelSeed?: CandidateChannelInput,
): Option.Option<NaturalStructurePlan> => {
  const siteOption = endCitySiteForRegion(seed, { x: regionX, z: regionZ }, sampleTerrain, presenceChannelSeed)
  if (Option.isNone(siteOption)) {return Option.none()}
  const { candidate, baseY } = siteOption.value
  const ship = endShipPositionFor(seed, { x: regionX, z: regionZ }, candidate, baseY)
  const mutable: MutablePlan = { blocks: new Map(), markers: [] }
  addEndTower(mutable, candidate.x, baseY, candidate.z)
  addEndShip(mutable, ship.shipX, ship.shipY, candidate.z)
  placeEndCityDecorations(mutable, candidate, baseY, ship)
  return Option.some(finishPlan(
    {
      dimension: 'end',
      id: `end-city:${String(seed)}:${String(regionX)}:${String(regionZ)}`,
      kind: 'end-city',
      origin: { x: candidate.x, y: baseY, z: candidate.z },
      region: { x: regionX, z: regionZ },
    },
    mutable,
  ))
}
