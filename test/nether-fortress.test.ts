/* oxlint-disable curly, id-length, init-declarations, max-lines-per-function, max-statements, no-magic-numbers, no-ternary, no-undefined, sort-imports */

import { describe, expect, it } from '@effect/vitest'
import { BLOCK_IDS, chunkCoord } from '@nerima-games/mc-kernel'
import { Option } from 'effect'
import { CHUNK_HEIGHT, CHUNK_SIZE_XZ } from '../src/domain/constants'
import {
  FORTRESS_BLAZE_RADIUS,
  FORTRESS_FLOOR_Y,
  FORTRESS_LAYOUT,
  FORTRESS_MIN_HEADROOM,
  FORTRESS_REGION_SIZE,
  FORTRESS_SITE_MARGIN,
  NETHER_FORTRESS_BLOCK,
  isNearFortressSite,
  planNetherFortressForRegion,
} from '../src/domain/nether-fortress'
import {
  naturalStructurePlansForChunk,
  naturalStructureSliceForChunk,
  type NaturalStructurePlan,
} from '../src/domain/natural-structure'
import type { NetherStructureTerrainSampler } from '../src/domain/natural-structure'

const FLAT_NETHER: NetherStructureTerrainSampler = () => ({ ceilingY: 96, surfaceY: 48 })

type LocatedPlan = {
  readonly plan: NaturalStructurePlan
  readonly regionX: number
  readonly regionZ: number
}

const findFortress = (seed: number): LocatedPlan => {
  for (let regionX = -20; regionX <= 20; regionX += 1) {
    for (let regionZ = -20; regionZ <= 20; regionZ += 1) {
      const plan = planNetherFortressForRegion(seed, regionX, regionZ, FLAT_NETHER)
      if (Option.isSome(plan)) return { plan: plan.value, regionX, regionZ }
    }
  }
  throw new Error('Nether fortress search range exhausted')
}

const findAbsentRegion = (seed: number): readonly [number, number] => {
  for (let regionX = -20; regionX <= 20; regionX += 1) {
    for (let regionZ = -20; regionZ <= 20; regionZ += 1) {
      if (Option.isNone(planNetherFortressForRegion(seed, regionX, regionZ, FLAT_NETHER))) return [regionX, regionZ]
    }
  }
  throw new Error('Nether fortress absent-region search range exhausted')
}

const positionKey = (position: { readonly x: number; readonly y: number; readonly z: number }): string =>
  `${String(position.x)},${String(position.y)},${String(position.z)}`

describe('Nether fortress plans', () => {
  it('are deterministic, immutable, sparse, and registry-safe', () => {
    const seed = 0x1234
    const located = findFortress(seed)
    const repeatedOption = planNetherFortressForRegion(seed, located.regionX, located.regionZ, FLAT_NETHER)
    if (Option.isNone(repeatedOption)) throw new Error('expected repeated fortress plan')
    const { plan } = located

    expect(repeatedOption.value).toStrictEqual(plan)
    expect(plan.kind).toBe('nether-fortress')
    expect(plan.dimension).toBe('nether')
    expect(plan.origin.y).toBe(FORTRESS_FLOOR_Y)
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
      expect(Math.floor(placement.x / FORTRESS_REGION_SIZE)).toBeGreaterThanOrEqual(located.regionX - 1)
      expect(Math.floor(placement.z / FORTRESS_REGION_SIZE)).toBeGreaterThanOrEqual(located.regionZ - 1)
    }
    for (const block of Object.values(NETHER_FORTRESS_BLOCK)) expect(placedBlocks.has(block)).toBe(true)

    expect(plan.markers).toContainEqual(expect.objectContaining({ entity: 'blaze', kind: 'spawner' }))
    expect(plan.markers).toContainEqual(expect.objectContaining({ entity: 'blaze', kind: 'entity-spawn' }))
    expect(plan.markers).toContainEqual(expect.objectContaining({ entity: 'wither-skeleton', kind: 'entity-spawn' }))
    expect(plan.markers).toContainEqual(expect.objectContaining({ kind: 'loot-chest', lootTable: 'nether-fortress' }))
    for (const marker of plan.markers) expect(Object.isFrozen(marker)).toBe(true)
  })

  it('keeps the cross layout within its configured footprint and exposes semantic decoration', () => {
    const plan = findFortress(0x5678).plan
    const extentX = plan.bounds.maxX - plan.bounds.minX
    const extentZ = plan.bounds.maxZ - plan.bounds.minZ
    const expectedExtent = FORTRESS_LAYOUT.corridorHalfLength * 2

    expect(extentX).toBe(expectedExtent)
    expect(extentZ).toBe(expectedExtent)
    expect(plan.bounds.minY).toBe(FORTRESS_FLOOR_Y)
    expect(plan.bounds.maxY).toBe(FORTRESS_FLOOR_Y + FORTRESS_LAYOUT.wallHeight + 1)
    expect(plan.blocks).toContainEqual({
      block: NETHER_FORTRESS_BLOCK.CHEST,
      x: plan.origin.x,
      y: plan.origin.y + 1,
      z: plan.origin.z + 1,
    })
    expect(plan.markers.map(positionKey)).not.toHaveLength(0)
  })

  it('rejects absent candidates, invalid heights, and insufficient headroom', () => {
    const seed = 0x9abc
    const located = findFortress(seed)
    const [absentX, absentZ] = findAbsentRegion(seed)

    expect(Option.isNone(planNetherFortressForRegion(seed, absentX, absentZ, FLAT_NETHER))).toBe(true)
    expect(Option.isNone(planNetherFortressForRegion(seed, located.regionX, located.regionZ, () => undefined))).toBe(true)
    expect(Option.isNone(planNetherFortressForRegion(
      seed,
      located.regionX,
      located.regionZ,
      () => ({ ceilingY: 96, surfaceY: -1 }),
    ))).toBe(true)
    expect(Option.isNone(planNetherFortressForRegion(
      seed,
      located.regionX,
      located.regionZ,
      () => ({ ceilingY: CHUNK_HEIGHT * 2, surfaceY: CHUNK_HEIGHT }),
    ))).toBe(true)
    expect(Option.isNone(planNetherFortressForRegion(
      seed,
      located.regionX,
      located.regionZ,
      () => ({ ceilingY: FORTRESS_FLOOR_Y + FORTRESS_MIN_HEADROOM - 1, surfaceY: FORTRESS_FLOOR_Y }),
    ))).toBe(true)
    expect(Option.isNone(planNetherFortressForRegion(
      seed,
      located.regionX,
      located.regionZ,
      () => ({ ceilingY: CHUNK_HEIGHT * 2, surfaceY: CHUNK_HEIGHT - FORTRESS_MIN_HEADROOM + 1 }),
    ))).toBe(true)

    const raised = planNetherFortressForRegion(
      seed,
      located.regionX,
      located.regionZ,
      () => ({ ceilingY: 96, surfaceY: 64 }),
    )
    if (Option.isNone(raised)) throw new Error('expected raised fortress plan')
    expect(raised.value.origin.y).toBe(64)
  })

  it('answers proximity from accepted candidates and ignores absent regions', () => {
    const seed = 0xdef0
    const located = findFortress(seed)
    const { x, z } = located.plan.origin
    const [absentX, absentZ] = findAbsentRegion(seed)
    const absentPoint = {
      x: absentX * FORTRESS_REGION_SIZE + FORTRESS_SITE_MARGIN,
      z: absentZ * FORTRESS_REGION_SIZE + FORTRESS_SITE_MARGIN,
    }

    expect(isNearFortressSite(seed, x, z, 0)).toBe(true)
    expect(isNearFortressSite(seed, x + 1, z, 0)).toBe(false)
    expect(isNearFortressSite(seed, absentPoint.x, absentPoint.z, 0)).toBe(false)
    expect(isNearFortressSite(seed, x, z, FORTRESS_BLAZE_RADIUS)).toBe(true)
  })

  it('dispatches through the Nether chunk plan and preserves chunk ownership', () => {
    const seed = 0x2468
    const located = findFortress(seed)
    const coordinate = chunkCoord(
      Math.floor(located.plan.origin.x / CHUNK_SIZE_XZ),
      Math.floor(located.plan.origin.z / CHUNK_SIZE_XZ),
    )
    const plans = naturalStructurePlansForChunk(seed, 'nether', coordinate, { nether: FLAT_NETHER })
    const fortress = plans.find(({ id }) => id === located.plan.id)
    if (fortress === undefined) throw new Error('expected fortress in Nether chunk plans')

    const slices = naturalStructureSliceForChunk(fortress, coordinate.cx, coordinate.cz)
    expect(slices.blocks.length + slices.markers.length).toBeGreaterThan(0)
    expect(slices.blocks.every(({ x, z }) =>
      Math.floor(x / CHUNK_SIZE_XZ) === coordinate.cx && Math.floor(z / CHUNK_SIZE_XZ) === coordinate.cz)).toBe(true)
    expect(slices.markers.every(({ x, z }) =>
      Math.floor(x / CHUNK_SIZE_XZ) === coordinate.cx && Math.floor(z / CHUNK_SIZE_XZ) === coordinate.cz)).toBe(true)
  })
})
