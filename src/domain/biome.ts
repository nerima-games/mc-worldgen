/**
 * Biome classification: climate → biome.
 *
 * PRE-AUDIT FIRST CUT (叩き台). The roster below is a representative subset of
 * the reference implementation's 13 biomes
 * (`packages/world/domain/biome.ts:4`), enough to exercise the classifier and
 * the surface rules. The full roster arrives with the structures that need it.
 *
 * ---------------------------------------------------------------------------
 * Rule table, not a nest of `if`s
 * ---------------------------------------------------------------------------
 *
 * The reference drove its two-input classifier from a declarative,
 * first-match-wins table (`CLASSIFY_BIOME_RULES`,
 * `packages/world/domain/biome-classifier.ts:44-79`) with a `PLAINS` fallback
 * (`:86`). That shape is kept: it makes the rules enumerable, so "which climates
 * produce no biome" and "which biome is unreachable" are answerable by reading
 * data instead of by tracing branches — and it is what lets
 * `test/biome.test.ts` sweep the whole climate square.
 *
 * The reference's *full* classifier takes six inputs, not two
 * (`ClimateSample`, `biome-classifier.ts:16-23`: temperature, humidity,
 * continentalness, erosion, pv, riverNoise). This skeleton implements the
 * two-input stage only; docs/porting.md records the rest.
 */
import { BlockId } from '@nerima-games/mc-kernel'

export const BIOMES = ['OCEAN', 'BEACH', 'DESERT', 'SAVANNA', 'PLAINS', 'FOREST', 'TAIGA', 'SNOW'] as const

export type BiomeType = (typeof BIOMES)[number]

/** Biomes that may be stored in a dimension-agnostic chunk. */
export const CHUNK_BIOMES = [...BIOMES, 'NETHER', 'END'] as const

export type ChunkBiomeType = (typeof CHUNK_BIOMES)[number]

/** Climate at a column. Both axes are normalised to [0, 1]. */
export type ClimateSample = {
  readonly temperature: number
  readonly humidity: number
}

type BiomeRule = {
  readonly biome: BiomeType
  readonly when: (climate: ClimateSample) => boolean
}

/**
 * First match wins. Order is therefore meaningful and the cold rules come
 * first: temperature dominates humidity, because a wet freezing region is snow
 * before it is anything else.
 */
const BIOME_RULES: ReadonlyArray<BiomeRule> = [
  { biome: 'SNOW', when: ({ temperature }) => temperature < 0.2 },
  { biome: 'TAIGA', when: ({ temperature }) => temperature < 0.35 },
  { biome: 'DESERT', when: ({ temperature, humidity }) => temperature > 0.75 && humidity < 0.3 },
  { biome: 'SAVANNA', when: ({ temperature, humidity }) => temperature > 0.65 && humidity < 0.5 },
  { biome: 'FOREST', when: ({ humidity }) => humidity > 0.55 },
]

/** The fallback, matching the reference's `'PLAINS'` default (`biome-classifier.ts:86`). */
export const FALLBACK_BIOME: BiomeType = 'PLAINS'

export const classifyBiome = (climate: ClimateSample): BiomeType =>
  BIOME_RULES.find((rule) => rule.when(climate))?.biome ?? FALLBACK_BIOME

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
export const BLOCK = {
  AIR: BlockId(0),
  BEDROCK: BlockId(1),
  STONE: BlockId(2),
  DIRT: BlockId(3),
  GRASS: BlockId(4),
  SAND: BlockId(5),
  WATER: BlockId(6),
  SNOW: BlockId(7),
  GRAVEL: BlockId(8),
  LOG: BlockId(9),
  LEAVES: BlockId(10),
  OBSIDIAN: BlockId(40),
} as const

export const BIOME_SURFACES: Record<BiomeType, BiomeSurface> = {
  OCEAN: { top: BLOCK.SAND, filler: BLOCK.SAND, underwaterTop: BLOCK.SAND },
  BEACH: { top: BLOCK.SAND, filler: BLOCK.SAND, underwaterTop: BLOCK.SAND },
  DESERT: { top: BLOCK.SAND, filler: BLOCK.SAND, underwaterTop: BLOCK.SAND },
  SAVANNA: { top: BLOCK.GRASS, filler: BLOCK.DIRT, underwaterTop: BLOCK.GRAVEL },
  PLAINS: { top: BLOCK.GRASS, filler: BLOCK.DIRT, underwaterTop: BLOCK.GRAVEL },
  FOREST: { top: BLOCK.GRASS, filler: BLOCK.DIRT, underwaterTop: BLOCK.GRAVEL },
  TAIGA: { top: BLOCK.GRASS, filler: BLOCK.DIRT, underwaterTop: BLOCK.GRAVEL },
  SNOW: { top: BLOCK.SNOW, filler: BLOCK.DIRT, underwaterTop: BLOCK.GRAVEL },
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
  OCEAN: 0,
  BEACH: 0,
  DESERT: 0,
  SAVANNA: 0.008,
  PLAINS: 0.006,
  FOREST: 0.012,
  TAIGA: 0.009,
  SNOW: 0.004,
}
