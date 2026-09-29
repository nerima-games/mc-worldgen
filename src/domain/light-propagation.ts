import { CHUNK_HEIGHT, CHUNK_SIZE_XZ, blockIndex } from './constants.js'
import { type Chunk, getBlockAt } from './chunk.js'
import {
  type ChunkLight,
  emptyChunkLight,
  getLightAt,
  packPosLevel,
  setLightAt,
  unpackLevel,
  unpackX,
  unpackY,
  unpackZ,
} from './light-grid.js'
import {
  LIGHT_DECAY_PER_HOP,
  MIN_CHUNK_COORD,
  NEIGHBOUR_OFFSETS,
  STEP,
  axisCrossing,
  coordKey,
} from './light-common.js'
import { LIGHT_LEVEL_MAX, LIGHT_LEVEL_MIN, lightEmissionOfBlockId, transmitsLight } from '@nerima-games/mc-kernel'

type LightChunk = {
  readonly chunk: Chunk
  readonly light: ChunkLight
  readonly sourceIndex: number
}

type LightQueue = {
  readonly packed: Array<number>
  readonly source: Array<number>
  head: number
  tail: number
}

type PropagationContext = {
  readonly chunksByCoord: ReadonlyMap<string, number>
  readonly gridOf: (light: ChunkLight) => Uint8Array
  readonly queue: LightQueue
  readonly sourceTable: ReadonlyArray<LightChunk>
}

const createQueue = (): LightQueue => {
  const packed: Array<number> = []
  const source: Array<number> = []
  return {
    head: 0,
    packed,
    source,
    tail: 0,
  }
}

/** Sky light enters every transmitting cell above the first opaque block. */
const seedSkyLight = (chunk: Chunk, grid: Uint8Array): Array<number> => {
  const queue: Array<number> = []

  for (let x = MIN_CHUNK_COORD; x < CHUNK_SIZE_XZ; x += STEP) {
    for (let z = MIN_CHUNK_COORD; z < CHUNK_SIZE_XZ; z += STEP) {
      for (let y = CHUNK_HEIGHT - STEP; y >= MIN_CHUNK_COORD; y -= STEP) {
        if (!transmitsLight(getBlockAt(chunk, x, y, z))) {
          break
        }

        setLightAt(grid, blockIndex(x, y, z), LIGHT_LEVEL_MAX)
        queue.push(packPosLevel(x, y, z, LIGHT_LEVEL_MAX))
      }
    }
  }

  return queue
}

/** Block light starts at every emitting block, including opaque emitters. */
const seedBlockLight = (chunk: Chunk, grid: Uint8Array): Array<number> => {
  const queue: Array<number> = []

  for (let x = MIN_CHUNK_COORD; x < CHUNK_SIZE_XZ; x += STEP) {
    for (let z = MIN_CHUNK_COORD; z < CHUNK_SIZE_XZ; z += STEP) {
      for (let y = MIN_CHUNK_COORD; y < CHUNK_HEIGHT; y += STEP) {
        const emission = lightEmissionOfBlockId(getBlockAt(chunk, x, y, z))
        if (emission > LIGHT_LEVEL_MIN) {
          setLightAt(grid, blockIndex(x, y, z), emission)
          queue.push(packPosLevel(x, y, z, emission))
        }
      }
    }
  }

  return queue
}

const LOWEST_PROPAGATABLE_LEVEL = LIGHT_LEVEL_MIN + LIGHT_DECAY_PER_HOP

const seedQueues = (
  chunks: ReadonlyArray<LightChunk>,
  gridOf: (light: ChunkLight) => Uint8Array,
  seed: (chunk: Chunk, grid: Uint8Array) => Array<number>,
): LightQueue => {
  const queue = createQueue()

  for (const entry of chunks) {
    for (const packed of seed(entry.chunk, gridOf(entry.light))) {
      const index = queue.tail
      queue.packed[index] = packed
      queue.source[index] = entry.sourceIndex
      queue.tail = index + STEP
    }
  }

  return queue
}

const X_OFFSET = 0
const Y_OFFSET = 1
const Z_OFFSET = 2
const LIGHT_Y_STRIDE = STEP
const LIGHT_Z_STRIDE = CHUNK_HEIGHT
const LIGHT_X_STRIDE = CHUNK_HEIGHT * CHUNK_SIZE_XZ
// The loop intentionally keeps scalar coordinates and no per-neighbour records.
// oxlint-disable-next-line max-statements
const popAndRelax = (context: PropagationContext, source: LightChunk, packed: number): void => {
  const level = unpackLevel(packed)
  if (level > LOWEST_PROPAGATABLE_LEVEL) {
    const next = level - LIGHT_DECAY_PER_HOP
    const x = unpackX(packed), y = unpackY(packed), z = unpackZ(packed)
    const sourceVoxel = blockIndex(x, y, z)
    for (const offset of NEIGHBOUR_OFFSETS) {
      const ny = y + offset[Y_OFFSET]
      if (ny >= MIN_CHUNK_COORD && ny < CHUNK_HEIGHT) {
        const nx = x + offset[X_OFFSET], nz = z + offset[Z_OFFSET]
        let target: LightChunk | null = source
        let targetX = nx
        let targetZ = nz
        let targetVoxel = sourceVoxel + offset[Y_OFFSET] * LIGHT_Y_STRIDE + offset[Z_OFFSET] * LIGHT_Z_STRIDE + offset[X_OFFSET] * LIGHT_X_STRIDE
        if (nx < MIN_CHUNK_COORD || nx >= CHUNK_SIZE_XZ || nz < MIN_CHUNK_COORD || nz >= CHUNK_SIZE_XZ) {
          const adjacentIndex = context.chunksByCoord.get(coordKey(source.chunk.coord.cx + axisCrossing(nx, CHUNK_SIZE_XZ), source.chunk.coord.cz + axisCrossing(nz, CHUNK_SIZE_XZ)))
          if (typeof adjacentIndex === 'number') {
            // @ts-expect-error the index comes from the validated chunk table.
            target = context.sourceTable[adjacentIndex]
            targetX = (nx + CHUNK_SIZE_XZ) % CHUNK_SIZE_XZ
            targetZ = (nz + CHUNK_SIZE_XZ) % CHUNK_SIZE_XZ
            targetVoxel = blockIndex(targetX, ny, targetZ)
          } else {
            target = null
          }
        }
        if (target !== null && transmitsLight(getBlockAt(target.chunk, targetX, ny, targetZ))) {
          const grid = context.gridOf(target.light)
          if (getLightAt(grid, targetVoxel) < next) {
            setLightAt(grid, targetVoxel, next)
            const index = context.queue.tail
            context.queue.packed[index] = packPosLevel(targetX, ny, targetZ, next)
            context.queue.source[index] = target.sourceIndex
            context.queue.tail = index + STEP
          }
        }
      }
    }
  }
}

const propagateAcrossChunks = (
  chunks: ReadonlyArray<LightChunk>,
  chunksByCoord: ReadonlyMap<string, number>,
  gridOf: (light: ChunkLight) => Uint8Array,
  seed: (chunk: Chunk, grid: Uint8Array) => Array<number>,
): void => {
  const queue = seedQueues(chunks, gridOf, seed)
  const sourceTable: ReadonlyArray<LightChunk> = chunks
  const context: PropagationContext = { chunksByCoord, gridOf, queue, sourceTable }
  while (queue.head < queue.tail) {
    const index = queue.head
    // Source indices are assigned sequentially while building this validated table.
    // @ts-expect-error noUncheckedIndexedAccess cannot express the validated queue indices.
    popAndRelax(context, sourceTable[queue.source[index]], queue.packed[index])
    queue.head = index + STEP
  }
}

type IndexedChunks<Key extends string> = {
  readonly entries: Array<{ readonly key: Key; readonly chunk: LightChunk }>
  readonly chunksByCoord: Map<string, number>
}

const indexChunks = <Key extends string>(loaded: ReadonlyMap<Key, Chunk>): IndexedChunks<Key> => {
  const entries: Array<{ readonly key: Key; readonly chunk: LightChunk }> = []
  const chunksByCoord = new Map<string, number>()

  let sourceIndex = 0
  for (const [key, chunk] of loaded) {
    const entry: LightChunk = { chunk, light: emptyChunkLight(), sourceIndex }
    entries.push({ chunk: entry, key })
    chunksByCoord.set(coordKey(chunk.coord.cx, chunk.coord.cz), sourceIndex)
    sourceIndex += STEP
  }

  return { chunksByCoord, entries }
}

const collectLights = <Key extends string>(
  entries: ReadonlyArray<{ readonly key: Key; readonly chunk: LightChunk }>,
): ReadonlyMap<Key, ChunkLight> => {
  const result = new Map<Key, ChunkLight>()
  for (const { key, chunk } of entries) {
    result.set(key, chunk.light)
  }
  return result
}

/** Compute mutually consistent sky and block grids for resident chunks. */
export const computeChunkLights = <Key extends string>(loaded: ReadonlyMap<Key, Chunk>): ReadonlyMap<Key, ChunkLight> => {
  const { chunksByCoord, entries } = indexChunks(loaded)

  propagateAcrossChunks(entries.map(({ chunk }) => chunk), chunksByCoord, (light) => light.sky, seedSkyLight)
  propagateAcrossChunks(entries.map(({ chunk }) => chunk), chunksByCoord, (light) => light.block, seedBlockLight)

  return collectLights(entries)
}

/** Single-chunk convenience wrapper with an isolated horizontal boundary. */
export const computeChunkLight = (chunk: Chunk): ChunkLight => {
  const entry: LightChunk = { chunk, light: emptyChunkLight(), sourceIndex: 0 }
  const chunks = [entry]
  const chunksByCoord = new Map([[coordKey(chunk.coord.cx, chunk.coord.cz), MIN_CHUNK_COORD]])
  propagateAcrossChunks(chunks, chunksByCoord, (light) => light.sky, seedSkyLight)
  propagateAcrossChunks(chunks, chunksByCoord, (light) => light.block, seedBlockLight)
  return entry.light
}
