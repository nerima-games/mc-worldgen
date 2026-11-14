import { createHash } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { chunkCoord } from '@nerima-games/mc-kernel'
import { Effect, Result } from 'effect'
import { ChunkCapacity, ChunkStore, GeneratedChunkStoreLayer as generatedChunkStoreLayer } from '../../src/application/chunk-store.js'
import { NoiseSeed } from '@nerima-games/mc-noise'
import { CHUNK_SIZE_XZ } from '../../src/domain/constants.js'
import { chunkAxis } from '../../src/domain/coordinate-compatibility.js'

const SPAWN_BLOCK = 0.5
const SEARCH_RADIUS_BLOCKS = 40
const MIN_CHUNK_COORD = Math.floor(Math.floor(SPAWN_BLOCK - SEARCH_RADIUS_BLOCKS) / CHUNK_SIZE_XZ)
const MAX_CHUNK_COORD = Math.floor(Math.floor(SPAWN_BLOCK + SEARCH_RADIUS_BLOCKS) / CHUNK_SIZE_XZ)
const CHUNKS_PER_AXIS = MAX_CHUNK_COORD - MIN_CHUNK_COORD + 1
const SEED = Result.getOrThrow(NoiseSeed.result(7))
const COORDS = Array.from({ length: CHUNKS_PER_AXIS * CHUNKS_PER_AXIS }, (_, index) => {
  const cx = MIN_CHUNK_COORD + (index % CHUNKS_PER_AXIS)
  const cz = MIN_CHUNK_COORD + Math.floor(index / CHUNKS_PER_AXIS)
  return chunkCoord(chunkAxis(cx), chunkAxis(cz))
})

const capacity = Result.getOrThrow(ChunkCapacity.result(COORDS.length))
const storeLayer = generatedChunkStoreLayer(SEED, capacity)

type CpuProfiler = {
  readonly session: import('node:inspector/promises').Session
  readonly path: string
}

const startCpuProfiler = async (path: string): Promise<CpuProfiler> => {
  const { Session } = await import('node:inspector/promises')
  const session = new Session()
  session.connect()

  try {
    await session.post('Profiler.enable')
    await session.post('Profiler.start')
    return { session, path }
  } catch (error) {
    session.disconnect()
    throw error
  }
}

const stopCpuProfiler = async ({ session, path }: CpuProfiler): Promise<void> => {
  try {
    const { profile } = await session.post('Profiler.stop')
    const { writeFile } = await import('node:fs/promises')
    await writeFile(path, JSON.stringify(profile))
  } finally {
    session.disconnect()
  }
}

const measurement = Effect.gen(function* measureChunkLoads() {
  const store = yield* ChunkStore
  const loadedChunks: object[] = []
  const profilePath = process.env.WORLDGEN_CPU_PROFILE_PATH
  let cpuProfiler: CpuProfiler | undefined

  if (profilePath !== undefined) {
    cpuProfiler = yield* Effect.promise(() => startCpuProfiler(profilePath))
  }

  const started = performance.now()

  for (const coord of COORDS) {
    const chunk = yield* store.load(coord)
    loadedChunks.push(chunk)
  }

  const elapsedMs = performance.now() - started
  if (cpuProfiler) {
    const profiler = cpuProfiler
    yield* Effect.promise(() => stopCpuProfiler(profiler))
  }

  const hash = createHash('sha256')
  let statefulChunks = 0
  for (let index = 0; index < COORDS.length; index += 1) {
    const coord = COORDS[index]
    const chunk = loadedChunks[index]
    if (!coord || !chunk) throw new Error(`missing loaded chunk at index ${index}`)
    const blocks = Reflect.get(chunk, 'blocks')
    const biomes = Reflect.get(chunk, 'biomes')
    if (!(blocks instanceof Uint16Array) || !Array.isArray(biomes)) {
      throw new Error(`invalid generated chunk at index ${index}`)
    }

    hash.update(`${coord.cx},${coord.cz}\0`)
    hash.update(new Uint8Array(blocks.buffer, blocks.byteOffset, blocks.byteLength))
    hash.update(JSON.stringify(biomes))

    const blockStates = Reflect.get(chunk, 'blockStates')
    if (blockStates instanceof Uint32Array) {
      statefulChunks += 1
      hash.update(new Uint8Array(blockStates.buffer, blockStates.byteOffset, blockStates.byteLength))
    }
  }

  return {
    checksum: hash.digest('hex'),
    chunks: COORDS.length,
    elapsedMs,
    hasBlockStates: statefulChunks === COORDS.length,
    statefulChunks,
    warmupLoads: 0,
  }
}).pipe(Effect.provide(storeLayer))

const result = await Effect.runPromise(measurement)
process.stdout.write(`${JSON.stringify({
  ...result,
  seed: 7,
  spawn: { x: SPAWN_BLOCK, z: SPAWN_BLOCK },
  radiusBlocks: SEARCH_RADIUS_BLOCKS,
})}\n`)
