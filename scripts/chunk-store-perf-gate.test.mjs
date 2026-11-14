import assert from 'node:assert/strict'
import { test } from 'node:test'
import { evaluatePairs, measureWithRetries, validateSample } from './chunk-store-perf-gate.mjs'

const sample = (elapsedMs, load = 0) => ({ elapsedMs, checksum: 'a'.repeat(64), loadBefore: [load, 0, 0], loadAfter: [load, 0, 0] })
const pairs = (times) => times.map(([base, head]) => ({ base: sample(base), head: sample(head) }))
const stable = (head) => pairs(Array.from({ length: 5 }, () => [100, head]))
const noisy = () => pairs([[100, 90], [100, 100], [100, 120], [100, 155], [100, 170]])

test('stable equal timing passes, the strict threshold passes, and a slowdown fails', () => {
  assert.equal(evaluatePairs(stable(100)).status, 'PASS')
  assert.equal(evaluatePairs(stable(150)).status, 'PASS')
  assert.equal(evaluatePairs(stable(151)).status, 'REGRESSED')
  assert.equal(evaluatePairs(stable(200)).ratio, 2)
})

test('spread spanning the budget is inconclusive even with a passing median', () => {
  const result = evaluatePairs(noisy())
  assert.equal(result.status, 'INCONCLUSIVE')
  assert.equal(result.ratio, 1.2)
  assert.deepEqual(result.envelope, [0.9, 1.7])
  assert.deepEqual(result.pairRatios, [0.9, 1, 1.2, 1.55, 1.7])
})

test('high 1-minute load makes otherwise stable measurements inconclusive', () => {
  const measurements = stable(100)
  measurements[0].head.loadAfter[0] = 30
  assert.equal(evaluatePairs(measurements).status, 'INCONCLUSIVE')
})

test('only inconclusive attempts retry and exhaust after three attempts', () => {
  const reports = []
  assert.equal(measureWithRetries(() => noisy(), (r) => reports.push(r)), 'INCONCLUSIVE')
  assert.equal(reports.length, 3)
  assert.deepEqual(reports.map((r) => r.attempt), [1, 2, 3])
  const retry = []
  assert.equal(measureWithRetries((attempt) => attempt === 0 ? noisy() : stable(100), (r) => retry.push(r)), 'PASS')
  assert.equal(retry.length, 2)
  let regressedAttempts = 0
  assert.equal(measureWithRetries(() => { regressedAttempts += 1; return stable(200) }, () => {}), 'REGRESSED')
  assert.equal(regressedAttempts, 1)
})

test('checksum mismatch and incomplete pairs fail without retry', () => {
  const measurements = stable(100)
  measurements[2].head.checksum = 'b'.repeat(64)
  let calls = 0
  assert.throws(() => measureWithRetries(() => { calls += 1; return measurements }, () => {}), /checksums differ/)
  assert.equal(calls, 1)
  assert.throws(() => evaluatePairs(measurements.slice(1)), /Expected 5 pairs/)
})

test('workload validation rejects missing lighting, incorrect chunk counts, and invalid timing', () => {
  const valid = { ...sample(100), chunks: 36, seed: 7, radiusBlocks: 40, warmupLoads: 0, statefulChunks: 36, workload: 'consumer', lightReads: 2, writes: 1 }
  assert.doesNotThrow(() => validateSample(valid, 'consumer'))
  assert.doesNotThrow(() => validateSample({ ...valid, workload: 'load', lightReads: 0, writes: 0 }, 'load'))
  for (const invalid of [{ lightReads: 0 }, { writes: 0 }, { chunks: 35 }, { statefulChunks: 0 }, { elapsedMs: NaN }, { elapsedMs: -1 }, { checksum: '' }]) {
    assert.throws(() => validateSample({ ...valid, ...invalid }, 'consumer'), /Invalid consumer/)
  }
})
