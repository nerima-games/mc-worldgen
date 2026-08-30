import { CHUNK_SIZE_XZ } from '@nerima-games/mc-kernel'

/**
 * Terrain constants and the chunk buffer layout.
 *
 * These constants define the current deterministic generation contract.
 *
 * ---------------------------------------------------------------------------
 * ⚠ plan.md §3.7 STATES THE WRONG SEA LEVEL. DO NOT USE ITS NUMBERS.
 * ---------------------------------------------------------------------------
 *
 * plan.md §3.7 lists, under 設計注意(参照実装の実測知見):
 *
 *     地形定数: `SEA_LEVEL=48`、`LAKE_LEVEL=62`
 *
 * Both values are wrong, and the section they appear in is the one whose items
 * plan.md instructs should become regression tests. Writing a test from those
 * numbers would have made the error permanent and authoritative.
 *
 * The reference implementation, `packages/core/domain/constants.ts`:
 *
 *     :16  // Phase 2.1 MC 1.18-aligned. Ocean biome water fills up to this height.
 *     :17  export const SEA_LEVEL = 63
 *     :19  // Phase 2.1 MC 1.18-aligned. Inland lake water surface matches sea level.
 *     :20  export const LAKE_LEVEL = SEA_LEVEL
 *
 * So:
 *   - `SEA_LEVEL` is **63**, not 48. (63 is also the vanilla Minecraft value.)
 *   - `LAKE_LEVEL` is **not a distinct constant**. It is defined as `SEA_LEVEL`,
 *     so it is 63 as well, not 62. There is no one-block offset between a lake
 *     surface and a sea surface, and any code branching on the difference is
 *     encoding a distinction that has never existed.
 *
 * See docs/design-notes.md for the full correction and the tests that pin it.
 *
 * ---------------------------------------------------------------------------
 * Why they are a config type rather than two exported numbers
 * ---------------------------------------------------------------------------
 *
 * In the reference implementation these constants are imported at exactly ONE
 * site inside `packages/world` — `domain/terrain/generator-types.ts:3`, where
 * they become `DEFAULT_TERRAIN_LEVELS` (`:15-18`). Everything downstream takes
 * `terrainLevels: TerrainLevels = DEFAULT_TERRAIN_LEVELS` as a defaulted
 * parameter (e.g. `terrain/generator.ts:34`, `terrain/tree-placer.ts:194`).
 *
 * That is a good design and it is preserved here: the levels are injected, not
 * baked. It is what makes a superflat preview world, a test fixture with an
 * exaggerated sea, and a future custom-worldgen setting all possible without
 * touching generation code.
 */

/** Horizontal extent of a chunk, in blocks. */
export { CHUNK_SIZE_XZ }

/** Vertical extent of a chunk, in blocks. */
export const CHUNK_HEIGHT = 256

/**
 * Blocks per chunk, and therefore the length of the `blocks` buffer.
 * 16 × 16 × 256 = 65,536 bytes, matching the reference implementation
 * (`packages/world/domain/chunk.ts:11-12`).
 */
export const CHUNK_VOLUME: number = CHUNK_SIZE_XZ * CHUNK_SIZE_XZ * CHUNK_HEIGHT

/**
 * Flat index into the `blocks` buffer.
 *
 * Y-major within a column, exactly as the reference laid it out
 * (`packages/world/domain/chunk.ts:11`):
 *
 *     index = y + (z * CHUNK_HEIGHT) + (x * CHUNK_HEIGHT * CHUNK_SIZE)
 *
 * The ordering is not arbitrary: consecutive Y values are adjacent in memory,
 * which is what makes column-walking operations — surface finding, sky-light
 * propagation, water filling — cache-friendly. They are the operations that run
 * per column per chunk, so this is the axis worth optimising for.
 */
export const blockIndex = (x: number, y: number, z: number): number =>
  y + z * CHUNK_HEIGHT + x * CHUNK_HEIGHT * CHUNK_SIZE_XZ

/**
 * Sea level. **63**, per `packages/core/domain/constants.ts:17`.
 * plan.md §3.7's `48` is wrong; see the module header.
 */
export const SEA_LEVEL = 63

/**
 * Lake level. Defined as `SEA_LEVEL` because that is exactly how the reference
 * defines it (`packages/core/domain/constants.ts:20`: `export const LAKE_LEVEL =
 * SEA_LEVEL`). plan.md §3.7's `62` is wrong; see the module header.
 *
 * Deliberately written as `SEA_LEVEL` rather than as the literal `63`, so that
 * the two cannot drift apart by someone editing one number.
 */
export const LAKE_LEVEL: number = SEA_LEVEL

export type TerrainLevels = {
  readonly seaLevel: number
  readonly lakeLevel: number
}

export const DEFAULT_TERRAIN_LEVELS: TerrainLevels = {
  lakeLevel: LAKE_LEVEL,
  seaLevel: SEA_LEVEL,
}

/** Lowest solid layer. Nothing is ever carved or replaced below this. */
export const BEDROCK_Y = 0

/** Upper-exclusive boundary of the vanilla deepslate layer. */
export const DEEPSLATE_CEILING = 16

/**
 * How many blocks of solid shell a carver must leave beneath a water body.
 *
 * `CAVE_WATER_FLOOR_MARGIN = 3` in
 * `packages/world/domain/terrain/constants.ts:50`, whose comment records that
 * caves "used to eat the river/lake BED from below". See `domain/carver.ts`.
 */
export const WATER_FLOOR_MARGIN = 3
