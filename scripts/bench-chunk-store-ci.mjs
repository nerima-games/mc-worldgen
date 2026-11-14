import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { loadavg } from 'node:os'
import { MAX_RETRIES, PAIRS, REGRESSION_RATIO, measureWithRetries, validateSample } from './chunk-store-perf-gate.mjs'

const [baseArg, mode = 'compare'] = process.argv.slice(2)
if (!baseArg || !['compare', 'aa'].includes(mode)) {
  throw new Error('Usage: node scripts/bench-chunk-store-ci.mjs <base-root> [compare|aa]')
}
const roots = { base: resolve(baseArg), head: process.cwd() }
const artifactDir = resolve('.perf/results')
mkdirSync(artifactDir, { recursive: true })
const attempts = []
const summaries = []

const runSample = (version, workload) => {
  const root = roots[version]
  const loadBefore = loadavg()
  const child = spawnSync(resolve(root, 'node_modules/.bin/tsx'), [
    resolve(root, 'apps/chunk-store-perf/main.ts'), workload,
  ], { cwd: root, encoding: 'utf8', timeout: 5 * 60 * 1000, killSignal: 'SIGKILL' })
  const loadAfter = loadavg()
  if (child.error) throw child.error
  if (child.status !== 0) throw new Error(`${version}/${workload} exited ${child.status}: ${child.stderr.trim()}`)
  const result = JSON.parse(child.stdout.trim().split('\n').at(-1))
  validateSample(result, workload)
  return { ...result, loadBefore, loadAfter }
}

try {
  for (const workload of ['load', 'consumer']) {
    const status = measureWithRetries(() => {
      const pairs = []
      for (let pair = 0; pair < PAIRS; pair += 1) {
        const order = pair % 2 === 0 ? ['base', 'head'] : ['head', 'base']
        const samples = {}
        for (const version of order) {
          samples[version] = runSample(version, workload)
          const sample = samples[version]
          const measuredMs = workload === 'consumer' ? sample.lightElapsedMs : sample.elapsedMs
          process.stdout.write(`${mode}/${workload} pair ${pair + 1} ${version}: ${measuredMs.toFixed(2)} ms measured; ${sample.elapsedMs.toFixed(2)} ms total; load ${sample.loadBefore[0]} -> ${sample.loadAfter[0]}\n`)
        }
        pairs.push(samples)
      }
      return pairs
    }, (result) => {
      attempts.push({ workload, ...result })
      process.stdout.write(`${mode}/${workload} checksums: base ${result.checksums.base}; head ${result.checksums.head}; output changed: ${result.outputChanged}\n`)
      process.stdout.write(`${mode}/${workload} attempt ${result.attempt}: ${result.status}, median ratio ${result.ratio.toFixed(4)}, observed envelope ${result.envelope.map((x) => x.toFixed(4)).join('..')}, pair ratios ${result.pairRatios.map((x) => x.toFixed(4)).join(', ')}\n`)
    }, workload)
    summaries.push({ workload, status })
  }
} finally {
  const report = { mode, threshold: REGRESSION_RATIO, pairs: PAIRS, maxRetries: MAX_RETRIES, warmupLoads: 0, attempts, summaries }
  writeFileSync(resolve(artifactDir, `${mode}.json`), `${JSON.stringify(report, null, 2)}\n`)
  const markdown = [
    `## ChunkStore performance ${mode}`,
    '',
    `Threshold: ${REGRESSION_RATIO}; five alternating fresh-process pairs per attempt; at most ${MAX_RETRIES} retries for inconclusive timing. No warmup. Imports and setup excluded. Load and consumer measured separately.`,
    'Consumer: seed 7, 36 sequential cold loads, then first light calculation, one changed block, second light read. Its gate uses lightElapsedMs from after the loads through the last light read; total elapsedMs is recorded only. The load gate uses elapsedMs. Each version must produce the same checksum across samples and attempts. Different base/head outputs are recorded without affecting the performance verdict.',
    'Envelope is min(head)/max(base)..max(head)/min(base), an observed range, not a confidence interval. An envelope crossing the threshold or 1-minute load >=30 is inconclusive. The threshold never adapts to A/A.',
    '',
    '| Workload | Metric | Attempt | Verdict | Median ratio | Observed envelope | Pair ratios |',
    '|---|---|---:|---|---:|---|---|',
    ...attempts.map((r) => `| ${r.workload} | ${r.metric} | ${r.attempt} | ${r.status} | ${r.ratio.toFixed(4)} | ${r.envelope.map((x) => x.toFixed(4)).join('..')} | ${r.pairRatios.map((x) => x.toFixed(4)).join(', ')} |`),
    '',
    '| Workload | Attempt | Base checksum | Head checksum | Output changed |',
    '|---|---:|---|---|---|',
    ...attempts.map((r) => `| ${r.workload} | ${r.attempt} | ${r.checksums.base} | ${r.checksums.head} | ${r.outputChanged} |`),
  ].join('\n')
  process.stdout.write(`${markdown}\n`)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`)
}
if (summaries.some(({ status }) => status !== 'PASS')) process.exitCode = 1
