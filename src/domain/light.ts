/**
 * The light grid: how bright every cell of a chunk is, from the sky and from
 * the blocks around it.
 *
 * plan.md §3.7 gives this repository 「ライトグリッド（BFS 光伝播、4bit パック）は
 * チャンクデータの一部としてここが所有。適用（描画）は mc-render」, and
 * `application/chunk-store.ts`'s header leans on that ownership to settle the
 * whole block-write path: 「a block write invalidates light and dirties the saved
 * chunk」. Until this file existed that argument cited a grid nobody had built.
 *
 * The structure is the reference implementation's, catalogued in
 * `docs/public-api.md` §8 and `docs/design-notes.md` DN-7 before any of it was
 * ported. Where this file diverges from that catalogue it says so and says why.
 *
 * ---------------------------------------------------------------------------
 * TWO GRIDS, NOT ONE, AND THEY ARE NOT ADDED TOGETHER HERE
 * ---------------------------------------------------------------------------
 *
 * Sky light and block light are stored separately and reported separately.
 * Collapsing them into one number would be cheaper by half and would break the
 * only rule that reads them: `mx-gameplay/domain/mob/hostile-spawn.ts` gates on
 * BLOCK light alone (`HOSTILE_SPAWN_MAX_BLOCK_LIGHT = 7`), because a hostile
 * that refused to spawn in sunlight would be refusing twice — the daylight gate
 * has already run by then, and at night the sky light IS low. A combined number
 * would make a torch and a sunbeam the same fact, and mc-render needs them apart
 * anyway (a sky-lit cell is tinted by the time of day, a torch-lit one is not).
 *
 * ---------------------------------------------------------------------------
 * 4-BIT PACKING, WHICH IS A MEASUREMENT RATHER THAN A STYLE
 * ---------------------------------------------------------------------------
 *
 * `light.ts:4-7` in the reference: two voxels per byte, `LIGHT_BYTE_LENGTH =
 * (CHUNK_SIZE * CHUNK_SIZE * CHUNK_HEIGHT) / 2`. One byte per voxel would be
 * 64 KB per grid, and there are two grids per chunk — 128 KB of light beside a
 * 64 KB block buffer, so light would be TWICE the size of the world it
 * describes. Packed, it is 32 KB each and 64 KB the pair.
 *
 * `no-bitwise` is `off` in this repository's `.oxlintrc.json`, and this file plus
 * `./seeded-random` are the two reasons recorded there.
 *
 * ---------------------------------------------------------------------------
 * FULL RECOMPUTE AND INCREMENTAL PROPAGATION
 * ---------------------------------------------------------------------------
 *
 * `computeChunkLights` is the from-scratch oracle and the cold-cache path.
 * `updateChunkLights` is the warm-cache path: it starts at changed voxels and
 * repeatedly re-evaluates the local light equation, queueing face neighbours
 * only when a value changes. The same fixed-point queue handles both increases
 * and decreases, so removing a torch or placing a wall retracts stale light as
 * naturally as adding a source spreads it. Horizontal neighbours wrap through
 * resident chunk coordinates, making a seam no different from an interior
 * face.
 *
 * ---------------------------------------------------------------------------
 * PROPAGATION ACROSS A CHUNK BOUNDARY
 * ---------------------------------------------------------------------------
 *
 * `computeChunkLights` seeds every resident chunk before one world BFS. At a
 * horizontal edge it looks up the adjacent resident chunk and continues there;
 * an absent chunk is an opaque boundary. Seeding first makes the result
 * independent of load and iteration order. `computeChunkLight` remains the
 * single-chunk compatibility wrapper and therefore retains the old isolated
 * boundary contract when called directly.
 */
import { getBlockAt, type Chunk } from './chunk'
import { blockIndex, CHUNK_HEIGHT, CHUNK_SIZE_XZ, CHUNK_VOLUME } from './constants'
import {
  clampLightLevel,
  lightEmissionOfBlockId,
  LIGHT_LEVEL_MAX,
  LIGHT_LEVEL_MIN,
  transmitsLight,
  type ChunkCoord,
} from '@nerima-games/mc-kernel'

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

/**
 * Bytes in one packed grid. Two voxels per byte — `light.ts:7`.
 *
 * `CHUNK_VOLUME` is even by construction (16 × 16 × 256), so this is exact and
 * there is no odd final voxel to special-case.
 */
export const LIGHT_BYTE_LENGTH = CHUNK_VOLUME / 2

/**
 * Read one voxel's nibble. `light.ts:93-99`.
 *
 * Even voxels live in the LOW nibble and odd ones in the high nibble. Which way
 * round is arbitrary and it is pinned by a test anyway, because the pairing has
 * to agree with `setLightAt` and nothing else in the world can tell.
 *
 * TOTAL: an index outside the buffer reads as dark rather than as `undefined`.
 * `noUncheckedIndexedAccess` is on, so this is the single place that `number |
 * undefined` is handled — the same discipline `readBlock` applies to blocks.
 * Dark is the right fallback for the same reason `blockAt` does NOT do this for
 * blocks: an unknown light level has an inert reading and an unknown block does
 * not.
 */
export const getLightAt = (grid: Uint8Array, voxel: number): number => {
  const byte = grid[voxel >> 1] ?? 0
  return (voxel & 1) === 0 ? byte & 0x0f : (byte >> 4) & 0x0f
}

/**
 * Write one voxel's nibble, clamped into 0..15. `light.ts:100-108`.
 *
 * The clamp is kernel's `clampLightLevel` rather than a local `Math.min`, so
 * that a level arriving from a save file or a developer console cannot corrupt
 * its NEIGHBOUR — an unclamped 16 would overflow into the adjacent nibble and
 * silently brighten a different cell, which is the class of bug a packed grid
 * exists to invite.
 */
export const setLightAt = (grid: Uint8Array, voxel: number, level: number): void => {
  const index = voxel >> 1
  const clamped = clampLightLevel(level)
  const byte = grid[index] ?? 0

  grid[index] = (voxel & 1) === 0 ? (byte & 0xf0) | clamped : (byte & 0x0f) | (clamped << 4)
}

/**
 * One chunk's two grids.
 *
 * Mutable `Uint8Array`s behind a `readonly` field, exactly as `Chunk.blocks` is
 * and for the same measured reason (`./chunk-store-state`'s header on the one
 * deliberate impurity). Nothing hands one of these out: the store computes a
 * grid, caches it and answers QUESTIONS about it, so the aliasing hazard
 * `chunkSnapshotOf` exists for does not arise here.
 */
export type ChunkLight = {
  readonly sky: Uint8Array
  readonly block: Uint8Array
}

export const emptyChunkLight = (): ChunkLight => ({
  sky: new Uint8Array(LIGHT_BYTE_LENGTH),
  block: new Uint8Array(LIGHT_BYTE_LENGTH),
})

// ---------------------------------------------------------------------------
// The BFS queue
// ---------------------------------------------------------------------------

/**
 * A queue entry packed into one int32. `light-engine-utils.ts:22-26`.
 *
 *     y: bits 0-8 (9 bits, 0..511)   z: 9-12   x: 13-16   level: 17-21
 *
 * An array of numbers rather than an array of `{x, y, z, level}` records,
 * because the queue is the hot allocation: a full-chunk sky pass enqueues on the
 * order of the chunk's open volume, and one object per entry is tens of
 * thousands of short-lived allocations per relight. This is the same class of
 * decision as `./chunk-store-state`'s in-place buffer write and plan.md §5.2
 * sanctions it the same way.
 *
 * Y GETS NINE BITS FOR 256 VALUES, which looks like four wasted ones. It is the
 * reference's layout and it is kept verbatim: `CHUNK_HEIGHT` is a constant this
 * repository expects to raise (vanilla's 1.18 world is 384 tall and starts at
 * -64), and a layout that fits today's height exactly is one that has to be
 * re-derived the day it changes. The bits are free.
 */
export const packPosLevel = (x: number, y: number, z: number, level: number): number =>
  (x << 13) | (z << 9) | y | (level << 17)

export const unpackY = (packed: number): number => packed & 0x1ff
export const unpackZ = (packed: number): number => (packed >> 9) & 0x0f
export const unpackX = (packed: number): number => (packed >> 13) & 0x0f
export const unpackLevel = (packed: number): number => (packed >> 17) & 0x1f

// ---------------------------------------------------------------------------
// Propagation
// ---------------------------------------------------------------------------

/** The six face neighbours, as `[dx, dy, dz]`. Light does not travel diagonally. */
const NEIGHBOUR_OFFSETS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
]

type LightChunk = {
  readonly chunk: Chunk
  readonly light: ChunkLight
}

const coordKey = (cx: number, cz: number): string => `${String(cx)},${String(cz)}`

/**
 * Spread every seeded cell outwards, one level dimmer per step.
 *
 * A SINGLE add-queue BFS, which is correct here precisely because the caller
 * always starts from an empty grid: the two-queue remove-then-add form exists to
 * un-light a neighbourhood when a source disappears, and nothing can disappear
 * from a grid that was allocated three lines ago. See the module header on why
 * the incremental engine is not this cut.
 *
 * The `existing >= next` test is what makes this terminate and what makes it
 * O(cells) rather than O(cells × sources): a cell already at least as bright as
 * the light arriving at it neither improves nor re-enqueues. Without it a room
 * with two torches would re-walk itself once per torch.
 */
/**
 * Sky light: full brightness from the top of the world down to the first block
 * that stops it, then spread sideways under the overhangs.
 *
 * THE COLUMN WALK RUNS BEFORE THE BFS and does not decrement. A cell with open
 * sky above it is at `LIGHT_LEVEL_MAX` however deep the shaft, which is
 * vanilla's rule and the reason a one-block hole in a roof lights the floor
 * beneath it rather than a cell four levels dimmer per storey. Decrementing down
 * the column instead — the obvious reading of "BFS from the top" — would make
 * the sea floor pitch dark at noon and every hostile-spawn rule downstream would
 * read the world as permanently night.
 *
 * `./constants` records that the buffer is Y-MAJOR for exactly this loop:
 * consecutive Y values are adjacent in memory, so a column walk is a linear scan
 * of 256 bytes rather than 256 strided reads.
 */
const seedSkyLight = (chunk: Chunk, grid: Uint8Array): Array<number> => {
  const queue: Array<number> = []

  for (let x = 0; x < CHUNK_SIZE_XZ; x += 1) {
    for (let z = 0; z < CHUNK_SIZE_XZ; z += 1) {
      for (let y = CHUNK_HEIGHT - 1; y >= 0; y -= 1) {
        if (!transmitsLight(getBlockAt(chunk, x, y, z))) {
          // The first thing that stops the sky stops the column. Everything
          // below it is reached — if at all — sideways, by the BFS.
          break
        }

        setLightAt(grid, blockIndex(x, y, z), LIGHT_LEVEL_MAX)
        queue.push(packPosLevel(x, y, z, LIGHT_LEVEL_MAX))
      }
    }
  }

  return queue
}

/**
 * Block light: every emitting cell is a source at its own level.
 *
 * The emitter's OWN cell is written even when the block does not transmit
 * light. Glowstone is `opacity: 'opaque'` in kernel's registry and a torch is
 * not, and both must read as bright AT the source — otherwise `getLight` on the
 * glowstone itself answers 0, which reads as "this is a dark cell" to every
 * consumer, and mc-render would draw an unlit block that is the reason the room
 * is lit. Propagation OUT of the cell is still governed by the neighbour's
 * transmission, so an opaque emitter lights the air around it and not the rock
 * behind it.
 */
const seedBlockLight = (chunk: Chunk, grid: Uint8Array): Array<number> => {
  const queue: Array<number> = []

  for (let x = 0; x < CHUNK_SIZE_XZ; x += 1) {
    for (let z = 0; z < CHUNK_SIZE_XZ; z += 1) {
      for (let y = 0; y < CHUNK_HEIGHT; y += 1) {
        const emission = lightEmissionOfBlockId(getBlockAt(chunk, x, y, z))
        if (emission <= LIGHT_LEVEL_MIN) {
          continue
        }

        setLightAt(grid, blockIndex(x, y, z), emission)
        queue.push(packPosLevel(x, y, z, emission))
      }
    }
  }

  return queue
}

const propagateAcrossChunks = (
  chunks: ReadonlyArray<LightChunk>,
  chunksByCoord: ReadonlyMap<string, number>,
  gridOf: (light: ChunkLight) => Uint8Array,
  seed: (chunk: Chunk, grid: Uint8Array) => Array<number>,
): void => {
  const queueChunks: Array<number> = []
  const queueCells: Array<number> = []

  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
    const entry = chunks[chunkIndex]
    if (entry === undefined) continue

    for (const packed of seed(entry.chunk, gridOf(entry.light))) {
      queueChunks.push(chunkIndex)
      queueCells.push(packed)
    }
  }

  let head = 0
  while (head < queueCells.length) {
    const packed = queueCells[head] ?? 0
    const chunkIndex = queueChunks[head] ?? 0
    head += 1

    const level = unpackLevel(packed)
    if (level <= 1) continue

    const source = chunks[chunkIndex]
    if (source === undefined) continue

    const x = unpackX(packed)
    const y = unpackY(packed)
    const z = unpackZ(packed)
    const next = level - 1

    for (const [dx, dy, dz] of NEIGHBOUR_OFFSETS) {
      let nx = x + dx
      const ny = y + dy
      let nz = z + dz
      if (ny < 0 || ny >= CHUNK_HEIGHT) continue

      let target = source
      let targetIndex = chunkIndex
      if (nx < 0 || nx >= CHUNK_SIZE_XZ || nz < 0 || nz >= CHUNK_SIZE_XZ) {
        const dcx = nx < 0 ? -1 : nx >= CHUNK_SIZE_XZ ? 1 : 0
        const dcz = nz < 0 ? -1 : nz >= CHUNK_SIZE_XZ ? 1 : 0
        const adjacentIndex = chunksByCoord.get(
          coordKey(source.chunk.coord.cx + dcx, source.chunk.coord.cz + dcz),
        )
        if (adjacentIndex === undefined) continue

        const adjacent = chunks[adjacentIndex]
        if (adjacent === undefined) continue
        target = adjacent
        targetIndex = adjacentIndex
        nx = (nx + CHUNK_SIZE_XZ) % CHUNK_SIZE_XZ
        nz = (nz + CHUNK_SIZE_XZ) % CHUNK_SIZE_XZ
      }

      if (!transmitsLight(getBlockAt(target.chunk, nx, ny, nz))) continue

      const grid = gridOf(target.light)
      const voxel = blockIndex(nx, ny, nz)
      if (getLightAt(grid, voxel) >= next) continue

      setLightAt(grid, voxel, next)
      queueChunks.push(targetIndex)
      queueCells.push(packPosLevel(nx, ny, nz, next))
    }
  }
}

/** Compute mutually consistent light grids for a set of resident chunks. */
export const computeChunkLights = <Key extends string>(loaded: ReadonlyMap<Key, Chunk>): ReadonlyMap<Key, ChunkLight> => {
  const keys: Array<Key> = []
  const chunks: Array<LightChunk> = []
  const chunksByCoord = new Map<string, number>()

  for (const [key, chunk] of loaded) {
    keys.push(key)
    chunks.push({ chunk, light: emptyChunkLight() })
    chunksByCoord.set(coordKey(chunk.coord.cx, chunk.coord.cz), chunks.length - 1)
  }

  propagateAcrossChunks(chunks, chunksByCoord, (light) => light.sky, seedSkyLight)
  propagateAcrossChunks(chunks, chunksByCoord, (light) => light.block, seedBlockLight)

  const result = new Map<Key, ChunkLight>()
  for (let index = 0; index < chunks.length; index += 1) {
    const key = keys[index]
    const entry = chunks[index]
    if (key !== undefined && entry !== undefined) result.set(key, entry.light)
  }
  return result
}

/** One block mutation whose cached light neighbourhood must reach a new fixed point. */
export type ChunkLightChange = {
  readonly coord: ChunkCoord
  readonly x: number
  readonly y: number
  readonly z: number
}

type LightChannel = 'sky' | 'block'

/**
 * Incrementally reconcile complete cached grids after one or more block edits.
 *
 * The input grids are treated as immutable: only chunks whose light changes are
 * cloned. An incomplete cache falls back to the full oracle, which keeps this
 * function total and lets callers use one operation across cold and warm state.
 */
export const updateChunkLights = <Key extends string>(
  loaded: ReadonlyMap<Key, Chunk>,
  current: ReadonlyMap<Key, ChunkLight>,
  changes: ReadonlyArray<ChunkLightChange>,
): ReadonlyMap<Key, ChunkLight> => {
  if (loaded.size !== current.size) return computeChunkLights(loaded)

  const keys: Array<Key> = []
  const chunks: Array<Chunk> = []
  const lights: Array<ChunkLight> = []
  const chunksByCoord = new Map<string, number>()

  for (const [key, chunk] of loaded) {
    const light = current.get(key)
    if (light === undefined) return computeChunkLights(loaded)
    keys.push(key)
    chunks.push(chunk)
    lights.push(light)
    chunksByCoord.set(coordKey(chunk.coord.cx, chunk.coord.cz), chunks.length - 1)
  }

  if (changes.length === 0) return current

  const result = new Map(current)
  const cloned = new Set<number>()
  const highestOpaqueByColumn = new Map<number, number>()

  const cloneLight = (chunkIndex: number): ChunkLight | undefined => {
    const existing = lights[chunkIndex]
    const key = keys[chunkIndex]
    if (existing === undefined || key === undefined) return undefined
    if (cloned.has(chunkIndex)) return existing

    const copy = { sky: existing.sky.slice(), block: existing.block.slice() }
    lights[chunkIndex] = copy
    result.set(key, copy)
    cloned.add(chunkIndex)
    return copy
  }

  const neighbourOf = (
    chunkIndex: number,
    x: number,
    y: number,
    z: number,
    dx: number,
    dy: number,
    dz: number,
  ): readonly [number, number, number, number] | undefined => {
    const source = chunks[chunkIndex]
    if (source === undefined) return undefined

    let nx = x + dx
    const ny = y + dy
    let nz = z + dz
    if (ny < 0 || ny >= CHUNK_HEIGHT) return undefined
    if (nx >= 0 && nx < CHUNK_SIZE_XZ && nz >= 0 && nz < CHUNK_SIZE_XZ) {
      return [chunkIndex, nx, ny, nz]
    }

    const dcx = nx < 0 ? -1 : nx >= CHUNK_SIZE_XZ ? 1 : 0
    const dcz = nz < 0 ? -1 : nz >= CHUNK_SIZE_XZ ? 1 : 0
    const adjacentIndex = chunksByCoord.get(coordKey(source.coord.cx + dcx, source.coord.cz + dcz))
    if (adjacentIndex === undefined) return undefined
    nx = (nx + CHUNK_SIZE_XZ) % CHUNK_SIZE_XZ
    nz = (nz + CHUNK_SIZE_XZ) % CHUNK_SIZE_XZ
    return [adjacentIndex, nx, ny, nz]
  }

  const isDirectSky = (chunkIndex: number, x: number, y: number, z: number): boolean => {
    const column = chunkIndex * CHUNK_SIZE_XZ * CHUNK_SIZE_XZ + x * CHUNK_SIZE_XZ + z
    let highestOpaque = highestOpaqueByColumn.get(column)
    if (highestOpaque === undefined) {
      highestOpaque = -1
      const chunk = chunks[chunkIndex]
      if (chunk === undefined) return false
      for (let scanY = CHUNK_HEIGHT - 1; scanY >= 0; scanY -= 1) {
        if (!transmitsLight(getBlockAt(chunk, x, scanY, z))) {
          highestOpaque = scanY
          break
        }
      }
      highestOpaqueByColumn.set(column, highestOpaque)
    }
    return y > highestOpaque
  }

  const runChannel = (channel: LightChannel): void => {
    const queue: Array<number> = []
    const pending = new Set<number>()
    const enqueue = (chunkIndex: number, x: number, y: number, z: number): void => {
      const id = chunkIndex * CHUNK_VOLUME + blockIndex(x, y, z)
      if (pending.has(id)) return
      pending.add(id)
      queue.push(id)
    }

    for (const change of changes) {
      const chunkIndex = chunksByCoord.get(coordKey(change.coord.cx, change.coord.cz))
      if (
        chunkIndex === undefined ||
        !Number.isInteger(change.x) ||
        change.x < 0 ||
        change.x >= CHUNK_SIZE_XZ ||
        !Number.isInteger(change.z) ||
        change.z < 0 ||
        change.z >= CHUNK_SIZE_XZ ||
        !Number.isInteger(change.y) ||
        change.y < 0 ||
        change.y >= CHUNK_HEIGHT
      ) {
        continue
      }
      enqueue(chunkIndex, change.x, change.y, change.z)
      for (const [dx, dy, dz] of NEIGHBOUR_OFFSETS) {
        const neighbour = neighbourOf(chunkIndex, change.x, change.y, change.z, dx, dy, dz)
        if (neighbour !== undefined) enqueue(...neighbour)
      }
    }

    let head = 0
    while (head < queue.length) {
      const id = queue[head] ?? 0
      head += 1
      pending.delete(id)

      const chunkIndex = Math.floor(id / CHUNK_VOLUME)
      const voxel = id % CHUNK_VOLUME
      const y = voxel % CHUNK_HEIGHT
      const column = Math.floor(voxel / CHUNK_HEIGHT)
      const z = column % CHUNK_SIZE_XZ
      const x = Math.floor(column / CHUNK_SIZE_XZ)
      const chunk = chunks[chunkIndex]
      const light = lights[chunkIndex]
      if (chunk === undefined || light === undefined) continue

      const block = getBlockAt(chunk, x, y, z)
      let next = LIGHT_LEVEL_MIN
      if (channel === 'block') next = lightEmissionOfBlockId(block)
      if (transmitsLight(block)) {
        if (channel === 'sky' && isDirectSky(chunkIndex, x, y, z)) {
          next = LIGHT_LEVEL_MAX
        } else {
          for (const [dx, dy, dz] of NEIGHBOUR_OFFSETS) {
            const neighbour = neighbourOf(chunkIndex, x, y, z, dx, dy, dz)
            if (neighbour === undefined) continue
            const [nearChunkIndex, nx, ny, nz] = neighbour
            const nearLight = lights[nearChunkIndex]
            if (nearLight === undefined) continue
            next = Math.max(next, getLightAt(nearLight[channel], blockIndex(nx, ny, nz)) - 1)
          }
        }
      }

      const existing = getLightAt(light[channel], voxel)
      if (existing === next) continue
      const writable = cloneLight(chunkIndex)
      if (writable === undefined) continue
      setLightAt(writable[channel], voxel, next)

      for (const [dx, dy, dz] of NEIGHBOUR_OFFSETS) {
        const neighbour = neighbourOf(chunkIndex, x, y, z, dx, dy, dz)
        if (neighbour !== undefined) enqueue(...neighbour)
      }
    }
  }

  runChannel('sky')
  runChannel('block')
  return cloned.size === 0 ? current : result
}

/**
 * Light one whole chunk, from scratch.
 *
 * PURE in the sense this repository means it: it reads a chunk and returns a new
 * pair of grids, touching neither the chunk nor anything the caller holds. That
 * is what lets the store call it inside a `Ref.modify` without the TOCTOU
 * hazard plan.md §3.8 lists — see `./chunk-store-state`.
 *
 * Cost is O(CHUNK_VOLUME) block reads for the two seeding passes plus O(lit
 * volume) BFS steps, so an open surface chunk is the expensive case (most of its
 * volume is sky-lit) and a solid one is nearly free.
 */
export const computeChunkLight = (chunk: Chunk): ChunkLight => {
  const key = coordKey(chunk.coord.cx, chunk.coord.cz)
  return computeChunkLights(new Map([[key, chunk]])).get(key) ?? emptyChunkLight()
}
