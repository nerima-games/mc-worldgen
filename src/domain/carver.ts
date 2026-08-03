/**
 * Cave carving — and the water-floor guard.
 *
 * PRE-AUDIT FIRST CUT (叩き台).
 *
 * ---------------------------------------------------------------------------
 * CORRECTION TO plan.md §3.7
 * ---------------------------------------------------------------------------
 *
 * plan.md §3.7 says:
 *
 *     カーバーが川/湖の底をくり抜くと「浮いた水面 + 真っ暗な空洞」になる
 *     (参照実装の重大バグ)。水域の床マージン検査を最初から入れる
 *
 * The bug is real and the instruction is right, but the parenthetical is out of
 * date: **the reference implementation already fixed it, and the fix is
 * regression-tested there.** This is therefore not a bug to avoid inventing —
 * it is a fix to port, and it is the most valuable thing in the carver.
 *
 * Reference, `packages/world/domain/terrain/cave-carver.ts:70-74`:
 *
 *     // Keep a solid shell under water bodies: carving the bed away leaves a
 *     // floating water sheet over an unlit cavity (the black-void bug).
 *     if (waterFloorY >= 0 && y >= waterFloorY - CAVE_WATER_FLOOR_MARGIN && y < waterFloorY) {
 *       continue
 *     }
 *
 * supported by `computeWaterFloorYs` (`cave-carver.ts:18-32`), pinned by
 * `packages/world/test/cave-carver.test.ts:201` ("keeps a solid floor shell
 * under water bodies (hollow-lake regression)").
 *
 * ---------------------------------------------------------------------------
 * The subtle half: a biome check is NOT sufficient
 * ---------------------------------------------------------------------------
 *
 * The ravine carver has the same guard in two layers, and its comments record
 * that the first layer alone was the buggy version —
 * `packages/world/domain/terrain/ravine-carver.ts:41-46`:
 *
 *     // Water bodies keep their beds — vanilla surface ravines don't slice rivers open.
 *     if (state.biome === 'OCEAN' || state.biome === 'RIVER') continue
 *     // Same rule for ANY submerged column (lakes, flooded basins): the biome check
 *     // alone let ravines carve lake beds from under their water, leaving a floating
 *     // water sheet over a dark shaft ("hollow lake" black-void bug).
 *     if (blocks[...surfaceY + 1...] === waterBlockIndex) continue
 *
 * A lake sitting in a `PLAINS` basin is submerged but is not an ocean or a
 * river biome, so the biome test misses it entirely. The guard must probe the
 * actual blocks. That is why `computeWaterFloorYs` below scans the buffer
 * rather than consulting the biome map.
 *
 * ---------------------------------------------------------------------------
 * Why the margin is a parameter
 * ---------------------------------------------------------------------------
 *
 * `waterFloorMargin: 0` disables the guard, which is not a feature — it is a
 * test affordance. `test/carver.test.ts` generates the same chunk with the
 * guard on and off and asserts that the unguarded run really does hollow out a
 * lake bed. A regression test that cannot demonstrate the regression is only
 * asserting that today's code does what today's code does.
 */
import { BLOCK } from './biome'
import { blockIndex, CHUNK_HEIGHT, CHUNK_SIZE_XZ, WATER_FLOOR_MARGIN } from './constants'
import { readBlock, worldX, worldZ } from './chunk'
import type { ChunkCoord } from './kernel-vocabulary'
import { channelSeed, valueNoise2D } from './seeded-random'

/** Vertical band caves may occupy. Above bedrock, below the surface layer. */
export const CAVE_FLOOR_Y = 6
export const CAVE_CEILING_Y = 58

/** Above this noise value a column is carved. Higher = fewer caves. */
export const CAVE_THRESHOLD = 0.62

export type CarveOptions = {
  /**
   * Solid blocks to preserve beneath the lowest water block in a column.
   * Defaults to `WATER_FLOOR_MARGIN` (3, matching the reference). Zero disables
   * the guard and reproduces the hollow-lake bug — for tests only.
   */
  readonly waterFloorMargin?: number
}

/**
 * Lowest water block in each column, or `-1` where the column holds no water.
 *
 * The scan deliberately reaches above `CAVE_CEILING_Y` by the margin, so a
 * water body whose bed sits just above the carving band is still protected. The
 * reference does the same and says why — `cave-carver.ts:20`:
 * `const scanTop = CAVE_CEILING + CAVE_WATER_FLOOR_MARGIN`.
 */
export const computeWaterFloorYs = (blocks: Uint8Array, margin: number): Int16Array => {
  const floors = new Int16Array(CHUNK_SIZE_XZ * CHUNK_SIZE_XZ).fill(-1)
  const scanTop = Math.min(CHUNK_HEIGHT - 1, CAVE_CEILING_Y + margin + 16)

  for (let lx = 0; lx < CHUNK_SIZE_XZ; lx += 1) {
    for (let lz = 0; lz < CHUNK_SIZE_XZ; lz += 1) {
      for (let y = 0; y <= scanTop; y += 1) {
        if (readBlock(blocks, blockIndex(lx, y, lz)) === BLOCK.WATER) {
          floors[lz * CHUNK_SIZE_XZ + lx] = y
          break
        }
      }
    }
  }

  return floors
}

/**
 * Carve caves into `blocks`, in place.
 *
 * Mutates rather than returning a new buffer. That is a deliberate exception to
 * this project's immutability preference: a chunk buffer is 64 KB, the pipeline
 * runs several passes over it per chunk, and copying at each pass is the kind
 * of cost that only shows up as stutter once a world is big. The mutation is
 * confined to a buffer this function's caller has just allocated and not yet
 * shared, so it is unobservable from outside `generateChunk`.
 */
export const carveCaves = (
  blocks: Uint8Array,
  seed: number,
  coord: ChunkCoord,
  options: CarveOptions = {},
): void => {
  const margin = options.waterFloorMargin ?? WATER_FLOOR_MARGIN
  const waterFloors = computeWaterFloorYs(blocks, margin)
  const caveSeed = channelSeed(seed, 'caves')

  for (let lx = 0; lx < CHUNK_SIZE_XZ; lx += 1) {
    for (let lz = 0; lz < CHUNK_SIZE_XZ; lz += 1) {
      const waterFloorY = waterFloors[lz * CHUNK_SIZE_XZ + lx] ?? -1
      const density = valueNoise2D(caveSeed, worldX(coord, lx), worldZ(coord, lz), 1 / 24)

      if (density <= CAVE_THRESHOLD) {
        continue
      }

      // Taller caves where the field is stronger, so the band is not a slab.
      const halfHeight = Math.floor((density - CAVE_THRESHOLD) * 40)
      const centre = Math.floor(CAVE_FLOOR_Y + (CAVE_CEILING_Y - CAVE_FLOOR_Y) * density)
      const from = Math.max(CAVE_FLOOR_Y, centre - halfHeight)
      const to = Math.min(CAVE_CEILING_Y, centre + halfHeight)

      for (let y = from; y <= to; y += 1) {
        // ────────────────────────────────────────────────────────────────
        // THE GUARD. Leave a solid shell under any water body, or the bed
        // is carved away and the player gets a floating water sheet over an
        // unlit void. Do not replace this with a biome test — a lake in a
        // PLAINS basin is submerged and is not an OCEAN.
        // ────────────────────────────────────────────────────────────────
        if (waterFloorY >= 0 && y >= waterFloorY - margin && y < waterFloorY) {
          continue
        }

        const index = blockIndex(lx, y, lz)
        const current = readBlock(blocks, index)

        if (current === BLOCK.AIR || current === BLOCK.WATER || current === BLOCK.BEDROCK) {
          continue
        }

        blocks[index] = BLOCK.AIR
      }
    }
  }
}
