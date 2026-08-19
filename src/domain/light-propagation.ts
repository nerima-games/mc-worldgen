import { CHUNK_HEIGHT, CHUNK_SIZE_XZ, blockIndex } from './constants'
import { type Chunk, getBlockAt } from './chunk'
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
} from './light-grid'
import {
  LIGHT_DECAY_PER_HOP,
  MIN_CHUNK_COORD,
  NEIGHBOUR_OFFSETS,
  STEP,
  axisCrossing,
  coordKey,
} from './light-common'
import { LIGHT_LEVEL_MAX, LIGHT_LEVEL_MIN, lightEmissionOfBlockId, transmitsLight } from '@nerima-games/mc-kernel'

type LightChunk = {
  readonly chunk: Chunk
  readonly light: ChunkLight
}

type PropagationContext = {
  readonly chunks: ReadonlyArray<LightChunk>
  readonly chunksByCoord: ReadonlyMap<string, number>
  readonly gridOf: (light: ChunkLight) => Uint8Array
  readonly queueChunks: Array<number>
  readonly queueCells: Array<number>
}

type FrontierCell = {
  readonly source: LightChunk
  readonly sourceIndex: number
  readonly x: number
  readonly y: number
  readonly z: number
  readonly next: number
}

type NeighbourLocation = {
  readonly target: LightChunk
  readonly targetIndex: number
  readonly nx: number
  readonly ny: number
  readonly nz: number
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
  const [nx, ny, nz] = neighbour
  const sourceCoord = source.chunk.coord
  const adjacentIndex =
    context.chunksByCoord.get(
      coordKey(sourceCoord.cx + axisCrossing(nx, CHUNK_SIZE_XZ), sourceCoord.cz + axisCrossing(nz, CHUNK_SIZE_XZ)),
    ) ?? null
  if (adjacentIndex === null) {
    return null
  }

  const adjacent = context.chunks[adjacentIndex]!
  return {
    nx: (nx + CHUNK_SIZE_XZ) % CHUNK_SIZE_XZ,
    ny,
    nz: (nz + CHUNK_SIZE_XZ) % CHUNK_SIZE_XZ,
    target: adjacent,
    targetIndex: adjacentIndex,
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
    return { nx, ny, nz, target: cell.source, targetIndex: cell.sourceIndex }
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
  context.queueChunks.push(neighbour.targetIndex)
  context.queueCells.push(packPosLevel(neighbour.nx, neighbour.ny, neighbour.nz, next))
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
): { readonly queueChunks: Array<number>; readonly queueCells: Array<number> } => {
  const queueChunks: Array<number> = []
  const queueCells: Array<number> = []

  for (let chunkIndex = MIN_CHUNK_COORD; chunkIndex < chunks.length; chunkIndex += STEP) {
    const entry = chunks[chunkIndex]!
    for (const packed of seed(entry.chunk, gridOf(entry.light))) {
      queueChunks.push(chunkIndex)
      queueCells.push(packed)
    }
  }

  return { queueCells, queueChunks }
}

/** Stop queue expansion once a hop cannot produce a positive light level. */
const activeFrontierSource = (context: PropagationContext, chunkIndex: number, level: number): LightChunk | null => {
  if (level <= LOWEST_PROPAGATABLE_LEVEL) {
    return null
  }
  return context.chunks[chunkIndex]!
}

const popAndRelax = (context: PropagationContext, head: number): void => {
  const packed = context.queueCells[head]!
  const chunkIndex = context.queueChunks[head]!
  const level = unpackLevel(packed)
  const source = activeFrontierSource(context, chunkIndex, level)
  if (source === null) {
    return
  }

  const cell: FrontierCell = {
    next: level - LIGHT_DECAY_PER_HOP,
    source,
    sourceIndex: chunkIndex,
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
  chunksByCoord: ReadonlyMap<string, number>,
  gridOf: (light: ChunkLight) => Uint8Array,
  seed: (chunk: Chunk, grid: Uint8Array) => Array<number>,
): void => {
  const { queueChunks, queueCells } = seedQueues(chunks, gridOf, seed)
  const context: PropagationContext = { chunks, chunksByCoord, gridOf, queueCells, queueChunks }

  let head = MIN_CHUNK_COORD
  while (head < queueCells.length) {
    popAndRelax(context, head)
    head += STEP
  }
}

type IndexedChunks<Key extends string> = {
  readonly keys: Array<Key>
  readonly chunks: Array<LightChunk>
  readonly chunksByCoord: Map<string, number>
}

const indexChunks = <Key extends string>(loaded: ReadonlyMap<Key, Chunk>): IndexedChunks<Key> => {
  const keys: Array<Key> = []
  const chunks: Array<LightChunk> = []
  const chunksByCoord = new Map<string, number>()

  for (const [key, chunk] of loaded) {
    keys.push(key)
    chunks.push({ chunk, light: emptyChunkLight() })
    chunksByCoord.set(coordKey(chunk.coord.cx, chunk.coord.cz), chunks.length - STEP)
  }

  return { chunks, chunksByCoord, keys }
}

const collectLights = <Key extends string>(
  keys: ReadonlyArray<Key>,
  chunks: ReadonlyArray<LightChunk>,
): ReadonlyMap<Key, ChunkLight> => {
  const result = new Map<Key, ChunkLight>()
  for (let index = MIN_CHUNK_COORD; index < chunks.length; index += STEP) {
    const key = keys[index]!
    const entry = chunks[index]!
    result.set(key, entry.light)
  }
  return result
}

/** Compute mutually consistent sky and block grids for resident chunks. */
export const computeChunkLights = <Key extends string>(loaded: ReadonlyMap<Key, Chunk>): ReadonlyMap<Key, ChunkLight> => {
  const { chunks, chunksByCoord, keys } = indexChunks(loaded)

  propagateAcrossChunks(chunks, chunksByCoord, (light) => light.sky, seedSkyLight)
  propagateAcrossChunks(chunks, chunksByCoord, (light) => light.block, seedBlockLight)

  return collectLights(keys, chunks)
}

/** Single-chunk convenience wrapper with an isolated horizontal boundary. */
export const computeChunkLight = (chunk: Chunk): ChunkLight => {
  const key = coordKey(chunk.coord.cx, chunk.coord.cz)
  return computeChunkLights(new Map([[key, chunk]])).get(key)!
}
