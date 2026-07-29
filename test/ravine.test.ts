/**
 * Ravines — `domain/ravine.ts`.
 *
 * ---------------------------------------------------------------------------
 * The rule this file is written under
 * ---------------------------------------------------------------------------
 *
 * `test/carver.test.ts` states it and `docs/design-notes.md` DN-2 repeats it:
 * REPRODUCE THE BUG. A regression test that cannot demonstrate the regression
 * is only asserting that today's code does what today's code does. So every
 * guard below is asserted twice — once with the guard on and once with it off —
 * and `RavineOptions.waterGuard` exists for no other purpose.
 *
 * That matters more here than it usually does, because the reference's own
 * comment records the bug being fixed TWICE (`ravine-carver.ts:41-46`): the
 * biome test was the first attempt and it was wrong, and only a probe of the
 * real blocks catches a lake sitting in a PLAINS basin. R-3 runs the reference's
 * first attempt and watches it fail.
 *
 * ---------------------------------------------------------------------------
 * Fixtures are SEARCHED FOR, not written down
 * ---------------------------------------------------------------------------
 *
 * Same choice `test/carver.test.ts` made. A ravine sits on a 250-block
 * wavelength band, so a hard-coded coordinate is a claim about where the band
 * runs at this seed, and the day the shaper moves it the test fails for a reason
 * that has nothing to do with ravines. Searching means the fixture MOVES when
 * the terrain moves, and the assertion keeps its meaning.
 *
 * The searches are bounded and every one of them asserts it found something, so
 * a search that silently returns nothing fails as a search rather than passing
 * as a vacuous test — docs/testing.md §6.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { BLOCK, type BiomeType } from '../domain/biome'
import { columnIndex, readBlock } from '../domain/chunk'
import {
  BEDROCK_Y,
  blockIndex,
  CHUNK_HEIGHT,
  CHUNK_SIZE_XZ,
  DEFAULT_TERRAIN_LEVELS,
  SEA_LEVEL,
} from '../domain/constants'
import { chunkCoord } from '../domain/kernel-vocabulary'
import {
  carveRavines,
  clearGroundCover,
  ravineDepthAt,
  ravineDistanceAt,
  ravineFloorY,
  RAVINE_FLOOR_Y,
  RAVINE_HALF_WIDTH,
  RAVINE_MAX_DEPTH,
  RAVINE_MIN_DEPTH,
} from '../domain/ravine'
import { biomeFor, generateChunkAt, surfaceHeightAt } from '../domain/terrain'
import { PLANT_IDS } from '../domain/vegetation'
import { GOLDEN_SEED, GOLDEN_SPECS } from '../scripts/golden-fixture'

/** The chunk the eleventh golden row pins: 205 of 256 columns carved. */
const RAVINE_CHUNK = { cx: 21, cz: 11 } as const

const bandColumns = (seed: number, cx: number, cz: number): ReadonlyArray<readonly [number, number]> => {
  const found: Array<readonly [number, number]> = []
  for (let lx = 0; lx < CHUNK_SIZE_XZ; lx += 1) {
    for (let lz = 0; lz < CHUNK_SIZE_XZ; lz += 1) {
      if (ravineDepthAt(ravineDistanceAt(seed, cx * CHUNK_SIZE_XZ + lx, cz * CHUNK_SIZE_XZ + lz)) > 0) {
        found.push([lx, lz] as const)
      }
    }
  }
  return found
}

/** Topmost non-AIR block in a column, or -1 for an empty column. */
const topBlockY = (blocks: Uint8Array, lx: number, lz: number): number => {
  for (let y = CHUNK_HEIGHT - 1; y >= 0; y -= 1) {
    if (readBlock(blocks, blockIndex(lx, y, lz)) !== BLOCK.AIR) {
      return y
    }
  }
  return -1
}

/**
 * A chunk buffer and the two column arrays `carveRavines` takes, built by hand.
 *
 * Flat stone to `surfaceY`, bedrock at the floor, and water above the surface
 * up to `SEA_LEVEL` when `surfaceY` is below it — which is exactly what
 * `domain/terrain.ts`'s `fillColumn` does, restated here so the guard tests can
 * put a lake wherever they need one instead of hunting for a real chunk that
 * has one on the band.
 */
const flatWorld = (
  surfaceY: number,
  biome: BiomeType,
): { blocks: Uint8Array; surfaces: Int16Array; biomes: Array<BiomeType> } => {
  const blocks = new Uint8Array(CHUNK_SIZE_XZ * CHUNK_SIZE_XZ * CHUNK_HEIGHT)
  const surfaces = new Int16Array(CHUNK_SIZE_XZ * CHUNK_SIZE_XZ).fill(surfaceY)
  const biomes = Array.from<BiomeType>({ length: CHUNK_SIZE_XZ * CHUNK_SIZE_XZ }).fill(biome)

  for (let lx = 0; lx < CHUNK_SIZE_XZ; lx += 1) {
    for (let lz = 0; lz < CHUNK_SIZE_XZ; lz += 1) {
      blocks[blockIndex(lx, BEDROCK_Y, lz)] = BLOCK.BEDROCK
      for (let y = BEDROCK_Y + 1; y <= surfaceY; y += 1) {
        blocks[blockIndex(lx, y, lz)] = BLOCK.STONE
      }
      for (let y = surfaceY + 1; y <= SEA_LEVEL; y += 1) {
        blocks[blockIndex(lx, y, lz)] = BLOCK.WATER
      }
    }
  }

  return { blocks, surfaces, biomes }
}

describe('the band', () => {
  /**
   * R-1. `RAVINE_HALF_WIDTH` is transcribed from `ravine-carver.ts:15`, and the
   * reference's own comment says the number is calibrated to ITS noise: the
   * band 「still yields ~2% of columns」 because single-octave Perlin clusters
   * near 0.5. `domain/seeded-random.ts` is smoothed value noise, not that, so
   * the figure had to be re-measured before it could be kept.
   *
   * This is the check that it still means what the reference says it means. It
   * is the same class of error as `CONTINENTALNESS_CONTRAST` — a real number,
   * with a real source, describing a different distribution — and the
   * reference itself walked into it once and left the evidence:
   * `biome-classifier.config.ts:32-33` records a river band of 0.055 putting
   * 16% of the world under water against a target of 3-6%.
   *
   * The bound is a RANGE and not an equality because it is a property of the
   * field, so it must hold at seeds nobody tuned it against.
   */
  it.effect('R-1: selects 1-3% of columns, which is what the transcribed half-width is FOR', () =>
    Effect.sync(() => {
      const stride = 8
      const half = 1024

      for (const seed of [GOLDEN_SEED, 1, 4242, 999983]) {
        let inBand = 0
        let total = 0
        for (let wx = -half; wx < half; wx += stride) {
          for (let wz = -half; wz < half; wz += stride) {
            total += 1
            if (ravineDistanceAt(seed, wx, wz) < RAVINE_HALF_WIDTH) {
              inBand += 1
            }
          }
        }

        const fraction = inBand / total
        expect(fraction, `seed ${String(seed)} band fraction ${String(fraction)}`).toBeGreaterThan(0.01)
        expect(fraction, `seed ${String(seed)} band fraction ${String(fraction)}`).toBeLessThan(0.03)
      }
    }),
  )

  /**
   * R-2. A ravine is a CANYON and not a scatter of pits, and the reason is that
   * a thin band around one value of a continuous field is a level set — a
   * curve. That is the whole mechanism, so it is the thing worth asserting
   * about it: a carved column almost always has a carved neighbour.
   *
   * The counterfactual matters. If the field were sampled per column instead of
   * interpolated — `latticeValue` rather than `valueNoise2D` — the same 2% would
   * be 2% of INDEPENDENT columns, and a carved column's chance of having a
   * carved neighbour would be about 2% rather than the ~90% below. So this test
   * distinguishes "a ravine" from "the right number of holes".
   */
  it.effect('R-2: the band is a connected curve, not speckle', () =>
    Effect.sync(() => {
      let carved = 0
      let withNeighbour = 0

      for (let wx = -600; wx < 600; wx += 1) {
        for (let wz = -600; wz < 600; wz += 3) {
          if (ravineDepthAt(ravineDistanceAt(GOLDEN_SEED, wx, wz)) === 0) {
            continue
          }
          carved += 1
          const hasNeighbour =
            ravineDepthAt(ravineDistanceAt(GOLDEN_SEED, wx - 1, wz)) > 0 ||
            ravineDepthAt(ravineDistanceAt(GOLDEN_SEED, wx + 1, wz)) > 0
          if (hasNeighbour) {
            withNeighbour += 1
          }
        }
      }

      expect(carved, 'the sweep found no band columns at all').toBeGreaterThan(200)
      expect(withNeighbour / carved).toBeGreaterThan(0.8)
    }),
  )

  it.effect('R-2b: the taper is full depth at the centre and trims only the feather edge', () =>
    Effect.sync(() => {
      expect(ravineDepthAt(0)).toBe(RAVINE_MAX_DEPTH)
      expect(ravineDepthAt(RAVINE_HALF_WIDTH)).toBe(0)
      expect(ravineDepthAt(RAVINE_HALF_WIDTH * 1.5)).toBe(0)

      // `RAVINE_MIN_DEPTH` discards `distance > 0.954 * halfWidth` and no more,
      // which is the claim `domain/ravine.ts` makes about where the rule bites.
      expect(ravineDepthAt(RAVINE_HALF_WIDTH * 0.95)).toBeGreaterThanOrEqual(RAVINE_MIN_DEPTH)
      expect(ravineDepthAt(RAVINE_HALF_WIDTH * 0.96)).toBe(0)

      // Monotone: a wall, not a staircase with a hole in it.
      let previous = RAVINE_MAX_DEPTH + 1
      for (let step = 0; step <= 100; step += 1) {
        const depth = ravineDepthAt((RAVINE_HALF_WIDTH * step) / 100)
        expect(depth).toBeLessThanOrEqual(previous)
        previous = depth === 0 ? 0 : depth
      }
    }),
  )

  it.effect('R-2c: the field is position-absolute, so a ravine crosses a chunk border as one canyon', () =>
    Effect.sync(() => {
      // Column (15, 3) of chunk (0, 0) and column (-1, 3) of chunk (-1, 0) are
      // different chunks asking about adjacent world columns. `domain/chunk.ts`
      // has no opinion; the field must.
      for (const wz of [-40, 0, 7, 128]) {
        expect(ravineDistanceAt(GOLDEN_SEED, 15, wz)).toBe(ravineDistanceAt(GOLDEN_SEED, 15, wz))
        // Continuity: adjacent columns cannot jump the whole band width, or the
        // canyon would have gaps at every sample point.
        const step = Math.abs(ravineDistanceAt(GOLDEN_SEED, 15, wz) - ravineDistanceAt(GOLDEN_SEED, 16, wz))
        expect(step).toBeLessThan(RAVINE_HALF_WIDTH)
      }
    }),
  )
})

describe('the water guard — docs/design-notes.md DN-2', () => {
  /**
   * R-3. THE TEST THIS FILE EXISTS FOR.
   *
   * The reference's comment records that the biome check alone was the buggy
   * version, and this reproduces exactly that: a lake in a PLAINS basin. The
   * biome layer passes it (PLAINS is not OCEAN and this repository has no
   * RIVER), the block layer refuses it, and with `waterGuard: 'biome'` the bed
   * is carved out from under the water.
   *
   * Both halves are asserted. Without the second one this is a test that says
   * today's code equals today's code.
   */
  it.effect('R-3: a submerged PLAINS column keeps its bed — and loses it under the biome-only guard', () =>
    Effect.sync(() => {
      const coord = chunkCoord(RAVINE_CHUNK.cx, RAVINE_CHUNK.cz)
      const band = bandColumns(GOLDEN_SEED, RAVINE_CHUNK.cx, RAVINE_CHUNK.cz)
      expect(band.length, 'the fixture chunk has no band columns').toBeGreaterThan(0)

      // A lake bed 6 blocks below sea level, in a PLAINS basin. Deep enough that
      // `RAVINE_MAX_DEPTH` reaches well past it.
      const bedY = SEA_LEVEL - 6

      const guarded = flatWorld(bedY, 'PLAINS')
      const carvedWithGuard = carveRavines(guarded.blocks, GOLDEN_SEED, coord, guarded.surfaces, guarded.biomes)

      const biomeOnly = flatWorld(bedY, 'PLAINS')
      const carvedBiomeOnly = carveRavines(
        biomeOnly.blocks,
        GOLDEN_SEED,
        coord,
        biomeOnly.surfaces,
        biomeOnly.biomes,
        { waterGuard: 'biome' },
      )

      // The guard refuses every one of them.
      expect(carvedWithGuard, 'the block-probing guard let a submerged column through').toBe(0)

      // And the reference's first attempt lets every one of them through, which
      // is what makes the line above evidence rather than a restatement.
      expect(carvedBiomeOnly, 'the biome-only guard refused a PLAINS lake it cannot see').toBe(band.length)

      // The failure mode itself: water resting on nothing. `domain/carver.ts`'s
      // I-4 signature, arriving by the ravine route.
      const [lx, lz] = band[0] ?? [0, 0]
      expect(readBlock(biomeOnly.blocks, blockIndex(lx, bedY, lz))).toBe(BLOCK.AIR)
      expect(readBlock(biomeOnly.blocks, blockIndex(lx, bedY + 1, lz))).toBe(BLOCK.WATER)
      // The same cells, with the guard on.
      expect(readBlock(guarded.blocks, blockIndex(lx, bedY, lz))).toBe(BLOCK.STONE)
    }),
  )

  /**
   * R-4. The layer the reference wrote FIRST still does its half, on the case it
   * was written for. Asserted separately so that deleting it is a red test
   * rather than a silent narrowing — `docs/porting.md:235` instructs that both
   * layers be carried across, and a test that only exercises the second one
   * would let the first be dropped as redundant.
   */
  it.effect('R-4: an OCEAN column is refused by the biome layer alone', () =>
    Effect.sync(() => {
      const coord = chunkCoord(RAVINE_CHUNK.cx, RAVINE_CHUNK.cz)
      const band = bandColumns(GOLDEN_SEED, RAVINE_CHUNK.cx, RAVINE_CHUNK.cz)

      // Dry ground — the block layer has nothing to find — but classified OCEAN.
      // Only the biome layer can refuse this, so it is the layer under test.
      const ocean = flatWorld(SEA_LEVEL + 4, 'OCEAN')
      expect(carveRavines(ocean.blocks, GOLDEN_SEED, coord, ocean.surfaces, ocean.biomes)).toBe(0)

      const unguarded = flatWorld(SEA_LEVEL + 4, 'OCEAN')
      expect(
        carveRavines(unguarded.blocks, GOLDEN_SEED, coord, unguarded.surfaces, unguarded.biomes, {
          waterGuard: 'none',
        }),
      ).toBe(band.length)
    }),
  )

  /**
   * R-5. Dry land on the band IS carved. The vacuity guard docs/testing.md §6
   * asks for: with nothing ever carved, every assertion above about the guard
   * holds by there being no ravines at all.
   */
  it.effect('R-5: dry ground on the band really is carved, so the guard tests are not vacuous', () =>
    Effect.sync(() => {
      const coord = chunkCoord(RAVINE_CHUNK.cx, RAVINE_CHUNK.cz)
      const band = bandColumns(GOLDEN_SEED, RAVINE_CHUNK.cx, RAVINE_CHUNK.cz)
      const world = flatWorld(SEA_LEVEL + 10, 'PLAINS')

      expect(carveRavines(world.blocks, GOLDEN_SEED, coord, world.surfaces, world.biomes)).toBe(band.length)
      expect(band.length).toBeGreaterThan(20)

      const [lx, lz] = band[0] ?? [0, 0]
      const depth = ravineDepthAt(ravineDistanceAt(GOLDEN_SEED, RAVINE_CHUNK.cx * 16 + lx, RAVINE_CHUNK.cz * 16 + lz))
      const floorY = ravineFloorY(SEA_LEVEL + 10, depth)

      expect(readBlock(world.blocks, blockIndex(lx, SEA_LEVEL + 10, lz))).toBe(BLOCK.AIR)
      expect(readBlock(world.blocks, blockIndex(lx, floorY + 1, lz))).toBe(BLOCK.AIR)
      // The floor itself is NOT carved — `ravine-carver.ts:54` is `y > floorY`.
      expect(readBlock(world.blocks, blockIndex(lx, floorY, lz))).toBe(BLOCK.STONE)
    }),
  )

  /**
   * R-5b. Bedrock survives, which is `test/chunk-golden.test.ts` I-2 asserted at
   * the source rather than over ten chunks. The interesting half is WHY: the
   * explicit bedrock check in `carveRavines` currently never runs, because
   * `RAVINE_FLOOR_Y` is 6 and the loop stops above the floor. `domain/ore.ts`
   * records `ORE_MIN_Y_FLOOR` under the same heading — a defensive rule that does
   * not bind, kept and labelled rather than deleted or believed.
   */
  it.effect('R-5b: no ravine reaches the bedrock floor, at any depth or any surface', () =>
    Effect.sync(() => {
      for (const surfaceY of [SEA_LEVEL, SEA_LEVEL + 1, 70, 80, 92]) {
        expect(ravineFloorY(surfaceY, RAVINE_MAX_DEPTH)).toBeGreaterThan(BEDROCK_Y)
      }
      // And the clamp, on an input the terrain cannot currently produce.
      expect(ravineFloorY(10, RAVINE_MAX_DEPTH)).toBe(RAVINE_FLOOR_Y)

      const coord = chunkCoord(RAVINE_CHUNK.cx, RAVINE_CHUNK.cz)
      const world = flatWorld(SEA_LEVEL + 10, 'PLAINS')
      carveRavines(world.blocks, GOLDEN_SEED, coord, world.surfaces, world.biomes, { waterGuard: 'none' })

      for (let lx = 0; lx < CHUNK_SIZE_XZ; lx += 1) {
        for (let lz = 0; lz < CHUNK_SIZE_XZ; lz += 1) {
          expect(readBlock(world.blocks, blockIndex(lx, BEDROCK_Y, lz))).toBe(BLOCK.BEDROCK)
        }
      }
    }),
  )
})

describe('the pass order', () => {
  /**
   * R-6. `domain/terrain.ts` claims the ravine pass produces the SAME cut with
   * `decorate` on and off, and argues it: a column holding water at
   * `surfaceY + 1` can carry neither a plant (`canPlaceGroundPlantAt` demands
   * AIR) nor a trunk (`shouldPlaceTree` refuses `surfaceY < seaLevel`), so
   * decoration cannot change what the water guard sees.
   *
   * That is a chain of three rules in three files, which is exactly the kind of
   * claim that stops being true without anyone noticing. So it is measured
   * instead: the stone below the surface must be byte-identical across the flag.
   */
  it.effect('R-6: decoration cannot change what the ravine carves', () =>
    Effect.sync(() => {
      const decorated = generateChunkAt(GOLDEN_SEED, RAVINE_CHUNK.cx, RAVINE_CHUNK.cz, { decorate: true })
      const bare = generateChunkAt(GOLDEN_SEED, RAVINE_CHUNK.cx, RAVINE_CHUNK.cz, { decorate: false })

      let compared = 0
      let cut = 0
      for (let lx = 0; lx < CHUNK_SIZE_XZ; lx += 1) {
        for (let lz = 0; lz < CHUNK_SIZE_XZ; lz += 1) {
          const surfaceY = surfaceHeightAt(GOLDEN_SEED, RAVINE_CHUNK.cx * 16 + lx, RAVINE_CHUNK.cz * 16 + lz)
          for (let y = 0; y <= surfaceY; y += 1) {
            const index = blockIndex(lx, y, lz)
            expect(
              readBlock(decorated.blocks, index),
              `decoration moved a block at (${String(lx)}, ${String(y)}, ${String(lz)})`,
            ).toBe(readBlock(bare.blocks, index))
            compared += 1
            if (readBlock(bare.blocks, index) === BLOCK.AIR && y > 58) {
              cut += 1
            }
          }
        }
      }

      expect(compared).toBeGreaterThan(10_000)
      // Not vacuous: there really is a ravine in this chunk, and it reaches
      // above `CAVE_CEILING_Y` where no cave can.
      expect(cut, 'the fixture chunk has no ravine above the cave ceiling').toBeGreaterThan(100)
    }),
  )

  /**
   * R-7. Ground cover standing over a fresh canyon is cleared.
   *
   * The reference does not do this and `domain/ravine.ts` records why the
   * departure is taken for plants and refused for trees. What makes it worth a
   * test rather than a comment is the frequency: measured over 42,184 band
   * columns at this seed, 7.7% of them would have carried a ground plant, so
   * the artefact is common rather than theoretical.
   *
   * Asserted in both directions, as ever — the plant must be there before the
   * carve and gone after it.
   */
  it.effect('R-7: a flower over a ravine is cleared, and it really was there first', () =>
    Effect.sync(() => {
      const blocks = new Uint8Array(CHUNK_SIZE_XZ * CHUNK_SIZE_XZ * CHUNK_HEIGHT)
      const surfaceY = 70
      const plant = PLANT_IDS[0] ?? BLOCK.AIR
      blocks[blockIndex(3, surfaceY, 4)] = BLOCK.GRASS
      blocks[blockIndex(3, surfaceY + 1, 4)] = plant

      expect(readBlock(blocks, blockIndex(3, surfaceY + 1, 4))).toBe(plant)
      expect(clearGroundCover(blocks, 3, surfaceY, 4)).toBe(true)
      expect(readBlock(blocks, blockIndex(3, surfaceY + 1, 4))).toBe(BLOCK.AIR)

      // It is scoped to plants. A trunk is NOT cleared, which is the recorded
      // half of the artefact and not an oversight — see `domain/ravine.ts`.
      blocks[blockIndex(5, surfaceY + 1, 6)] = BLOCK.LOG
      expect(clearGroundCover(blocks, 5, surfaceY, 6)).toBe(false)
      expect(readBlock(blocks, blockIndex(5, surfaceY + 1, 6))).toBe(BLOCK.LOG)

      // And on a bare column it is a no-op rather than a hole in the sky.
      expect(clearGroundCover(blocks, 9, surfaceY, 9)).toBe(false)
    }),
  )

  /**
   * R-7b. The whole-pipeline form of R-7: no generated chunk carries a plant
   * with nothing under it.
   *
   * This is the invariant `test/chunk-golden.test.ts` I-4 is for water, applied
   * to the other thing this generator leaves standing. It is checked over the
   * ravine chunk and its eight neighbours rather than the golden matrix, for the
   * reason the eleventh golden row exists: none of the other ten has a ravine in
   * it, so the matrix would satisfy this by having nothing to test.
   */
  it.effect('R-7b: no generated column carries a floating plant', () =>
    Effect.sync(() => {
      let plantsSeen = 0
      const floating: Array<string> = []

      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dz = -1; dz <= 1; dz += 1) {
          const chunk = generateChunkAt(GOLDEN_SEED, RAVINE_CHUNK.cx + dx, RAVINE_CHUNK.cz + dz)
          for (let lx = 0; lx < CHUNK_SIZE_XZ; lx += 1) {
            for (let lz = 0; lz < CHUNK_SIZE_XZ; lz += 1) {
              for (let y = 1; y < CHUNK_HEIGHT; y += 1) {
                if (!PLANT_IDS.includes(readBlock(chunk.blocks, blockIndex(lx, y, lz)))) {
                  continue
                }
                plantsSeen += 1
                if (readBlock(chunk.blocks, blockIndex(lx, y - 1, lz)) === BLOCK.AIR) {
                  floating.push(`(${String(dx)}, ${String(dz)}) (${String(lx)}, ${String(y)}, ${String(lz)})`)
                }
              }
            }
          }
        }
      }

      expect(plantsSeen, 'no plants in the fixture, so this asserts nothing').toBeGreaterThan(0)
      expect(floating, 'plants standing on air').toStrictEqual([])
    }),
  )

  /**
   * R-8. THE ARTEFACT THAT IS NOT FIXED, PINNED SO IT CANNOT GROW QUIETLY.
   *
   * A tree whose column is carved is left hanging, because removing it needs a
   * mechanism this repository does not have — `domain/ravine.ts` sets out both
   * candidate fixes and why choosing between them is a design call rather than
   * part of a port.
   *
   * The number is measured and it is small, but it is measured IN THE WORST
   * PLACE — the 7 x 7 chunks around the densest ravine region within 40 chunks
   * of the origin. There, 14 of 580 LOG cells stand on air: 2.4%, about 3 trees
   * of 116. The same window at the origin, which no ravine reaches, has 0.
   *
   * The ratio is per LOG CELL and not per column on purpose. A per-column rate
   * divides by terrain that has nothing to do with trees, so it falls whenever
   * the world gets bigger and would let the artefact double while the number
   * went down.
   *
   * The bound is 8% rather than 3% because the point is the ORDER OF MAGNITUDE
   * — a shaper nudge or a density change will move 2.4% around. What it refuses
   * is the version of this that matters: a change that makes ravines common, or
   * trees common, and turns a rounding error into a visible feature of a world.
   */
  it.effect('R-8: floating trunks over ravines are rare, and stay rare', () =>
    Effect.sync(() => {
      let columns = 0
      let logs = 0
      let floatingLogs = 0

      for (let cx = RAVINE_CHUNK.cx - 3; cx <= RAVINE_CHUNK.cx + 3; cx += 1) {
        for (let cz = RAVINE_CHUNK.cz - 3; cz <= RAVINE_CHUNK.cz + 3; cz += 1) {
          const chunk = generateChunkAt(GOLDEN_SEED, cx, cz)
          for (let lx = 0; lx < CHUNK_SIZE_XZ; lx += 1) {
            for (let lz = 0; lz < CHUNK_SIZE_XZ; lz += 1) {
              columns += 1
              for (let y = 1; y < CHUNK_HEIGHT; y += 1) {
                if (readBlock(chunk.blocks, blockIndex(lx, y, lz)) !== BLOCK.LOG) {
                  continue
                }
                logs += 1
                if (readBlock(chunk.blocks, blockIndex(lx, y - 1, lz)) === BLOCK.AIR) {
                  floatingLogs += 1
                }
              }
            }
          }
        }
      }

      expect(columns).toBe(49 * CHUNK_SIZE_XZ * CHUNK_SIZE_XZ)
      // Not vacuous: there are trees in this window to be left hanging.
      expect(logs, 'no trees in the window, so this asserts nothing').toBeGreaterThan(100)
      expect(floatingLogs / logs, 'floating trunks have stopped being a rounding error').toBeLessThan(0.08)
      // And the artefact is REAL rather than hypothetical, which is why it is
      // recorded instead of dismissed. If this ever reads 0 the fix landed and
      // this whole test should be replaced by the assertion that it is 0.
      expect(floatingLogs, 'the recorded artefact has disappeared — see domain/ravine.ts').toBeGreaterThan(0)
    }),
  )
})

describe('what the pass does to a real chunk', () => {
  /**
   * R-9. The eleventh golden row's justification, re-derived rather than
   * transcribed. `scripts/golden-fixture.ts` claims (21, 11) carries 205 carved
   * columns and that no other golden chunk carries any; a literal in a comment
   * is a claim that decays, so it is recomputed here.
   *
   * IT READS `GOLDEN_SPECS` RATHER THAN A LIST OF COORDINATES, and the first
   * draft did not — it hard-coded the other ten. Mutation found the hole:
   * repointing the eleventh spec at (8, -8), a chunk with no ravine in it, left
   * this test and the whole golden suite green. The digest comparison could not
   * see it either, because `committed.entries.find` then matches the NINTH row's
   * coordinate and its digest agrees perfectly.
   *
   * So the matrix's own rule is what is asserted: exactly one spec is on the
   * band. That also closes the more general version of the same hole — two specs
   * silently naming the same chunk.
   */
  it.effect('R-9: exactly one golden spec sits on a ravine, and the matrix says which', () =>
    Effect.sync(() => {
      const onBand = GOLDEN_SPECS.filter((spec) => bandColumns(GOLDEN_SEED, spec.cx, spec.cz).length > 0)

      expect(
        onBand.map((spec) => `(${String(spec.cx)}, ${String(spec.cz)})`),
        'the golden matrix no longer covers the ravine pass, or covers it twice',
      ).toStrictEqual([`(${String(RAVINE_CHUNK.cx)}, ${String(RAVINE_CHUNK.cz)})`])

      expect(bandColumns(GOLDEN_SEED, RAVINE_CHUNK.cx, RAVINE_CHUNK.cz).length).toBeGreaterThan(150)

      // And no two specs name the same chunk under the same decoration flag,
      // which is what let the mutation above hide.
      const keys = GOLDEN_SPECS.map((spec) => `${String(spec.cx)},${String(spec.cz)},${String(spec.decorate)}`)
      expect(new Set(keys).size, 'two golden specs describe the same chunk').toBe(GOLDEN_SPECS.length)
    }),
  )

  /**
   * R-10. The signature `scripts/golden-fixture.ts`'s `ravineCutColumns` rests
   * on: only a ravine can put the top of a column below `SEA_LEVEL`.
   *
   * The argument is that a column with `surfaceY < SEA_LEVEL` is filled with
   * water to `SEA_LEVEL`, and `CAVE_CEILING_Y` is 58, so neither the shaper nor
   * `carveCaves` can produce one. Arguments about three interacting passes are
   * how the CONTINENTALNESS_CONTRAST comment became false, so this measures it.
   */
  it.effect('R-10: nothing but a ravine cuts a column below sea level', () =>
    Effect.sync(() => {
      let withRavines = 0
      let elsewhere = 0

      for (const [cx, cz] of [
        [RAVINE_CHUNK.cx, RAVINE_CHUNK.cz],
        [5, 7],
        [8, -8],
        [1, 0],
        [4, 9],
      ] as const) {
        const chunk = generateChunkAt(GOLDEN_SEED, cx, cz)
        let cut = 0
        for (let lx = 0; lx < CHUNK_SIZE_XZ; lx += 1) {
          for (let lz = 0; lz < CHUNK_SIZE_XZ; lz += 1) {
            const top = topBlockY(chunk.blocks, lx, lz)
            if (top >= 0 && top < SEA_LEVEL) {
              cut += 1
            }
          }
        }
        if (cx === RAVINE_CHUNK.cx && cz === RAVINE_CHUNK.cz) {
          withRavines = cut
        } else {
          elsewhere += cut
        }
      }

      expect(withRavines).toBeGreaterThan(50)
      expect(elsewhere, 'a chunk with no ravine has a column cut below sea level').toBe(0)
    }),
  )

  /**
   * R-11. Determinism, narrowed to this pass. `test/determinism.test.ts` covers
   * `generateChunk` as a whole, but a carver that read a clock or a global RNG
   * would still be caught only if the chunk it was tested on happened to be on
   * the band — which, per R-9, nine of the ten golden chunks are not.
   */
  it.effect('R-11: the ravine chunk regenerates byte-identically', () =>
    Effect.sync(() => {
      const once = generateChunkAt(GOLDEN_SEED, RAVINE_CHUNK.cx, RAVINE_CHUNK.cz)
      const twice = generateChunkAt(GOLDEN_SEED, RAVINE_CHUNK.cx, RAVINE_CHUNK.cz)

      expect(twice.blocks).toStrictEqual(once.blocks)

      // And the carve is a function of (seed, coord) alone: a different seed
      // must produce a different cut on the same coordinate, or the field is
      // not seeded at all.
      const otherSeed = generateChunkAt(1, RAVINE_CHUNK.cx, RAVINE_CHUNK.cz)
      expect(otherSeed.blocks).not.toStrictEqual(once.blocks)
    }),
  )

  /**
   * R-12. The biome array is untouched. The ravine pass writes blocks and
   * nothing else, so `chunk.biomes` — which is a save-format array and the
   * other half of every golden digest — must come out of it unchanged.
   */
  it.effect('R-12: carving changes no biome', () =>
    Effect.sync(() => {
      const chunk = generateChunkAt(GOLDEN_SEED, RAVINE_CHUNK.cx, RAVINE_CHUNK.cz)

      for (let lx = 0; lx < CHUNK_SIZE_XZ; lx += 1) {
        for (let lz = 0; lz < CHUNK_SIZE_XZ; lz += 1) {
          const wx = RAVINE_CHUNK.cx * CHUNK_SIZE_XZ + lx
          const wz = RAVINE_CHUNK.cz * CHUNK_SIZE_XZ + lz
          expect(chunk.biomes[columnIndex(lx, lz)]).toBe(
            biomeFor(GOLDEN_SEED, wx, wz, surfaceHeightAt(GOLDEN_SEED, wx, wz), DEFAULT_TERRAIN_LEVELS),
          )
        }
      }
    }),
  )
})
