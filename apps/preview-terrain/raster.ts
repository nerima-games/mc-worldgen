/**
 * A tiny RGB framebuffer that prints itself as ANSI truecolour.
 *
 * A dev application, not shipped API.
 *
 * ---------------------------------------------------------------------------
 * Why half blocks
 * ---------------------------------------------------------------------------
 *
 * A terminal cell is about twice as tall as it is wide, so one cell per pixel
 * renders a map at 2:1 and a vertical cross-section at 1:2. Both distort the
 * thing the preview exists to measure — "is the water column really 12 blocks
 * deep here" is not a question you can answer off a squashed image.
 *
 * U+2580 UPPER HALF BLOCK with a foreground and a background colour puts two
 * vertically stacked pixels in one cell: the pixels come out square and the
 * vertical resolution doubles. This is the standard trick and it costs nothing.
 *
 * ---------------------------------------------------------------------------
 * No clock
 * ---------------------------------------------------------------------------
 *
 * There is no animation loop and no frame timing anywhere in this app, so it
 * needs no clock and takes no escape hatch from the `Date.now()` ban. Frames
 * are drawn in response to keystrokes and to nothing else. That is not a
 * limitation being worked around — a generator that is a pure function of
 * `(seed, coord)` has nothing to animate.
 */

export type Rgb = readonly [number, number, number]

export type Raster = {
  readonly width: number
  readonly height: number
  readonly pixels: Uint8Array
  /**
   * One character code per pixel, filled in parallel with the colours.
   *
   * ASCII output is not a fallback for terminals that cannot do truecolour —
   * it is how a frame gets into a bug report, a commit message or a diff.
   * "The lake bed at (64, 144) has a hole in it" is worth far more with eight
   * lines of `~` over `.` pasted underneath it than with a screenshot nobody
   * can grep.
   */
  readonly glyphs: Uint8Array
}

const CHANNELS = 3
const SPACE = 32

export const createRaster = (width: number, height: number, evenRows = true): Raster => {
  const safeWidth = Math.max(1, Math.floor(width))
  // The ANSI encoder consumes rows in pairs, so its height is rounded up to an
  // even number and the last cell is never a half-drawn row. ASCII output is
  // one row per cell and needs no such rounding.
  const requested = Math.max(1, Math.floor(height))
  const safeHeight = evenRows ? Math.max(2, Math.ceil(requested / 2) * 2) : requested

  const glyphs = new Uint8Array(safeWidth * safeHeight)
  glyphs.fill(SPACE)

  return {
    width: safeWidth,
    height: safeHeight,
    pixels: new Uint8Array(safeWidth * safeHeight * CHANNELS),
    glyphs,
  }
}

export const setPixel = (raster: Raster, x: number, y: number, color: Rgb, glyph = ' '): void => {
  if (x < 0 || y < 0 || x >= raster.width || y >= raster.height) {
    return
  }
  const cell = y * raster.width + x
  const offset = cell * CHANNELS
  raster.pixels[offset] = color[0]
  raster.pixels[offset + 1] = color[1]
  raster.pixels[offset + 2] = color[2]
  raster.glyphs[cell] = glyph.charCodeAt(0)
}

const readPixel = (raster: Raster, x: number, y: number): Rgb => {
  const offset = (y * raster.width + x) * CHANNELS
  return [
    raster.pixels[offset] ?? 0,
    raster.pixels[offset + 1] ?? 0,
    raster.pixels[offset + 2] ?? 0,
  ]
}

const sameColor = (left: Rgb, right: Rgb): boolean =>
  left[0] === right[0] && left[1] === right[1] && left[2] === right[2]

/**
 * ESC (0x1B).
 *
 * Built with `String.fromCharCode` rather than written as a literal, so that no
 * raw control byte sits in a source file that `grep`, `git diff` and the
 * dependency-gate's source masker all have to read.
 */
export const ESC: string = String.fromCharCode(27)

export const RESET = `${ESC}[0m`

const foreground = (color: Rgb): string =>
  `${ESC}[38;2;${String(color[0])};${String(color[1])};${String(color[2])}m`

const background = (color: Rgb): string =>
  `${ESC}[48;2;${String(color[0])};${String(color[1])};${String(color[2])}m`

const UPPER_HALF_BLOCK = '▀'

/**
 * One string per terminal row, each already reset at the end.
 *
 * Escape sequences are emitted only when a colour actually changes. On a
 * terrain map most horizontal runs are the same biome, so this is the
 * difference between a ~40 KB frame and a ~400 KB one — visible as tearing on a
 * slow terminal.
 */
export const toAnsiLines = (raster: Raster): ReadonlyArray<string> => {
  const lines: Array<string> = []

  for (let row = 0; row < raster.height; row += 2) {
    const parts: Array<string> = []
    let lastTop: Rgb | undefined
    let lastBottom: Rgb | undefined

    for (let x = 0; x < raster.width; x += 1) {
      const top = readPixel(raster, x, row)
      const bottom = readPixel(raster, x, row + 1)

      if (lastTop === undefined || !sameColor(lastTop, top)) {
        parts.push(foreground(top))
        lastTop = top
      }
      if (lastBottom === undefined || !sameColor(lastBottom, bottom)) {
        parts.push(background(bottom))
        lastBottom = bottom
      }
      parts.push(UPPER_HALF_BLOCK)
    }

    parts.push(RESET)
    lines.push(parts.join(''))
  }

  return lines
}

/** One line per pixel row, in glyphs. Colour is discarded. */
export const toAsciiLines = (raster: Raster): ReadonlyArray<string> => {
  const lines: Array<string> = []

  for (let row = 0; row < raster.height; row += 1) {
    const characters: Array<string> = []
    for (let x = 0; x < raster.width; x += 1) {
      characters.push(String.fromCharCode(raster.glyphs[row * raster.width + x] ?? SPACE))
    }
    lines.push(characters.join(''))
  }

  return lines
}

/** Colourise a short run of text without disturbing the raster encoder. */
export const paint = (text: string, color: Rgb): string => `${foreground(color)}${text}${RESET}`

/** Bold, for HUD labels. */
export const bold = (text: string): string => `${ESC}[1m${text}${ESC}[22m`

/** Dim, for HUD hints. */
export const dim = (text: string): string => `${ESC}[2m${text}${ESC}[22m`
