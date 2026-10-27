/**
 * Advisory one-process sample for ChunkStore batch writes and live reads.
 *
 * Run with `pnpm bench:chunk-store -- --arm=legacy` or
 * `pnpm bench:chunk-store -- --arm=transaction`. Pass `--source-root=/path/to/checkout`
 * to load source files from that filesystem checkout; for origin/main, use its
 * checkout directory. Each invocation warms three batches, measures forty
 * batches of `4 chunks × 4 rows × CHUNK_SIZE_XZ columns` edits (256 at size 16),
 * then measures 50,000 load/peek pairs. Run fresh processes for each sample and
 * alternate the arms. JSON includes a 32-bit FNV-1a-style hash of selected
 * block IDs, expected to match across arms, and a read-reference check.
 * The transaction arm reports unavailable when the selected source has no API.
 * Timing is advisory and is not a verification gate.
 */
import { performance } from 'node:perf_hooks'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Effect, Result } from 'effect'
import {
  blockPosition as createBlockPosition,
  chunkCoord as createChunkCoord,
  type BlockId,
  type BlockPosition,
  type ChunkCoord,
} from '@nerima-games/mc-kernel'

type Arm = 'legacy' | 'transaction'
type ChunkStoreModules = Readonly<{
  application: typeof import('../src/application/chunk-store')
  biome: typeof import('../src/domain/biome')
  chunk: typeof import('../src/domain/chunk')
  constants: typeof import('../src/domain/constants')
  coordinates: typeof import('../src/domain/coordinate-compatibility')
}>
type BatchEdit = Readonly<{ position: BlockPosition; block: BlockId }>
type BenchmarkBatches = readonly [ReadonlyArray<BatchEdit>, ReadonlyArray<BatchEdit>]
type PreparedWrite = Readonly<{ changes: ReadonlyArray<unknown> }>
type TransactionApi = {
  readonly prepare: (edits: ReadonlyArray<BatchEdit>) => Effect.Effect<PreparedWrite, unknown>
  readonly publish: (prepared: PreparedWrite) => Effect.Effect<void, never>
}
type ChunkStoreInstance = Effect.Success<ChunkStoreModules['application']['ChunkStore']>
type BatchMeasurement = Readonly<{ elapsedMs: number; unexpectedOutcomes: number }>
type OutputMeasurement = Readonly<{ outputCorrect: boolean; signature: number }>
type ReadMeasurement = Readonly<{ readMsPerPair: number; readReferenceStable: boolean; readSink: number }>
type BenchResult = Readonly<{
  status: 'ok' | 'unavailable' | 'incorrect'
  arm: Arm
  warmupBatches?: number
  measuredBatches?: number
  editsPerBatch?: number
  elapsedMs?: number
  msPerBatch?: number
  readPairs?: number
  readMsPerPair?: number
  signature?: number
  outputCorrect?: boolean
  readReferenceStable?: boolean
}>

const CHUNK_COUNT = 4
const WARMUP_BATCHES = 3
const MEASURED_BATCHES = 40
const READ_PAIRS = 50_000
const SURFACE_Y = 63
const now = (): number => performance.now() // mc-kernel-allow-time-source: benchmark harness

const loadSourceModules = (sourceRoot: string): Effect.Effect<ChunkStoreModules> => {
  const root = resolve(sourceRoot)
  return Effect.all({
    application: Effect.promise(() => import(pathToFileURL(join(root, 'src/application/chunk-store.ts')).href)),
    biome: Effect.promise(() => import(pathToFileURL(join(root, 'src/domain/biome.ts')).href)),
    chunk: Effect.promise(() => import(pathToFileURL(join(root, 'src/domain/chunk.ts')).href)),
    constants: Effect.promise(() => import(pathToFileURL(join(root, 'src/domain/constants.ts')).href)),
    coordinates: Effect.promise(() => import(pathToFileURL(join(root, 'src/domain/coordinate-compatibility.ts')).href)),
  })
}

const flatChunk = (coord: ChunkCoord, modules: ChunkStoreModules) => {
  const { BLOCK } = modules.biome
  const { emptyBlocks } = modules.chunk
  const { blockIndex, CHUNK_SIZE_XZ } = modules.constants
  const blocks = emptyBlocks()
  for (let x = 0; x < CHUNK_SIZE_XZ; x += 1) {
    for (let z = 0; z < CHUNK_SIZE_XZ; z += 1) {
      blocks[blockIndex(x, 0, z)] = BLOCK.BEDROCK
      for (let y = 1; y <= SURFACE_Y; y += 1) blocks[blockIndex(x, y, z)] = BLOCK.STONE
    }
  }
  return {
    coord,
    blocks,
    biomes: Array.from({ length: CHUNK_SIZE_XZ * CHUNK_SIZE_XZ }, () => 'PLAINS' as const),
  }
}

const editsFor = (
  block: BlockId,
  editsPerBatch: number,
  chunkSize: number,
  coordinates: ChunkStoreModules['coordinates'],
): ReadonlyArray<BatchEdit> =>
  Array.from({ length: editsPerBatch }, (_, index) => {
    const editsPerChunk = chunkSize * 4
    const chunkIndex = Math.floor(index / editsPerChunk)
    const localIndex = index % editsPerChunk
    const localX = localIndex % chunkSize
    const localZ = Math.floor(localIndex / chunkSize)
    const worldX = chunkIndex * chunkSize + localX
    return {
      position: createBlockPosition(
        coordinates.blockAxis(worldX),
        coordinates.blockAxis(SURFACE_Y),
        coordinates.blockAxis(localZ),
      ),
      block,
    }
  })

const transactionApiFor = (store: ChunkStoreInstance): TransactionApi | undefined => {
  const prepare = Reflect.get(store, 'prepare')
  const publish = Reflect.get(store, 'publish')
  if (typeof prepare !== 'function' || typeof publish !== 'function') {
    return undefined
  }
  return {
    prepare: prepare as TransactionApi['prepare'],
    publish: publish as TransactionApi['publish'],
  }
}

const applyBatch = (
  arm: Arm,
  store: ChunkStoreInstance,
  transactionApi: TransactionApi | undefined,
  edits: ReadonlyArray<BatchEdit>,
): Effect.Effect<number, unknown> =>
  Effect.gen(function* applyEdits() {
    if (arm === 'legacy') {
      let unexpectedOutcomes = 0
      for (const edit of edits) {
        const outcome = yield* store.setBlock(edit.position, edit.block)
        if (outcome['_tag'] !== 'Written') unexpectedOutcomes += 1
      }
      return unexpectedOutcomes
    }
    if (!transactionApi) {
      return 1
    }
    const prepared = yield* transactionApi.prepare(edits)
    yield* transactionApi.publish(prepared)
    return prepared.changes.length === edits.length ? 0 : 1
  })

const batchAt = (batches: BenchmarkBatches, index: number): ReadonlyArray<BatchEdit> =>
  batches[index % 2] ?? batches[0]

const measureBatches = (
  arm: Arm,
  store: ChunkStoreInstance,
  transactionApi: TransactionApi | undefined,
  batches: BenchmarkBatches,
): Effect.Effect<BatchMeasurement, unknown> =>
  Effect.gen(function* measure() {
    let unexpectedOutcomes = 0
    for (let batch = 0; batch < WARMUP_BATCHES; batch += 1) {
      unexpectedOutcomes += yield* applyBatch(arm, store, transactionApi, batchAt(batches, batch))
    }
    const started = now()
    for (let batch = 0; batch < MEASURED_BATCHES; batch += 1) {
      unexpectedOutcomes += yield* applyBatch(
        arm,
        store,
        transactionApi,
        batchAt(batches, WARMUP_BATCHES + batch),
      )
    }
    return { elapsedMs: now() - started, unexpectedOutcomes }
  })

const verifyBlockOutput = (
  store: ChunkStoreInstance,
  chunkCoords: ReadonlyArray<ChunkCoord>,
  blockIndex: ChunkStoreModules['constants']['blockIndex'],
  chunkSize: number,
  expectedBlock: BlockId,
  unexpectedOutcomes: number,
): Effect.Effect<OutputMeasurement, unknown> =>
  Effect.gen(function* verify() {
    let signature = 2_166_136_261
    let outputCorrect = unexpectedOutcomes === 0
    for (const coord of chunkCoords) {
      const chunk = yield* store.peek(coord)
      if (!chunk) {
        outputCorrect = false
      } else {
        for (let localZ = 0; localZ < 4; localZ += 1) {
          for (let localX = 0; localX < chunkSize; localX += 1) {
            const block = chunk.blocks[blockIndex(localX, SURFACE_Y, localZ)] ?? 0
            if (block !== expectedBlock) outputCorrect = false
            signature = Math.imul(signature ^ block, 16_777_619) >>> 0
          }
        }
      }
    }
    return { outputCorrect, signature }
  })

const measureReads = (
  store: ChunkStoreInstance,
  readCoord: ChunkCoord,
  blockIndex: ChunkStoreModules['constants']['blockIndex'],
): Effect.Effect<ReadMeasurement, unknown> =>
  Effect.gen(function* measureReadPairs() {
    const readReference = yield* store.load(readCoord)
    const readBuffer = readReference.blocks
    const readIndex = blockIndex(0, SURFACE_Y, 0)
    let readReferenceStable = true
    let readSink = 0
    const readStarted = now()
    for (let pair = 0; pair < READ_PAIRS; pair += 1) {
      const loaded = yield* store.load(readCoord)
      const peeked = yield* store.peek(readCoord)
      if (loaded !== readReference || peeked !== readReference || loaded.blocks !== readBuffer) {
        readReferenceStable = false
      }
      readSink += loaded.blocks[readIndex] ?? 0
    }
    return { readMsPerPair: (now() - readStarted) / READ_PAIRS, readReferenceStable, readSink }
  })

const benchmark = (arm: Arm, modules: ChunkStoreModules): Effect.Effect<BenchResult, unknown> => {
  const { application, biome, constants, coordinates } = modules
  const { BLOCK } = biome
  const { CHUNK_SIZE_XZ, blockIndex } = constants
  const chunkCoords = Array.from({ length: CHUNK_COUNT }, (_, index) =>
    createChunkCoord(coordinates.chunkAxis(index), coordinates.chunkAxis(0)),
  )
  const editsPerBatch = CHUNK_COUNT * CHUNK_SIZE_XZ * 4
  const source = (coord: ChunkCoord) => Effect.sync(() => flatChunk(coord, modules))
  const world = application.ChunkStoreLayer(
    source,
    Result.getOrThrow(application.ChunkCapacity.result(8)),
  )

  return Effect.gen(function* runBenchmark() {
    const store = yield* application.ChunkStore
    const transactionApi = transactionApiFor(store)
    if (arm === 'transaction' && !transactionApi) {
      return { status: 'unavailable' as const, arm }
    }
    for (const coord of chunkCoords) yield* store.load(coord)

    const batches: BenchmarkBatches = [
      editsFor(BLOCK.SAND, editsPerBatch, CHUNK_SIZE_XZ, coordinates),
      editsFor(BLOCK.GRAVEL, editsPerBatch, CHUNK_SIZE_XZ, coordinates),
    ]
    const batchMeasurement = yield* measureBatches(arm, store, transactionApi, batches)
    const lastBatchIndex = WARMUP_BATCHES + MEASURED_BATCHES - 1
    const expectedBlock = lastBatchIndex % 2 === 0 ? BLOCK.SAND : BLOCK.GRAVEL
    const output = yield* verifyBlockOutput(
      store,
      chunkCoords,
      blockIndex,
      CHUNK_SIZE_XZ,
      expectedBlock,
      batchMeasurement.unexpectedOutcomes,
    )
    const readCoord = createChunkCoord(coordinates.chunkAxis(0), coordinates.chunkAxis(0))
    const reads = yield* measureReads(store, readCoord, blockIndex)
    const result: BenchResult = {
      status: output.outputCorrect && reads.readReferenceStable && reads.readSink > 0 ? 'ok' : 'incorrect',
      arm,
      warmupBatches: WARMUP_BATCHES,
      measuredBatches: MEASURED_BATCHES,
      editsPerBatch,
      elapsedMs: batchMeasurement.elapsedMs,
      msPerBatch: batchMeasurement.elapsedMs / MEASURED_BATCHES,
      readPairs: READ_PAIRS,
      readMsPerPair: reads.readMsPerPair,
      signature: output.signature,
      outputCorrect: output.outputCorrect,
      readReferenceStable: reads.readReferenceStable,
    }
    return result
  }).pipe(Effect.provide(world))
}

const main = Effect.gen(function* main() {
  const armValue = process.argv.find((argument) => argument.startsWith('--arm='))?.slice('--arm='.length)
  if (armValue !== 'legacy' && armValue !== 'transaction') {
    process.stderr.write('Choose one benchmark arm: --arm=legacy or --arm=transaction\n')
    process.exitCode = 2
    return
  }

  const sourceRootValue = process.argv.find((argument) => argument.startsWith('--source-root='))
    ?.slice('--source-root='.length)
  const modules = yield* loadSourceModules(resolve(sourceRootValue ?? process.cwd()))
  const result = yield* benchmark(armValue, modules)
  console.log(JSON.stringify(result))
  if (result.status !== 'ok') process.exitCode = result.status === 'unavailable' ? 2 : 1
})

await Effect.runPromise(main)
