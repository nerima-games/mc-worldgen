export const REGRESSION_RATIO = 1.5
export const PAIRS = 5
export const MAX_RETRIES = 2

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]

export const validateSample = (sample, workload) => {
  if (sample.chunks !== 36 || sample.seed !== 7 || sample.radiusBlocks !== 40 || sample.warmupLoads !== 0 ||
      sample.statefulChunks !== 36 || sample.workload !== workload ||
      sample.lightReads !== (workload === 'consumer' ? 2 : 0) || sample.writes !== (workload === 'consumer' ? 1 : 0) ||
      !Number.isFinite(sample.elapsedMs) || sample.elapsedMs <= 0 || !/^[a-f0-9]{64}$/.test(sample.checksum)) {
    throw new Error(`Invalid ${workload} benchmark sample`)
  }
}

export const evaluatePairs = (pairs) => {
  if (pairs.length !== PAIRS) throw new Error(`Expected ${PAIRS} pairs`)
  const base = pairs.map((pair) => pair.base.elapsedMs)
  const head = pairs.map((pair) => pair.head.elapsedMs)
  const checksums = new Set(pairs.flatMap((pair) => [pair.base.checksum, pair.head.checksum]))
  if (checksums.size !== 1) throw new Error('Base/head output checksums differ')
  const ratio = median(head) / median(base)
  const envelope = [Math.min(...head) / Math.max(...base), Math.max(...head) / Math.min(...base)]
  const pairRatios = pairs.map((pair) => pair.head.elapsedMs / pair.base.elapsedMs)
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
  }
}

export const measureWithRetries = (measure, report) => {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    const pairs = measure(attempt)
    const result = evaluatePairs(pairs)
    report({ attempt: attempt + 1, pairs, ...result })
    if (result.status !== 'INCONCLUSIVE') return result.status
  }
  return 'INCONCLUSIVE'
}
