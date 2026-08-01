import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { BLOCK } from '../src/domain/biome'
import { blockIndex, CHUNK_HEIGHT, CHUNK_SIZE_XZ } from '../src/domain/constants'
import { generateChunkAt } from '../src/domain/terrain'
import {
  TREE_CELL_JITTER_ORIGIN,
  TREE_CELL_JITTER_SPAN,
  TREE_CROWN_RADIUS,
  TREE_GRID_SIZE,
  TREE_MIN_SPACING,
} from '../src/domain/tree-placement'

/**
 * ---------------------------------------------------------------------------
 * Canopies must not fuse — docs/testing.md §4-b F-2.
 * ---------------------------------------------------------------------------
 *
 * `domain/tree-placement.ts` claimed a jittered grid "bounds the minimum
 * spacing by construction". It bounded density. Measured minimum spacing was 1,
 * and in generated block data the largest 4-connected patch of LEAVES at a
 * single Y in a single chunk was 78 blocks against 21 for one crown — the
 * "walkable leaf slab" that `tree-placer.ts:184-188` warned about, still present
 * after the grid was introduced.
 *
 * ---------------------------------------------------------------------------
 * Why this is measured on BLOCKS and not on the placement function
 * ---------------------------------------------------------------------------
 *
 * `test/biome-and-trees.test.ts` pins the spacing of the CANDIDATES. That is
 * necessary and it is not sufficient, because the fusion is a property of the
 * world: two trunks four blocks apart on a hillside have crowns at different
 * heights and do not fuse, while two on flat ground do. Only `generateChunk`
 * output knows which. The invariant that actually matters — "a player cannot
 * walk from one tree to the next across the leaves" — is a statement about
 * connected components in the block buffer, so that is what is measured.
 *
 * The scan is also STITCHED across chunk borders. The preview's version measures
 * one chunk at a time and says so, noting that a slab straddling a border is
 * undercounted and that its 78 is therefore a floor. A test that inherited that
 * blind spot would be weakest exactly where `plantTree` is least careful.
 */

/** The default preview seed: the world docs/testing.md §4-b reports on. */
const SEED = 20260726

/** Side of the stitched square, in chunks. 8 × 8 = 128 × 128 blocks. */
const CHUNK_SPAN = 8

/** Trunk height in `plantTree`, so the trunk block count converts to a tree count. */
const TRUNK_HEIGHT = 5

/**
 * Columns in one crown: a square of radius `TREE_CROWN_RADIUS` with its four
 * corners removed. 21 for radius 2.
 */
const CROWN_COLUMNS = (2 * TREE_CROWN_RADIUS + 1) ** 2 - 4

/**
 * LEAVES in one crown. The trunk reaches the crown's own Y and `plantTree` only
 * writes leaves into AIR, so the centre column of a crown stays LOG and the leaf
 * patch is one smaller than the crown. 20 for radius 2.
 */
const CROWN_LEAF_BLOCKS = CROWN_COLUMNS - 1

type Region = {
  readonly width: number
  /** `[x][z][y]`, flattened. */
  readonly blocks: Uint8Array
}

const at = (region: Region, x: number, z: number, y: number): number =>
  region.blocks[(x * region.width + z) * CHUNK_HEIGHT + y] ?? 0

/** Generate a square of chunks and stitch them into one contiguous block field. */
const stitch = (seed: number, chunkSpan: number): Region => {
  const width = chunkSpan * CHUNK_SIZE_XZ
  const blocks = new Uint8Array(width * width * CHUNK_HEIGHT)

  for (let cx = 0; cx < chunkSpan; cx += 1) {
    for (let cz = 0; cz < chunkSpan; cz += 1) {
      const chunk = generateChunkAt(seed, cx, cz)
      for (let lx = 0; lx < CHUNK_SIZE_XZ; lx += 1) {
        for (let lz = 0; lz < CHUNK_SIZE_XZ; lz += 1) {
          const x = cx * CHUNK_SIZE_XZ + lx
          const z = cz * CHUNK_SIZE_XZ + lz
          for (let y = 0; y < CHUNK_HEIGHT; y += 1) {
            blocks[(x * width + z) * CHUNK_HEIGHT + y] = chunk.blocks[blockIndex(lx, y, lz)] ?? 0
          }
        }
      }
    }
  }

  return { width, blocks }
}

/**
 * Largest 4-connected patch of LEAVES at a single Y, over the whole stitched
 * region. Flood fill; 4-connected because that is what "walk from here to
 * there" means on a block grid.
 */
const largestLeafPatch = (region: Region): number => {
  const seen = new Uint8Array(region.width * region.width)
  const stack: Array<number> = []
  let largest = 0

  for (let y = 0; y < CHUNK_HEIGHT; y += 1) {
    seen.fill(0)

    for (let x = 0; x < region.width; x += 1) {
      for (let z = 0; z < region.width; z += 1) {
        if (at(region, x, z, y) !== BLOCK.LEAVES || seen[x * region.width + z] === 1) {
          continue
        }

        seen[x * region.width + z] = 1
        stack.length = 0
        stack.push(x * region.width + z)
        let size = 0

        while (stack.length > 0) {
          const cell = stack.pop() ?? 0
          size += 1
          const cx = Math.floor(cell / region.width)
          const cz = cell % region.width

          for (const [nx, nz] of [
            [cx - 1, cz],
            [cx + 1, cz],
            [cx, cz - 1],
            [cx, cz + 1],
          ] as ReadonlyArray<readonly [number, number]>) {
            if (nx < 0 || nz < 0 || nx >= region.width || nz >= region.width) {
              continue
            }
            if (seen[nx * region.width + nz] === 1 || at(region, nx, nz, y) !== BLOCK.LEAVES) {
              continue
            }
            seen[nx * region.width + nz] = 1
            stack.push(nx * region.width + nz)
          }
        }

        largest = Math.max(largest, size)
      }
    }
  }

  return largest
}

const countBlock = (region: Region, block: number): number => {
  let count = 0
  for (let index = 0; index < region.blocks.length; index += 1) {
    if (region.blocks[index] === block) {
      count += 1
    }
  }
  return count
}

const region = stitch(SEED, CHUNK_SPAN)
const trees = countBlock(region, BLOCK.LOG) / TRUNK_HEIGHT
const leaves = countBlock(region, BLOCK.LEAVES)

describe('the canopy in generated block data', () => {
  /**
   * The fixture must not be empty, and it must not be thin. 78 trees over 64
   * chunks is enough overlap opportunity that the old code produced a 78-block
   * slab in a SINGLE chunk of this same region.
   */
  it.effect('has enough trees for the sweep below to mean something', () =>
    Effect.sync(() => {
      expect(trees).toBeGreaterThan(50)
      expect(Number.isInteger(trees)).toBe(true)
      expect(leaves).toBeGreaterThan(0)
    }),
  )

  /**
   * REGRESSION, docs/testing.md §4-b F-2: 78 blocks against 21 for one crown.
   *
   * Asserted as an equality, not a bound. `toBeLessThanOrEqual` would also pass
   * for a world with one tree in it, or none; `toBe` says the largest thing made
   * of leaves anywhere in 64 chunks is exactly one whole crown, which is both
   * the ceiling and the proof that full crowns are present.
   */
  it.effect('never joins two crowns: the largest leaf patch at one Y is exactly one crown', () =>
    Effect.sync(() => {
      expect(largestLeafPatch(region)).toBe(CROWN_LEAF_BLOCKS)
    }),
  )

  /**
   * Every crown is whole. This is a stronger statement than it looks: it says no
   * crown was clipped at a chunk border either.
   *
   * `plantTree` cannot write into a neighbouring chunk's buffer (that is the
   * chunk manager's job — docs/porting.md), so a crown near a border loses part
   * of itself. With `TREE_GRID_SIZE` dividing `CHUNK_SIZE_XZ` and the jitter
   * window inset by `TREE_CELL_JITTER_ORIGIN >= TREE_CROWN_RADIUS`, no candidate
   * can land within `TREE_CROWN_RADIUS` of a chunk edge, so the clipping cannot
   * arise. It falls out of the same constants that bound the spacing; the
   * arithmetic is asserted below so that it cannot quietly stop being true.
   */
  it.effect('leaves no clipped crowns, because no candidate lands near a chunk border', () =>
    Effect.sync(() => {
      expect(leaves).toBe(trees * CROWN_LEAF_BLOCKS)

      expect(CHUNK_SIZE_XZ % TREE_GRID_SIZE).toBe(0)
      expect(TREE_CELL_JITTER_ORIGIN).toBeGreaterThanOrEqual(TREE_CROWN_RADIUS)
      expect(TREE_CELL_JITTER_ORIGIN + TREE_CELL_JITTER_SPAN - 1 + TREE_CROWN_RADIUS).toBeLessThan(TREE_GRID_SIZE)
    }),
  )

  it.effect('holds for other seeds, so it is the grid and not this world', () =>
    Effect.sync(() => {
      for (const seed of [1, 4242, 999983]) {
        const other = stitch(seed, 4)
        const otherTrees = countBlock(other, BLOCK.LOG) / TRUNK_HEIGHT

        expect(otherTrees).toBeGreaterThan(0)
        expect(largestLeafPatch(other)).toBe(CROWN_LEAF_BLOCKS)
      }
    }),
  )
})

describe('the spacing bound the grid is sized for', () => {
  /**
   * The inequality the whole design rests on, stated on the constants so that
   * changing any one of them fails here rather than in a screenshot.
   *
   * Two radius-`r` crowns occupy adjacent columns unless their trunks are more
   * than `2r` apart — strictly more, because at exactly `2r + 1` the crowns'
   * edge columns touch and 4-connect. Hence `>= 2r + 2`.
   */
  it.effect('is at least 2 * TREE_CROWN_RADIUS + 2, which is what "do not fuse" means', () =>
    Effect.sync(() => {
      expect(TREE_MIN_SPACING).toBe(TREE_GRID_SIZE - TREE_CELL_JITTER_SPAN + 1)
      expect(TREE_MIN_SPACING).toBeGreaterThanOrEqual(2 * TREE_CROWN_RADIUS + 2)
      // The jitter is real jitter. A span of 1 would satisfy everything above by
      // degenerating into a fixed lattice.
      expect(TREE_CELL_JITTER_SPAN).toBeGreaterThan(1)
    }),
  )

  /**
   * REGRESSION, and the reason the bound is `2r + 2` rather than `2r + 1`.
   *
   * Two crowns are painted into an empty field at a given separation and the
   * same flood fill is run over them. At `TREE_MIN_SPACING` they are two patches;
   * one block closer they are one. This is the `carver.test.ts` discipline —
   * reproduce the failure, do not merely assert its absence — applied to a
   * threshold instead of a guard. Without it, `TREE_MIN_SPACING` could be
   * lowered by one and every other test in this file would still pass, because
   * the noise happens not to put two trees at the minimum on flat ground in the
   * sampled seeds.
   */
  it.effect('is tight: one block closer and the two crowns become one patch', () =>
    Effect.sync(() => {
      const paint = (separation: number): number => {
        const width = 4 * TREE_MIN_SPACING
        const field: Region = { width, blocks: new Uint8Array(width * width * CHUNK_HEIGHT) }
        const y = 70

        for (const centre of [TREE_MIN_SPACING, TREE_MIN_SPACING + separation]) {
          for (let dx = -TREE_CROWN_RADIUS; dx <= TREE_CROWN_RADIUS; dx += 1) {
            for (let dz = -TREE_CROWN_RADIUS; dz <= TREE_CROWN_RADIUS; dz += 1) {
              if (Math.abs(dx) === TREE_CROWN_RADIUS && Math.abs(dz) === TREE_CROWN_RADIUS) {
                continue
              }
              const x = centre + dx
              const z = TREE_MIN_SPACING + dz
              field.blocks[(x * width + z) * CHUNK_HEIGHT + y] = BLOCK.LEAVES
            }
          }
        }

        return largestLeafPatch(field)
      }

      // Whole crowns here, trunks not painted, so the reference size is
      // CROWN_COLUMNS rather than CROWN_LEAF_BLOCKS.
      expect(paint(TREE_MIN_SPACING)).toBe(CROWN_COLUMNS)
      expect(paint(TREE_MIN_SPACING - 1)).toBeGreaterThan(CROWN_COLUMNS)
    }),
  )
})
