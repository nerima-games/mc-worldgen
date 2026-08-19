import { CHUNK_HEIGHT, CHUNK_SIZE_XZ, CHUNK_VOLUME, blockIndex } from './constants'
import { type Chunk, getBlockAt } from './chunk'
import {
  type ChunkCoord,
  LIGHT_LEVEL_MAX,
  LIGHT_LEVEL_MIN,
  lightEmissionOfBlockId,
  transmitsLight,
} from '@nerima-games/mc-kernel'
import { type ChunkLight, getLightAt, setLightAt } from './light-grid'
import {
  LIGHT_DECAY_PER_HOP,
  MIN_CHUNK_COORD,
  NEIGHBOUR_OFFSETS,
  STEP,
  axisCrossing,
  coordKey,
} from './light-common'
import { computeChunkLights } from './light-propagation'

/** One block mutation whose cached light neighbourhood must reach a new fixed point. */
export type ChunkLightChange = {
  readonly coord: ChunkCoord
  readonly x: number
  readonly y: number
  readonly z: number
}

type LightChannel = 'sky' | 'block'

type VoxelRef = {
  readonly chunkIndex: number
  readonly x: number
  readonly y: number
  readonly z: number
}

const voxelId = (voxel: VoxelRef): number => voxel.chunkIndex * CHUNK_VOLUME + blockIndex(voxel.x, voxel.y, voxel.z)

const voxelOfId = (id: number): VoxelRef => {
  const chunkIndex = Math.floor(id / CHUNK_VOLUME)
  const withinChunk = id % CHUNK_VOLUME
  const y = withinChunk % CHUNK_HEIGHT
  const column = Math.floor(withinChunk / CHUNK_HEIGHT)
  const z = column % CHUNK_SIZE_XZ
  const x = Math.floor(column / CHUNK_SIZE_XZ)
  return { chunkIndex, x, y, z }
}

type UpdateContext<Key extends string> = {
  readonly chunks: ReadonlyArray<Chunk>
  readonly chunksByCoord: ReadonlyMap<string, number>
  readonly cloned: Set<number>
  readonly highestOpaqueByColumn: Map<number, number>
  readonly keys: ReadonlyArray<Key>
  readonly lights: Array<ChunkLight>
  readonly result: Map<Key, ChunkLight>
}

type ChunkIndexBuilder<Key extends string> = {
  readonly keys: Array<Key>
  readonly chunks: Array<Chunk>
  readonly lights: Array<ChunkLight>
  readonly chunksByCoord: Map<string, number>
}

/** Append one cached chunk, returning false when the cache is incomplete. */
const registerCurrentChunk = <Key extends string>(
  builder: ChunkIndexBuilder<Key>,
  current: ReadonlyMap<Key, ChunkLight>,
  key: Key,
  chunk: Chunk,
): boolean => {
  const light = current.get(key) ?? null
  if (light === null) {
    return false
  }
  builder.keys.push(key)
  builder.chunks.push(chunk)
  builder.lights.push(light)
  builder.chunksByCoord.set(coordKey(chunk.coord.cx, chunk.coord.cz), builder.chunks.length - STEP)
  return true
}

/** Re-index loaded chunks against the current cache. */
const buildUpdateContext = <Key extends string>(
  loaded: ReadonlyMap<Key, Chunk>,
  current: ReadonlyMap<Key, ChunkLight>,
): UpdateContext<Key> | null => {
  const builder: ChunkIndexBuilder<Key> = {
    chunks: [],
    chunksByCoord: new Map<string, number>(),
    keys: [],
    lights: [],
  }

  for (const [key, chunk] of loaded) {
    if (!registerCurrentChunk(builder, current, key, chunk)) {
      return null
    }
  }

  return {
    chunks: builder.chunks,
    chunksByCoord: builder.chunksByCoord,
    cloned: new Set<number>(),
    highestOpaqueByColumn: new Map<number, number>(),
    keys: builder.keys,
    lights: builder.lights,
    result: new Map(current),
  }
}

const commitClonedLight = <Key extends string>(
  context: UpdateContext<Key>,
  chunkIndex: number,
  key: Key,
  existing: ChunkLight,
): ChunkLight => {
  const copy = { block: existing.block.slice(), sky: existing.sky.slice() }
  context.lights[chunkIndex] = copy
  context.result.set(key, copy)
  context.cloned.add(chunkIndex)
  return copy
}

/** Copy a cached chunk on its first write; untouched chunks remain shared. */
const cloneLight = <Key extends string>(context: UpdateContext<Key>, chunkIndex: number): ChunkLight => {
  const existing = context.lights[chunkIndex]!
  const key = context.keys[chunkIndex]!
  if (context.cloned.has(chunkIndex)) {
    return existing
  }

  return commitClonedLight(context, chunkIndex, key, existing)
}

const crossChunkNeighbourId = <Key extends string>(
  context: UpdateContext<Key>,
  voxel: VoxelRef,
  neighbour: readonly [number, number, number],
): number | null => {
  const source = context.chunks[voxel.chunkIndex]!
  const [nx, ny, nz] = neighbour
  const adjacentIndex =
    context.chunksByCoord.get(
      coordKey(source.coord.cx + axisCrossing(nx, CHUNK_SIZE_XZ), source.coord.cz + axisCrossing(nz, CHUNK_SIZE_XZ)),
    ) ?? null
  if (adjacentIndex === null) {
    return null
  }
  return adjacentIndex * CHUNK_VOLUME + blockIndex((nx + CHUNK_SIZE_XZ) % CHUNK_SIZE_XZ, ny, (nz + CHUNK_SIZE_XZ) % CHUNK_SIZE_XZ)
}

/** Return a face-neighbour id, or null at the vertical/world boundary. */
const neighbourIdOf = <Key extends string>(
  context: UpdateContext<Key>,
  voxel: VoxelRef,
  offset: readonly [number, number, number],
): number | null => {
  const [dx, dy, dz] = offset
  const ny = voxel.y + dy
  if (ny < MIN_CHUNK_COORD || ny >= CHUNK_HEIGHT) {
    return null
  }

  const nx = voxel.x + dx
  const nz = voxel.z + dz
  if (nx >= MIN_CHUNK_COORD && nx < CHUNK_SIZE_XZ && nz >= MIN_CHUNK_COORD && nz < CHUNK_SIZE_XZ) {
    return voxel.chunkIndex * CHUNK_VOLUME + blockIndex(nx, ny, nz)
  }

  return crossChunkNeighbourId(context, voxel, [nx, ny, nz])
}

const NO_OPAQUE_BLOCK_FOUND = -1

const scanHighestOpaque = (chunk: Chunk, x: number, z: number): number => {
  for (let scanY = CHUNK_HEIGHT - STEP; scanY >= MIN_CHUNK_COORD; scanY -= STEP) {
    if (!transmitsLight(getBlockAt(chunk, x, scanY, z))) {
      return scanY
    }
  }
  return NO_OPAQUE_BLOCK_FOUND
}

/** Whether a voxel has direct sky access, with each column scan cached. */
const isDirectSky = <Key extends string>(context: UpdateContext<Key>, voxel: VoxelRef): boolean => {
  const column = voxel.chunkIndex * CHUNK_SIZE_XZ * CHUNK_SIZE_XZ + voxel.x * CHUNK_SIZE_XZ + voxel.z
  const cached = context.highestOpaqueByColumn.get(column) ?? null
  if (cached !== null) {
    return voxel.y > cached
  }

  const chunk = context.chunks[voxel.chunkIndex]!
  const highestOpaque = scanHighestOpaque(chunk, voxel.x, voxel.z)
  context.highestOpaqueByColumn.set(column, highestOpaque)
  return voxel.y > highestOpaque
}

type IdQueue = {
  readonly items: Array<number>
  readonly pending: Set<number>
}

const enqueueId = (queue: IdQueue, id: number): void => {
  if (!queue.pending.has(id)) {
    queue.pending.add(id)
    queue.items.push(id)
  }
}

const enqueueNeighbours = <Key extends string>(context: UpdateContext<Key>, queue: IdQueue, voxel: VoxelRef): void => {
  for (const offset of NEIGHBOUR_OFFSETS) {
    const neighbourId = neighbourIdOf(context, voxel, offset)
    if (neighbourId !== null) {
      enqueueId(queue, neighbourId)
    }
  }
}

const isValidChangeCoordinate = (value: number, size: number): boolean =>
  Number.isInteger(value) && value >= MIN_CHUNK_COORD && value < size

const resolveChangeVoxel = <Key extends string>(
  context: UpdateContext<Key>,
  change: ChunkLightChange,
): VoxelRef | null => {
  const chunkIndex = context.chunksByCoord.get(coordKey(change.coord.cx, change.coord.cz)) ?? null
  if (
    chunkIndex === null ||
    !isValidChangeCoordinate(change.x, CHUNK_SIZE_XZ) ||
    !isValidChangeCoordinate(change.z, CHUNK_SIZE_XZ) ||
    !isValidChangeCoordinate(change.y, CHUNK_HEIGHT)
  ) {
    return null
  }
  return { chunkIndex, x: change.x, y: change.y, z: change.z }
}

const seedChangeQueue = <Key extends string>(
  context: UpdateContext<Key>,
  changes: ReadonlyArray<ChunkLightChange>,
): IdQueue => {
  const queue: IdQueue = { items: [], pending: new Set<number>() }
  for (const change of changes) {
    const voxel = resolveChangeVoxel(context, change)
    if (voxel !== null) {
      enqueueId(queue, voxelId(voxel))
      enqueueNeighbours(context, queue, voxel)
    }
  }
  return queue
}

const brightestNeighbourLevel = <Key extends string>(
  context: UpdateContext<Key>,
  channel: LightChannel,
  voxel: VoxelRef,
  floor: number,
): number => {
  let next = floor
  for (const offset of NEIGHBOUR_OFFSETS) {
    const neighbourId = neighbourIdOf(context, voxel, offset)
    if (neighbourId !== null) {
      const near = voxelOfId(neighbourId)
      const nearLight = context.lights[near.chunkIndex]!
      next = Math.max(next, getLightAt(nearLight[channel], neighbourId % CHUNK_VOLUME) - LIGHT_DECAY_PER_HOP)
    }
  }
  return next
}

const nextLightLevel = <Key extends string>(
  context: UpdateContext<Key>,
  channel: LightChannel,
  voxel: VoxelRef,
  chunk: Chunk,
): number => {
  const block = getBlockAt(chunk, voxel.x, voxel.y, voxel.z)
  let next = LIGHT_LEVEL_MIN
  if (channel === 'block') {
    next = lightEmissionOfBlockId(block)
  }
  if (!transmitsLight(block)) {
    return next
  }
  if (channel === 'sky' && isDirectSky(context, voxel)) {
    return LIGHT_LEVEL_MAX
  }
  return brightestNeighbourLevel(context, channel, voxel, next)
}

type RelaxationSource = {
  readonly chunk: Chunk
  readonly light: ChunkLight
}

const relaxationSourceOf = <Key extends string>(context: UpdateContext<Key>, voxel: VoxelRef): RelaxationSource => {
  const chunk = context.chunks[voxel.chunkIndex]!
  const light = context.lights[voxel.chunkIndex]!
  return { chunk, light }
}

type ChannelRun<Key extends string> = {
  readonly channel: LightChannel
  readonly context: UpdateContext<Key>
  readonly queue: IdQueue
}

const writeRelaxedVoxel = <Key extends string>(run: ChannelRun<Key>, voxel: VoxelRef, id: number, next: number): void => {
  const writable = cloneLight(run.context, voxel.chunkIndex)
  setLightAt(writable[run.channel], id % CHUNK_VOLUME, next)
  enqueueNeighbours(run.context, run.queue, voxel)
}

const relaxVoxel = <Key extends string>(run: ChannelRun<Key>, id: number): void => {
  const voxel = voxelOfId(id)
  const source = relaxationSourceOf(run.context, voxel)

  const next = nextLightLevel(run.context, run.channel, voxel, source.chunk)
  const existing = getLightAt(source.light[run.channel], id % CHUNK_VOLUME)
  if (existing === next) {
    return
  }
  writeRelaxedVoxel(run, voxel, id, next)
}

const runChannel = <Key extends string>(
  context: UpdateContext<Key>,
  changes: ReadonlyArray<ChunkLightChange>,
  channel: LightChannel,
): void => {
  const run: ChannelRun<Key> = { channel, context, queue: seedChangeQueue(context, changes) }

  let head = MIN_CHUNK_COORD
  while (head < run.queue.items.length) {
    const id = run.queue.items[head]!
    head += STEP
    run.queue.pending.delete(id)
    relaxVoxel(run, id)
  }
}

const resolvedUpdateContext = <Key extends string>(
  loaded: ReadonlyMap<Key, Chunk>,
  current: ReadonlyMap<Key, ChunkLight>,
): UpdateContext<Key> | null => {
  if (loaded.size !== current.size) {
    return null
  }
  return buildUpdateContext(loaded, current)
}

const finalizeUpdate = <Key extends string>(
  context: UpdateContext<Key>,
  current: ReadonlyMap<Key, ChunkLight>,
): ReadonlyMap<Key, ChunkLight> => {
  if (context.cloned.size === MIN_CHUNK_COORD) {
    return current
  }
  return context.result
}

/** Incrementally reconcile complete cached grids after block edits. */
export const updateChunkLights = <Key extends string>(
  loaded: ReadonlyMap<Key, Chunk>,
  current: ReadonlyMap<Key, ChunkLight>,
  changes: ReadonlyArray<ChunkLightChange>,
): ReadonlyMap<Key, ChunkLight> => {
  const context = resolvedUpdateContext(loaded, current)
  if (context === null) {
    return computeChunkLights(loaded)
  }
  if (changes.length === MIN_CHUNK_COORD) {
    return current
  }

  runChannel(context, changes, 'sky')
  runChannel(context, changes, 'block')
  return finalizeUpdate(context, current)
}
