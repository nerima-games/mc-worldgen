const MICROSECONDS_PER_MILLISECOND = 1000
const PERCENT_FACTOR = 100
const TOP_FUNCTION_LIMIT = 15

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

const sourceLocation = (url, lineNumber) => {
  if (url === '') return '[native]'

  const source = url.startsWith('file://') ? decodeURIComponent(url.slice('file://'.length)) : url
  const srcIndex = source.lastIndexOf('/src/')
  const packageIndex = source.lastIndexOf('/node_modules/')
  const normalized =
    srcIndex >= 0 ? source.slice(srcIndex + 1) : packageIndex >= 0 ? source.slice(packageIndex + 1) : source
  return `${normalized}:${lineNumber + 1}`
}

const categoryFor = (source, name) => {
  for (const [category, matches] of PROFILE_CATEGORIES) {
    if (matches(source, name)) return category
  }
  throw new Error(`CPU profile frame was not assigned to a category: ${name} at ${source}`)
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
    category: categoryFor(url, name),
  }
}

const createAggregate = (profile) => ({
  nodesById: new Map(profile.nodes.map((node) => [node.id, node])),
  functionsByFrame: new Map(),
  categories: new Map(PROFILE_CATEGORIES.map(([category]) => [category, 0])),
  totalMicros: 0,
})

const addSample = (aggregate, nodeId, deltaMicros, index) => {
  const node = aggregate.nodesById.get(nodeId)
  if (!node || !Number.isFinite(deltaMicros) || deltaMicros < 0) {
    throw new Error(`CPU profile contains an invalid sample at index ${index}`)
  }

  const details = profileFrame(node)
  const frame = aggregate.functionsByFrame.get(details.key) ?? { ...details, selfMicros: 0 }
  frame.selfMicros += deltaMicros
  aggregate.functionsByFrame.set(details.key, frame)
  aggregate.categories.set(details.category, aggregate.categories.get(details.category) + deltaMicros)
  aggregate.totalMicros += deltaMicros
}

const aggregateSamples = (profile) => {
  const aggregate = createAggregate(profile)
  for (let index = 0; index < profile.samples.length; index += 1) {
    addSample(aggregate, profile.samples[index], profile.timeDeltas[index], index)
  }
  return aggregate
}

const summarizeFunctions = ({ functionsByFrame, totalMicros }) =>
  [...functionsByFrame.values()]
    .sort((left, right) => right.selfMicros - left.selfMicros)
    .slice(0, TOP_FUNCTION_LIMIT)
    .map(({ name, source, category, selfMicros }) => ({
      name,
      source,
      category,
      selfMs: selfMicros / MICROSECONDS_PER_MILLISECOND,
      percent: (selfMicros / totalMicros) * PERCENT_FACTOR,
    }))

const summarizeCategories = ({ categories, totalMicros }) =>
  Object.fromEntries(
    PROFILE_CATEGORIES.map(([category]) => {
      const selfMicros = categories.get(category)
      return [category, {
        selfMs: selfMicros / MICROSECONDS_PER_MILLISECOND,
        percent: (selfMicros / totalMicros) * PERCENT_FACTOR,
      }]
    }),
  )

export const summarizeCpuProfile = (profile) => {
  validateProfile(profile)
  const aggregate = aggregateSamples(profile)
  if (aggregate.totalMicros <= 0) throw new Error('CPU profile contains no sampled self time')
  return {
    sampleCount: profile.samples.length,
    selfMs: aggregate.totalMicros / MICROSECONDS_PER_MILLISECOND,
    categories: summarizeCategories(aggregate),
    functions: summarizeFunctions(aggregate),
  }
}

export const renderCpuProfileMarkdown = (version, summary) => {
  const categoryRows = Object.entries(summary.categories).map(
    ([category, { selfMs, percent }]) => `| ${category} | ${selfMs.toFixed(2)} ms | ${percent.toFixed(2)}% |`,
  )
  const functionRows = summary.functions.map(
    ({ name, source, selfMs, percent }, index) =>
      `| ${index + 1} | ${selfMs.toFixed(2)} ms | ${percent.toFixed(2)}% | \`${name}\` | \`${source}\` |`,
  )

  return [
    `### ${version} CPU profile`,
    '',
    `Self-sampled time: ${summary.selfMs.toFixed(2)} ms across ${summary.sampleCount} samples.`,
    '',
    '| Category | Self time | Share |',
    '| --- | ---: | ---: |',
    ...categoryRows,
    '',
    '| Rank | Self time | Share | Function | Source |',
    '| ---: | ---: | ---: | --- | --- |',
    ...functionRows,
    '',
  ].join('\n')
}
