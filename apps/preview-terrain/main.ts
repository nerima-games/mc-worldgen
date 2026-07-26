/**
 * `apps/preview-terrain` — the built-in terrain preview.
 *
 * plan.md §6 Step 2 calls this repository's preview 「本計画の最初の遊べる成果物」,
 * and plan.md §2.3-4 requires a preview to live with the thing it verifies. It
 * is therefore a dev application INSIDE mc-worldgen: not a package, not part of
 * `index.ts`, and not something a consumer can import.
 *
 * ---------------------------------------------------------------------------
 * Why this renders in a terminal and not in THREE.js
 * ---------------------------------------------------------------------------
 *
 * The alternative was to add `three` to the preview alone. It was rejected:
 *
 *  1. mc-worldgen's THREE-freedom is enforced mechanically, not by convention:
 *     `tsconfig.base.json` omits "DOM" from `lib`, so `new THREE.Vector3()`
 *     does not typecheck anywhere in the repository. A 3D preview would need
 *     "DOM" back in some tsconfig, which converts a mechanical guarantee into
 *     a promise that some other tsconfig keeps.
 *  2. It would need a bundler and a browser to run. `pnpm preview` would stop
 *     being a thing you can pipe, screenshot into a bug report, or run over
 *     ssh on the machine that actually reproduced the terrain.
 *  3. It would be worse at the job. docs/testing.md §3 lists six things the
 *     preview must make visible; two of them — "sea level is really 63" and
 *     "no hollow lake bed" — are answered instantly by a cross-section and
 *     only by digging in a first-person view.
 *
 * What is lost is real and worth stating: this preview cannot show you the
 * silhouette of a mountain range, and standing inside a cave is more
 * convincing than looking at a slice of one. When mc-render exists, a 3D
 * preview belongs there, consuming mc-worldgen's chunks across the boundary
 * that the reference implementation's zero THREE imports in `packages/world`
 * already drew.
 *
 * ---------------------------------------------------------------------------
 * Constraints this app is written under
 * ---------------------------------------------------------------------------
 *
 *  - `apps` is in `SCAN_ROOTS` (scripts/check-dependency-whitelist.ts), so the
 *    preview's imports are gated like any other source here. It imports this
 *    repository's own modules and nothing else — no org package, no npm
 *    dependency, not even a colour library.
 *  - The `Date.now()` / `new Date()` / `performance.now()` ban applies. It is
 *    satisfied without an escape hatch: there is no clock read anywhere in
 *    this app, because there is no animation and nothing to time. Frames are
 *    drawn in response to keystrokes.
 *  - `pnpm verify` does not run this app. `tsconfig.preview.json` typechecks it
 *    and `pnpm lint` lints it, but `pnpm preview` is not a gate.
 */
import { DEFAULT_TERRAIN_LEVELS, type TerrainLevels } from '../../domain/constants'
import { ANSI_STYLE, buildHud, HUD_ROWS, PLAIN_STYLE } from './hud'
import { parseArguments, USAGE, type PreviewOptions } from './options'
import { dim } from './raster'
import { buildStatsReport } from './stats'
import { createChunkCache, type WorldParams } from './sampler'
import {
  enterFullScreen,
  isInteractive,
  leaveFullScreen,
  onExit,
  onInputEnd,
  onKey,
  onResize,
  paintFrame,
  screenSize,
  writeLine,
} from './terminal'
import { renderView, VIEW_MODES, type Camera, type ViewMode, type ViewToggles } from './views'

type State = {
  seed: number
  view: ViewMode
  camera: Camera
  decorate: boolean
  guard: boolean
  toggles: ViewToggles
  levels: TerrainLevels
  showHelp: boolean
}

const MIN_ZOOM = 1
const MAX_ZOOM = 32

const levelsFor = (options: PreviewOptions): TerrainLevels =>
  options.seaLevel === undefined
    ? DEFAULT_TERRAIN_LEVELS
    : { seaLevel: options.seaLevel, lakeLevel: options.seaLevel }

const worldParams = (state: State): WorldParams => ({
  seed: state.seed,
  levels: state.levels,
  carve: state.guard ? {} : { waterFloorMargin: 0 },
  decorate: state.decorate,
})

/**
 * World blocks covered vertically by `rows` terminal rows.
 *
 * ANSI packs two pixel rows into a cell with a half block; ASCII does not. Every
 * vertical calculation — the default framing, the HUD's stated Y range — has to
 * agree with the renderer about this, and the first version did not: it framed
 * an ASCII slice as if it were twice as tall, which put sea level off screen and
 * made the sea-level check silently unavailable in exactly the mode meant for
 * pasting into a bug report.
 */
const verticalBlocks = (rows: number, ascii: boolean): number => (ascii ? rows : rows * 2)

/**
 * Default vertical framing for the slice view: sea level a little above centre,
 * so the water column, the surface and the top of the cave band are all in
 * frame at once. Those are the three things a cross-section is for.
 */
const defaultYBottom = (seaLevel: number, blocksTall: number): number =>
  Math.max(0, seaLevel - Math.floor(blocksTall * 0.6))

const frameSize = (options: PreviewOptions): { readonly columns: number; readonly rows: number } => {
  const screen = screenSize()
  return {
    columns: Math.max(20, options.width ?? screen.columns),
    rows: Math.max(6, (options.height ?? screen.rows) - HUD_ROWS - 1),
  }
}

const cache = createChunkCache()

const render = (state: State, options: PreviewOptions): ReadonlyArray<string> => {
  const { columns, rows } = frameSize(options)

  if (state.showHelp) {
    return [...USAGE, '', dim('press any key to return')]
  }

  const view = renderView(
    state.view,
    cache,
    worldParams(state),
    state.camera,
    state.toggles,
    columns,
    rows,
    options.ascii,
  )

  return [
    ...view.lines,
    '',
    ...buildHud(
      {
        seed: state.seed,
        view: state.view,
        camera: state.camera,
        decorate: state.decorate,
        guard: state.guard,
        toggles: state.toggles,
        seaLevel: state.levels.seaLevel,
        frameWidth: columns,
        frameBlocksTall: verticalBlocks(rows, options.ascii),
        chunksGenerated: cache.generated,
      },
      view.stats,
      view.centre,
      options.ascii ? PLAIN_STYLE : ANSI_STYLE,
    ),
  ]
}

const clampZoom = (zoom: number): number => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom))

const panStep = (state: State): number => Math.max(1, state.camera.zoom * 8)

const move = (state: State, dx: number, dz: number, dy: number): void => {
  state.camera = {
    x: state.camera.x + dx,
    z: state.camera.z + dz,
    yBottom: Math.max(0, state.camera.yBottom + dy),
    zoom: state.camera.zoom,
  }
}

const setZoom = (state: State, zoom: number): void => {
  state.camera = { ...state.camera, zoom: clampZoom(zoom) }
}

/** Returns false when the key means "quit". */
const handleKey = (state: State, key: string, options: PreviewOptions): boolean => {
  if (state.showHelp) {
    state.showHelp = false
    return true
  }

  const step = panStep(state)
  const bigStep = step * 8

  switch (key) {
    case 'x':
    case 'escape':
    case 'ctrl-c':
      return false

    case 'w':
    case 'up':
      move(state, 0, -step, 0)
      break
    case 'W':
      move(state, 0, -bigStep, 0)
      break
    case 's':
    case 'down':
      move(state, 0, step, 0)
      break
    case 'S':
      move(state, 0, bigStep, 0)
      break
    case 'a':
    case 'left':
      move(state, -step, 0, 0)
      break
    case 'A':
      move(state, -bigStep, 0, 0)
      break
    case 'd':
    case 'right':
      move(state, step, 0, 0)
      break
    case 'D':
      move(state, bigStep, 0, 0)
      break

    case 'q':
      move(state, 0, 0, -8)
      break
    case 'Q':
      move(state, 0, 0, -32)
      break
    case 'e':
      move(state, 0, 0, 8)
      break
    case 'E':
      move(state, 0, 0, 32)
      break

    case '-':
    case '_':
      setZoom(state, state.camera.zoom * 2)
      break
    case '=':
    case '+':
      setZoom(state, state.camera.zoom / 2)
      break

    case '1':
      state.view = 'map'
      break
    case '2':
      state.view = 'height'
      break
    case '3':
      state.view = 'slice'
      break
    case 'v': {
      const index = VIEW_MODES.indexOf(state.view)
      state.view = VIEW_MODES[(index + 1) % VIEW_MODES.length] ?? 'map'
      break
    }

    case '[':
      state.seed -= 1
      break
    case ']':
      state.seed += 1
      break
    case '{':
      state.seed -= 1000
      break
    case '}':
      state.seed += 1000
      break

    case 'g':
      state.guard = !state.guard
      break
    case 't':
      state.decorate = !state.decorate
      break
    case 'b':
      state.toggles = { ...state.toggles, chunkGrid: !state.toggles.chunkGrid }
      break
    case 'l':
      state.toggles = { ...state.toggles, seaLine: !state.toggles.seaLine }
      break

    case '0':
      state.camera = {
        x: options.x,
        z: options.z,
        yBottom: options.yBottom ?? defaultYBottom(state.levels.seaLevel, verticalBlocks(frameSize(options).rows, options.ascii)),
        zoom: options.zoom,
      }
      break

    case '?':
    case 'h':
      state.showHelp = true
      break

    default:
      break
  }

  return true
}

const runInteractive = (state: State, options: PreviewOptions): void => {
  enterFullScreen()

  let restored = false
  const restore = (): void => {
    if (!restored) {
      restored = true
      leaveFullScreen()
    }
  }
  onExit(restore)

  const draw = (): void => {
    paintFrame(render(state, options))
  }

  const quit = (): void => {
    restore()
    process.exit(0)
  }

  onResize(draw)
  onInputEnd(quit)
  onKey((key) => {
    if (handleKey(state, key, options)) {
      draw()
      return
    }
    quit()
  })

  draw()
}

const runOnce = (state: State, options: PreviewOptions): void => {
  for (const line of render(state, options)) {
    writeLine(line)
  }
}

const runStats = (state: State, options: PreviewOptions): void => {
  const report = buildStatsReport(cache, worldParams(state), {
    surveySpan: options.surveySpan,
    surveyStride: options.surveyStride,
    columnSpan: options.columnSpan,
    chunkSpan: options.chunkSpan,
    originX: options.x,
    originZ: options.z,
  })
  for (const line of report) {
    writeLine(line)
  }
}

const main = (): number => {
  const options = parseArguments(process.argv.slice(2))

  if (options.errors.length > 0) {
    for (const error of options.errors) {
      writeLine(`preview-terrain: ${error}`)
    }
    writeLine('')
    for (const line of USAGE) {
      writeLine(line)
    }
    return 1
  }

  if (options.help) {
    for (const line of USAGE) {
      writeLine(line)
    }
    return 0
  }

  const levels = levelsFor(options)
  const state: State = {
    seed: options.seed,
    view: options.view,
    camera: {
      x: options.x,
      z: options.z,
      yBottom: options.yBottom ?? defaultYBottom(levels.seaLevel, verticalBlocks(frameSize(options).rows, options.ascii)),
      zoom: options.zoom,
    },
    decorate: options.decorate,
    guard: options.guard,
    toggles: { chunkGrid: false, seaLine: true },
    levels,
    showHelp: false,
  }

  if (options.stats) {
    runStats(state, options)
    return 0
  }

  if (options.once || !isInteractive()) {
    if (!options.once) {
      writeLine(
        dim('preview-terrain: stdin/stdout is not a TTY, drawing a single frame (same as --once)'),
      )
    }
    runOnce(state, options)
    return 0
  }

  runInteractive(state, options)
  return 0
}

const exitCode = main()
if (exitCode !== 0) {
  process.exit(exitCode)
}
