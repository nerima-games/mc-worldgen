import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { BLOCK } from '../src/domain/biome'
import { CAVE_CEILING_Y, computeWaterFloorYs } from '../src/domain/carver'
import { biomeAt, readBlock } from '../src/domain/chunk'
import { blockIndex, CHUNK_SIZE_XZ, WATER_FLOOR_MARGIN } from '../src/domain/constants'
import { generateChunkAt } from '../src/domain/terrain'

/**
 * ---------------------------------------------------------------------------
 * The hollow-lake regression.
 * ---------------------------------------------------------------------------
 *
 * plan.md §3.7 describes the bug and calls it 参照実装の重大バグ:
 *
 *     カーバーが川/湖の底をくり抜くと「浮いた水面 + 真っ暗な空洞」になる
 *
 * The description is accurate but the framing is out of date: the reference
 * implementation FIXED this, and pins it with its own regression tests —
 * `packages/world/test/cave-carver.test.ts:201` ("keeps a solid floor shell
 * under water bodies (hollow-lake regression)") and
 * `packages/world/test/ravine-carver.test.ts:75` ("keeps lake beds intact"). The
 * guard itself is at `cave-carver.ts:70-74` and `ravine-carver.ts:41-46`.
 *
 * So this is a port of a fix, not an invention. What makes the test below worth
 * more than "the guard is enabled" is that it runs the same chunk with the
 * guard OFF and shows the bug actually appears. A regression test that cannot
 * produce the regression is only asserting that today's code equals itself.
 */

const SEED = 4242

/** Every world column where water sits directly on a solid bed. */
const submergedColumns = (blocks: Uint8Array): ReadonlyArray<{ lx: number; lz: number; waterFloorY: number }> => {
  const floors = computeWaterFloorYs(blocks, WATER_FLOOR_MARGIN)
  const found: Array<{ lx: number; lz: number; waterFloorY: number }> = []

  for (let lx = 0; lx < CHUNK_SIZE_XZ; lx += 1) {
    for (let lz = 0; lz < CHUNK_SIZE_XZ; lz += 1) {
      const waterFloorY = floors[lz * CHUNK_SIZE_XZ + lx] ?? -1
      if (waterFloorY > 0 && waterFloorY <= CAVE_CEILING_Y) {
        found.push({ lx, lz, waterFloorY })
      }
    }
  }

  return found
}

type SubmergedFixture = {
  readonly coord: readonly [number, number]
  readonly guarded: Uint8Array
  readonly unguarded: Uint8Array
  readonly columns: ReadonlyArray<{ lx: number; lz: number; waterFloorY: number }>
}

/** Blocks of air inside the protected shell — i.e. the bug, counted. */
export const hollowUnderWater = (
  blocks: Uint8Array,
  columns: ReadonlyArray<{ lx: number; lz: number; waterFloorY: number }>,
): number => {
  let count = 0
  for (const { lx, lz, waterFloorY } of columns) {
    for (let y = Math.max(1, waterFloorY - WATER_FLOOR_MARGIN); y < waterFloorY; y += 1) {
      if (readBlock(blocks, blockIndex(lx, y, lz)) === BLOCK.AIR) {
        count += 1
      }
    }
  }
  return count
}

/**
 * A chunk where a cave genuinely passes beneath a water body.
 *
 * The search criterion is deliberately "the unguarded run hollows the bed",
 * not merely "the chunk contains water". Water with no cave under it satisfies
 * the guard vacuously: the first such chunk found is one where turning the
 * guard off changes nothing, so a test built on it would pass no matter what
 * the guard did. Searching for a chunk that actually reproduces the bug is what
 * makes the assertion mean something.
 *
 * Searched rather than hard-coded so that tuning the terrain shaper moves the
 * fixture instead of breaking the test, and memoised because each chunk is
 * 64 KB and the cases below would otherwise repeat the scan.
 */
let cachedFixture: SubmergedFixture | undefined

const submergedFixture = (): SubmergedFixture => {
  if (cachedFixture !== undefined) {
    return cachedFixture
  }

  for (let cx = -16; cx <= 16; cx += 1) {
    for (let cz = -16; cz <= 16; cz += 1) {
      const guarded = generateChunkAt(SEED, cx, cz, { decorate: false }).blocks
      const columns = submergedColumns(guarded)

      if (columns.length === 0) {
        continue
      }

      const unguarded = generateChunkAt(SEED, cx, cz, {
        decorate: false,
        carve: { waterFloorMargin: 0 },
      }).blocks

      if (hollowUnderWater(unguarded, columns) > 0) {
        cachedFixture = { coord: [cx, cz], guarded, unguarded, columns }
        return cachedFixture
      }
    }
  }

  throw new Error(
    'no chunk found where a cave passes beneath a water body; the fixture search needs widening, ' +
      'or the terrain shaper no longer produces water within the carving band',
  )
}

describe('carver water-floor guard', () => {
  it.effect('finds submerged columns to test against, so the rest is not vacuous', () =>
    Effect.sync(() => {
      const { columns } = submergedFixture()
      expect(columns.length).toBeGreaterThan(0)
    }),
  )

  it.effect('leaves a solid shell of WATER_FLOOR_MARGIN blocks beneath every water body', () =>
    Effect.sync(() => {
      const { guarded, columns } = submergedFixture()

      for (const { lx, lz, waterFloorY } of columns) {
        for (let y = Math.max(1, waterFloorY - WATER_FLOOR_MARGIN); y < waterFloorY; y += 1) {
          const block = readBlock(guarded, blockIndex(lx, y, lz))
          // Air directly under water is the black-void bug: the player sees a
          // sheet of water hanging over an unlit cavity.
          expect(block).not.toBe(BLOCK.AIR)
        }
      }
    }),
  )

  it.effect('the guard is load-bearing: with the margin at 0 the bed really does get eaten', () =>
    Effect.sync(() => {
      const { guarded, unguarded, columns } = submergedFixture()

      // Same seed, same coordinate, same everything except the margin.
      expect(hollowUnderWater(guarded, columns)).toBe(0)
      expect(hollowUnderWater(unguarded, columns)).toBeGreaterThan(0)
    }),
  )

  /**
   * The subtle half, from `ravine-carver.ts:41-46`: the reference's first
   * attempt tested the biome (`OCEAN` or `RIVER`) and that was not enough,
   * because a lake in a `PLAINS` basin is submerged without being either. The
   * guard here probes the block buffer, so it covers those columns too.
   */
  it.effect('protects a submerged column whatever its biome, because it probes blocks not biomes', () =>
    Effect.sync(() => {
      const { coord, guarded, columns } = submergedFixture()
      const chunk = generateChunkAt(SEED, coord[0], coord[1], { decorate: false })

      const biomesProtected = new Set(columns.map(({ lx, lz }) => biomeAt(chunk, lx, lz)))
      expect(biomesProtected.size).toBeGreaterThan(0)

      // Every protected column is protected, including any that is not OCEAN.
      // The reference's first attempt tested only `biome === 'OCEAN' || 'RIVER'`
      // and that let lakes in a PLAINS basin be carved out from underneath.
      for (const { lx, lz, waterFloorY } of columns) {
        for (let y = Math.max(1, waterFloorY - WATER_FLOOR_MARGIN); y < waterFloorY; y += 1) {
          expect(readBlock(guarded, blockIndex(lx, y, lz))).not.toBe(BLOCK.AIR)
        }
      }
    }),
  )
})

describe('computeWaterFloorYs', () => {
  it.effect('reports -1 for a column with no water', () =>
    Effect.sync(() => {
      const dry = new Uint8Array(16 * 16 * 256).fill(BLOCK.STONE)
      const floors = computeWaterFloorYs(dry, WATER_FLOOR_MARGIN)

      expect([...floors].every((value) => value === -1)).toBe(true)
    }),
  )

  it.effect('reports the LOWEST water block, not the surface', () =>
    Effect.sync(() => {
      // A deep column: the guard must protect the bed, which sits under the
      // bottom of the water, not under its surface.
      const blocks = new Uint8Array(16 * 16 * 256).fill(BLOCK.STONE)
      for (let y = 40; y <= 63; y += 1) {
        blocks[blockIndex(0, y, 0)] = BLOCK.WATER
      }

      const floors = computeWaterFloorYs(blocks, WATER_FLOOR_MARGIN)
      expect(floors[0]).toBe(40)
    }),
  )
})
