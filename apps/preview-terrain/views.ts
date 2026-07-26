/**
 * The three views.
 *
 * A dev application, not shipped API.
 *
 * ---------------------------------------------------------------------------
 * Each view answers a specific question from docs/testing.md §3
 * ---------------------------------------------------------------------------
 *
 *   map    — biome colours + hillshade + tree markers, seen from above.
 *            Answers 2 (biomes are distinguishable), 5 (canopies have not
 *            fused into a slab) and 6 (no seam at a chunk border).
 *
 *   height — surface height, banded, with a hard colour break exactly at sea
 *            level and LOUD colours for columns pinned to MIN_SURFACE_Y or
 *            MAX_SURFACE_Y. Answers 3 (sea level) from above, and answers
 *            "is the world flat" honestly rather than flatteringly.
 *
 *   slice  — a vertical cross-section of REAL generated blocks. Answers 3
 *            (count the water rows against the gutter) and 4 (look under a
 *            lake for the hollow-lake void). This is the view that reads
 *            `generateChunk` output rather than the cheap column queries, and
 *            it is the only one that can see a cave at all.
 *
 * A 3D flythrough would be worse at 3 and 4, not better: finding out whether a
 * lake bed has been carved away from underneath means digging, and reading a
 * sea level off a first-person camera means counting blocks you are standing
 * in. The cross-section shows both at a glance.
 */
import type { BiomeType } from '../../domain/biome'
import { BLOCK } from '../../domain/biome'
import { CHUNK_HEIGHT, CHUNK_SIZE_XZ } from '../../domain/constants'
import { MAX_SURFACE_Y, MIN_SURFACE_Y } from '../../domain/terrain'
import {
  BIOME_COLOR,
  BIOME_GLYPH,
  blend,
  blockColor,
  blockGlyph,
  HEIGHT_GLYPHS,
  HEIGHT_RAMP,
  shade,
  type Rgb,
} from './palette'
import { createRaster, setPixel, toAnsiLines, toAsciiLines, type Raster } from './raster'
import { blockAt, positiveMod, sampleColumn, type ChunkCache, type ColumnSample, type WorldParams } from './sampler'

export type ViewMode = 'map' | 'height' | 'slice'

export const VIEW_MODES: ReadonlyArray<ViewMode> = ['map', 'height', 'slice']

export type Camera = {
  /** World X at the centre of the frame. */
  readonly x: number
  /** World Z at the centre of the frame (map views) / the slice plane (slice view). */
  readonly z: number
  /** Lowest world Y drawn by the slice view. */
  readonly yBottom: number
  /** Blocks per pixel. Map views only; the slice view is always 1:1. */
  readonly zoom: number
}

export type ViewToggles = {
  readonly chunkGrid: boolean
  readonly seaLine: boolean
}

export type ViewStats = {
  readonly biomeCounts: ReadonlyArray<readonly [BiomeType, number]>
  readonly columns: number
  readonly surfaceMin: number
  readonly surfaceMax: number
  readonly submerged: number
  readonly pinnedHigh: number
  readonly pinnedLow: number
  readonly trees: number
}

export type RenderedView = {
  /** Terminal rows, gutter included, ready to print. */
  readonly lines: ReadonlyArray<string>
  readonly stats: ViewStats
  readonly centre: ColumnSample
}

const WATER_DEEP: Rgb = [18, 44, 90]
const GRID_TINT: Rgb = [235, 235, 245]
const CROSSHAIR: Rgb = [255, 64, 64]
const SEA_GUIDE: Rgb = [86, 116, 176]
const PINNED_HIGH: Rgb = [255, 92, 200]
const PINNED_LOW: Rgb = [255, 196, 84]
const TREE_MARK: Rgb = [22, 66, 22]

const collectStats = (samples: ReadonlyArray<ColumnSample>): ViewStats => {
  const counts = new Map<BiomeType, number>()
  let surfaceMin = Number.POSITIVE_INFINITY
  let surfaceMax = Number.NEGATIVE_INFINITY
  let submerged = 0
  let pinnedHigh = 0
  let pinnedLow = 0
  let trees = 0

  for (const sample of samples) {
    counts.set(sample.biome, (counts.get(sample.biome) ?? 0) + 1)
    surfaceMin = Math.min(surfaceMin, sample.surfaceY)
    surfaceMax = Math.max(surfaceMax, sample.surfaceY)
    if (sample.submerged) {
      submerged += 1
    }
    if (sample.surfaceY >= MAX_SURFACE_Y) {
      pinnedHigh += 1
    }
    if (sample.surfaceY <= MIN_SURFACE_Y) {
      pinnedLow += 1
    }
    if (sample.hasTree) {
      trees += 1
    }
  }

  return {
    biomeCounts: [...counts.entries()].sort((left, right) => right[1] - left[1]),
    columns: samples.length,
    surfaceMin: samples.length === 0 ? 0 : surfaceMin,
    surfaceMax: samples.length === 0 ? 0 : surfaceMax,
    submerged,
    pinnedHigh,
    pinnedLow,
    trees,
  }
}

/** World coordinate under a top-down pixel. */
const mapWorldX = (camera: Camera, raster: Raster, px: number): number =>
  camera.x + (px - Math.floor(raster.width / 2)) * camera.zoom

const mapWorldZ = (camera: Camera, raster: Raster, py: number): number =>
  camera.z + (py - Math.floor(raster.height / 2)) * camera.zoom

const sampleGrid = (
  params: WorldParams,
  camera: Camera,
  raster: Raster,
): ReadonlyArray<ColumnSample> => {
  const samples: Array<ColumnSample> = []
  for (let py = 0; py < raster.height; py += 1) {
    for (let px = 0; px < raster.width; px += 1) {
      samples.push(sampleColumn(params, mapWorldX(camera, raster, px), mapWorldZ(camera, raster, py)))
    }
  }
  return samples
}

const at = (samples: ReadonlyArray<ColumnSample>, raster: Raster, px: number, py: number): ColumnSample | undefined =>
  samples[py * raster.width + px]

/**
 * Relief shading from the two upstream neighbours.
 *
 * The neighbours are pixels rather than blocks, so at zoom > 1 the slope is
 * measured over the same distance the pixel covers. That keeps the relief
 * legible when zoomed out instead of collapsing into noise.
 */
const hillshade = (samples: ReadonlyArray<ColumnSample>, raster: Raster, px: number, py: number): number => {
  const here = at(samples, raster, px, py)
  const west = at(samples, raster, Math.max(0, px - 1), py)
  const north = at(samples, raster, px, Math.max(0, py - 1))
  if (here === undefined || west === undefined || north === undefined) {
    return 1
  }
  const slope = here.surfaceY - west.surfaceY + (here.surfaceY - north.surfaceY)
  return Math.max(0.55, Math.min(1.45, 1 + slope * 0.07))
}

const drawCrosshair = (raster: Raster): void => {
  const cx = Math.floor(raster.width / 2)
  const cy = Math.floor(raster.height / 2)
  for (let offset = -3; offset <= 3; offset += 1) {
    if (Math.abs(offset) > 1) {
      setPixel(raster, cx + offset, cy, CROSSHAIR, '-')
      setPixel(raster, cx, cy + offset, CROSSHAIR, '|')
    }
  }
}

const renderMap = (
  params: WorldParams,
  camera: Camera,
  toggles: ViewToggles,
  raster: Raster,
): ReadonlyArray<ColumnSample> => {
  const samples = sampleGrid(params, camera, raster)

  for (let py = 0; py < raster.height; py += 1) {
    for (let px = 0; px < raster.width; px += 1) {
      const sample = at(samples, raster, px, py)
      if (sample === undefined) {
        continue
      }

      let color: Rgb = BIOME_COLOR[sample.biome]
      let glyph = BIOME_GLYPH[sample.biome]

      if (sample.submerged) {
        color = blend(color, WATER_DEEP, Math.min(0.85, 0.3 + sample.waterDepth / 22))
        if (sample.waterDepth >= 3) {
          glyph = '~'
        }
      } else {
        color = shade(color, hillshade(samples, raster, px, py))
      }

      if (sample.hasTree) {
        color = TREE_MARK
        glyph = 'T'
      }

      if (
        toggles.chunkGrid &&
        (positiveMod(sample.worldX, CHUNK_SIZE_XZ) === 0 || positiveMod(sample.worldZ, CHUNK_SIZE_XZ) === 0)
      ) {
        color = blend(color, GRID_TINT, 0.28)
      }

      setPixel(raster, px, py, color, glyph)
    }
  }

  drawCrosshair(raster)
  return samples
}

type Cell = { readonly color: Rgb; readonly glyph: string }

const rampGlyph = (index: number): string =>
  HEIGHT_GLYPHS.charAt(
    Math.max(0, Math.min(HEIGHT_GLYPHS.length - 1, Math.round((index / 11) * (HEIGHT_GLYPHS.length - 1)))),
  )

/**
 * `!` and `_` mark columns the shaper clamped to `MAX_SURFACE_Y` /
 * `MIN_SURFACE_Y`. They are loud because a clamped region is a perfectly flat
 * plateau or basin that a smooth colour ramp renders as a gentle slope — the
 * one thing a height view must not hide.
 */
const heightCell = (sample: ColumnSample, seaLevel: number): Cell => {
  if (sample.surfaceY >= MAX_SURFACE_Y) {
    return { color: PINNED_HIGH, glyph: '!' }
  }
  if (sample.surfaceY <= MIN_SURFACE_Y) {
    return { color: PINNED_LOW, glyph: '_' }
  }

  if (sample.surfaceY < seaLevel) {
    const span = Math.max(1, seaLevel - MIN_SURFACE_Y)
    const depth = (seaLevel - sample.surfaceY) / span
    const index = Math.max(0, Math.min(3, 3 - Math.floor(depth * 4)))
    return { color: HEIGHT_RAMP[index] ?? WATER_DEEP, glyph: '~' }
  }

  const span = Math.max(1, MAX_SURFACE_Y - seaLevel)
  const rise = (sample.surfaceY - seaLevel) / span
  const index = Math.max(4, Math.min(11, 4 + Math.floor(rise * 8)))
  return { color: HEIGHT_RAMP[index] ?? WATER_DEEP, glyph: rampGlyph(index) }
}

const renderHeight = (
  params: WorldParams,
  camera: Camera,
  toggles: ViewToggles,
  raster: Raster,
): ReadonlyArray<ColumnSample> => {
  const samples = sampleGrid(params, camera, raster)

  for (let py = 0; py < raster.height; py += 1) {
    for (let px = 0; px < raster.width; px += 1) {
      const sample = at(samples, raster, px, py)
      if (sample === undefined) {
        continue
      }

      const cell = heightCell(sample, params.levels.seaLevel)
      let color = cell.color

      if (
        toggles.chunkGrid &&
        (positiveMod(sample.worldX, CHUNK_SIZE_XZ) === 0 || positiveMod(sample.worldZ, CHUNK_SIZE_XZ) === 0)
      ) {
        color = blend(color, GRID_TINT, 0.28)
      }

      setPixel(raster, px, py, color, cell.glyph)
    }
  }

  drawCrosshair(raster)
  return samples
}

/** Width of the Y-axis gutter the slice view prints, in terminal columns. */
export const SLICE_GUTTER = 5

const sliceWorldX = (camera: Camera, raster: Raster, px: number): number =>
  camera.x + (px - Math.floor(raster.width / 2))

const renderSlice = (
  cache: ChunkCache,
  params: WorldParams,
  camera: Camera,
  toggles: ViewToggles,
  raster: Raster,
): ReadonlyArray<ColumnSample> => {
  const samples: Array<ColumnSample> = []

  for (let px = 0; px < raster.width; px += 1) {
    samples.push(sampleColumn(params, sliceWorldX(camera, raster, px), camera.z))
  }

  for (let py = 0; py < raster.height; py += 1) {
    const wy = camera.yBottom + (raster.height - 1 - py)

    for (let px = 0; px < raster.width; px += 1) {
      const wx = sliceWorldX(camera, raster, px)
      const block = wy >= 0 && wy < CHUNK_HEIGHT ? blockAt(cache, params, wx, wy, camera.z) : BLOCK.AIR

      let color = blockColor(block)
      let glyph = blockGlyph(block)

      if (block === BLOCK.AIR) {
        // Air at exactly sea level means a cave mouth opening at the waterline,
        // which is rare and worth seeing. It is NOT the sea-level indicator —
        // that lives in the gutter, because on ordinary terrain this row is
        // water or solid and never air. See `sliceGutter`.
        if (toggles.seaLine && wy === params.levels.seaLevel) {
          color = blend(color, SEA_GUIDE, 0.55)
          glyph = '-'
        } else if (wy % 16 === 0) {
          color = blend(color, GRID_TINT, 0.09)
        }
      }

      if (toggles.chunkGrid && positiveMod(wx, CHUNK_SIZE_XZ) === 0) {
        color = blend(color, GRID_TINT, 0.2)
      }

      setPixel(raster, px, py, color, glyph)
    }
  }

  const centreX = Math.floor(raster.width / 2)
  for (let py = 0; py < raster.height; py += 1) {
    const wy = camera.yBottom + (raster.height - 1 - py)
    if (wy >= 0 && wy < CHUNK_HEIGHT && blockAt(cache, params, camera.x, wy, camera.z) === BLOCK.AIR) {
      setPixel(raster, centreX, py, blend(blockColor(BLOCK.AIR), CROSSHAIR, 0.45), '|')
    }
  }

  return samples
}

/**
 * Y-axis labels down the left edge of the slice view.
 *
 * Each terminal row covers two world Y values, so the label is the upper of the
 * pair. Without this the view is a pretty picture; with it, "the water surface
 * is at 63" is something you read rather than something you take on trust.
 */
/**
 * Y-axis gutter for the slice view, and the sea-level marker.
 *
 * The marker lives here rather than in the frame because there is nowhere in
 * the frame to put it. The first version tinted air at `y === seaLevel` and
 * never once drew: that row is water where the column is submerged, and solid
 * where it is not, so it is air only inside a cave. The feature was dead on
 * arrival and looked like it worked, which is worse than absent.
 *
 * A `>` in the gutter is unambiguous and always visible, which is what check 3
 * of docs/testing.md §3 — "sea level is really 63" — actually needs.
 */
const sliceGutter = (
  camera: Camera,
  raster: Raster,
  row: number,
  rowsPerCell: number,
  seaLevel: number,
  showSeaLine: boolean,
): string => {
  const wy = camera.yBottom + (raster.height - 1 - row * rowsPerCell)
  // An ANSI row covers two world Y values; the marker must fire for either.
  const coversSeaLevel = wy === seaLevel || (rowsPerCell === 2 && wy - 1 === seaLevel)

  if (showSeaLine && coversSeaLevel) {
    return `${String(seaLevel).padStart(SLICE_GUTTER - 2, ' ')}> `
  }

  const label = wy % 10 === 0 ? String(wy) : ''
  return `${label.padStart(SLICE_GUTTER - 1, ' ')} `
}

export const renderView = (
  mode: ViewMode,
  cache: ChunkCache,
  params: WorldParams,
  camera: Camera,
  toggles: ViewToggles,
  width: number,
  height: number,
  ascii = false,
): RenderedView => {
  const rasterWidth = mode === 'slice' ? Math.max(1, width - SLICE_GUTTER) : width
  // ANSI packs two pixel rows into one terminal row with a half block; ASCII is
  // one glyph per row, so it renders at half the vertical resolution.
  const raster = createRaster(rasterWidth, ascii ? height : height * 2, !ascii)

  let samples: ReadonlyArray<ColumnSample>
  switch (mode) {
    case 'map':
      samples = renderMap(params, camera, toggles, raster)
      break
    case 'height':
      samples = renderHeight(params, camera, toggles, raster)
      break
    case 'slice':
      samples = renderSlice(cache, params, camera, toggles, raster)
      break
    default:
      samples = renderMap(params, camera, toggles, raster)
      break
  }

  const body = ascii ? toAsciiLines(raster) : toAnsiLines(raster)
  const lines =
    mode === 'slice'
      ? body.map(
          (line, row) =>
            sliceGutter(camera, raster, row, ascii ? 1 : 2, params.levels.seaLevel, toggles.seaLine) +
            line,
        )
      : [...body]

  return {
    lines,
    stats: collectStats(samples),
    centre: sampleColumn(params, camera.x, camera.z),
  }
}
