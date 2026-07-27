/**
 * Command-line options for the terrain preview.
 *
 * A dev application, not shipped API.
 *
 * Pure: `parseArguments` reads an array and returns a value. It never touches
 * `process`, so the whole option surface is exercisable without running the
 * app — which matters because "the preview accepts a seed" is one of the things
 * plan.md §3.7 asks for, and a parser that can only be tested by launching a
 * terminal UI is a parser nobody tests.
 */
import type { ViewMode } from './views'
import { VIEW_MODES } from './views'

/**
 * The default seed.
 *
 * A literal, not a clock read and not `Math.random()`. Two reasons, and only one
 * of them is the `Date.now()` ban: a preview whose default world changes every
 * launch cannot be used to report "look at (120, -340), the lake bed has a hole
 * in it". Reproducibility is the point of the whole generator.
 */
export const DEFAULT_SEED = 20260726

export type PreviewOptions = {
  readonly seed: number
  readonly view: ViewMode
  readonly x: number
  readonly z: number
  /** Lowest world Y in the slice view. `undefined` centres the frame on sea level. */
  readonly yBottom: number | undefined
  readonly zoom: number
  readonly decorate: boolean
  /** False sets `waterFloorMargin: 0`, reproducing the hollow-lake bug on purpose. */
  readonly guard: boolean
  readonly seaLevel: number | undefined
  readonly once: boolean
  /** Render glyphs instead of colour, so a frame can be pasted into a bug report. */
  readonly ascii: boolean
  readonly stats: boolean
  /**
   * Place the portal overlay at startup and switch to the slice view, so that a
   * portal frame can be rendered by `--once --ascii` and pasted somewhere. The
   * interactive `p` does the same thing; without this flag the only way to see a
   * portal is to be sitting at a terminal, which is the one place a reviewer
   * reading a diff is not.
   */
  readonly portal: boolean
  readonly help: boolean
  readonly width: number | undefined
  readonly height: number | undefined
  readonly surveySpan: number
  readonly surveyStride: number
  readonly columnSpan: number
  readonly chunkSpan: number
  readonly errors: ReadonlyArray<string>
}

const DEFAULTS = {
  seed: DEFAULT_SEED,
  view: 'map',
  x: 0,
  z: 0,
  yBottom: undefined,
  zoom: 1,
  decorate: true,
  guard: true,
  seaLevel: undefined,
  once: false,
  ascii: false,
  stats: false,
  portal: false,
  help: false,
  width: undefined,
  height: undefined,
  // 8192 blocks is ~45 continentalness features across. Anything much smaller
  // measures one hill and calls it a world; see the header of stats.ts.
  surveySpan: 8192,
  surveyStride: 16,
  columnSpan: 384,
  chunkSpan: 8,
  errors: [],
} satisfies PreviewOptions

const isViewMode = (value: string): value is ViewMode =>
  (VIEW_MODES as ReadonlyArray<string>).includes(value)

type Accumulator = {
  -readonly [Key in keyof PreviewOptions]: PreviewOptions[Key]
}

const readNumber = (
  accumulator: Accumulator,
  flag: string,
  raw: string | undefined,
): number | undefined => {
  if (raw === undefined) {
    accumulator.errors = [...accumulator.errors, `${flag} needs a value`]
    return undefined
  }
  const value = Number(raw)
  if (!Number.isFinite(value)) {
    accumulator.errors = [...accumulator.errors, `${flag}: "${raw}" is not a number`]
    return undefined
  }
  return value
}

/**
 * Accepts `--flag value`, `--flag=value` and `--no-flag`.
 *
 * Unknown flags are collected as errors rather than ignored: a silently
 * dropped `--seed` is a preview showing the wrong world with full confidence.
 */
export const parseArguments = (argv: ReadonlyArray<string>): PreviewOptions => {
  const accumulator: Accumulator = { ...DEFAULTS }
  const queue = [...argv]

  while (queue.length > 0) {
    const token = queue.shift()
    if (token === undefined) {
      break
    }

    const equalsAt = token.indexOf('=')
    const flag = equalsAt === -1 ? token : token.slice(0, equalsAt)
    const inlineValue = equalsAt === -1 ? undefined : token.slice(equalsAt + 1)
    const takeValue = (): string | undefined => inlineValue ?? queue.shift()

    switch (flag) {
      // pnpm 9 forwards a literal `--` into argv when someone writes
      // `pnpm preview -- --stats` out of npm habit. Rejecting it as an unknown
      // option would be technically correct and completely unhelpful.
      case '--':
        break
      case '--help':
      case '-h':
        accumulator.help = true
        break
      case '--stats':
        accumulator.stats = true
        break
      case '--once':
        accumulator.once = true
        break
      case '--ascii':
        accumulator.ascii = true
        break
      case '--portal':
        accumulator.portal = true
        break
      case '--decorate':
        accumulator.decorate = true
        break
      case '--no-decorate':
        accumulator.decorate = false
        break
      case '--guard':
        accumulator.guard = true
        break
      case '--no-guard':
        accumulator.guard = false
        break
      case '--seed':
        accumulator.seed = readNumber(accumulator, flag, takeValue()) ?? accumulator.seed
        break
      case '--x':
        accumulator.x = readNumber(accumulator, flag, takeValue()) ?? accumulator.x
        break
      case '--z':
        accumulator.z = readNumber(accumulator, flag, takeValue()) ?? accumulator.z
        break
      case '--y':
        accumulator.yBottom = readNumber(accumulator, flag, takeValue()) ?? accumulator.yBottom
        break
      case '--zoom':
        accumulator.zoom = Math.max(1, readNumber(accumulator, flag, takeValue()) ?? accumulator.zoom)
        break
      case '--sea-level':
        accumulator.seaLevel = readNumber(accumulator, flag, takeValue()) ?? accumulator.seaLevel
        break
      case '--width':
        accumulator.width = readNumber(accumulator, flag, takeValue()) ?? accumulator.width
        break
      case '--height':
        accumulator.height = readNumber(accumulator, flag, takeValue()) ?? accumulator.height
        break
      case '--survey-span':
        accumulator.surveySpan = Math.max(
          1,
          readNumber(accumulator, flag, takeValue()) ?? accumulator.surveySpan,
        )
        break
      case '--survey-stride':
        accumulator.surveyStride = Math.max(
          1,
          readNumber(accumulator, flag, takeValue()) ?? accumulator.surveyStride,
        )
        break
      case '--column-span':
        accumulator.columnSpan = Math.max(
          1,
          readNumber(accumulator, flag, takeValue()) ?? accumulator.columnSpan,
        )
        break
      case '--chunk-span':
        accumulator.chunkSpan = Math.max(
          1,
          readNumber(accumulator, flag, takeValue()) ?? accumulator.chunkSpan,
        )
        break
      case '--view': {
        const value = takeValue()
        if (value !== undefined && isViewMode(value)) {
          accumulator.view = value
        } else {
          accumulator.errors = [
            ...accumulator.errors,
            `--view: "${String(value)}" is not one of ${VIEW_MODES.join(', ')}`,
          ]
        }
        break
      }
      default:
        accumulator.errors = [...accumulator.errors, `unknown option: ${flag}`]
        break
    }
  }

  return { ...accumulator, seed: Math.trunc(accumulator.seed) }
}

export const USAGE: ReadonlyArray<string> = [
  'pnpm preview [options]           terrain preview for @nerima-games/mc-worldgen',
  '',
  'options',
  `  --seed <n>          world seed (default ${String(DEFAULT_SEED)})`,
  '  --view <mode>       map | height | slice        (default map)',
  '  --x <n> --z <n>     camera centre, world blocks (default 0, 0)',
  '  --y <n>             lowest world Y in the slice view (default: centred on sea level)',
  '  --zoom <n>          blocks per pixel in the top-down views (default 1)',
  '  --sea-level <n>     override the injected TerrainLevels; try 40 or 90',
  '  --no-decorate       generate without trees',
  '  --no-guard          waterFloorMargin=0 — reproduces the hollow-lake bug on purpose',
  '  --once              render one frame to stdout and exit (no raw mode, pipe-safe)',
  '  --ascii             glyphs instead of colour — pasteable into an issue or a diff',
  '  --portal            stand a portal frame under the camera (implies --view slice)',
  '  --stats             print the numeric report instead of a picture',
  '  --survey-span <n>   --stats: side of the wide strided survey, blocks (default 8192)',
  '  --survey-stride <n> --stats: blocks between survey samples (default 16)',
  '  --column-span <n>   --stats: side of the dense adjacency scan, blocks (default 384)',
  '  --chunk-span <n>    --stats: side of the generated chunk square (default 8)',
  '  --width <n> --height <n>   force the frame size in terminal cells',
  '  --help              this text',
  '',
  'keys (interactive)',
  '  w a s d       pan north / west / south / east   (uppercase = 8x)',
  '  q e           lower / raise the slice view',
  '  - =           zoom out / in (top-down views)',
  '  1 2 3   v     map / height / slice   |   cycle view',
  '  [ ]   { }     seed -1 / +1   |   seed -1000 / +1000',
  '  g             toggle the carver water-floor guard (DN-2)',
  '  t             toggle trees',
  '  b             toggle chunk-border grid',
  '  l             toggle the sea-level guide line',
  '  p             place / remove a portal frame under the camera (slice view)',
  '  k             break / repair its obsidian ring — the verdict must flip',
  '  0             recentre on (0, 0)',
  '  ? h           this help   |   x  Esc  Ctrl-C   quit',
]
