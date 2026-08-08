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
import { CHUNK_HEIGHT, CHUNK_SIZE_XZ, CHUNK_VOLUME, blockIndex } from './constants'
import { type Chunk, getBlockAt } from './chunk'
import {
  type ChunkCoord,
  LIGHT_LEVEL_MAX,
  LIGHT_LEVEL_MIN,
  clampLightLevel,
  lightEmissionOfBlockId,
  transmitsLight,
} from '@nerima-games/mc-kernel'

// ---------------------------------------------------------------------------
// Shared numeric constants
// ---------------------------------------------------------------------------
/**
 * Grouped here, by the code that uses them, rather than left inline, because
 * oxlint's `no-magic-numbers` treats every bare literal below as unreadable
 * without a name — including the loop increments and bit-layout numbers the
 * module header above already explains in prose.
 */

/** The loop increment shared by every counted loop in this file. */
const STEP = 1

/** The minimum valid coordinate on any axis inside a chunk, and every counted loop's start. */
const MIN_CHUNK_COORD = 0

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

/**
 * Bytes in one packed grid. Two voxels per byte — `light.ts:7`.
 *
 * `CHUNK_VOLUME` is even by construction (16 × 16 × 256), so this is exact and
 * there is no odd final voxel to special-case.
 */
/** Two voxels share one packed light byte, low nibble first (`getLightAt`/`setLightAt`). */
const VOXELS_PER_BYTE = 2
/** `voxel >> BYTE_TO_VOXEL_SHIFT` is `voxel / VOXELS_PER_BYTE`. */
const BYTE_TO_VOXEL_SHIFT = 1
/** `voxel & PARITY_MASK` isolates whether a voxel is the even or odd one of its byte. */
const PARITY_MASK = 1
/** The `PARITY_MASK` result for an even voxel, which lives in the low nibble. */
const EVEN_VOXEL_REMAINDER = 0
const NIBBLE_MASK = 0x0f
const HIGH_NIBBLE_MASK = 0xf0
/** Width of one nibble, in bits — how far the high nibble is shifted to reach it. */
const NIBBLE_BITS = 4
/** The byte a never-written grid position reads as. */
const EMPTY_BYTE = 0

export const LIGHT_BYTE_LENGTH = CHUNK_VOLUME / VOXELS_PER_BYTE

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
  const byte = grid[voxel >> BYTE_TO_VOXEL_SHIFT] ?? EMPTY_BYTE
  if ((voxel & PARITY_MASK) === EVEN_VOXEL_REMAINDER) {
    return byte & NIBBLE_MASK
  }
  return (byte >> NIBBLE_BITS) & NIBBLE_MASK
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
  const index = voxel >> BYTE_TO_VOXEL_SHIFT
  const clamped = clampLightLevel(level)
  const byte = grid[index] ?? EMPTY_BYTE

  if ((voxel & PARITY_MASK) === EVEN_VOXEL_REMAINDER) {
    grid[index] = (byte & HIGH_NIBBLE_MASK) | clamped
  } else {
    grid[index] = (byte & NIBBLE_MASK) | (clamped << NIBBLE_BITS)
  }
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
  block: new Uint8Array(LIGHT_BYTE_LENGTH),
  sky: new Uint8Array(LIGHT_BYTE_LENGTH),
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
/** Queue-entry bit layout: `y: 0-8, z: 9-12, x: 13-16, level: 17-21`. */
const QUEUE_Z_SHIFT = 9
const QUEUE_X_SHIFT = 13
const QUEUE_LEVEL_SHIFT = 17
const QUEUE_Y_MASK = 0x1ff
const QUEUE_XZ_MASK = 0x0f
const QUEUE_LEVEL_MASK = 0x1f

export const packPosLevel = (x: number, y: number, z: number, level: number): number =>
  (x << QUEUE_X_SHIFT) | (z << QUEUE_Z_SHIFT) | y | (level << QUEUE_LEVEL_SHIFT)

export const unpackY = (packed: number): number => packed & QUEUE_Y_MASK
export const unpackZ = (packed: number): number => (packed >> QUEUE_Z_SHIFT) & QUEUE_XZ_MASK
export const unpackX = (packed: number): number => (packed >> QUEUE_X_SHIFT) & QUEUE_XZ_MASK
export const unpackLevel = (packed: number): number => (packed >> QUEUE_LEVEL_SHIFT) & QUEUE_LEVEL_MASK

// ---------------------------------------------------------------------------
// Propagation
// ---------------------------------------------------------------------------

/** The six face neighbours, as `[dx, dy, dz]`. Light does not travel diagonally. */
/** Unit deltas for a face-neighbour offset. */
const AXIS_POSITIVE = 1
const AXIS_NEGATIVE = -1
const AXIS_NONE = 0

/** Which adjacent chunk (if any) a coordinate has crossed into, as a unit axis delta. */
const axisCrossing = (coord: number, size: number): number => {
  if (coord < MIN_CHUNK_COORD) {
    return AXIS_NEGATIVE
  }
  if (coord >= size) {
    return AXIS_POSITIVE
  }
  return AXIS_NONE
}

const NEIGHBOUR_OFFSETS: ReadonlyArray<readonly [number, number, number]> = [
  [AXIS_POSITIVE, AXIS_NONE, AXIS_NONE],
  [AXIS_NEGATIVE, AXIS_NONE, AXIS_NONE],
  [AXIS_NONE, AXIS_POSITIVE, AXIS_NONE],
  [AXIS_NONE, AXIS_NEGATIVE, AXIS_NONE],
  [AXIS_NONE, AXIS_NONE, AXIS_POSITIVE],
  [AXIS_NONE, AXIS_NONE, AXIS_NEGATIVE],
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

  for (let x = MIN_CHUNK_COORD; x < CHUNK_SIZE_XZ; x += STEP) {
    for (let z = MIN_CHUNK_COORD; z < CHUNK_SIZE_XZ; z += STEP) {
      for (let y = CHUNK_HEIGHT - STEP; y >= MIN_CHUNK_COORD; y -= STEP) {
        if (!transmitsLight(getBlockAt(chunk, x, y, z))) {
          // The first thing that stops the sky stops the column. Everything
          // Below it is reached — if at all — sideways, by the BFS.
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

/** One level of light is lost per BFS hop; below this, a hop only ever produces `LIGHT_LEVEL_MIN`. */
const LIGHT_DECAY_PER_HOP = 1
const LOWEST_PROPAGATABLE_LEVEL = LIGHT_LEVEL_MIN + LIGHT_DECAY_PER_HOP

/** The two growable queues a whole propagation pass shares, plus what it was seeded from. */
type PropagationContext = {
  readonly chunks: ReadonlyArray<LightChunk>
  readonly chunksByCoord: ReadonlyMap<string, number>
  readonly gridOf: (light: ChunkLight) => Uint8Array
  readonly queueChunks: Array<number>
  readonly queueCells: Array<number>
}

/** One dequeued BFS entry, unpacked once and reused for all six neighbours. */
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

/**
 * Resolve one face-neighbour of `cell`, crossing into the adjacent resident
 * chunk when it falls outside the current one. `null` when the neighbour is
 * above/below the loaded height range or the adjacent chunk is not resident
 * — an opaque boundary either way.
 */
/** The cross-chunk half of `resolveNeighbour`, split out to keep both under the statement budget. */
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
  /**
   * `chunksByCoord` and `chunks` are co-populated 1:1 by `indexChunks` —
   * every `chunks.push()` is immediately followed by
   * `chunksByCoord.set(key, chunks.length - STEP)` for that exact element —
   * so any `adjacentIndex` this function got from `chunksByCoord.get` is
   * always `< chunks.length`, and this read never misses.
   */
  const adjacent = context.chunks[adjacentIndex]!

  return {
    nx: (nx + CHUNK_SIZE_XZ) % CHUNK_SIZE_XZ,
    ny,
    nz: (nz + CHUNK_SIZE_XZ) % CHUNK_SIZE_XZ,
    target: adjacent,
    targetIndex: adjacentIndex,
  }
}

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

/** The second half of `relaxNeighbour`: write the improved level and re-enqueue. */
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

/** Relax one face-neighbour of `cell`: light it to `cell.next` and re-enqueue it, if that is an improvement. */
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

  /**
   * Loop index ranges over `[0, chunks.length)` by the loop bound, and
   * `chunks` is a densely `.push()`-built array with no holes, so the entry
   * at every index is always defined.
   */
  for (let chunkIndex = MIN_CHUNK_COORD; chunkIndex < chunks.length; chunkIndex += STEP) {
    const entry = chunks[chunkIndex]!
    for (const packed of seed(entry.chunk, gridOf(entry.light))) {
      queueChunks.push(chunkIndex)
      queueCells.push(packed)
    }
  }

  return { queueCells, queueChunks }
}

/** `null` once the level has decayed to where a hop could never light anything, or the chunk fell out of the set. */
const activeFrontierSource = (context: PropagationContext, chunkIndex: number, level: number): LightChunk | null => {
  if (level <= LOWEST_PROPAGATABLE_LEVEL) {
    return null
  }
  /**
   * Every `chunkIndex` reaching this function comes from `seedQueues`
   * (`< chunks.length` by loop bound) or from `applyRelaxation`'s
   * `neighbour.targetIndex` — itself either `cell.sourceIndex` or an index
   * this module already validated against `chunksByCoord` in
   * `resolveCrossChunkNeighbour`. `chunks[chunkIndex]` is therefore always
   * defined.
   */
  return context.chunks[chunkIndex]!
}

/** Pop one BFS entry and relax its six face-neighbours, if it is still bright enough to matter. */
const popAndRelax = (context: PropagationContext, head: number): void => {
  /**
   * The caller only ever invokes this with `head < queueCells.length`, and
   * `queueCells`/`queueChunks` are always pushed to in lockstep —
   * `seedQueues` and `applyRelaxation` each push both arrays together, once
   * per entry — so they share one length and both reads are always
   * in-bounds.
   */
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

/** Give every loaded chunk a stable index and an empty light pair, keyed by its coordinate. */
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

/** Re-key the indexed chunks' lights back onto the caller's original keys. */
const collectLights = <Key extends string>(
  keys: ReadonlyArray<Key>,
  chunks: ReadonlyArray<LightChunk>,
): ReadonlyMap<Key, ChunkLight> => {
  const result = new Map<Key, ChunkLight>()
  /**
   * Keys and chunks are pushed together, 1:1, by `indexChunks`, and the loop
   * index ranges over `[0, chunks.length)`, so both reads always succeed.
   */
  for (let index = MIN_CHUNK_COORD; index < chunks.length; index += STEP) {
    const key = keys[index]!
    const entry = chunks[index]!
    result.set(key, entry.light)
  }
  return result
}

/** Compute mutually consistent light grids for a set of resident chunks. */
export const computeChunkLights = <Key extends string>(loaded: ReadonlyMap<Key, Chunk>): ReadonlyMap<Key, ChunkLight> => {
  const { chunks, chunksByCoord, keys } = indexChunks(loaded)

  propagateAcrossChunks(chunks, chunksByCoord, (light) => light.sky, seedSkyLight)
  propagateAcrossChunks(chunks, chunksByCoord, (light) => light.block, seedBlockLight)

  return collectLights(keys, chunks)
}

/** One block mutation whose cached light neighbourhood must reach a new fixed point. */
export type ChunkLightChange = {
  readonly coord: ChunkCoord
  readonly x: number
  readonly y: number
  readonly z: number
}

type LightChannel = 'sky' | 'block'

/** A voxel located by which resident chunk it belongs to, in that chunk's local coordinates. */
type VoxelRef = {
  readonly chunkIndex: number
  readonly x: number
  readonly y: number
  readonly z: number
}

/** Flatten a `VoxelRef` into the single integer the incremental queue carries. */
const voxelId = (voxel: VoxelRef): number => voxel.chunkIndex * CHUNK_VOLUME + blockIndex(voxel.x, voxel.y, voxel.z)

/** The inverse of `voxelId`. `./constants` records the buffer as Y-major, which is why `y` peels off first. */
const voxelOfId = (id: number): VoxelRef => {
  const chunkIndex = Math.floor(id / CHUNK_VOLUME)
  const withinChunk = id % CHUNK_VOLUME
  const y = withinChunk % CHUNK_HEIGHT
  const column = Math.floor(withinChunk / CHUNK_HEIGHT)
  const z = column % CHUNK_SIZE_XZ
  const x = Math.floor(column / CHUNK_SIZE_XZ)
  return { chunkIndex, x, y, z }
}

/** Everything one `updateChunkLights` call threads through its helpers. */
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

/** Append one `(key, chunk)` pair; `false` when `current` has no light for it, which aborts the whole rebuild. */
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

/** Re-index `loaded` against `current`; `null` when the cache is missing an entry, which forces a full recompute. */
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

/** The second half of `cloneLight`: actually copy, once it is known there is something to copy. */
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

/** The input grids are immutable, so a chunk is copied at most once per `updateChunkLights` call, on first write. */
const cloneLight = <Key extends string>(context: UpdateContext<Key>, chunkIndex: number): ChunkLight => {
  /**
   * `lights` and `keys` are pushed together, 1:1, by `registerCurrentChunk`,
   * and every `chunkIndex` reaching this function was already validated
   * against `chunksByCoord` (directly by `resolveChangeVoxel`, or by reuse
   * of an already-valid `VoxelRef` in `neighbourIdOf`) before being queued —
   * so both reads always succeed.
   */
  const existing = context.lights[chunkIndex]!
  const key = context.keys[chunkIndex]!
  if (context.cloned.has(chunkIndex)) {
    return existing
  }

  return commitClonedLight(context, chunkIndex, key, existing)
}

/** The cross-chunk half of `neighbourIdOf`, split out to keep both under the statement budget. */
const crossChunkNeighbourId = <Key extends string>(
  context: UpdateContext<Key>,
  voxel: VoxelRef,
  neighbour: readonly [number, number, number],
): number | null => {
  /**
   * `voxel.chunkIndex` is always a `chunksByCoord`-validated index (see
   * `resolveChangeVoxel` and `neighbourIdOf`), and `UpdateContext.chunks` is
   * built 1:1 with `chunksByCoord` by `registerCurrentChunk`, so this read
   * never misses.
   */
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

/** The id of one face-neighbour of `voxel`, or `null` across a boundary with no resident chunk on the other side. */
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

/** "No opaque block in this column" sentinel, one below the lowest real Y. */
const NO_OPAQUE_BLOCK_FOUND = -1

/** Scan a column top-down for the first block that stops the sky; `NO_OPAQUE_BLOCK_FOUND` if none does. */
const scanHighestOpaque = (chunk: Chunk, x: number, z: number): number => {
  for (let scanY = CHUNK_HEIGHT - STEP; scanY >= MIN_CHUNK_COORD; scanY -= STEP) {
    if (!transmitsLight(getBlockAt(chunk, x, scanY, z))) {
      return scanY
    }
  }
  return NO_OPAQUE_BLOCK_FOUND
}

/** Whether `voxel` has open sky above it. Column results are cached once computed. */
const isDirectSky = <Key extends string>(context: UpdateContext<Key>, voxel: VoxelRef): boolean => {
  const column = voxel.chunkIndex * CHUNK_SIZE_XZ * CHUNK_SIZE_XZ + voxel.x * CHUNK_SIZE_XZ + voxel.z
  const cached = context.highestOpaqueByColumn.get(column) ?? null
  if (cached !== null) {
    return voxel.y > cached
  }

  /**
   * Same invariant as `crossChunkNeighbourId` — `voxel.chunkIndex` is always
   * `chunksByCoord`-validated, and `context.chunks` is co-populated with
   * `chunksByCoord` 1:1, so this read never misses within one
   * `updateChunkLights` call.
   */
  const chunk = context.chunks[voxel.chunkIndex]!

  const highestOpaque = scanHighestOpaque(chunk, voxel.x, voxel.z)
  context.highestOpaqueByColumn.set(column, highestOpaque)
  return voxel.y > highestOpaque
}

/** The incremental engine's frontier: a growable queue with de-duplicated membership. */
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

/** Locate one `ChunkLightChange`; `null` for a change outside any resident chunk or with non-integer coordinates. */
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

/** Seed the frontier with every changed voxel and its face-neighbours. */
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

/** The brightest a transmitting, non-direct-sky voxel can be relit to: one hop dimmer than its brightest lit neighbour. */
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
      /**
       * This id came from `neighbourIdOf`, which only ever returns an id
       * whose chunk index is `chunksByCoord`-validated, and `lights` is
       * co-populated with `chunksByCoord` 1:1, so this read never misses.
       */
      const nearLight = context.lights[near.chunkIndex]!
      next = Math.max(next, getLightAt(nearLight[channel], neighbourId % CHUNK_VOLUME) - LIGHT_DECAY_PER_HOP)
    }
  }
  return next
}

/** What `voxel` should read as on `channel`, from scratch, given the CURRENT (possibly stale) neighbour cache. */
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

/** The resident chunk and cached light `voxel` belongs to. */
const relaxationSourceOf = <Key extends string>(context: UpdateContext<Key>, voxel: VoxelRef): RelaxationSource => {
  /**
   * Same invariant as `cloneLight` — `chunks` and `lights` are co-populated
   * 1:1 by `registerCurrentChunk`, and `voxel.chunkIndex` is always a
   * `chunksByCoord`-validated index by the time it reaches here.
   */
  const chunk = context.chunks[voxel.chunkIndex]!
  const light = context.lights[voxel.chunkIndex]!
  return { chunk, light }
}

/** One channel's queue plus the shared context it reads and writes, bundled so every helper below fits `max-params`. */
type ChannelRun<Key extends string> = {
  readonly channel: LightChannel
  readonly context: UpdateContext<Key>
  readonly queue: IdQueue
}

/** The second half of `relaxVoxel`: actually write the improved level and re-enqueue its neighbours. */
const writeRelaxedVoxel = <Key extends string>(run: ChannelRun<Key>, voxel: VoxelRef, id: number, next: number): void => {
  const writable = cloneLight(run.context, voxel.chunkIndex)
  setLightAt(writable[run.channel], id % CHUNK_VOLUME, next)
  enqueueNeighbours(run.context, run.queue, voxel)
}

/** Recompute one dequeued voxel; write and re-enqueue its neighbours only if that changes its level. */
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

/** Run the incremental fixed point for one channel, to completion. */
const runChannel = <Key extends string>(
  context: UpdateContext<Key>,
  changes: ReadonlyArray<ChunkLightChange>,
  channel: LightChannel,
): void => {
  const run: ChannelRun<Key> = { channel, context, queue: seedChangeQueue(context, changes) }

  /**
   * The loop's own guard keeps `head` below `run.queue.items.length`, and
   * `queue.items` only ever grows via `enqueueId`'s `.push()`, so it is
   * dense with no holes: this read never misses.
   */
  let head = MIN_CHUNK_COORD
  while (head < run.queue.items.length) {
    const id = run.queue.items[head]!
    head += STEP
    run.queue.pending.delete(id)
    relaxVoxel(run, id)
  }
}

/** The size-check-and-rebuild half of `updateChunkLights`: `null` for anything that forces a full recompute. */
const resolvedUpdateContext = <Key extends string>(
  loaded: ReadonlyMap<Key, Chunk>,
  current: ReadonlyMap<Key, ChunkLight>,
): UpdateContext<Key> | null => {
  if (loaded.size !== current.size) {
    return null
  }
  return buildUpdateContext(loaded, current)
}

/** Only chunks recorded as cloned actually changed; everything else can keep sharing the caller's map. */
const finalizeUpdate = <Key extends string>(
  context: UpdateContext<Key>,
  current: ReadonlyMap<Key, ChunkLight>,
): ReadonlyMap<Key, ChunkLight> => {
  if (context.cloned.size === MIN_CHUNK_COORD) {
    return current
  }
  return context.result
}

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
  /**
   * `computeChunkLights` is called with a map containing exactly one entry
   * under `key`, and `collectLights` guarantees an entry for every key
   * present in its input — so `.get(key)` always succeeds here.
   */
  return computeChunkLights(new Map([[key, chunk]])).get(key)!
}
