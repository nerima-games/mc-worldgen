/**
 * update-goldens.ts — rewrite `test/golden/chunk-goldens.json`.
 *
 *     pnpm goldens:update
 *
 * docs/testing.md §3: "ハッシュは生成コードで書き出すこと。手で書かない" and
 * "更新は必ず意図的な操作にする". This script is the whole of "deliberate": there
 * is no `-u` flag on the test, no watch mode that rewrites the file, and
 * `pnpm verify` never invokes this.
 *
 * A digest that moves is a statement that generated terrain changed, which — for
 * a project whose save files store a seed rather than the blocks — is
 * retroactive corruption of every world anyone has saved. So the output is
 * deliberately noisy about what moved: running this prints a per-entry
 * comparison against the file currently on disk, and says so when nothing
 * changed. Rewriting the file and printing nothing is how a golden becomes a
 * rubber stamp.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildGoldenFile,
  GOLDEN_FILE_PATH,
  renderGoldenFile,
  type GoldenEntry,
  type GoldenFile,
} from './golden-fixture'

const rootDir = process.cwd()

const label = (entry: GoldenEntry): string =>
  `${entry.biome.padEnd(8, ' ')} (${String(entry.cx)}, ${String(entry.cz)})${entry.decorate ? '' : ' no-decorate'}`

const readExisting = async (file: string): Promise<GoldenFile | undefined> => {
  const raw = await readFile(file, 'utf8').catch(() => undefined)
  if (raw === undefined) {
    return undefined
  }
  try {
    return JSON.parse(raw) as GoldenFile
  } catch {
    return undefined
  }
}

/** Match by identity — biome plus coordinate plus decoration — never by position. */
const findPrevious = (
  previous: GoldenFile | undefined,
  entry: GoldenEntry,
): GoldenEntry | undefined =>
  previous?.entries.find(
    (candidate) =>
      candidate.cx === entry.cx && candidate.cz === entry.cz && candidate.decorate === entry.decorate,
  )

export const main = async (): Promise<number> => {
  const absolute = path.join(rootDir, GOLDEN_FILE_PATH)
  const previous = await readExisting(absolute)
  const next = buildGoldenFile()

  let moved = 0
  const lines: Array<string> = []

  for (const entry of next.entries) {
    const before = findPrevious(previous, entry)
    if (before === undefined) {
      moved += 1
      lines.push(`  NEW        ${label(entry)}  blocks ${entry.blocksSha256.slice(0, 16)}`)
      continue
    }
    const blocksMoved = before.blocksSha256 !== entry.blocksSha256
    const biomesMoved = before.biomesSha256 !== entry.biomesSha256
    const summaryMoved = JSON.stringify(before.summary) !== JSON.stringify(entry.summary)
    if (!blocksMoved && !biomesMoved && !summaryMoved) {
      lines.push(`  unchanged  ${label(entry)}`)
      continue
    }
    moved += 1
    if (blocksMoved) {
      lines.push(
        `  BLOCKS     ${label(entry)}  ${before.blocksSha256.slice(0, 16)} -> ${entry.blocksSha256.slice(0, 16)}`,
      )
    }
    if (biomesMoved) {
      lines.push(
        `  BIOMES     ${label(entry)}  ${before.biomesSha256.slice(0, 16)} -> ${entry.biomesSha256.slice(0, 16)}`,
      )
    }
    if (summaryMoved) {
      lines.push(`  SUMMARY    ${label(entry)}  block-count summary changed`)
    }
  }

  const dropped = (previous?.entries ?? []).filter(
    (entry) => findPrevious(next, entry) === undefined,
  )
  for (const entry of dropped) {
    moved += 1
    lines.push(`  DROPPED    ${label(entry)}`)
  }

  await mkdir(path.dirname(absolute), { recursive: true })
  await writeFile(absolute, renderGoldenFile(next), 'utf8')

  console.log(`goldens: wrote ${GOLDEN_FILE_PATH} — ${String(next.entries.length)} entries, seed ${String(next.seed)}`)
  console.log(lines.join('\n'))

  if (previous === undefined) {
    console.log('')
    console.log('No previous file to compare against; every entry is new.')
    return 0
  }

  console.log('')
  if (moved === 0) {
    console.log('Nothing moved. The committed goldens already describe this generator.')
    return 0
  }

  console.log(
    `${String(moved)} entr${moved === 1 ? 'y' : 'ies'} moved. A moved digest means GENERATED TERRAIN CHANGED.`,
  )
  console.log('Save files store a seed and not the blocks, so this is retroactive for every existing world.')
  console.log('Explain the cause in the commit message; a silent regeneration is the same as deleting the golden.')
  return 0
}

const isDirectRun = (): boolean => {
  const entry = process.argv[1]
  return entry !== undefined && path.resolve(entry) === path.resolve(fileURLToPath(import.meta.url))
}

if (isDirectRun()) {
  process.exit(await main())
}
