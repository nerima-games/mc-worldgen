import { CHUNK_HEIGHT, CHUNK_SIZE_XZ, CHUNK_VOLUME, blockIndex } from './constants.js'
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
  readonly packed: Int32Array
  readonly source: Uint8Array
  readonly packedView: DataView
  readonly sourceView: DataView
  head: number
  tail: number
}

type PropagationContext = {
  readonly chunksByCoord: ReadonlyMap<string, LightChunk>
  readonly gridOf: (light: ChunkLight) => Uint8Array
  readonly queue: LightQueue
  readonly sourceTable: Record<number, LightChunk>
}

type FrontierCell = {
  readonly source: LightChunk
  readonly x: number
  readonly y: number
  readonly z: number
  readonly next: number
}

type NeighbourLocation = {
  readonly target: LightChunk
  readonly nx: number
  readonly ny: number
  readonly nz: number
}

const QUEUE_CAPACITY_PER_CELL = LIGHT_LEVEL_MAX

const createQueue = (chunkCount: number): LightQueue => {
  const capacity = CHUNK_VOLUME * chunkCount * QUEUE_CAPACITY_PER_CELL
  const packed = new Int32Array(capacity)
  const source = new Uint8Array(capacity)
  return {
    head: 0,
    packed,
    packedView: new DataView(packed.buffer),
    source,
    sourceView: new DataView(source.buffer),
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

/** Resolve a neighbour that crosses into a resident horizontal chunk. */
const resolveCrossChunkNeighbour = (
  context: PropagationContext,
  source: LightChunk,
  neighbour: readonly [number, number, number],
): NeighbourLocation | null => {
  const [xOffset, yOffset, zOffset] = neighbour
  const sourceCoord = source.chunk.coord
  const adjacent = context.chunksByCoord.get(
    coordKey(sourceCoord.cx + axisCrossing(xOffset, CHUNK_SIZE_XZ), sourceCoord.cz + axisCrossing(zOffset, CHUNK_SIZE_XZ)),
  )
  if (!adjacent) {
    return null
  }
  return {
    nx: (xOffset + CHUNK_SIZE_XZ) % CHUNK_SIZE_XZ,
    ny: yOffset,
    nz: (zOffset + CHUNK_SIZE_XZ) % CHUNK_SIZE_XZ,
    target: adjacent,
  }
}

/** Resolve one face-neighbour, treating absent chunks as opaque boundaries. */
const resolveNeighbour = (
  context: PropagationContext,
  cell: FrontierCell,
  offset: readonly [number, number, number],
): NeighbourLocation | null => {
  const [dx, dy, dz] = offset
  const ny = cell.y + dy
  if (ny < MIN_CHUNK_COORD || ny >= CHUNK_HEIGHT) {
    return null
  }

  const nx = cell.x + dx
  const nz = cell.z + dz
  if (nx >= MIN_CHUNK_COORD && nx < CHUNK_SIZE_XZ && nz >= MIN_CHUNK_COORD && nz < CHUNK_SIZE_XZ) {
    return { nx, ny, nz, target: cell.source }
  }

  return resolveCrossChunkNeighbour(context, cell.source, [nx, ny, nz])
}

/** Write and enqueue an improved neighbour level. */
const applyRelaxation = (context: PropagationContext, neighbour: NeighbourLocation, next: number): void => {
  const grid = context.gridOf(neighbour.target.light)
  const voxel = blockIndex(neighbour.nx, neighbour.ny, neighbour.nz)
  if (getLightAt(grid, voxel) >= next) {
    return
  }

  setLightAt(grid, voxel, next)
  const index = context.queue.tail
  context.queue.packed[index] = packPosLevel(neighbour.nx, neighbour.ny, neighbour.nz, next)
  context.queue.source[index] = neighbour.target.sourceIndex
  context.queue.tail = index + STEP
}

/** Relax one face-neighbour if its block transmits light. */
const relaxNeighbour = (
  context: PropagationContext,
  cell: FrontierCell,
  offset: readonly [number, number, number],
): void => {
  const neighbour = resolveNeighbour(context, cell, offset)
  if (neighbour === null) {
    return
  }
  if (!transmitsLight(getBlockAt(neighbour.target.chunk, neighbour.nx, neighbour.ny, neighbour.nz))) {
    return
  }
  applyRelaxation(context, neighbour, cell.next)
}

const seedQueues = (
  chunks: ReadonlyArray<LightChunk>,
  gridOf: (light: ChunkLight) => Uint8Array,
  seed: (chunk: Chunk, grid: Uint8Array) => Array<number>,
): LightQueue => {
  const queue = createQueue(chunks.length)

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

/** Stop queue expansion once a hop cannot produce a positive light level. */
const activeFrontierSource = (source: LightChunk, level: number): LightChunk | null => {
  if (level <= LOWEST_PROPAGATABLE_LEVEL) {
    return null
  }
  return source
}

const popAndRelax = (context: PropagationContext, source: LightChunk, packed: number): void => {
  const level = unpackLevel(packed)
  if (activeFrontierSource(source, level) === null) {
    return
  }

  const cell: FrontierCell = {
    next: level - LIGHT_DECAY_PER_HOP,
    source,
    x: unpackX(packed),
    y: unpackY(packed),
    z: unpackZ(packed),
  }
  for (const offset of NEIGHBOUR_OFFSETS) {
    relaxNeighbour(context, cell, offset)
  }
}

const propagateAcrossChunks = (
  chunks: ReadonlyArray<LightChunk>,
  chunksByCoord: ReadonlyMap<string, LightChunk>,
  gridOf: (light: ChunkLight) => Uint8Array,
  seed: (chunk: Chunk, grid: Uint8Array) => Array<number>,
): void => {
  const queue = seedQueues(chunks, gridOf, seed)
  const sourceTable: Record<number, LightChunk> = Object.fromEntries(chunks.map((source) => [source.sourceIndex, source]))
  const context: PropagationContext = { chunksByCoord, gridOf, queue, sourceTable }
  while (queue.head < queue.tail) {
    const index = queue.head
    popAndRelax(context, Reflect.get(sourceTable, queue.sourceView.getUint8(index)), queue.packedView.getInt32(index * Int32Array.BYTES_PER_ELEMENT, true))
    queue.head = index + STEP
  }
}

type IndexedChunks<Key extends string> = {
  readonly entries: Array<{ readonly key: Key; readonly chunk: LightChunk }>
  readonly chunksByCoord: Map<string, LightChunk>
}

const indexChunks = <Key extends string>(loaded: ReadonlyMap<Key, Chunk>): IndexedChunks<Key> => {
  const entries: Array<{ readonly key: Key; readonly chunk: LightChunk }> = []
  const chunksByCoord = new Map<string, LightChunk>()

  let sourceIndex = 0
  for (const [key, chunk] of loaded) {
    const entry: LightChunk = { chunk, light: emptyChunkLight(), sourceIndex }
    entries.push({ chunk: entry, key })
    chunksByCoord.set(coordKey(chunk.coord.cx, chunk.coord.cz), entry)
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
  const chunksByCoord = new Map([[coordKey(chunk.coord.cx, chunk.coord.cz), entry]])
  propagateAcrossChunks(chunks, chunksByCoord, (light) => light.sky, seedSkyLight)
  propagateAcrossChunks(chunks, chunksByCoord, (light) => light.block, seedBlockLight)
  return entry.light
}
