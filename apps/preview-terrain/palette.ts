/**
 * Colours for the terrain preview.
 *
 * A dev application, not shipped API. See apps/preview-terrain/README.md.
 *
 * The palette exists so that the six things docs/testing.md §3 asks the preview
 * to make visible are actually distinguishable by eye:
 *
 *   - water must not be confusable with any solid block, or "is the sea level
 *     right" is unanswerable;
 *   - AIR must be near-black rather than black, so that a carved cave reads as
 *     a shape against the unlit background rather than as the absence of a
 *     frame;
 *   - LOG and LEAVES must separate from GRASS, or "is the canopy a walkable
 *     slab" cannot be judged from above.
 */
import type { BiomeType } from '../../domain/biome'
import { BLOCK } from '../../domain/biome'

export type Rgb = readonly [number, number, number]

/**
 * One colour per biome. Chosen so that the two overrides `biomeFor` applies
 * downstream of climate — OCEAN and BEACH — are the two most obvious colours on
 * screen, because a preview whose ocean is subtle cannot show a missing ocean.
 */
export const BIOME_COLOR: Record<BiomeType, Rgb> = {
  OCEAN: [27, 59, 111],
  BEACH: [227, 217, 165],
  DESERT: [217, 193, 119],
  SAVANNA: [168, 176, 96],
  PLAINS: [124, 179, 66],
  FOREST: [46, 107, 46],
  TAIGA: [74, 124, 89],
  SNOW: [232, 238, 242],
}

const BLOCK_COLORS: ReadonlyArray<readonly [number, Rgb]> = [
  [BLOCK.AIR, [11, 13, 18]],
  [BLOCK.BEDROCK, [38, 38, 43]],
  [BLOCK.STONE, [110, 110, 118]],
  [BLOCK.DIRT, [122, 90, 58]],
  [BLOCK.GRASS, [106, 168, 79]],
  [BLOCK.SAND, [224, 206, 148]],
  [BLOCK.WATER, [45, 107, 181]],
  [BLOCK.SNOW, [234, 241, 245]],
  [BLOCK.GRAVEL, [138, 138, 138]],
  [BLOCK.LOG, [122, 74, 38]],
  [BLOCK.LEAVES, [63, 139, 63]],
]

const BLOCK_COLOR_BY_ID: ReadonlyMap<number, Rgb> = new Map(BLOCK_COLORS)

/** Magenta: a block id the palette does not know. Loud on purpose. */
export const UNKNOWN_BLOCK_COLOR: Rgb = [255, 0, 255]

export const blockColor = (blockId: number): Rgb =>
  BLOCK_COLOR_BY_ID.get(blockId) ?? UNKNOWN_BLOCK_COLOR

/**
 * ASCII glyphs, chosen so that a printed frame reads as terrain without a
 * legend: `~` water, `.` air, `#` stone, `=` bedrock, `T` a trunk, `^` leaves.
 * Density of ink roughly tracks density of matter.
 */
const BLOCK_GLYPHS: ReadonlyArray<readonly [number, string]> = [
  [BLOCK.AIR, '.'],
  [BLOCK.BEDROCK, '='],
  [BLOCK.STONE, '#'],
  [BLOCK.DIRT, ','],
  [BLOCK.GRASS, '"'],
  [BLOCK.SAND, ':'],
  [BLOCK.WATER, '~'],
  [BLOCK.SNOW, '*'],
  [BLOCK.GRAVEL, ';'],
  [BLOCK.LOG, 'T'],
  [BLOCK.LEAVES, '^'],
]

const BLOCK_GLYPH_BY_ID: ReadonlyMap<number, string> = new Map(BLOCK_GLYPHS)

export const blockGlyph = (blockId: number): string => BLOCK_GLYPH_BY_ID.get(blockId) ?? '?'

/** First letter of the biome, so the map legend is the biome roster itself. */
export const BIOME_GLYPH: Record<BiomeType, string> = {
  OCEAN: 'o',
  BEACH: 'b',
  DESERT: 'd',
  SAVANNA: 'v',
  PLAINS: 'p',
  FOREST: 'f',
  TAIGA: 't',
  SNOW: 's',
}

/** Ink ramp for the height view, low to high. */
export const HEIGHT_GLYPHS = ' .:-=+*#%@'

const clampChannel = (value: number): number => Math.max(0, Math.min(255, Math.round(value)))

export const shade = (color: Rgb, factor: number): Rgb => [
  clampChannel(color[0] * factor),
  clampChannel(color[1] * factor),
  clampChannel(color[2] * factor),
]

export const blend = (from: Rgb, to: Rgb, amount: number): Rgb => {
  const t = Math.max(0, Math.min(1, amount))
  return [
    clampChannel(from[0] + (to[0] - from[0]) * t),
    clampChannel(from[1] + (to[1] - from[1]) * t),
    clampChannel(from[2] + (to[2] - from[2]) * t),
  ]
}

/**
 * The height ramp used by the `height` view.
 *
 * Deliberately NOT a smooth greyscale. A continuous ramp hides plateaus: a
 * thousand columns all pinned to the same height look like a gentle gradient.
 * Banding the ramp into discrete steps makes a plateau read as one flat patch
 * of colour, which is exactly the failure mode ("the world is flat") this view
 * is here to catch.
 */
export const HEIGHT_RAMP: ReadonlyArray<Rgb> = [
  [16, 32, 72],
  [24, 60, 120],
  [40, 96, 168],
  [72, 140, 200],
  [227, 217, 165],
  [124, 179, 66],
  [92, 150, 60],
  [140, 150, 80],
  [168, 152, 108],
  [186, 168, 140],
  [214, 206, 196],
  [246, 250, 252],
]
