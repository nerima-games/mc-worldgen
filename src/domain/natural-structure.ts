/* oxlint-disable curly, id-length, max-params, max-statements, new-cap, no-continue, no-magic-numbers, no-ternary, no-undefined, prefer-destructuring, sort-imports */

/** Deterministic, immutable plans for cross-chunk natural structures. */
import { Option } from 'effect'
import { CHUNK_HEIGHT, CHUNK_SIZE_XZ } from './constants'
import { END_OUTER_ISLAND_START, endSurfaceHeightAt } from './end-terrain'
import { BlockId } from './kernel-vocabulary'
import type { Dimension } from './nether-travel'
import { channelSeed, latticeValue } from './seeded-random'
import {
  type VillageTerrainSampler,
  VILLAGE_HALF_EXTENT,
  VILLAGE_REGION_SIZE,
  VILLAGE_SITE_MARGIN,
  villageSiteForRegion,
} from './structure-siting'
import { villageBlockAt, villageVillagerSpawnsForSite } from './village'

export type NaturalStructureKind = 'village' | 'ruined-nether-portal' | 'end-city'

export type NaturalStructureGrid = {
  /** Distance between candidate-region origins, in blocks. */
  readonly spacing: number
  /** Guaranteed minimum distance between candidates in adjacent regions, in blocks. */
  readonly separation: number
  /** Fraction of regions that reach terrain validation, in permille. */
  readonly spawnPermille: number
}

export const NATURAL_STRUCTURE_GRID: Readonly<Record<NaturalStructureKind, NaturalStructureGrid>> = Object.freeze({
  'end-city': Object.freeze({ separation: 176, spacing: 320, spawnPermille: 350 }),
  'ruined-nether-portal': Object.freeze({ separation: 64, spacing: 192, spawnPermille: 300 }),
  village: Object.freeze({ separation: VILLAGE_SITE_MARGIN * 2, spacing: VILLAGE_REGION_SIZE, spawnPermille: 120 }),
})

export const MAX_NATURAL_STRUCTURE_BLOCKS = 4096
export const MAX_NATURAL_STRUCTURE_MARKERS = 32

export const NATURAL_STRUCTURE_BLOCK = Object.freeze({
  CHEST: BlockId(105),
  END_ROD: BlockId(95),
  END_STONE_BRICKS: BlockId(96),
  NETHERRACK: BlockId(117),
  OBSIDIAN: BlockId(40),
  PURPUR: BlockId(98),
  PURPUR_PILLAR: BlockId(99),
})

export type NaturalStructureRegion = { readonly x: number; readonly z: number }
export type NaturalStructurePosition = { readonly x: number; readonly y: number; readonly z: number }
export type NaturalStructureBounds = {
  readonly minX: number
  readonly maxX: number
  readonly minY: number
  readonly maxY: number
  readonly minZ: number
  readonly maxZ: number
}
export type NaturalStructureBlockPlacement = NaturalStructurePosition & { readonly block: BlockId }

export type NaturalStructureMarker = NaturalStructurePosition & (
  | { readonly kind: 'loot-chest'; readonly lootTable: 'village' | 'ruined-nether-portal' | 'end-city' | 'end-ship' }
  | { readonly kind: 'entity-spawn'; readonly entity: 'villager'; readonly profession: 'farmer' | 'toolsmith' }
  | { readonly kind: 'spawner'; readonly entity: 'shulker' }
  | { readonly kind: 'portal-frame'; readonly axis: 'x' | 'z'; readonly complete: false }
  | { readonly kind: 'end-ship' }
)

export type NaturalStructurePlan = {
  readonly id: string
  readonly kind: NaturalStructureKind
  readonly dimension: Dimension
  readonly region: NaturalStructureRegion
  readonly origin: NaturalStructurePosition
  readonly bounds: NaturalStructureBounds
  readonly blocks: ReadonlyArray<NaturalStructureBlockPlacement>
  readonly markers: ReadonlyArray<NaturalStructureMarker>
}

export type NaturalStructureChunkSlice = {
  readonly chunkX: number
  readonly chunkZ: number
  readonly blocks: ReadonlyArray<NaturalStructureBlockPlacement>
  readonly markers: ReadonlyArray<NaturalStructureMarker>
}

export type NetherStructureTerrainSample = {
  readonly surfaceY: number
  readonly ceilingY: number
}
export type NetherStructureTerrainSampler = (x: number, z: number) => NetherStructureTerrainSample
export type EndStructureTerrainSampler = (x: number, z: number) => number | undefined

type Candidate = NaturalStructureRegion
type MutablePlan = {
  readonly blocks: Map<string, NaturalStructureBlockPlacement>
  readonly markers: Array<NaturalStructureMarker>
}

const keyOf = (x: number, y: number, z: number): string => `${String(x)},${String(y)},${String(z)}`
const floorDiv = (value: number, divisor: number): number => Math.floor(value / divisor)

const candidateForRegion = (
  seed: number,
  dimension: Dimension,
  kind: NaturalStructureKind,
  regionX: number,
  regionZ: number,
): Option.Option<Candidate> => {
  const grid = NATURAL_STRUCTURE_GRID[kind]
  if (latticeValue(channelSeed(seed, `${dimension}:${kind}:present`), regionX, regionZ) >= grid.spawnPermille / 1000) {
    return Option.none()
  }
  const margin = grid.separation / 2
  const span = grid.spacing - grid.separation
  return Option.some(Object.freeze({
    x: regionX * grid.spacing + margin + Math.floor(latticeValue(channelSeed(seed, `${dimension}:${kind}:x`), regionX, regionZ) * span),
    z: regionZ * grid.spacing + margin + Math.floor(latticeValue(channelSeed(seed, `${dimension}:${kind}:z`), regionX, regionZ) * span),
  }))
}

const addBlock = (mutable: MutablePlan, x: number, y: number, z: number, block: BlockId): void => {
  if (y < 0 || y >= CHUNK_HEIGHT) return
  const key = keyOf(x, y, z)
  if (!mutable.blocks.has(key) && mutable.blocks.size >= MAX_NATURAL_STRUCTURE_BLOCKS) return
  mutable.blocks.set(key, Object.freeze({ block, x, y, z }))
}

const addMarker = (mutable: MutablePlan, marker: NaturalStructureMarker): void => {
  if (mutable.markers.length < MAX_NATURAL_STRUCTURE_MARKERS) mutable.markers.push(Object.freeze(marker))
}

const finishPlan = (
  id: string,
  kind: NaturalStructureKind,
  dimension: Dimension,
  regionX: number,
  regionZ: number,
  origin: NaturalStructurePosition,
  mutable: MutablePlan,
): NaturalStructurePlan => {
  const blocks = Object.freeze([...mutable.blocks.values()])
  const markers = Object.freeze([...mutable.markers])
  const positions: ReadonlyArray<NaturalStructurePosition> = [...blocks, ...markers]
  const xs = positions.map((position) => position.x)
  const ys = positions.map((position) => position.y)
  const zs = positions.map((position) => position.z)
  const bounds = Object.freeze({
    maxX: Math.max(...xs), maxY: Math.max(...ys), maxZ: Math.max(...zs),
    minX: Math.min(...xs), minY: Math.min(...ys), minZ: Math.min(...zs),
  })
  return Object.freeze({
    blocks,
    bounds,
    dimension,
    id,
    kind,
    markers,
    origin: Object.freeze(origin),
    region: Object.freeze({ x: regionX, z: regionZ }),
  })
}

/** Projects a plan without observing or mutating loaded neighbouring chunks. */
export const naturalStructureSliceForChunk = (
  plan: NaturalStructurePlan,
  chunkX: number,
  chunkZ: number,
): NaturalStructureChunkSlice => Object.freeze({
  blocks: Object.freeze(plan.blocks.filter((block) =>
    floorDiv(block.x, CHUNK_SIZE_XZ) === chunkX && floorDiv(block.z, CHUNK_SIZE_XZ) === chunkZ,
  )),
  chunkX,
  chunkZ,
  markers: Object.freeze(plan.markers.filter((marker) =>
    floorDiv(marker.x, CHUNK_SIZE_XZ) === chunkX && floorDiv(marker.z, CHUNK_SIZE_XZ) === chunkZ,
  )),
})

/** Plans the same village layout used by the Overworld chunk generator. */
export const planVillageForRegion = (
  seed: number,
  regionX: number,
  regionZ: number,
  sampleTerrain: VillageTerrainSampler,
): Option.Option<NaturalStructurePlan> => {
  const siteOption = villageSiteForRegion(seed, regionX, regionZ, sampleTerrain)
  if (Option.isNone(siteOption)) return Option.none()
  const site = siteOption.value
  const mutable: MutablePlan = { blocks: new Map(), markers: [] }
  for (let x = site.x - VILLAGE_HALF_EXTENT; x <= site.x + VILLAGE_HALF_EXTENT; x += 1) {
    for (let z = site.z - VILLAGE_HALF_EXTENT; z <= site.z + VILLAGE_HALF_EXTENT; z += 1) {
      const surfaceY = sampleTerrain(x, z).surfaceY
      for (let y = surfaceY; y < Math.min(CHUNK_HEIGHT, surfaceY + 16); y += 1) {
        const block = villageBlockAt(site, x, y, z, sampleTerrain)
        if (block !== undefined) addBlock(mutable, x, y, z, block)
      }
    }
  }
  const spawns = villageVillagerSpawnsForSite(seed, site, sampleTerrain)
  for (const spawn of spawns) {
    addMarker(mutable, { entity: 'villager', kind: 'entity-spawn', profession: spawn.profession, x: spawn.x, y: spawn.y, z: spawn.z })
  }
  const lootSpawn = spawns[0]
  if (lootSpawn !== undefined) {
    const lootX = lootSpawn.x + 1
    addBlock(mutable, lootX, lootSpawn.y, lootSpawn.z, NATURAL_STRUCTURE_BLOCK.CHEST)
    addMarker(mutable, { kind: 'loot-chest', lootTable: 'village', x: lootX, y: lootSpawn.y, z: lootSpawn.z })
  }
  return Option.some(finishPlan(
    `village:${String(seed)}:${String(regionX)}:${String(regionZ)}`,
    'village', 'overworld', regionX, regionZ, { x: site.x, y: sampleTerrain(site.x, site.z).surfaceY, z: site.z }, mutable,
  ))
}

const portalTerrainFits = (candidate: Candidate, sample: NetherStructureTerrainSampler): Option.Option<number> => {
  const probes = [
    sample(candidate.x, candidate.z), sample(candidate.x - 3, candidate.z), sample(candidate.x + 3, candidate.z),
    sample(candidate.x, candidate.z - 3), sample(candidate.x, candidate.z + 3),
  ]
  const surfaces = probes.map((probe) => probe.surfaceY)
  const baseY = Math.max(...surfaces) + 1
  if (Math.max(...surfaces) - Math.min(...surfaces) > 6 || probes.some((probe) => probe.ceilingY - baseY < 7)) {
    return Option.none()
  }
  return Option.some(baseY)
}

/** Plans an intentionally incomplete, unlit Nether portal ruin. */
export const planRuinedNetherPortalForRegion = (
  seed: number,
  regionX: number,
  regionZ: number,
  sampleTerrain: NetherStructureTerrainSampler,
): Option.Option<NaturalStructurePlan> => {
  const candidateOption = candidateForRegion(seed, 'nether', 'ruined-nether-portal', regionX, regionZ)
  if (Option.isNone(candidateOption)) return Option.none()
  const candidate = candidateOption.value
  const baseYOption = portalTerrainFits(candidate, sampleTerrain)
  if (Option.isNone(baseYOption)) return Option.none()
  const baseY = baseYOption.value
  const axis: 'x' | 'z' = latticeValue(channelSeed(seed, 'nether:ruined-nether-portal:axis'), regionX, regionZ) < 0.5 ? 'x' : 'z'
  const missing = Math.floor(latticeValue(channelSeed(seed, 'nether:ruined-nether-portal:damage'), regionX, regionZ) * 4)
  const mutable: MutablePlan = { blocks: new Map(), markers: [] }
  for (let across = -3; across <= 3; across += 1) {
    for (let along = -2; along <= 2; along += 1) {
      const x = candidate.x + (axis === 'x' ? across : along)
      const z = candidate.z + (axis === 'x' ? along : across)
      addBlock(mutable, x, baseY - 1, z, NATURAL_STRUCTURE_BLOCK.NETHERRACK)
    }
  }
  for (let horizontal = 0; horizontal < 4; horizontal += 1) {
    for (let vertical = 0; vertical < 5; vertical += 1) {
      if (horizontal !== 0 && horizontal !== 3 && vertical !== 0 && vertical !== 4) continue
      if ((horizontal + vertical) % 4 === missing) continue
      const x = candidate.x + (axis === 'x' ? horizontal - 1 : 0)
      const z = candidate.z + (axis === 'z' ? horizontal - 1 : 0)
      addBlock(mutable, x, baseY + vertical, z, NATURAL_STRUCTURE_BLOCK.OBSIDIAN)
    }
  }
  addBlock(mutable, candidate.x + 3, baseY, candidate.z + 2, NATURAL_STRUCTURE_BLOCK.CHEST)
  addMarker(mutable, { axis, complete: false, kind: 'portal-frame', x: candidate.x, y: baseY, z: candidate.z })
  addMarker(mutable, { kind: 'loot-chest', lootTable: 'ruined-nether-portal', x: candidate.x + 3, y: baseY, z: candidate.z + 2 })
  return Option.some(finishPlan(
    `ruined-nether-portal:${String(seed)}:${String(regionX)}:${String(regionZ)}`,
    'ruined-nether-portal', 'nether', regionX, regionZ, { x: candidate.x, y: baseY, z: candidate.z }, mutable,
  ))
}

const endTerrainFits = (candidate: Candidate, sample: EndStructureTerrainSampler): Option.Option<number> => {
  if (Math.hypot(candidate.x, candidate.z) < END_OUTER_ISLAND_START) return Option.none()
  const heights = [
    sample(candidate.x, candidate.z), sample(candidate.x - 6, candidate.z), sample(candidate.x + 6, candidate.z),
    sample(candidate.x, candidate.z - 6), sample(candidate.x, candidate.z + 6),
  ]
  if (heights.some((height) => height === undefined)) return Option.none()
  const present = heights.filter((height): height is number => height !== undefined)
  if (Math.max(...present) - Math.min(...present) > 5) return Option.none()
  return Option.some(Math.max(...present) + 1)
}

const addEndTower = (mutable: MutablePlan, x: number, baseY: number, z: number): void => {
  for (let y = baseY; y <= baseY + 20; y += 1) {
    for (let dx = -3; dx <= 3; dx += 1) {
      for (let dz = -3; dz <= 3; dz += 1) {
        const boundary = Math.abs(dx) === 3 || Math.abs(dz) === 3
        if (y === baseY || y === baseY + 20 || boundary) {
          addBlock(mutable, x + dx, y, z + dz, y % 5 === 0 ? NATURAL_STRUCTURE_BLOCK.PURPUR_PILLAR : NATURAL_STRUCTURE_BLOCK.PURPUR)
        }
      }
    }
  }
}

const addEndShip = (mutable: MutablePlan, x: number, y: number, z: number): void => {
  for (let dx = -7; dx <= 7; dx += 1) {
    const halfWidth = Math.max(1, 4 - Math.floor(Math.abs(dx) / 2))
    for (let dz = -halfWidth; dz <= halfWidth; dz += 1) addBlock(mutable, x + dx, y, z + dz, NATURAL_STRUCTURE_BLOCK.PURPUR)
  }
  for (let mastY = y + 1; mastY <= y + 8; mastY += 1) addBlock(mutable, x, mastY, z, NATURAL_STRUCTURE_BLOCK.PURPUR_PILLAR)
  addBlock(mutable, x + 4, y + 1, z, NATURAL_STRUCTURE_BLOCK.CHEST)
  addBlock(mutable, x - 5, y + 1, z, NATURAL_STRUCTURE_BLOCK.END_ROD)
}

/** Plans an End city tower and its ship on a broad, level outer island. */
export const planEndCityForRegion = (
  seed: number,
  regionX: number,
  regionZ: number,
  sampleTerrain: EndStructureTerrainSampler = (x, z) => endSurfaceHeightAt(seed, x, z),
): Option.Option<NaturalStructurePlan> => {
  const candidateOption = candidateForRegion(seed, 'end', 'end-city', regionX, regionZ)
  if (Option.isNone(candidateOption)) return Option.none()
  const candidate = candidateOption.value
  const baseYOption = endTerrainFits(candidate, sampleTerrain)
  if (Option.isNone(baseYOption)) return Option.none()
  const baseY = baseYOption.value
  const direction = latticeValue(channelSeed(seed, 'end:end-city:ship-direction'), regionX, regionZ) < 0.5 ? -1 : 1
  const shipX = candidate.x + direction * 24
  const shipY = baseY + 14
  const mutable: MutablePlan = { blocks: new Map(), markers: [] }
  addEndTower(mutable, candidate.x, baseY, candidate.z)
  addEndShip(mutable, shipX, shipY, candidate.z)
  addBlock(mutable, candidate.x, baseY, candidate.z, NATURAL_STRUCTURE_BLOCK.END_STONE_BRICKS)
  addBlock(mutable, candidate.x + 1, baseY + 1, candidate.z, NATURAL_STRUCTURE_BLOCK.CHEST)
  addMarker(mutable, { entity: 'shulker', kind: 'spawner', x: candidate.x, y: baseY + 10, z: candidate.z })
  addMarker(mutable, { kind: 'loot-chest', lootTable: 'end-city', x: candidate.x + 1, y: baseY + 1, z: candidate.z })
  addMarker(mutable, { kind: 'end-ship', x: shipX, y: shipY, z: candidate.z })
  addMarker(mutable, { kind: 'loot-chest', lootTable: 'end-ship', x: shipX + 4, y: shipY + 1, z: candidate.z })
  return Option.some(finishPlan(
    `end-city:${String(seed)}:${String(regionX)}:${String(regionZ)}`,
    'end-city', 'end', regionX, regionZ, { x: candidate.x, y: baseY, z: candidate.z }, mutable,
  ))
}
