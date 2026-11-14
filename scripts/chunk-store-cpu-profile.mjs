const MICROSECONDS_PER_MILLISECOND = 1000
const PERCENT_FACTOR = 100
const TOP_FUNCTION_LIMIT = 15
const MAX_NEGATIVE_DELTA_MICROSECONDS = 1000
const MAX_NEGATIVE_DELTA_SAMPLE_RATIO = 0.01
const MAX_NORMALIZED_TIME_RATIO = 0.005

const PROFILE_CATEGORIES = [
  ['density grid', (source) => /\/(?:density-grid|density-function)\./.test(source)],
  ['caves', (source) => source.endsWith('/carver.ts')],
  ['ore', (source) => source.endsWith('/ore.ts')],
  [
    'structures',
    (source, name) =>
      source.includes('structure') || /(?:writeStructures|structureTerrainSample|netherStructureTerrainAt)/.test(name),
  ],
  [
    'terrain columns',
    (source) => /\/(?:terrain|terrain-column|end-terrain|nether-terrain)\.ts$/.test(source),
  ],
  [
    'block-state materialization',
    (source, name) =>
      /(?:defaultBlockStatesFor|encodedDefaultStateFor|fillDefaultStateRun|fillDefaultBlockStateRuns|materializeChunkStates)/.test(
        name,
      ),
  ],
  ['kernel/save', (source) => /mc-(?:kernel|save)/.test(source)],
  ['noise', (source) => /mc-noise/.test(source)],
  ['other', () => true],
]
const PROFILER_CONTROL_CATEGORY = 'profiler control'

const sourcePath = (url) => {
  if (url === '') return '[native]'

  const source = url.startsWith('file://') ? decodeURIComponent(url.slice('file://'.length)) : url
  const srcIndex = source.lastIndexOf('/src/')
  const packageIndex = source.lastIndexOf('/node_modules/')
  const normalized =
    srcIndex >= 0 ? source.slice(srcIndex + 1) : packageIndex >= 0 ? source.slice(packageIndex + 1) : source
  return normalized
}

const sourceLocation = (url, lineNumber) => url === '' ? '[native]' : `${sourcePath(url)}:${lineNumber + 1}`

const isProfilerControl = (url) => url.startsWith('node:inspector')

const isStateMaterializationFrame = (node, nodesById, parentById) => {
  let current = node
  while (current) {
    if (current.callFrame.url.includes('/src/domain/chunk.ts')) {
      const parent = nodesById.get(parentById.get(current.id))
      if (parent?.callFrame.url.includes('/src/application/chunk-store.ts')) return true
    }
    current = nodesById.get(parentById.get(current.id))
  }
  return false
}

const categoryFor = (node, nodesById, parentById) => {
  const { url, functionName } = node.callFrame
  if (isProfilerControl(url)) return PROFILER_CONTROL_CATEGORY

  const source = sourcePath(url)
  const name = functionName || '(anonymous)'
  for (const [category, matches] of PROFILE_CATEGORIES) {
    if (category !== 'other' && matches(source, name)) return category
  }
  if (isStateMaterializationFrame(node, nodesById, parentById)) return 'block-state materialization'
  return 'other'
}

const noiseCallerCategory = (node, nodesById, parentById) => {
  let current = nodesById.get(parentById.get(node.id))
  while (current) {
    const source = sourcePath(current.callFrame.url)
    if (!source.includes('mc-noise')) {
      const name = current.callFrame.functionName || '(anonymous)'
      for (const [category, matches] of PROFILE_CATEGORIES) {
        if (category !== 'noise' && category !== 'other' && matches(source, name)) return category
      }
      if (isStateMaterializationFrame(current, nodesById, parentById)) return 'block-state materialization'
    }
    current = nodesById.get(parentById.get(current.id))
  }
  return 'other'
}

const validateProfile = (profile) => {
  if (!Array.isArray(profile.nodes) || !Array.isArray(profile.samples) || !Array.isArray(profile.timeDeltas)) {
    throw new Error('CPU profile is missing nodes, samples, or timeDeltas')
  }
  if (profile.samples.length === 0 || profile.samples.length !== profile.timeDeltas.length) {
    throw new Error('CPU profile has an empty or mismatched sample/time-delta array')
  }
}

const profileFrame = (node) => {
  const { functionName, scriptId, url, lineNumber, columnNumber } = node.callFrame
  const name = functionName || '(anonymous)'
  return {
    key: `${scriptId}\0${name}\0${url}\0${lineNumber}\0${columnNumber}`,
    name,
    source: sourceLocation(url, lineNumber),
  }
}

const createAggregate = (profile) => {
  const nodesById = new Map(profile.nodes.map((node) => [node.id, node]))
  const parentById = new Map()
  for (const node of profile.nodes) {
    for (const childId of node.children ?? []) {
      if (parentById.has(childId)) throw new Error(`CPU profile node ${childId} has multiple parents`)
      parentById.set(childId, node.id)
    }
  }

  return {
    nodesById,
    parentById,
    functionsByFrame: new Map(),
    categories: new Map(PROFILE_CATEGORIES.map(([category]) => [category, 0])),
    noiseCallers: new Map(PROFILE_CATEGORIES.filter(([category]) => category !== 'noise').map(([category]) => [category, 0])),
    workloadMicros: 0,
    sampledMicros: 0,
    profilerControlMicros: 0,
    noiseMicros: 0,
    profilerControlSampleCount: 0,
    workloadSampleCount: 0,
    negativeDeltaCount: 0,
    normalizedNegativeMicros: 0,
  }
}

const addSample = (aggregate, nodeId, deltaMicros, index) => {
  const node = aggregate.nodesById.get(nodeId)
  if (!node) {
    throw new Error(`CPU profile sample ${index} references missing node ${nodeId}`)
  }
  if (!Number.isInteger(deltaMicros)) {
    throw new Error(`CPU profile sample ${index} has a non-integer time delta`)
  }
  if (deltaMicros < -MAX_NEGATIVE_DELTA_MICROSECONDS) {
    throw new Error(`CPU profile sample ${index} regresses by more than one sampling interval`)
  }

  const selfMicros = Math.max(0, deltaMicros)
  if (deltaMicros < 0) {
    aggregate.negativeDeltaCount += 1
    aggregate.normalizedNegativeMicros -= deltaMicros
  }

  const category = categoryFor(node, aggregate.nodesById, aggregate.parentById)
  aggregate.sampledMicros += selfMicros
  if (category === PROFILER_CONTROL_CATEGORY) {
    aggregate.profilerControlMicros += selfMicros
    aggregate.profilerControlSampleCount += 1
    return
  }

  const details = profileFrame(node)
  details.category = category
  details.key += `\0${category}`
  const frame = aggregate.functionsByFrame.get(details.key) ?? { ...details, selfMicros: 0 }
  aggregate.workloadSampleCount += 1
  frame.selfMicros += selfMicros
  aggregate.functionsByFrame.set(details.key, frame)
  aggregate.categories.set(details.category, aggregate.categories.get(details.category) + selfMicros)
  if (category === 'noise') {
    const caller = noiseCallerCategory(node, aggregate.nodesById, aggregate.parentById)
    aggregate.noiseCallers.set(caller, aggregate.noiseCallers.get(caller) + selfMicros)
    aggregate.noiseMicros += selfMicros
  }
  aggregate.workloadMicros += selfMicros
}

const aggregateSamples = (profile) => {
  const aggregate = createAggregate(profile)
  for (let index = 0; index < profile.samples.length; index += 1) {
    addSample(aggregate, profile.samples[index], profile.timeDeltas[index], index)
  }
  return aggregate
}

const summarizeFunctions = ({ functionsByFrame, workloadMicros }) =>
  [...functionsByFrame.values()]
    .sort((left, right) => right.selfMicros - left.selfMicros)
    .slice(0, TOP_FUNCTION_LIMIT)
    .map(({ name, source, category, selfMicros }) => ({
      name,
      source,
      category,
      selfMs: selfMicros / MICROSECONDS_PER_MILLISECOND,
      percent: (selfMicros / workloadMicros) * PERCENT_FACTOR,
    }))

const summarizeCategories = ({ categories, workloadMicros }) =>
  Object.fromEntries(
    PROFILE_CATEGORIES.map(([category]) => {
      const selfMicros = categories.get(category)
      return [category, {
        selfMs: selfMicros / MICROSECONDS_PER_MILLISECOND,
        percent: (selfMicros / workloadMicros) * PERCENT_FACTOR,
      }]
    }),
  )

const summarizeNoiseCallers = ({ noiseCallers, noiseMicros, workloadMicros }) =>
  Object.fromEntries(
    [...noiseCallers].map(([category, selfMicros]) => [category, {
      selfMs: selfMicros / MICROSECONDS_PER_MILLISECOND,
      percentOfWorkload: (selfMicros / workloadMicros) * PERCENT_FACTOR,
      percentOfNoise: (selfMicros / noiseMicros) * PERCENT_FACTOR,
    }]),
  )

export const summarizeCpuProfile = (profile) => {
  validateProfile(profile)
  const aggregate = aggregateSamples(profile)
  if (aggregate.workloadMicros <= 0) throw new Error('CPU profile contains no sampled workload self time')
  const negativeDeltaSampleRatio = aggregate.negativeDeltaCount / profile.samples.length
  const normalizedTimeRatio = aggregate.normalizedNegativeMicros / aggregate.workloadMicros
  if (
    negativeDeltaSampleRatio > MAX_NEGATIVE_DELTA_SAMPLE_RATIO ||
    normalizedTimeRatio > MAX_NORMALIZED_TIME_RATIO
  ) {
    throw new Error('CPU profile contains too many negative time deltas to summarize')
  }
  return {
    sampleCount: profile.samples.length,
    workloadSampleCount: aggregate.workloadSampleCount,
    profilerControlSampleCount: aggregate.profilerControlSampleCount,
    sampledSelfMs: aggregate.sampledMicros / MICROSECONDS_PER_MILLISECOND,
    profilerControl: {
      selfMs: aggregate.profilerControlMicros / MICROSECONDS_PER_MILLISECOND,
      percentOfSampledTime: (aggregate.profilerControlMicros / aggregate.sampledMicros) * PERCENT_FACTOR,
    },
    selfMs: aggregate.workloadMicros / MICROSECONDS_PER_MILLISECOND,
    timeDeltaNormalization: {
      negativeDeltaCount: aggregate.negativeDeltaCount,
      normalizedNegativeMicros: aggregate.normalizedNegativeMicros,
    },
    categories: summarizeCategories(aggregate),
    noiseCallers: summarizeNoiseCallers(aggregate),
    functions: summarizeFunctions(aggregate),
  }
}

export const renderCpuProfileMarkdown = (version, summary) => {
  const normalizationNote = summary.timeDeltaNormalization.negativeDeltaCount === 0
    ? 'No negative profiler intervals required normalization.'
    : `Normalized ${summary.timeDeltaNormalization.negativeDeltaCount} negative profiler interval(s) (${summary.timeDeltaNormalization.normalizedNegativeMicros} µs total) to zero self time.`
  const categoryRows = Object.entries(summary.categories).map(
    ([category, { selfMs, percent }]) => `| ${category} | ${selfMs.toFixed(2)} ms | ${percent.toFixed(2)}% |`,
  )
  const functionRows = summary.functions.map(
    ({ name, source, selfMs, percent }, index) =>
      `| ${index + 1} | ${selfMs.toFixed(2)} ms | ${percent.toFixed(2)}% | \`${name}\` | \`${source}\` |`,
  )
  const noiseCallerRows = Object.entries(summary.noiseCallers).map(
    ([category, { selfMs, percentOfWorkload, percentOfNoise }]) =>
      `| ${category} | ${selfMs.toFixed(2)} ms | ${percentOfWorkload.toFixed(2)}% | ${percentOfNoise.toFixed(2)}% |`,
  )

  return [
    `### ${version} CPU profile`,
    '',
    `Sampled self time: ${summary.sampledSelfMs.toFixed(2)} ms across ${summary.sampleCount} samples.`,
    `Profiler-control frames: ${summary.profilerControl.selfMs.toFixed(2)} ms (${summary.profilerControl.percentOfSampledTime.toFixed(2)}% of sampled self time; excluded from workload percentages and function ranking).`,
    `Workload self time: ${summary.selfMs.toFixed(2)} ms across ${summary.workloadSampleCount} samples.`,
    normalizationNote,
    '',
    'Category rows use sampled frame source; percentages use workload self time after profiler-control frames were excluded.',
    '',
    '| Category | Self time | Share |',
    '| --- | ---: | ---: |',
    ...categoryRows,
    '',
    'Noise package self time by nearest worldgen caller (this table is a breakdown of the noise row above).',
    '',
    '| Caller | Noise self time | Share of workload | Share of noise |',
    '| --- | ---: | ---: | ---: |',
    ...noiseCallerRows,
    '',
    '| Rank | Self time | Share | Function | Source |',
    '| ---: | ---: | ---: | --- | --- |',
    ...functionRows,
    '',
  ].join('\n')
}
