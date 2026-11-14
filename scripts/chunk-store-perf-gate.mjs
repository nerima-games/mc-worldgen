export const REGRESSION_RATIO = 1.5
export const PAIRS = 5
export const MAX_RETRIES = 2

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]

export const validateSample = (sample, workload) => {
  if (sample.chunks !== 36 || sample.seed !== 7 || sample.radiusBlocks !== 40 || sample.warmupLoads !== 0 ||
      sample.statefulChunks !== 36 || sample.workload !== workload ||
      sample.lightReads !== (workload === 'consumer' ? 2 : 0) || sample.writes !== (workload === 'consumer' ? 1 : 0) ||
      (workload === 'consumer' ? !Number.isFinite(sample.lightElapsedMs) || sample.lightElapsedMs <= 0 : sample.lightElapsedMs !== 0) ||
      !Number.isFinite(sample.elapsedMs) || sample.elapsedMs <= 0 || !/^[a-f0-9]{64}$/.test(sample.checksum)) {
    throw new Error(`Invalid ${workload} benchmark sample`)
  }
}

export const evaluatePairs = (pairs, workload = 'load') => {
  if (pairs.length !== PAIRS) throw new Error(`Expected ${PAIRS} pairs`)
  const metric = workload === 'consumer' ? 'lightElapsedMs' : 'elapsedMs'
  const base = pairs.map((pair) => pair.base[metric])
  const head = pairs.map((pair) => pair.head[metric])
  const checksums = {}
  for (const version of ['base', 'head']) {
    const values = new Set(pairs.map((pair) => pair[version].checksum))
    if (values.size !== 1) throw new Error(`${version} output checksums differ between samples`)
    checksums[version] = pairs[0][version].checksum
  }
  const ratio = median(head) / median(base)
  const envelope = [Math.min(...head) / Math.max(...base), Math.max(...head) / Math.min(...base)]
  const pairRatios = pairs.map((pair) => pair.head[metric] / pair.base[metric])
  const highLoad = pairs.some((pair) => [pair.base, pair.head].some((sample) =>
    [sample.loadBefore[0], sample.loadAfter[0]].some((value) => value >= 30)))
  // This is a conservative observed range, not a statistical confidence interval.
  const inconclusive = highLoad || (envelope[0] <= REGRESSION_RATIO && envelope[1] > REGRESSION_RATIO)
  return {
    status: inconclusive ? 'INCONCLUSIVE' : ratio > REGRESSION_RATIO ? 'REGRESSED' : 'PASS',
    ratio,
    envelope,
    pairRatios,
    headWins: pairRatios.filter((value) => value < 1).length,
    baseMedianMs: median(base),
    headMedianMs: median(head),
    highLoad,
    checksums,
    outputChanged: checksums.base !== checksums.head,
    metric,
  }
}

export const measureWithRetries = (measure, report, workload = 'load') => {
  let checksums = null
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    const pairs = measure(attempt)
    const result = evaluatePairs(pairs, workload)
    if (checksums && (checksums.base !== result.checksums.base || checksums.head !== result.checksums.head)) {
      throw new Error('Output checksums changed between attempts')
    }
    checksums = result.checksums
    report({ attempt: attempt + 1, pairs, ...result })
    if (result.status !== 'INCONCLUSIVE') return result.status
  }
  return 'INCONCLUSIVE'
}
