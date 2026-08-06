/**
 * Small benchmark for the hot edit -> light-read path.
 *
 * Run directly with `pnpm exec tsx scripts/bench-light.ts`. The workload keeps
 * four chunks resident, warms their light cache, then alternates one torch in
 * a sealed room and observes its neighbour after every edit.
 */
import { performance } from 'node:perf_hooks'
import { BLOCK } from '../src/domain/biome'
import { emptyBlocks, type Chunk } from '../src/domain/chunk'
import { blockIndex, CHUNK_SIZE_XZ } from '../src/domain/constants'
import {
  emptyChunkStoreState,
  lightAt,
  withBlockAt,
  withChunk,
  type ChunkStoreState,
} from '../src/domain/chunk-store-state'
import { BlockId, blockPosition, chunkCoord, type ChunkCoord } from '@nerima-games/mc-kernel'

const PLAINS = Array.from({ length: CHUNK_SIZE_XZ * CHUNK_SIZE_XZ }, () => 'PLAINS' as const)
const SURFACE_Y = 63
const ROOF_Y = SURFACE_Y + 2
const ROOM_Y = SURFACE_Y + 1
const TORCH = BlockId(14)
const EDITS = 8
const RUNS = 5

const roofedChunk = (coord: ChunkCoord): Chunk => {
  const blocks = emptyBlocks()
  for (let x = 0; x < CHUNK_SIZE_XZ; x += 1) {
    for (let z = 0; z < CHUNK_SIZE_XZ; z += 1) {
      blocks[blockIndex(x, 0, z)] = BLOCK.BEDROCK
      for (let y = 1; y <= SURFACE_Y; y += 1) blocks[blockIndex(x, y, z)] = BLOCK.STONE
      blocks[blockIndex(x, ROOF_Y, z)] = BLOCK.STONE
    }
  }
  return { coord, blocks, biomes: PLAINS }
}

const makeState = (): ChunkStoreState => {
  let state = emptyChunkStoreState
  for (const coord of [chunkCoord(0, 0), chunkCoord(1, 0), chunkCoord(0, 1), chunkCoord(1, 1)]) {
    state = withChunk(state, roofedChunk(coord))
  }
  return lightAt(state, blockPosition(4, ROOM_Y, 4))[1]
}

let sink = 0
const workload = (): number => {
  let state = makeState()
  const source = blockPosition(4, ROOM_Y, 4)
  const target = blockPosition(5, ROOM_Y, 4)
  const started = performance.now()

  for (let edit = 0; edit < EDITS; edit += 1) {
    state = withBlockAt(state, source, edit % 2 === 0 ? TORCH : BLOCK.AIR)[1]
    const [reading, next] = lightAt(state, target)
    state = next
    if (reading._tag === 'Light') sink += reading.block
  }

  return performance.now() - started
}

workload()
const samples = Array.from({ length: RUNS }, workload).sort((left, right) => left - right)
const median = samples[Math.floor(samples.length / 2)] ?? 0
console.log(JSON.stringify({ chunks: 4, edits: EDITS, runs: RUNS, medianMs: median, samplesMs: samples, sink }))
