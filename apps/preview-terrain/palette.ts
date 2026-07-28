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
import { ORE_BLOCK } from '../../domain/ore'
import { PLANT } from '../../domain/vegetation'

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
  // Nothing GENERATES obsidian; it appears only under the portal overlay (`p`).
  // Dark violet rather than near-black so that a frame standing against stone at
  // night-time brightness is still a frame and not a hole in the picture.
  [BLOCK.OBSIDIAN, [82, 54, 128]],

  // Ore. Each is its real-world mineral colour lifted well clear of STONE's
  // [110, 110, 118], because the `slice` view is where 「is there any coal in
  // this world」 gets answered by eye, and an ore that reads as grey against grey
  // answers it wrongly. They are deliberately more saturated than any terrain
  // colour above: a vein is a handful of cells in a wall of stone, so it has to
  // survive being one pixel.
  [ORE_BLOCK.COAL, [42, 42, 48]],
  [ORE_BLOCK.IRON, [200, 154, 112]],
  [ORE_BLOCK.GOLD, [244, 205, 76]],
  [ORE_BLOCK.DIAMOND, [92, 219, 213]],
  [ORE_BLOCK.REDSTONE, [214, 54, 54]],
  [ORE_BLOCK.LAPIS, [48, 84, 190]],
  [ORE_BLOCK.EMERALD, [42, 194, 106]],

  // Ground cover. The two flowers must separate from GRASS [106, 168, 79] and
  // from each other, or 「are there flowers」 and 「are they all one kind」 are
  // both unanswerable from the top view — which is the view that shows ground
  // cover at all, since it is one block tall.
  [PLANT.DANDELION, [236, 226, 92]],
  [PLANT.POPPY, [206, 66, 62]],
  [PLANT.TALL_GRASS, [132, 190, 96]],
  [PLANT.FERN, [96, 152, 88]],
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
  // `O` for the ring. It has to survive `--ascii`, which is the mode a frame
  // gets pasted into a bug report in, so it cannot rely on the colour above.
  [BLOCK.OBSIDIAN, 'O'],
  // Ore: the mineral's initial, upper case, so a vein reads as a word in a wall
  // of `#`. `R` is redstone and `L` is lapis; `I` would collide with nothing but
  // is kept as iron for the same reason. These matter in `--ascii`, where the
  // colours above are gone and the glyph is the whole signal.
  [ORE_BLOCK.COAL, 'C'],
  [ORE_BLOCK.IRON, 'I'],
  [ORE_BLOCK.GOLD, 'G'],
  [ORE_BLOCK.DIAMOND, 'D'],
  [ORE_BLOCK.REDSTONE, 'R'],
  [ORE_BLOCK.LAPIS, 'L'],
  [ORE_BLOCK.EMERALD, 'E'],
  // Ground cover: lower case, so a printed frame separates 「something grows
  // here」 from 「something is buried here」 by case alone.
  [PLANT.DANDELION, 'y'],
  [PLANT.POPPY, 'r'],
  [PLANT.TALL_GRASS, 'w'],
  [PLANT.FERN, 'n'],
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
