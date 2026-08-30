/**
 * The only impure module in the preview.
 *
 * A dev application, not shipped API.
 *
 * Everything else here — sampling, rasterising, colouring, the option parser —
 * is a pure function of its arguments. Node's stdio lives behind this file so
 * that the boundary is visible rather than sprinkled, which is the same reason
 * the library keeps its clock behind a Port.
 *
 * Note what is NOT here: any read of a clock. The app redraws on a keystroke
 * and on a terminal resize, never on a timer, so `Date.now()` /
 * `performance.now()` never come up and the escape hatch documented in
 * `scripts/check-dependency-whitelist.ts` is not needed.
 */
import { ESC } from './raster'

export type Screen = {
  readonly columns: number
  readonly rows: number
}

const FALLBACK_SCREEN: Screen = { columns: 120, rows: 40 }

export const screenSize = (): Screen => ({
  columns: process.stdout.columns ?? FALLBACK_SCREEN.columns,
  rows: process.stdout.rows ?? FALLBACK_SCREEN.rows,
})

export const write = (text: string): void => {
  process.stdout.write(text)
}

export const NEWLINE: string = String.fromCharCode(10)

export const writeLine = (text = ''): void => {
  process.stdout.write(text + NEWLINE)
}

export const isInteractive = (): boolean =>
  process.stdin.isTTY === true && process.stdout.isTTY === true

const ENTER_ALT_SCREEN = `${ESC}[?1049h`
const LEAVE_ALT_SCREEN = `${ESC}[?1049l`
const HIDE_CURSOR = `${ESC}[?25l`
const SHOW_CURSOR = `${ESC}[?25h`
const HOME = `${ESC}[H`
const CLEAR_TO_END = `${ESC}[J`
const CLEAR_TO_LINE_END = `${ESC}[K`

export const enterFullScreen = (): void => {
  write(ENTER_ALT_SCREEN + HIDE_CURSOR + HOME + CLEAR_TO_END)
  if (typeof process.stdin.setRawMode === 'function') {
    process.stdin.setRawMode(true)
  }
  process.stdin.resume()
  process.stdin.setEncoding('utf8')
}

export const leaveFullScreen = (): void => {
  if (typeof process.stdin.setRawMode === 'function') {
    process.stdin.setRawMode(false)
  }
  process.stdin.pause()
  write(SHOW_CURSOR + LEAVE_ALT_SCREEN)
}

/**
 * Redraw in place rather than clearing first, so the frame does not flash.
 * Each line is cleared to its own end, which is what stops a short HUD line
 * from leaving the tail of the previous, longer one behind it.
 */
export const paintFrame = (lines: ReadonlyArray<string>): void => {
  write(HOME + lines.map((line) => line + CLEAR_TO_LINE_END).join(NEWLINE) + CLEAR_TO_END)
}

const ETX = String.fromCharCode(3)
const CARRIAGE_RETURN = String.fromCharCode(13)

/**
 * Normalised key names.
 *
 * Arrow keys arrive as three-byte escape sequences and a bare Escape arrives as
 * one byte, so a naive `chunk[0]` reading treats Escape and every arrow key as
 * the same keystroke.
 */
const KEY_NAMES: ReadonlyMap<string, string> = new Map([
  [`${ESC}[A`, 'up'],
  [`${ESC}[B`, 'down'],
  [`${ESC}[C`, 'right'],
  [`${ESC}[D`, 'left'],
  [ESC, 'escape'],
  [ETX, 'ctrl-c'],
  [CARRIAGE_RETURN, 'enter'],
  [NEWLINE, 'enter'],
])

export const decodeKey = (chunk: string): string => KEY_NAMES.get(chunk) ?? chunk

const ARROWS: ReadonlyMap<string, string> = new Map([
  ['A', 'up'],
  ['B', 'down'],
  ['C', 'right'],
  ['D', 'left'],
])

/**
 * Split one stdin chunk into individual keys.
 *
 * A `data` event is a chunk of BYTES, not a keystroke. Holding a key, typing
 * quickly and pasting all deliver several keystrokes in one chunk, and an
 * arrow key is three bytes that must stay together.
 *
 * The first version matched the whole chunk against a table, so `wwd` arrived
 * as the unrecognised key `"wwd"` and every one of those keystrokes was
 * silently dropped. It looked fine when tested one deliberate keypress at a
 * time — which is exactly how a person does NOT fly a camera around.
 */
export const decodeKeys = (chunk: string): ReadonlyArray<string> => {
  const keys: Array<string> = []
  let index = 0

  while (index < chunk.length) {
    const character = chunk.charAt(index)

    if (character === ESC && chunk.charAt(index + 1) === '[') {
      const arrow = ARROWS.get(chunk.charAt(index + 2))
      if (arrow !== undefined) {
        keys.push(arrow)
        index += 3
        continue
      }
    }

    keys.push(decodeKey(character))
    index += 1
  }

  return keys
}

export const onKey = (handler: (key: string) => void): void => {
  process.stdin.on('data', (chunk: string | Buffer) => {
    for (const key of decodeKeys(typeof chunk === 'string' ? chunk : chunk.toString('utf8'))) {
      handler(key)
    }
  })
}

/**
 * End of input. Without this the app waits forever on a closed stdin, which is
 * what happens whenever someone pipes keys into it.
 */
export const onInputEnd = (handler: () => void): void => {
  process.stdin.on('end', handler)
}

export const onResize = (handler: () => void): void => {
  process.stdout.on('resize', handler)
}

export const onExit = (handler: () => void): void => {
  process.on('exit', handler)
  process.on('SIGINT', () => {
    handler()
    process.exit(0)
  })
  process.on('SIGTERM', () => {
    handler()
    process.exit(0)
  })
}
