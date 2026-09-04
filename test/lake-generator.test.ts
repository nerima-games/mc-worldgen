/* oxlint-disable no-magic-numbers */
import { describe, expect, it } from '@effect/vitest'
import { Effect, Option } from 'effect'
import { BLOCK } from '../src/domain/biome'
import { blockIndex, CHUNK_VOLUME, DEFAULT_TERRAIN_LEVELS } from '../src/domain/constants'
import {
  computeLakeBasin,
  determineWaterLevel,
  fillWaterForColumn,
  isLakeShoreColumn,
  resolveSurfaceY,
  shouldFreezeWaterSurface,
} from '../src/domain/lake-generator'
import { resolveSurfaceMaterial } from '../src/domain/surface-resolver'

describe('lake and river terrain resolution', () => {
  it.effect('carves only eligible inland basins and applies the maximum basin depth', () =>
    Effect.sync(() => {
      expect(Option.isNone(computeLakeBasin('OCEAN', 1, 80))).toBe(true)
      expect(Option.isNone(computeLakeBasin('PLAINS', 0.7, 80))).toBe(true)
      expect(Option.isNone(computeLakeBasin('PLAINS', 1, 62))).toBe(true)
      expect(computeLakeBasin('PLAINS', 1, 80)).toStrictEqual(Option.some(45))
    }),
  )

  it.effect('resolves river cuts before water filling while a lake basin takes precedence', () =>
    Effect.sync(() => {
      expect(resolveSurfaceY('RIVER', 80, Option.none())).toBe(60)
      expect(resolveSurfaceY('RIVER', 50, Option.none())).toBe(52)
      expect(resolveSurfaceY('RIVER', 65, Option.none())).toBe(60)
      expect(resolveSurfaceY('RIVER', 80, Option.some(44))).toBe(44)
      expect(resolveSurfaceY('PLAINS', 80, Option.none())).toBe(80)
    }),
  )

  it.effect('assigns water levels to rivers, lake basins and ordinary submerged columns', () =>
    Effect.sync(() => {
      expect(determineWaterLevel('RIVER', 80, Option.none())).toStrictEqual(Option.some(62))
      expect(determineWaterLevel('PLAINS', 60, Option.none())).toStrictEqual(Option.some(63))
      expect(determineWaterLevel('PLAINS', 80, Option.none())).toStrictEqual(Option.none())
      expect(determineWaterLevel('PLAINS', 45, Option.some(45))).toStrictEqual(Option.some(63))
      expect(determineWaterLevel('PLAINS', 45, Option.some(45), { seaLevel: 70, lakeLevel: 68 })).toStrictEqual(Option.some(68))
    }),
  )

  it.effect('freezes snow and cold water surfaces only', () =>
    Effect.sync(() => {
      expect(shouldFreezeWaterSurface('SNOW', 0.9)).toBe(true)
      expect(shouldFreezeWaterSurface('PLAINS', 0.15)).toBe(true)
      expect(shouldFreezeWaterSurface('PLAINS', 0.150001)).toBe(false)
    }),
  )

  it.effect('fills a water column and replaces only its top block with ice', () =>
    Effect.sync(() => {
      const blocks = new Uint16Array(CHUNK_VOLUME)
      fillWaterForColumn({
        biome: 'PLAINS',
        blocks,
        freezeSurface: true,
        iceBlockIndex: BLOCK.ICE,
        lakeBasinY: Option.some(60),
        lx: 3,
        lz: 4,
        surfaceY: 60,
        waterBlockIndex: BLOCK.WATER,
      })

      expect(blocks[blockIndex(3, 60, 4)]).toBe(BLOCK.AIR)
      expect(blocks[blockIndex(3, 61, 4)]).toBe(BLOCK.WATER)
      expect(blocks[blockIndex(3, 62, 4)]).toBe(BLOCK.WATER)
      expect(blocks[blockIndex(3, 63, 4)]).toBe(BLOCK.ICE)
    }),
  )

  it.effect('recognizes the narrow lake shore band only outside an existing basin', () =>
    Effect.sync(() => {
      expect(isLakeShoreColumn(Option.none(), 0.67, 65, DEFAULT_TERRAIN_LEVELS)).toBe(true)
      expect(isLakeShoreColumn(Option.none(), 0.659, 65, DEFAULT_TERRAIN_LEVELS)).toBe(false)
      expect(isLakeShoreColumn(Option.none(), 0.67, 67, DEFAULT_TERRAIN_LEVELS)).toBe(false)
      expect(isLakeShoreColumn(Option.some(64), 0.99, 60, DEFAULT_TERRAIN_LEVELS)).toBe(false)
    }),
  )
})

describe('surface material resolution', () => {
  it.effect('selects dry, submerged, lake-bed and shore materials independently', () =>
    Effect.sync(() => {
      expect(resolveSurfaceMaterial('PLAINS', 70, 63)).toStrictEqual({
        filler: BLOCK.DIRT,
        fillerDepth: 4,
        submerged: false,
        top: BLOCK.GRASS,
      })
      expect(resolveSurfaceMaterial('PLAINS', 60, 63)).toStrictEqual({
        filler: BLOCK.DIRT,
        fillerDepth: 4,
        submerged: true,
        top: BLOCK.GRAVEL,
      })
      expect(resolveSurfaceMaterial('PLAINS', 45, 63, { hasLakeBasin: true, isShore: false })).toStrictEqual({
        filler: BLOCK.SAND,
        fillerDepth: 2,
        submerged: true,
        top: BLOCK.SAND,
      })
      expect(resolveSurfaceMaterial('PLAINS', 65, 63, { hasLakeBasin: false, isShore: true })).toStrictEqual({
        filler: BLOCK.DIRT,
        fillerDepth: 2,
        submerged: false,
        top: BLOCK.SAND,
      })
    }),
  )
})
