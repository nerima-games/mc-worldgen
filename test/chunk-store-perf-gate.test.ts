import assert from 'node:assert/strict'
import { test } from 'vitest'
import { evaluatePairs, measureWithRetries, validateSample } from '../scripts/chunk-store-perf-gate.mjs'
import type { GateAttempt, SamplePair, TimingSample } from '../scripts/chunk-store-perf-gate.mjs'

const sample = (elapsedMs: number, load = 0): TimingSample => ({ elapsedMs, lightElapsedMs: 0, checksum: 'a'.repeat(64), loadBefore: [load, 0, 0], loadAfter: [load, 0, 0] })
const pairs = (times: readonly (readonly [number, number])[]): SamplePair[] => times.map(([base, head]) => ({ base: sample(base), head: sample(head) }))
const stable = (head: number): SamplePair[] => pairs(Array.from({ length: 5 }, () => [100, head]))
const noisy = () => pairs([[100, 90], [100, 100], [100, 120], [100, 155], [100, 170]])

test('stable equal timing passes, the strict threshold passes, and a slowdown fails', () => {
  assert.equal(evaluatePairs(stable(100)).status, 'PASS')
  assert.equal(evaluatePairs(stable(150)).status, 'PASS')
  assert.equal(evaluatePairs(stable(151)).status, 'REGRESSED')
  assert.equal(evaluatePairs(stable(200)).ratio, 2)
})

test('consumer gate catches doubled lighting with unchanged load time', () => {
  const measurements = Array.from({ length: 5 }, () => ({
    base: { ...sample(1100), lightElapsedMs: 100 },
    head: { ...sample(1200), lightElapsedMs: 200 },
  }))
  assert.equal(evaluatePairs(measurements).status, 'PASS')
  const lighting = evaluatePairs(measurements, 'consumer')
  assert.equal(lighting.metric, 'lightElapsedMs')
  assert.equal(lighting.status, 'REGRESSED')
  assert.equal(lighting.ratio, 2)
  const reports: GateAttempt[] = []
  assert.equal(measureWithRetries(() => measurements, (r) => reports.push(r), 'consumer'), 'REGRESSED')
  assert.equal(reports.length, 1)
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
  assert.ok(measurements[0])
  measurements[0].head.loadAfter[0] = 30
  assert.equal(evaluatePairs(measurements).status, 'INCONCLUSIVE')
})

test('only inconclusive attempts retry and exhaust after three attempts', () => {
  const reports: GateAttempt[] = []
  assert.equal(measureWithRetries(() => noisy(), (r) => reports.push(r)), 'INCONCLUSIVE')
  assert.equal(reports.length, 3)
  assert.deepEqual(reports.map((r) => r.attempt), [1, 2, 3])
  const retry: GateAttempt[] = []
  assert.equal(measureWithRetries((attempt) => attempt === 0 ? noisy() : stable(100), (r) => retry.push(r)), 'PASS')
  assert.equal(retry.length, 2)
  let regressedAttempts = 0
  const regressions: GateAttempt[] = []
  assert.equal(measureWithRetries(() => { regressedAttempts += 1; return stable(200) }, (r) => regressions.push(r)), 'REGRESSED')
  assert.equal(regressedAttempts, 1)
  assert.equal(regressions.length, 1)
  assert.ok(regressions[0])
  assert.equal(regressions[0].status, 'REGRESSED')
})

test('different deterministic base/head outputs do not affect equal timing', () => {
  const measurements = stable(100)
  for (const pair of measurements) pair.head.checksum = 'b'.repeat(64)
  const result = evaluatePairs(measurements)
  assert.equal(result.status, 'PASS')
  assert.equal(result.ratio, 1)
  assert.deepEqual(result.checksums, { base: 'a'.repeat(64), head: 'b'.repeat(64) })
  assert.equal(result.outputChanged, true)
})

test('per-version nondeterminism and incomplete pairs fail without retry', () => {
  for (const version of ['base', 'head'] as const) {
    const measurements = stable(100)
    assert.ok(measurements[2])
    measurements[2][version].checksum = 'b'.repeat(64)
    let calls = 0
    const reports: GateAttempt[] = []
    assert.throws(() => measureWithRetries(() => { calls += 1; return measurements }, (r) => reports.push(r)), /checksums differ/)
    assert.equal(calls, 1)
    assert.equal(reports.length, 0)
    assert.throws(() => evaluatePairs(measurements.slice(1)), /Expected 5 pairs/)
  }
})

test('a version changing output between inconclusive attempts fails', () => {
  let calls = 0
  const reports: GateAttempt[] = []
  assert.throws(() => measureWithRetries((attempt) => {
    calls += 1
    const measurements = noisy()
    for (const pair of measurements) pair.head.checksum = (attempt === 0 ? 'a' : 'b').repeat(64)
    return measurements
  }, (r) => reports.push(r)), /checksums changed between attempts/)
  assert.equal(calls, 2)
  assert.equal(reports.length, 1)
})

test('workload validation rejects missing lighting, incorrect chunk counts, and invalid timing', () => {
  const valid = { ...sample(100), lightElapsedMs: 50, chunks: 36, seed: 7, radiusBlocks: 40, warmupLoads: 0, statefulChunks: 36, workload: 'consumer', lightReads: 2, writes: 1 }
  assert.doesNotThrow(() => validateSample(valid, 'consumer'))
  assert.doesNotThrow(() => validateSample({ ...valid, workload: 'load', lightElapsedMs: 0, lightReads: 0, writes: 0 }, 'load'))
  for (const invalid of [{ lightReads: 0 }, { writes: 0 }, { chunks: 35 }, { statefulChunks: 0 }, { elapsedMs: NaN }, { elapsedMs: -1 }, { checksum: '' }, { lightElapsedMs: 0 }, { lightElapsedMs: NaN }, { lightElapsedMs: -1 }]) {
    assert.throws(() => validateSample({ ...valid, ...invalid }, 'consumer'), /Invalid consumer/)
  }
})
