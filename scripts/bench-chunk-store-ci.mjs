import { appendFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const [baseArg, legacyArg] = process.argv.slice(2)
if (!baseArg || !legacyArg) {
  process.stderr.write('Usage: node scripts/bench-chunk-store-ci.mjs <v0.9.0-root> <v0.8.0-root>\n')
  process.exit(2)
}

const roots = {
  base: resolve(baseArg),
  legacy: resolve(legacyArg),
  head: process.cwd(),
}

const runSample = (name) => {
  const root = roots[name]
  const runner = resolve(root, 'node_modules/.bin/tsx')
  const script = resolve(root, 'scripts/bench-chunk-store-load.ts')
  const child = spawnSync(runner, [script], { cwd: root, encoding: 'utf8' })

  if (child.error) throw child.error
  if (child.status !== 0) {
    throw new Error(`${name} benchmark exited ${child.status}: ${child.stderr.trim()}`)
  }

  const output = child.stdout.trim().split('\n').at(-1)
  const result = JSON.parse(output)
  if (result.chunks !== 36 || result.seed !== 7 || result.radiusBlocks !== 40 || result.warmupLoads !== 0) {
    throw new Error(`${name} benchmark returned unexpected workload metadata`)
  }
  if (name !== 'legacy' && result.statefulChunks !== 36) {
    throw new Error(`${name} loaded ${result.statefulChunks} chunks with materialized block states`)
  }
  return result
}

const samples = { base: [], head: [], legacy: [] }
for (let pair = 0; pair < 5; pair += 1) {
  const order = pair % 2 === 0 ? ['base', 'head'] : ['head', 'base']
  for (const version of order) {
    const result = runSample(version)
    samples[version].push(result)
    process.stdout.write(`${version} sample ${pair + 1}: ${result.elapsedMs.toFixed(2)} ms (${result.checksum})\n`)
  }
}
samples.legacy.push(runSample('legacy'))
process.stdout.write(`legacy v0.8.0: ${samples.legacy[0].elapsedMs.toFixed(2)} ms (${samples.legacy[0].checksum})\n`)

const median = (values) => {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)]
}
const summarize = (values) => ({
  median: median(values),
  min: Math.min(...values),
  max: Math.max(...values),
})
const baseTimes = samples.base.map(({ elapsedMs }) => elapsedMs)
const headTimes = samples.head.map(({ elapsedMs }) => elapsedMs)
const legacyTimes = samples.legacy.map(({ elapsedMs }) => elapsedMs)
const baseSummary = summarize(baseTimes)
const headSummary = summarize(headTimes)
const legacySummary = summarize(legacyTimes)
const baseHeadChecksums = new Set([...samples.base, ...samples.head].map(({ checksum }) => checksum))
if (baseHeadChecksums.size !== 1) {
  throw new Error('v0.9.0 and head ChunkStore.load checksums differ')
}

const ratio = headSummary.median / baseSummary.median
const markdown = [
  '## ChunkStore sequential load performance',
  '',
  'Workload: seed 7, spawn `(0.5, 0.5)`, radius ±40 blocks, 36 chunks, generated source, sequential cold loads.',
  'Warmup: 0 loads. Each sample ran in a fresh process; the timer starts after module imports and store setup, then measures the first cold load through the 36th sequential load.',
  'v0.9.0 and head were alternated for five pairs; v0.8.0 ran once.',
  '',
  '| Version | Samples | Median | Range |',
  '|---|---:|---:|---:|',
  `| v0.8.0 | 1 | ${legacySummary.median.toFixed(2)} ms | ${legacySummary.min.toFixed(2)}–${legacySummary.max.toFixed(2)} ms |`,
  `| v0.9.0 | ${baseTimes.length} | ${baseSummary.median.toFixed(2)} ms | ${baseSummary.min.toFixed(2)}–${baseSummary.max.toFixed(2)} ms |`,
  `| head | ${headTimes.length} | ${headSummary.median.toFixed(2)} ms | ${headSummary.min.toFixed(2)}–${headSummary.max.toFixed(2)} ms |`,
  '',
  `Head/v0.9.0 median ratio: **${ratio.toFixed(3)}×** (recorded only; no threshold).`,
  `v0.9.0/head output checksum: \`${samples.base[0].checksum}\` (all ten matched).`,
].join('\n')

process.stdout.write(`${markdown}\n`)
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`)
