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
import { BlockId } from './kernel-vocabulary'

export const BIOMES =['OCEAN', 'BEACH', 'DESERT', 'SAVANNA', 'PLAINS', 'FOREST', 'TAIGA', 'SNOW'] as const

export type BiomeType = (typeof BIOMES)[number]

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
 * The block ids this generator writes.
 *
 * These eleven numbers are no longer local: `mc-kernel/domain/block-registry.ts`
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

/** How densely trees grow, as an effective per-column probability. See `domain/tree-placement.ts`. */
export const BIOME_TREE_DENSITY: Record<BiomeType, number> = {
  OCEAN: 0,
  BEACH: 0,
  DESERT: 0,
  SAVANNA: 0.008,
  PLAINS: 0.006,
  FOREST: 0.04,
  TAIGA: 0.03,
  SNOW: 0.004,
}
