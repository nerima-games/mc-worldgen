/**
 * Biome classification: climate → biome.
 *
 * The roster and direct climate rules mirror the reference implementation's
 * 13 biomes (`packages/world/domain/biome.ts:4`). The six-input climate
 * boundary used by terrain generation lives in `biome-classifier.ts`.
 *
 * ---------------------------------------------------------------------------
 * Rule table, not a nest of `if`s
 * ---------------------------------------------------------------------------
 *
 * The reference drives its two-input classifier from a declarative,
 * first-match-wins table (`CLASSIFY_BIOME_RULES`,
 * `packages/world/domain/biome-classifier.ts:44-79`) with a `PLAINS` fallback
 * (`:86`). That shape is kept: it makes the rules enumerable, so "which climates
 * produce no biome" and "which biome is unreachable" are answerable by reading
 * data instead of by tracing branches — and it is what lets
 * `test/biome.test.ts` sweep the whole climate square.
 *
 * The terrain boundary takes six inputs (`ClimateSample`,
 * `biome-classifier.ts`: temperature, humidity, continentalness, erosion, pv,
 * riverNoise) and applies the height and river refinements separately.
 */
import {
  HUM_DRY,
  HUM_JUNGLE,
  HUM_MOUNTAINS,
  HUM_SAVANNA_MIN,
  HUM_TAIGA,
  HUM_VERY_DRY,
  HUM_VERY_WET,
  HUM_WET,
  TEMP_COLD,
  TEMP_HOT,
  TEMP_JUNGLE,
} from './biome-classifier.config'
import { BlockId } from '@nerima-games/mc-kernel'

export const BIOMES = [
  'PLAINS',
  'DESERT',
  'FOREST',
  'FLOWER_FOREST',
  'OCEAN',
  'MOUNTAINS',
  'SNOW',
  'SWAMP',
  'JUNGLE',
  'BEACH',
  'RIVER',
  'TAIGA',
  'SAVANNA',
] as const

export type BiomeType = (typeof BIOMES)[number]

/** Biomes that may be stored in a dimension-agnostic chunk. */
export const CHUNK_BIOMES = [...BIOMES, 'NETHER', 'END'] as const

export type ChunkBiomeType = (typeof CHUNK_BIOMES)[number]

type BiomeRule = {
  readonly biome: BiomeType
  readonly when: (temperature: number, humidity: number) => boolean
}

const BIOME_RULES: ReadonlyArray<BiomeRule> = [
  { biome: 'SNOW', when: (temperature, humidity) => humidity < HUM_VERY_DRY && temperature < TEMP_COLD },
  { biome: 'DESERT', when: (temperature, humidity) => humidity < HUM_VERY_DRY && temperature >= TEMP_COLD },
  { biome: 'JUNGLE', when: (temperature, humidity) => humidity > HUM_JUNGLE && temperature > TEMP_JUNGLE },
  { biome: 'TAIGA', when: (temperature, humidity) => humidity > HUM_VERY_WET && temperature < TEMP_COLD && humidity > HUM_TAIGA },
  { biome: 'SWAMP', when: (temperature, humidity) => humidity > HUM_VERY_WET && temperature > TEMP_HOT },
  { biome: 'FOREST', when: (_temperature, humidity) => humidity > HUM_VERY_WET },
  { biome: 'TAIGA', when: (temperature, humidity) => temperature < TEMP_COLD && humidity > HUM_TAIGA },
  { biome: 'MOUNTAINS', when: (temperature, humidity) => temperature < TEMP_COLD && humidity > HUM_MOUNTAINS },
  { biome: 'SNOW', when: (_temperature) => _temperature < TEMP_COLD },
  { biome: 'JUNGLE', when: (temperature, humidity) => temperature > TEMP_HOT && humidity > HUM_WET },
  { biome: 'SAVANNA', when: (temperature, humidity) => temperature > TEMP_HOT && humidity > HUM_SAVANNA_MIN },
  { biome: 'DESERT', when: (_temperature) => _temperature > TEMP_HOT },
  { biome: 'PLAINS', when: (_temperature, humidity) => humidity < HUM_DRY },
  { biome: 'FOREST', when: (_temperature, humidity) => humidity > HUM_WET },
]

/** The fallback, matching the reference's `'PLAINS'` default (`biome-classifier.ts:86`). */
export const FALLBACK_BIOME: BiomeType = 'PLAINS'

export const classifyBiome = (temperature: number, humidity: number): BiomeType =>
  BIOME_RULES.find((rule) => rule.when(temperature, humidity))?.biome ?? FALLBACK_BIOME

/**
 * Surface materials for a biome.
 *
 * `underwaterTop` exists because the block on a submerged surface is not the
 * block on a dry one — a grass block below sea level is the classic "grass
 * growing on the lake bed" artefact.
 */
export type BiomeSurface = {
  readonly top: BlockId
  readonly filler: BlockId
  readonly underwaterTop: BlockId
}

/**
 * The block ids this repository names.
 *
 * The first eleven are no longer local: `mc-kernel/domain/block-registry.ts`
 * ADOPTED them as the canonical id assignment for `air`, `bedrock`, `stone`,
 * `dirt`, `grass_block`, `sand`, `water`, `snow`, `gravel`, `oak_log` and
 * `oak_leaves`. Kernel took this repository's numbering rather than imposing a
 * new one, precisely so that adopting the registry costs an import change here
 * and not a regeneration of every golden terrain fixture.
 *
 * `test/kernel-mirror.test.ts` pins the agreement in both directions. Changing
 * a number here is changing a save format; see the registry's header.
 *
 * The names are this repository's generation vocabulary (`GRASS`, `LOG`,
 * `LEAVES`) rather than kernel's `BlockType` literals (`grass_block`,
 * `oak_log`, `oak_leaves`); the mapping is in that same mirror test.
 *
 * ---------------------------------------------------------------------------
 * OBSIDIAN, and why this comment no longer says "the ids this generator WRITES"
 * ---------------------------------------------------------------------------
 *
 * The first eleven ids share a property that `OBSIDIAN` does not: every one of
 * them is placed by `../domain/terrain.ts` while filling a column. Obsidian is
 * placed by nothing yet. It is here because `../domain/portal-frame.ts` READS
 * it — a portal frame is defined by it — and because plan.md §3.7 gives this
 * repository 「構造物（村/ポータル/End）」, so the generator that writes it is a
 * structure this repository owes rather than one it will never have.
 *
 * The heading was rewritten instead of the row being quietly appended under it,
 * because "the ids this generator writes" would have become false on the line
 * it was documenting. Its number, 40, is transcribed from kernel's
 * `BLOCK_REGISTRY` (`block-registry.ts:1269`) rather than chosen here: unlike
 * the eleven above, this one is kernel's assignment and this repository is the
 * one adopting it. `test/kernel-mirror.test.ts` pins it in both directions with
 * the rest.
 *
 * `nether_portal` (kernel id 118) is deliberately NOT here. Detection refuses a
 * frame whose interior is not AIR, so the rule never names the lit block, and an
 * id in this table that nothing reads is an id nobody notices going stale.
 */
/**
 * The raw `mc-kernel` `BLOCK_REGISTRY` ids named above, kept as their own
 * table so the id itself carries the kernel block name rather than sitting as
 * an unnamed literal inside the `BlockId(...)` calls below.
 */
const KERNEL_BLOCK_ID = {
  AIR: 0,
  BEDROCK: 1,
  DIRT: 3,
  GRASS_BLOCK: 4,
  GRAVEL: 8,
  OAK_LEAVES: 10,
  OAK_LOG: 9,
  OBSIDIAN: 40,
  SAND: 5,
  SNOW: 7,
  STONE: 2,
  WATER: 6,
} as const

export const BLOCK = {
  AIR: BlockId(KERNEL_BLOCK_ID.AIR),
  BEDROCK: BlockId(KERNEL_BLOCK_ID.BEDROCK),
  DIRT: BlockId(KERNEL_BLOCK_ID.DIRT),
  GRASS: BlockId(KERNEL_BLOCK_ID.GRASS_BLOCK),
  GRAVEL: BlockId(KERNEL_BLOCK_ID.GRAVEL),
  LEAVES: BlockId(KERNEL_BLOCK_ID.OAK_LEAVES),
  LOG: BlockId(KERNEL_BLOCK_ID.OAK_LOG),
  OBSIDIAN: BlockId(KERNEL_BLOCK_ID.OBSIDIAN),
  SAND: BlockId(KERNEL_BLOCK_ID.SAND),
  SNOW: BlockId(KERNEL_BLOCK_ID.SNOW),
  STONE: BlockId(KERNEL_BLOCK_ID.STONE),
  WATER: BlockId(KERNEL_BLOCK_ID.WATER),
} as const

export const BIOME_SURFACES: Record<BiomeType, BiomeSurface> = {
  BEACH: { filler: BLOCK.SAND, top: BLOCK.SAND, underwaterTop: BLOCK.SAND },
  DESERT: { filler: BLOCK.SAND, top: BLOCK.SAND, underwaterTop: BLOCK.SAND },
  FLOWER_FOREST: { filler: BLOCK.DIRT, top: BLOCK.GRASS, underwaterTop: BLOCK.GRAVEL },
  FOREST: { filler: BLOCK.DIRT, top: BLOCK.GRASS, underwaterTop: BLOCK.GRAVEL },
  JUNGLE: { filler: BLOCK.DIRT, top: BLOCK.GRASS, underwaterTop: BLOCK.GRAVEL },
  MOUNTAINS: { filler: BLOCK.STONE, top: BLOCK.STONE, underwaterTop: BLOCK.STONE },
  OCEAN: { filler: BLOCK.SAND, top: BLOCK.SAND, underwaterTop: BLOCK.SAND },
  PLAINS: { filler: BLOCK.DIRT, top: BLOCK.GRASS, underwaterTop: BLOCK.GRAVEL },
  RIVER: { filler: BLOCK.SAND, top: BLOCK.SAND, underwaterTop: BLOCK.SAND },
  SAVANNA: { filler: BLOCK.DIRT, top: BLOCK.GRASS, underwaterTop: BLOCK.GRAVEL },
  SNOW: { filler: BLOCK.DIRT, top: BLOCK.SNOW, underwaterTop: BLOCK.GRAVEL },
  SWAMP: { filler: BLOCK.DIRT, top: BLOCK.GRASS, underwaterTop: BLOCK.GRAVEL },
  TAIGA: { filler: BLOCK.DIRT, top: BLOCK.GRASS, underwaterTop: BLOCK.GRAVEL },
}

/**
 * How densely trees grow, as an effective per-column probability.
 *
 * There is a ceiling on these numbers and it is geometric, not aesthetic. A
 * radius-2 crown fuses with its neighbour into one connected sheet of leaves
 * unless the trunks are at least `2 * TREE_CROWN_RADIUS + 2 = 6` columns apart,
 * and columns 6 apart pack at 1/36 = 0.0278 per column. Any density above that
 * is a request for a canopy that cannot exist without fusing.
 *
 * FOREST was 0.04 and TAIGA was 0.03 — both over the ceiling, which is why the
 * reference's "walkable leaf slab" warning kept coming true after the jittered
 * grid was introduced (docs/testing.md §4-b F-2: a 78-block leaf patch against
 * 21 for one crown). They are now 0.012 and 0.009, comfortably under both the
 * geometric ceiling and the placement grid's own `1 / TREE_GRID_AREA` = 0.0156.
 *
 * SAVANNA, PLAINS and SNOW were already under the ceiling and did NOT move. The
 * grid grew from 4×4 to 8×8 in the same change, and that is deliberately a
 * no-op for them: `shouldPlaceTree` converts by `density × TREE_GRID_AREA`, so
 * the expected number of trees per unit area depends on the density alone.
 *
 * See `domain/tree-placement.ts`.
 */
export const BIOME_TREE_DENSITY: Record<BiomeType, number> = {
  BEACH: 0,
  DESERT: 0,
  FLOWER_FOREST: 0.012,
  FOREST: 0.012,
  JUNGLE: 0.012,
  MOUNTAINS: 0,
  OCEAN: 0,
  PLAINS: 0.006,
  RIVER: 0,
  SAVANNA: 0.008,
  SNOW: 0.004,
  SWAMP: 0.012,
  TAIGA: 0.009,
}
