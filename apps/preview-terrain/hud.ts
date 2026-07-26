/**
 * The status panel under the frame.
 *
 * A dev application, not shipped API.
 *
 * The HUD is not decoration. A coloured picture of terrain is unfalsifiable on
 * its own — every generator produces something that looks like a map. The HUD
 * prints the numbers the picture is claiming (surface range, how much of the
 * frame is below sea level, how many columns are pinned to the shaper's clamps,
 * the biome mix) so that a wrong picture can be recognised as wrong.
 */
import { BIOME_COLOR } from './palette'
import { paint, bold, dim, type Rgb } from './raster'
import type { ColumnSample } from './sampler'
import type { Camera, ViewMode, ViewStats, ViewToggles } from './views'

const LABEL: Rgb = [150, 160, 175]
const VALUE: Rgb = [235, 240, 246]
const WARN: Rgb = [255, 150, 60]
const WATER: Rgb = [110, 170, 235]
const TREE: Rgb = [120, 200, 120]

/**
 * How the HUD emits colour.
 *
 * `--ascii` exists so a frame can be pasted into an issue; a HUD full of
 * `ESC[38;2;…m` underneath it would defeat that entirely. Threading the style
 * rather than reading a global keeps `buildHud` a pure function of its
 * arguments.
 */
export type Style = {
  readonly paint: (text: string, color: Rgb) => string
  readonly bold: (text: string) => string
  readonly dim: (text: string) => string
}

export const ANSI_STYLE: Style = { paint, bold, dim }

export const PLAIN_STYLE: Style = {
  paint: (text) => text,
  bold: (text) => text,
  dim: (text) => text,
}

export type HudState = {
  readonly seed: number
  readonly view: ViewMode
  readonly camera: Camera
  readonly decorate: boolean
  readonly guard: boolean
  readonly toggles: ViewToggles
  readonly seaLevel: number
  /** Frame width in terminal cells. */
  readonly frameWidth: number
  /** Frame height in WORLD BLOCKS, already adjusted for the ANSI/ASCII row packing. */
  readonly frameBlocksTall: number
  readonly chunksGenerated: number
}

const onOff = (enabled: boolean): string => (enabled ? 'on' : 'off')

const percent = (part: number, whole: number): string =>
  whole === 0 ? 'n/a' : `${(100 * (part / whole)).toFixed(1)}%`

const describeCentre = (style: Style, centre: ColumnSample, seaLevel: number): string => {
  const field = (label: string, value: string): string =>
    `${style.paint(label, LABEL)} ${style.paint(value, VALUE)}`

  return [
    field('at', `(${String(centre.worldX)}, ${String(centre.worldZ)})`),
    field('surface y', String(centre.surfaceY)),
    style.paint(centre.biome, BIOME_COLOR[centre.biome]),
    style.paint(
      centre.submerged ? `under ${String(centre.waterDepth)} blocks of water` : 'dry',
      centre.submerged ? WATER : LABEL,
    ),
    field('sea level', String(seaLevel)),
    centre.hasTree ? style.paint('tree here', TREE) : '',
  ]
    .filter((part) => part !== '')
    .join('  ')
}

const describeExtent = (style: Style, state: HudState): string => {
  const field = (label: string, value: string): string =>
    `${style.paint(label, LABEL)} ${style.paint(value, VALUE)}`

  const blocksWide =
    state.view === 'slice' ? state.frameWidth : state.frameWidth * state.camera.zoom

  const extent =
    state.view === 'slice'
      ? `${String(blocksWide)} blocks wide, y ${String(state.camera.yBottom)}..${String(
          state.camera.yBottom + state.frameBlocksTall - 1,
        )}, slice at z=${String(state.camera.z)}`
      : `${String(blocksWide)}x${String(state.frameBlocksTall * state.camera.zoom)} blocks at ${String(
          state.camera.zoom,
        )} blk/px`

  return [field('view', state.view), field('frame', extent)].join('  ')
}

const describeStats = (style: Style, stats: ViewStats): string => {
  const field = (label: string, value: string): string =>
    `${style.paint(label, LABEL)} ${style.paint(value, VALUE)}`

  const pinnedHighColor = stats.pinnedHigh > 0 ? WARN : LABEL
  return [
    field('surface', `${String(stats.surfaceMin)}..${String(stats.surfaceMax)}`),
    field('below sea', percent(stats.submerged, stats.columns)),
    `${style.paint('pinned high', pinnedHighColor)} ${style.paint(
      percent(stats.pinnedHigh, stats.columns),
      stats.pinnedHigh > 0 ? WARN : VALUE,
    )}`,
    field('pinned low', percent(stats.pinnedLow, stats.columns)),
    field('trees', String(stats.trees)),
  ].join('  ')
}

const describeBiomes = (style: Style, stats: ViewStats): string => {
  const shown = stats.biomeCounts.slice(0, 6)
  const rendered = shown.map(
    ([biome, count]) => `${style.paint(biome, BIOME_COLOR[biome])} ${percent(count, stats.columns)}`,
  )
  const overflow = stats.biomeCounts.length > shown.length ? style.dim('  ...') : ''
  return `${style.paint('biomes', LABEL)} ${rendered.join('  ')}${overflow}`
}

const describeToggles = (style: Style, state: HudState): string => {
  const field = (label: string, value: string): string =>
    `${style.paint(label, LABEL)} ${style.paint(value, VALUE)}`

  return [
    field('seed', String(state.seed)),
    `${style.paint('guard', state.guard ? LABEL : WARN)} ${style.paint(
      onOff(state.guard),
      state.guard ? VALUE : WARN,
    )}`,
    field('trees', onOff(state.decorate)),
    field('grid', onOff(state.toggles.chunkGrid)),
    field('sea line', onOff(state.toggles.seaLine)),
    field('chunks generated', String(state.chunksGenerated)),
  ].join('  ')
}

const KEY_HINT =
  'wasd pan  q/e up-down  -/= zoom  1/2/3 view  [ ] seed  g guard  t trees  b grid  l sealine  0 recentre  ? help  x quit'

export const buildHud = (
  state: HudState,
  stats: ViewStats,
  centre: ColumnSample,
  style: Style = ANSI_STYLE,
): ReadonlyArray<string> => [
  `${style.bold(style.paint('mc-worldgen terrain preview', VALUE))}  ${describeExtent(style, state)}`,
  describeCentre(style, centre, state.seaLevel),
  describeStats(style, stats),
  describeBiomes(style, stats),
  describeToggles(style, state),
  style.dim(KEY_HINT),
]

/** How many terminal rows `buildHud` needs. Kept next to it so they cannot drift. */
export const HUD_ROWS = 6
