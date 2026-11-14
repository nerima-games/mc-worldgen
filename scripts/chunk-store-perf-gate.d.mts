export type Workload = 'load' | 'consumer'
export type GateStatus = 'PASS' | 'REGRESSED' | 'INCONCLUSIVE'

export interface TimingSample {
  elapsedMs: number
  lightElapsedMs: number
  checksum: string
  loadBefore: [number, number, number]
  loadAfter: [number, number, number]
}

export interface SamplePair {
  base: TimingSample
  head: TimingSample
}

export interface GateEvaluation {
  status: GateStatus
  ratio: number
  envelope: [number, number]
  pairRatios: number[]
  headWins: number
  baseMedianMs: number
  headMedianMs: number
  highLoad: boolean
  checksums: { base: string; head: string }
  outputChanged: boolean
  metric: 'elapsedMs' | 'lightElapsedMs'
}

export interface GateAttempt extends GateEvaluation {
  attempt: number
  pairs: SamplePair[]
}

export declare const REGRESSION_RATIO: number
export declare const PAIRS: number
export declare const MAX_RETRIES: number
export function validateSample(sample: unknown, workload: Workload): void
export function evaluatePairs(pairs: SamplePair[], workload?: Workload): GateEvaluation
export function measureWithRetries(
  measure: (attempt: number) => SamplePair[],
  report: (attempt: GateAttempt) => void,
  workload?: Workload,
): GateStatus
