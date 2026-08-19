/* oxlint-disable curly, id-length, init-declarations, max-lines-per-function, max-statements, no-magic-numbers, no-ternary, no-undefined, sort-imports */

import { describe, expect, it } from '@effect/vitest'
import { BLOCK_IDS, chunkCoord } from '@nerima-games/mc-kernel'
import { Option } from 'effect'
import { BASTION_REMNANT_BLOCK, BASTION_REMNANT_GRID, BASTION_REMNANT_LAYOUT } from '../src/domain/bastion-remnant-data'
import { CHUNK_HEIGHT, CHUNK_SIZE_XZ } from '../src/domain/constants'
import {
  naturalStructurePlansForChunk,
  naturalStructureSliceForChunk,
  planBastionRemnantForRegion,
  type NaturalStructurePlan,
  type NetherStructureTerrainSampler,
} from '../src/domain/natural-structure'

const FLAT_NETHER: NetherStructureTerrainSampler = () => ({ ceilingY: 96, surfaceY: 48 })

type LocatedPlan = {
  readonly plan: NaturalStructurePlan
  readonly regionX: number
  readonly regionZ: number
}

const findBastion = (seed: number): LocatedPlan => {
  for (let regionX = -20; regionX <= 20; regionX += 1) {
    for (let regionZ = -20; regionZ <= 20; regionZ += 1) {
      const plan = planBastionRemnantForRegion(seed, regionX, regionZ, FLAT_NETHER)
      if (Option.isSome(plan)) return { plan: plan.value, regionX, regionZ }
    }
  }
  throw new Error('bastion remnant search range exhausted')
}

const findAbsentRegion = (seed: number): readonly [number, number] => {
  for (let regionX = -20; regionX <= 20; regionX += 1) {
    for (let regionZ = -20; regionZ <= 20; regionZ += 1) {
      if (Option.isNone(planBastionRemnantForRegion(seed, regionX, regionZ, FLAT_NETHER))) return [regionX, regionZ]
    }
  }
  throw new Error('bastion remnant absent-region search range exhausted')
}

describe('Bastion remnant plans', () => {
  it('are deterministic, immutable, sparse, and registry-safe', () => {
    const seed = 0x1234
    const located = findBastion(seed)
    const repeatedOption = planBastionRemnantForRegion(seed, located.regionX, located.regionZ, FLAT_NETHER)
    if (Option.isNone(repeatedOption)) throw new Error('expected repeated bastion remnant plan')
    const { plan } = located

    expect(repeatedOption.value).toStrictEqual(plan)
    expect(plan.kind).toBe('bastion-remnant')
    expect(plan.dimension).toBe('nether')
    expect(plan.origin.y).toBe(49)
    expect(plan.blocks.length).toBeGreaterThan(0)
    expect(plan.markers.length).toBeGreaterThan(0)
    expect(Object.isFrozen(plan)).toBe(true)
    expect(Object.isFrozen(plan.blocks)).toBe(true)
    expect(Object.isFrozen(plan.markers)).toBe(true)
    expect(Object.isFrozen(plan.bounds)).toBe(true)
    expect(Object.isFrozen(plan.origin)).toBe(true)
    expect(Object.isFrozen(plan.region)).toBe(true)

    const registered = new Set<number>(BLOCK_IDS)
    const placedBlocks = new Set(plan.blocks.map(({ block }) => block))
    for (const placement of plan.blocks) {
      expect(registered.has(placement.block)).toBe(true)
      expect(placement.y).toBeGreaterThanOrEqual(0)
      expect(placement.y).toBeLessThan(CHUNK_HEIGHT)
      expect(Math.floor(placement.x / BASTION_REMNANT_GRID.spacing)).toBeGreaterThanOrEqual(located.regionX - 1)
      expect(Math.floor(placement.z / BASTION_REMNANT_GRID.spacing)).toBeGreaterThanOrEqual(located.regionZ - 1)
    }
    for (const block of Object.values(BASTION_REMNANT_BLOCK)) expect(placedBlocks.has(block)).toBe(true)

    expect(plan.markers).toContainEqual(expect.objectContaining({ kind: 'loot-chest', lootTable: 'bastion-remnant' }))
    expect(plan.markers).toContainEqual(expect.objectContaining({ entity: 'piglin', kind: 'entity-spawn' }))
    expect(plan.markers).toContainEqual(expect.objectContaining({ entity: 'piglin-brute', kind: 'entity-spawn' }))
    for (const marker of plan.markers) expect(Object.isFrozen(marker)).toBe(true)
  })

  it('keeps the square footprint and exposes its compact bastion details', () => {
    const plan = findBastion(0x5678).plan
    const expectedExtent = BASTION_REMNANT_LAYOUT.halfExtent * 2

    expect(plan.bounds.maxX - plan.bounds.minX).toBe(expectedExtent)
    expect(plan.bounds.maxZ - plan.bounds.minZ).toBe(expectedExtent)
    expect(plan.bounds.minY).toBe(49)
    expect(plan.bounds.maxY).toBe(49 + BASTION_REMNANT_LAYOUT.centralTowerHeight)
    expect(plan.blocks).toContainEqual({
      block: BASTION_REMNANT_BLOCK.CHEST,
      x: plan.origin.x,
      y: plan.origin.y + BASTION_REMNANT_LAYOUT.chestYOffset,
      z: plan.origin.z,
    })
    expect(plan.blocks).toContainEqual({
      block: BASTION_REMNANT_BLOCK.SMOOTH_BASALT,
      x: plan.origin.x,
      y: plan.origin.y + BASTION_REMNANT_LAYOUT.centralTowerHeight,
      z: plan.origin.z - BASTION_REMNANT_LAYOUT.centralTowerHalfExtent,
    })
    expect(plan.blocks).toContainEqual({
      block: BASTION_REMNANT_BLOCK.GOLD_BLOCK,
      x: plan.origin.x - BASTION_REMNANT_LAYOUT.halfExtent + 2,
      y: plan.origin.y + 1,
      z: plan.origin.z - BASTION_REMNANT_LAYOUT.halfExtent + 2,
    })
  })

  it('rejects absent candidates, invalid terrain, excessive relief, and insufficient headroom', () => {
    const seed = 0x9abc
    const located = findBastion(seed)
    const [absentX, absentZ] = findAbsentRegion(seed)

    expect(Option.isNone(planBastionRemnantForRegion(seed, absentX, absentZ, FLAT_NETHER))).toBe(true)
    expect(Option.isNone(planBastionRemnantForRegion(seed, located.regionX, located.regionZ, () => undefined))).toBe(true)
    expect(Option.isNone(planBastionRemnantForRegion(seed, located.regionX, located.regionZ, () => ({ ceilingY: 96, surfaceY: -1 })))).toBe(true)
    expect(Option.isNone(planBastionRemnantForRegion(seed, located.regionX, located.regionZ, () => ({ ceilingY: 96, surfaceY: CHUNK_HEIGHT })))).toBe(true)
    expect(Option.isNone(planBastionRemnantForRegion(
      seed,
      located.regionX,
      located.regionZ,
      (x, z) => Math.abs(x - located.plan.origin.x) === BASTION_REMNANT_LAYOUT.halfExtent
        || Math.abs(z - located.plan.origin.z) === BASTION_REMNANT_LAYOUT.halfExtent
        ? { ceilingY: 96, surfaceY: 53 }
        : FLAT_NETHER(x, z),
    ))).toBe(true)
    expect(Option.isNone(planBastionRemnantForRegion(seed, located.regionX, located.regionZ, () => ({ ceilingY: 58, surfaceY: 48 })))).toBe(true)
    expect(Option.isNone(planBastionRemnantForRegion(
      seed,
      located.regionX,
      located.regionZ,
      () => ({ ceilingY: CHUNK_HEIGHT * 2, surfaceY: CHUNK_HEIGHT - BASTION_REMNANT_LAYOUT.centralTowerHeight }),
    ))).toBe(true)

    const raised = planBastionRemnantForRegion(seed, located.regionX, located.regionZ, () => ({ ceilingY: 96, surfaceY: 64 }))
    if (Option.isNone(raised)) throw new Error('expected raised bastion remnant plan')
    expect(raised.value.origin.y).toBe(65)
  })

  it('dispatches through Nether chunk plans and preserves chunk ownership', () => {
    const seed = 0x2468
    const located = findBastion(seed)
    const coordinate = chunkCoord(
      Math.floor(located.plan.origin.x / CHUNK_SIZE_XZ),
      Math.floor(located.plan.origin.z / CHUNK_SIZE_XZ),
    )
    const plans = naturalStructurePlansForChunk(seed, 'nether', coordinate, { nether: FLAT_NETHER })
    const bastion = plans.find(({ id }) => id === located.plan.id)
    if (bastion === undefined) throw new Error('expected bastion remnant in Nether chunk plans')

    const slice = naturalStructureSliceForChunk(bastion, coordinate.cx, coordinate.cz)
    expect(slice.blocks.length + slice.markers.length).toBeGreaterThan(0)
    expect(slice.blocks.every(({ x, z }) =>
      Math.floor(x / CHUNK_SIZE_XZ) === coordinate.cx && Math.floor(z / CHUNK_SIZE_XZ) === coordinate.cz,
    )).toBe(true)
    expect(slice.markers.every(({ x, z }) =>
      Math.floor(x / CHUNK_SIZE_XZ) === coordinate.cx && Math.floor(z / CHUNK_SIZE_XZ) === coordinate.cz,
    )).toBe(true)
  })
})
