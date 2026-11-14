import { describe, expect, it } from '@effect/vitest'
import { Effect, Option } from 'effect'
import { MAX_SURFACE_Y, MIN_SURFACE_Y } from '../src/domain/density-function'
import {
  createTerrainDensityColumnSampler,
  createTerrainDensityGrid,
  createTerrainDensitySurfaceSampler,
  TERRAIN_DENSITY_GRID_CELL_Y,
} from '../src/domain/density-grid'
import { blockAxis } from './fixtures/validated-inputs'

const yNodeCount = Math.ceil(MAX_SURFACE_Y / TERRAIN_DENSITY_GRID_CELL_Y) + 1
const DENSITY_X_WEIGHT = 3
const DENSITY_Y_WEIGHT = 2
const DENSITY_Z_WEIGHT = 7
const SURFACE_DENSITY_INTERCEPT = 100
const SURFACE_DENSITY_HORIZONTAL_SCALE = 0.25

describe('terrain density grid', () => {
  it.effect('trilinearly interpolates a linear density field from the 3×28×3 lattice', () =>
    Effect.sync(() => {
      let sampleCalls = 0
      const originX = -16
      const originZ = 32
      const grid = createTerrainDensityGrid((wx, wy, wz) => {
        sampleCalls += 1
        return Number(wx) * DENSITY_X_WEIGHT + Number(wy) * DENSITY_Y_WEIGHT + Number(wz) * DENSITY_Z_WEIGHT
      }, blockAxis(originX), blockAxis(originZ))
      const samples = new Float64Array(MAX_SURFACE_Y)

      for (let lx = 0; lx <= CHUNK_SIZE_XZ; lx += 1) {
        for (let lz = 0; lz <= CHUNK_SIZE_XZ; lz += 1) {
          grid.sampleColumn(lx, lz, samples)
          let y = 1
          for (const sample of samples) {
            expect(sample).toBe(
              (originX + lx) * DENSITY_X_WEIGHT + y * DENSITY_Y_WEIGHT + (originZ + lz) * DENSITY_Z_WEIGHT,
            )
            y += 1
          }
          expect(y).toBe(MAX_SURFACE_Y + 1)
        }
      }

      expect(sampleCalls).toBe(252)
    }),
  )

  it.effect('uses the same aligned density lattice for point queries and chunk columns', () =>
    Effect.sync(() => {
      const densityAt = (wx: number, wy: number, wz: number): number =>
        Number(wx) * DENSITY_X_WEIGHT + Number(wy) * DENSITY_Y_WEIGHT + Number(wz) * DENSITY_Z_WEIGHT
      const grid = createTerrainDensityGrid(densityAt, blockAxis(-16), blockAxis(32))
      const sampleColumnAt = createTerrainDensityColumnSampler(densityAt)
      const chunkSamples = new Float64Array(MAX_SURFACE_Y)
      const pointSamples = new Float64Array(MAX_SURFACE_Y)
      grid.sampleColumn(9, 13, chunkSamples)

      expect(sampleColumnAt(blockAxis(-7), blockAxis(45), pointSamples)).toBe(true)
      expect([...pointSamples]).toStrictEqual([...chunkSamples])
    }),
  )

  it.effect('finds the highest positive height in the interpolated density column', () =>
    Effect.sync(() => {
      const surfaceAt = createTerrainDensitySurfaceSampler((wx, wy, wz) =>
        SURFACE_DENSITY_INTERCEPT + (Number(wx) + Number(wz)) * SURFACE_DENSITY_HORIZONTAL_SCALE - Number(wy),
      )

      expect(surfaceAt(blockAxis(1), blockAxis(1))).toStrictEqual(Option.some(blockAxis(SURFACE_DENSITY_INTERCEPT)))
      expect(surfaceAt(blockAxis(7), blockAxis(6))).toStrictEqual(Option.some(blockAxis(SURFACE_DENSITY_INTERCEPT + 3)))
    }),
  )

  it.effect('returns the minimum surface when the interpolated density column has no positive cell', () =>
    Effect.sync(() => {
      const surfaceAt = createTerrainDensitySurfaceSampler(() => -1)

      expect(surfaceAt(blockAxis(1), blockAxis(1))).toStrictEqual(Option.some(blockAxis(MIN_SURFACE_Y)))
    }),
  )

  it.effect('reuses density corner columns for point queries in the same cell', () =>
    Effect.sync(() => {
      let sampleCalls = 0
      const sampleColumnAt = createTerrainDensityColumnSampler((wx, wy, wz) => {
        sampleCalls += 1
        return Number(wx) * DENSITY_X_WEIGHT + Number(wy) * DENSITY_Y_WEIGHT + Number(wz) * DENSITY_Z_WEIGHT
      })
      const firstSamples = new Float64Array(MAX_SURFACE_Y)
      const secondSamples = new Float64Array(MAX_SURFACE_Y)

      expect(sampleColumnAt(blockAxis(1), blockAxis(1), firstSamples)).toBe(true)
      expect(sampleCalls).toBe(4 * yNodeCount)
      expect(sampleColumnAt(blockAxis(7), blockAxis(6), secondSamples)).toBe(true)
      expect(sampleCalls).toBe(4 * yNodeCount)
      expect([...secondSamples]).toStrictEqual([...firstSamples].map((value) => value + 6 * DENSITY_X_WEIGHT + 5 * DENSITY_Z_WEIGHT))
    }),
  )

  it.effect('declines point-query lattices whose aligned chunk origin is not a safe coordinate', () =>
    Effect.sync(() => {
      const sampleColumnAt = createTerrainDensityColumnSampler((wx) => Number(wx))
      const surfaceAt = createTerrainDensitySurfaceSampler((wx) => Number(wx))
      const samples = new Float64Array(MAX_SURFACE_Y)

      expect(sampleColumnAt(blockAxis(Number.MIN_SAFE_INTEGER), blockAxis(0), samples)).toBe(false)
      expect(surfaceAt(blockAxis(Number.MIN_SAFE_INTEGER), blockAxis(0))).toStrictEqual(Option.none())
    }),
  )

  it.effect('keeps the final safe block coordinate sampleable at the largest chunk origin', () =>
    Effect.sync(() => {
      const maxSafeChunkOrigin = Number.MAX_SAFE_INTEGER - (CHUNK_SIZE_XZ - 1)
      const grid = createTerrainDensityGrid(
        (wx) => Number(wx),
        blockAxis(maxSafeChunkOrigin),
        blockAxis(0),
      )
      const samples = new Float64Array(MAX_SURFACE_Y)
      grid.sampleColumn(CHUNK_SIZE_XZ - 1, 0, samples)

      expect([...samples].at(-1)).toBe(Number.MAX_SAFE_INTEGER)
    }),
  )
})
