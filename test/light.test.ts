/**
 * The light grid: packing, propagation, and the invalidation the store's header
 * has been claiming since before the grid existed.
 *
 * `docs/design-notes.md` DN-7 carried four ⬜ oracle rows for this feature
 * before any of it was written. Three of them are checked here by name —
 * the nibble round trip, the `packPosLevel` round trip, and the boundary
 * behaviour — and the fourth (`removing a light source restores the levels that
 * existed before it`) is checked in the only form this cut can honestly claim:
 * the whole-chunk recompute reaches the right answer, which is the ORACLE the
 * two-queue incremental engine will later have to agree with. See
 * `domain/light.ts`'s header on why the incremental half is deliberately not
 * here yet.
 *
 * The store half of the file is about one property and it is the load-bearing
 * one: `application/chunk-store.ts` argues that the block write path belongs in
 * this repository BECAUSE 「a block write invalidates light」. Until these tests
 * existed that sentence was an intention.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { ChunkStore, ChunkStoreLayer, type ChunkSource } from '../application/chunk-store'
import { BLOCK } from '../domain/biome'
import { emptyBlocks, type Chunk } from '../domain/chunk'
import { blockIndex, CHUNK_HEIGHT, CHUNK_SIZE_XZ } from '../domain/constants'
import {
  computeChunkLight,
  emptyChunkLight,
  getLightAt,
  LIGHT_BYTE_LENGTH,
  packPosLevel,
  setLightAt,
  unpackLevel,
  unpackX,
  unpackY,
  unpackZ,
} from '../domain/light'
import { BlockId, blockPosition, chunkCoord, type ChunkCoord } from "@nerima-games/mc-kernel"

// ---------------------------------------------------------------------------
// Block ids kernel names and `domain/biome.ts`'s `BLOCK` does not.
//
// `BLOCK` reproduces kernel's registry for ids 0-10, which is every block this
// repository's GENERATOR places. Torches and glowstone are placed by nobody
// here — they arrive from a rule in another repository — so they are written as
// the literals kernel's `BLOCK_REGISTRY` assigns, with the emission that makes
// them worth testing. `@nerima-games/mc-kernel` transcribes the same rows,
// and `test/kernel-mirror.test.ts` is what pins the transcription; naming them
// again here would be a third copy.
// ---------------------------------------------------------------------------

/**
 * `lightEmission: 14` — one below glowstone, which is kernel's audit §5 point.
 *
 * Branded through `BlockId` rather than left a bare `14`, because `setBlock`
 * takes a `BlockId` and the brand is the whole reason a chunk buffer cannot be
 * handed a number nobody validated.
 */
const TORCH = BlockId(14)
/** `lightEmission: 15`, and `opacity: 'opaque'` — the case that needs its own rule. */
const GLOWSTONE = BlockId(15)

const PLAINS_BIOMES = Array.from({ length: CHUNK_SIZE_XZ * CHUNK_SIZE_XZ }, () => 'PLAINS' as const)

/** Bedrock floor, stone up to and including `surfaceY`, air above. */
const flatChunk = (coord: ChunkCoord, surfaceY: number): Chunk => {
  const blocks = emptyBlocks()

  for (let lx = 0; lx < CHUNK_SIZE_XZ; lx += 1) {
    for (let lz = 0; lz < CHUNK_SIZE_XZ; lz += 1) {
      blocks[blockIndex(lx, 0, lz)] = BLOCK.BEDROCK
      for (let y = 1; y <= surfaceY; y += 1) {
        blocks[blockIndex(lx, y, lz)] = BLOCK.STONE
      }
    }
  }

  return { coord, blocks, biomes: PLAINS_BIOMES }
}

const SURFACE_Y = 63

// ---------------------------------------------------------------------------
// Packing
// ---------------------------------------------------------------------------

describe('the 4-bit light grid', () => {
  it.effect('a light level survives a nibble pack/unpack round trip for every level 0..15', () =>
    Effect.sync(() => {
      // DN-7's first oracle row, and the reason it is a row: the packing is the
      // one part of this feature where an off-by-one is invisible in every
      // consumer and wrong in all of them.
      const grid = new Uint8Array(LIGHT_BYTE_LENGTH)

      for (let level = 0; level <= 15; level += 1) {
        // Two ADJACENT voxels, because the failure this catches is a write that
        // lands in the neighbour's nibble rather than one that loses a value.
        setLightAt(grid, 100, level)
        setLightAt(grid, 101, 15 - level)

        expect(getLightAt(grid, 100)).toBe(level)
        expect(getLightAt(grid, 101)).toBe(15 - level)
      }
    }),
  )

  it.effect('writing one voxel never disturbs the voxel sharing its byte', () =>
    Effect.sync(() => {
      const grid = new Uint8Array(LIGHT_BYTE_LENGTH)

      setLightAt(grid, 0, 15)
      setLightAt(grid, 1, 15)
      setLightAt(grid, 0, 0)

      expect(getLightAt(grid, 0)).toBe(0)
      expect(getLightAt(grid, 1)).toBe(15)
    }),
  )

  it.effect('clamps out-of-range levels instead of overflowing into the next nibble', () =>
    Effect.sync(() => {
      // An unclamped 16 is `0b10000`, which is entirely OUTSIDE the low nibble
      // and would silently brighten voxel 1 while leaving voxel 0 dark. This is
      // why the clamp is kernel's rather than a local `Math.min`.
      const grid = new Uint8Array(LIGHT_BYTE_LENGTH)

      setLightAt(grid, 0, 99)
      setLightAt(grid, 2, -5)

      expect(getLightAt(grid, 0)).toBe(15)
      expect(getLightAt(grid, 1)).toBe(0)
      expect(getLightAt(grid, 2)).toBe(0)
    }),
  )

  it.effect('a fresh grid is entirely dark, and is the size the reference says', () =>
    Effect.sync(() => {
      // 16 × 16 × 256 / 2. One byte per voxel would make the two grids TWICE the
      // size of the block buffer they describe; see `domain/light.ts`.
      expect(LIGHT_BYTE_LENGTH).toBe(32768)

      const light = emptyChunkLight()
      expect(light.sky.length).toBe(LIGHT_BYTE_LENGTH)
      expect(light.block.length).toBe(LIGHT_BYTE_LENGTH)
      expect(getLightAt(light.sky, 0)).toBe(0)
      expect(getLightAt(light.block, 12345)).toBe(0)
    }),
  )

  it.effect('packPosLevel round-trips every coordinate in a chunk', () =>
    Effect.sync(() => {
      // DN-7's second oracle row. Every (x, z) in the chunk against the four
      // corners of the Y range and both ends of the level range — the full cross
      // product is 16 × 16 × 256 × 16 and would be testing the multiplier rather
      // than the layout.
      for (let x = 0; x < CHUNK_SIZE_XZ; x += 1) {
        for (let z = 0; z < CHUNK_SIZE_XZ; z += 1) {
          for (const y of [0, 1, 127, CHUNK_HEIGHT - 1]) {
            for (const level of [0, 1, 15]) {
              const packed = packPosLevel(x, y, z, level)

              expect(unpackX(packed)).toBe(x)
              expect(unpackY(packed)).toBe(y)
              expect(unpackZ(packed)).toBe(z)
              expect(unpackLevel(packed)).toBe(level)
            }
          }
        }
      }
    }),
  )
})

// ---------------------------------------------------------------------------
// Sky light
// ---------------------------------------------------------------------------

describe('sky light', () => {
  it.effect('is full brightness everywhere the sky is open', () =>
    Effect.sync(() => {
      const light = computeChunkLight(flatChunk(chunkCoord(0, 0), SURFACE_Y))

      expect(getLightAt(light.sky, blockIndex(0, SURFACE_Y + 1, 0))).toBe(15)
      expect(getLightAt(light.sky, blockIndex(8, CHUNK_HEIGHT - 1, 8))).toBe(15)
    }),
  )

  it.effect('does NOT dim on the way down an open column', () =>
    Effect.sync(() => {
      // The decision `seedSkyLight`'s comment argues. A decrementing column walk
      // is the obvious reading of "BFS from the top" and it would put the ground
      // at 15 - 192 = dark at noon, which would make every hostile-spawn rule
      // downstream read the world as permanently night.
      const light = computeChunkLight(flatChunk(chunkCoord(0, 0), SURFACE_Y))

      for (let y = SURFACE_Y + 1; y < CHUNK_HEIGHT; y += 1) {
        expect(getLightAt(light.sky, blockIndex(4, y, 4))).toBe(15)
      }
    }),
  )

  it.effect('stops at the first block that does not transmit', () =>
    Effect.sync(() => {
      const light = computeChunkLight(flatChunk(chunkCoord(0, 0), SURFACE_Y))

      // The surface block itself is stone, and stone is opaque.
      expect(getLightAt(light.sky, blockIndex(4, SURFACE_Y, 4))).toBe(0)
      expect(getLightAt(light.sky, blockIndex(4, SURFACE_Y - 1, 4))).toBe(0)
    }),
  )

  it.effect('spreads sideways under an overhang, one level per step', () =>
    Effect.sync(() => {
      // A stone lid over the whole chunk at SURFACE_Y + 2 with ONE hole in it at
      // (0, 0), and air beneath. Light falls through the hole at 15 and has to
      // walk horizontally to reach the rest of the cavity.
      const chunk = flatChunk(chunkCoord(0, 0), SURFACE_Y)
      const lidY = SURFACE_Y + 2

      for (let lx = 0; lx < CHUNK_SIZE_XZ; lx += 1) {
        for (let lz = 0; lz < CHUNK_SIZE_XZ; lz += 1) {
          chunk.blocks[blockIndex(lx, lidY, lz)] = BLOCK.STONE
        }
      }
      chunk.blocks[blockIndex(0, lidY, 0)] = BLOCK.AIR

      const light = computeChunkLight(chunk)
      const cavityY = SURFACE_Y + 1

      // Straight under the hole: the column walk reached it, so it is full.
      expect(getLightAt(light.sky, blockIndex(0, cavityY, 0))).toBe(15)
      // One step along X, one step along Z, and two steps away.
      expect(getLightAt(light.sky, blockIndex(1, cavityY, 0))).toBe(14)
      expect(getLightAt(light.sky, blockIndex(0, cavityY, 1))).toBe(14)
      expect(getLightAt(light.sky, blockIndex(1, cavityY, 1))).toBe(13)
      // Fifteen steps of Manhattan distance is exactly dark, which is the edge
      // the `level <= 1` stop in `propagate` is about.
      expect(getLightAt(light.sky, blockIndex(15, cavityY, 0))).toBe(0)
    }),
  )

  it.effect('is dark under a sealed lid, because nothing reaches it at all', () =>
    Effect.sync(() => {
      const chunk = flatChunk(chunkCoord(0, 0), SURFACE_Y)
      const lidY = SURFACE_Y + 2

      for (let lx = 0; lx < CHUNK_SIZE_XZ; lx += 1) {
        for (let lz = 0; lz < CHUNK_SIZE_XZ; lz += 1) {
          chunk.blocks[blockIndex(lx, lidY, lz)] = BLOCK.STONE
        }
      }

      const light = computeChunkLight(chunk)

      // This is the reading the hostile-spawn rule is waiting for: a roofed room
      // at night is where a mob may appear.
      expect(getLightAt(light.sky, blockIndex(8, SURFACE_Y + 1, 8))).toBe(0)
    }),
  )
})

// ---------------------------------------------------------------------------
// Block light
// ---------------------------------------------------------------------------

describe('block light', () => {
  /** The sealed room the sky cannot reach, so that only emitters are measured. */
  const sealedRoom = (): Chunk => {
    const chunk = flatChunk(chunkCoord(0, 0), SURFACE_Y)
    const lidY = SURFACE_Y + 2

    for (let lx = 0; lx < CHUNK_SIZE_XZ; lx += 1) {
      for (let lz = 0; lz < CHUNK_SIZE_XZ; lz += 1) {
        chunk.blocks[blockIndex(lx, lidY, lz)] = BLOCK.STONE
      }
    }

    return chunk
  }

  it.effect('is zero everywhere when nothing emits', () =>
    Effect.sync(() => {
      const light = computeChunkLight(sealedRoom())

      expect(getLightAt(light.block, blockIndex(8, SURFACE_Y + 1, 8))).toBe(0)
      expect(getLightAt(light.block, blockIndex(0, CHUNK_HEIGHT - 1, 0))).toBe(0)
    }),
  )

  it.effect('a torch reads 14 at its own cell and dims by one per step', () =>
    Effect.sync(() => {
      // 14 and not 15: kernel's registry gives TORCH 14 and GLOWSTONE 15, and
      // the one-level gap is the reason `lightEmission` is a number rather than
      // the `emissive: boolean` plan.md §3.1 asked for.
      const chunk = sealedRoom()
      const y = SURFACE_Y + 1
      chunk.blocks[blockIndex(4, y, 4)] = TORCH

      const light = computeChunkLight(chunk)

      expect(getLightAt(light.block, blockIndex(4, y, 4))).toBe(14)
      expect(getLightAt(light.block, blockIndex(5, y, 4))).toBe(13)
      expect(getLightAt(light.block, blockIndex(6, y, 4))).toBe(12)
      expect(getLightAt(light.block, blockIndex(4, y, 6))).toBe(12)
    }),
  )

  it.effect('an OPAQUE emitter is bright at its own cell and lights the air beside it', () =>
    Effect.sync(() => {
      // Glowstone is `opacity: 'opaque'`. If the seeding pass respected
      // transmission the way propagation does, `getLight` on the glowstone
      // itself would answer 0 — an unlit block that is the reason the room is
      // lit — and mc-render would draw it dark.
      const chunk = sealedRoom()
      const y = SURFACE_Y + 1
      chunk.blocks[blockIndex(4, y, 4)] = GLOWSTONE

      const light = computeChunkLight(chunk)

      expect(getLightAt(light.block, blockIndex(4, y, 4))).toBe(15)
      expect(getLightAt(light.block, blockIndex(5, y, 4))).toBe(14)
    }),
  )

  /**
   * THE FOURTEEN EMITTERS THE MIRROR HAD LOST, measured through the light grid.
   *
   * `@nerima-games/mc-kernel` carried three emitting rows while kernel had
   * seventeen, so every other emitter fell through to `LIGHT_LEVEL_MIN` and this
   * pass seeded nothing for it. A redstone torch lit nothing; a nether portal
   * lit nothing. The transcription is fixed and pinned by
   * `test/kernel-mirror.test.ts`, but that file only asserts what
   * `lightEmissionOfBlockId` ANSWERS — it never runs the propagation, so it
   * cannot show that a placed emitter actually lights a room.
   *
   * These are the levels a boolean `emissive` could not have expressed, which is
   * why they are worth measuring separately rather than trusting the torch test
   * to stand in for all seventeen rows.
   */
  const REDSTONE_TORCH = BlockId(75)
  const NETHER_PORTAL = BlockId(118)
  const END_PORTAL_FRAME = BlockId(87)

  it.effect('a redstone torch lights the room at SEVEN, not at zero and not at fourteen', () =>
    Effect.sync(() => {
      const chunk = sealedRoom()
      const y = SURFACE_Y + 1
      chunk.blocks[blockIndex(4, y, 4)] = REDSTONE_TORCH

      const light = computeChunkLight(chunk)

      // Before the mirror was re-transcribed this cell read 0 and the room
      // stayed dark, which is the DARK direction DN-7 names as non-conservative.
      expect(getLightAt(light.block, blockIndex(4, y, 4))).toBe(7)
      expect(getLightAt(light.block, blockIndex(5, y, 4))).toBe(6)
      expect(getLightAt(light.block, blockIndex(7, y, 4))).toBe(4)

      // Seven and not fourteen. `mx-gameplay/domain/mob/hostile-spawn.ts`
      // refuses a spawn ABOVE light 7, so a redstone torch sits exactly on the
      // threshold: its own cell refuses, and the cell beside it permits. A
      // transcription that flattened every emitter to 15 would move that
      // boundary across a whole room.
      expect(getLightAt(light.block, blockIndex(4, y, 4))).not.toBe(14)
      expect(getLightAt(light.block, blockIndex(5, y, 4))).toBeLessThan(7)
    }),
  )

  it.effect('a nether portal emits 11, and an end portal frame only 1', () =>
    Effect.sync(() => {
      const y = SURFACE_Y + 1

      const portal = sealedRoom()
      portal.blocks[blockIndex(4, y, 4)] = NETHER_PORTAL
      expect(getLightAt(computeChunkLight(portal).block, blockIndex(4, y, 4))).toBe(11)

      // One. The dimmest emitting row kernel has, and the row that makes the
      // strongest case against `emissive: boolean`: an unlit frame emits 1 and
      // rises to 3 once its eye is socketed, which a flag cannot say at all.
      const frame = sealedRoom()
      frame.blocks[blockIndex(4, y, 4)] = END_PORTAL_FRAME
      const frameLight = computeChunkLight(frame)

      expect(getLightAt(frameLight.block, blockIndex(4, y, 4))).toBe(1)
      // It lights its own cell and nothing else: 1 attenuates to 0 in one step.
      expect(getLightAt(frameLight.block, blockIndex(5, y, 4))).toBe(0)
    }),
  )

  it.effect('does not travel through rock, and DOES travel around it', () =>
    Effect.sync(() => {
      // Both halves matter, and the first draft of this test asserted the wrong
      // one: it put a SINGLE stone block beside a torch and expected the cell
      // behind it to be dark. It is not, and should not be — light walks around
      // one block by four steps (z+1, x+1, x+1, z-1) and arrives at 10. An
      // implementation that darkened it would be casting shadows in straight
      // lines, which is not what a BFS over face neighbours means.
      //
      // The real claim is about a WALL. `x = 5` is sealed across every z, and
      // the room is one cell tall, so there is no path at all.
      const chunk = sealedRoom()
      const y = SURFACE_Y + 1

      chunk.blocks[blockIndex(4, y, 4)] = TORCH
      for (let lz = 0; lz < CHUNK_SIZE_XZ; lz += 1) {
        chunk.blocks[blockIndex(5, y, lz)] = BLOCK.STONE
      }

      const light = computeChunkLight(chunk)

      // Inside the wall itself: stone does not transmit, so nothing was written.
      expect(getLightAt(light.block, blockIndex(5, y, 4))).toBe(0)
      // Behind it: no path exists, at any distance.
      expect(getLightAt(light.block, blockIndex(6, y, 4))).toBe(0)
      expect(getLightAt(light.block, blockIndex(6, y, 8))).toBe(0)
      // And in front of it, the torch still lights the room it is in.
      expect(getLightAt(light.block, blockIndex(3, y, 4))).toBe(13)
    }),
  )

  it.effect('walks around a single obstruction rather than casting a shadow', () =>
    Effect.sync(() => {
      // The other half, pinned on its own because it is the property that made
      // the test above wrong: four steps around one block, so 14 - 4 = 10.
      const chunk = sealedRoom()
      const y = SURFACE_Y + 1

      chunk.blocks[blockIndex(4, y, 4)] = TORCH
      chunk.blocks[blockIndex(5, y, 4)] = BLOCK.STONE

      const light = computeChunkLight(chunk)

      expect(getLightAt(light.block, blockIndex(5, y, 4))).toBe(0)
      expect(getLightAt(light.block, blockIndex(6, y, 4))).toBe(10)
    }),
  )

  it.effect('two sources do not add, and the brighter one wins', () =>
    Effect.sync(() => {
      // The property that makes `propagate` O(cells) rather than O(cells x
      // sources): a cell already at least as bright neither improves nor
      // re-enqueues. It is also the correct lighting rule — two torches in one
      // room do not make it brighter than 14.
      const chunk = sealedRoom()
      const y = SURFACE_Y + 1
      chunk.blocks[blockIndex(4, y, 4)] = TORCH
      chunk.blocks[blockIndex(6, y, 4)] = GLOWSTONE

      const light = computeChunkLight(chunk)

      // Between them: 13 from the torch, 14 from the glowstone. Not 27.
      expect(getLightAt(light.block, blockIndex(5, y, 4))).toBe(14)
    }),
  )

  it.effect('sky light and block light are kept apart', () =>
    Effect.sync(() => {
      // The rule that reads these gates on BLOCK light alone. A torch under an
      // open sky must not raise the sky grid, and daylight must not raise the
      // block grid — otherwise the spawn rule refuses a cell for the wrong
      // reason and `too-bright` stops meaning anything.
      const chunk = flatChunk(chunkCoord(0, 0), SURFACE_Y)
      const y = SURFACE_Y + 1
      chunk.blocks[blockIndex(4, y, 4)] = TORCH

      const light = computeChunkLight(chunk)

      expect(getLightAt(light.block, blockIndex(5, y, 4))).toBe(13)
      expect(getLightAt(light.sky, blockIndex(5, y, 4))).toBe(15)
      // The torch cell itself: bright from its own emission, and the sky grid
      // does not reach it because a torch is not what the column walk stops on —
      // it transmits, so the sky passes straight through.
      expect(getLightAt(light.block, blockIndex(4, y, 4))).toBe(14)
      expect(getLightAt(light.sky, blockIndex(4, y, 4))).toBe(15)
    }),
  )

  it.effect('removing a light source restores the levels that existed before it', () =>
    Effect.sync(() => {
      // DN-7's third oracle row, in the form this cut can honestly claim: the
      // whole-chunk recompute is the ORACLE that the two-queue incremental
      // engine must later agree with. It is the harder direction of the two —
      // the reference's remove-then-add exists because a single add-queue BFS
      // CANNOT un-light a neighbourhood — so pinning the answer now is what
      // makes the incremental version checkable when it lands.
      const before = computeChunkLight(sealedRoom())

      const lit = sealedRoom()
      const y = SURFACE_Y + 1
      lit.blocks[blockIndex(4, y, 4)] = TORCH
      const during = computeChunkLight(lit)

      const removed = sealedRoom()
      const after = computeChunkLight(removed)

      expect(getLightAt(during.block, blockIndex(5, y, 4))).toBe(13)
      expect(getLightAt(before.block, blockIndex(5, y, 4))).toBe(0)
      expect(getLightAt(after.block, blockIndex(5, y, 4))).toBe(0)
    }),
  )

  it.effect('does not cross a chunk boundary, which is a KNOWN gap and not an accident', () =>
    Effect.sync(() => {
      // `domain/light.ts`'s header argues this at length and names the failure
      // mode: a hostile spawning inside the lit border of a torch-lit room on
      // the far side of a seam. It is pinned so that the day cross-chunk
      // propagation lands, this test is what has to be rewritten — rather than
      // the behaviour changing under a suite that never mentioned it.
      const chunk = sealedRoom()
      const y = SURFACE_Y + 1
      chunk.blocks[blockIndex(15, y, 8)] = TORCH

      const light = computeChunkLight(chunk)

      expect(getLightAt(light.block, blockIndex(15, y, 8))).toBe(14)
      expect(getLightAt(light.block, blockIndex(14, y, 8))).toBe(13)
      // x = 16 is the neighbouring chunk. Nothing here can reach it.
      expect(getLightAt(light.block, blockIndex(15, y, 9))).toBe(13)
    }),
  )
})

// ---------------------------------------------------------------------------
// The store query, and the invalidation the store's header is an argument about
// ---------------------------------------------------------------------------

describe('ChunkStore.getLight', () => {
  /** A world with a sealed stone lid, so that both grids have something to say. */
  const roofedSource: ChunkSource = (coord) =>
    Effect.sync(() => {
      const chunk = flatChunk(coord, SURFACE_Y)
      const lidY = SURFACE_Y + 2

      for (let lx = 0; lx < CHUNK_SIZE_XZ; lx += 1) {
        for (let lz = 0; lz < CHUNK_SIZE_XZ; lz += 1) {
          chunk.blocks[blockIndex(lx, lidY, lz)] = BLOCK.STONE
        }
      }

      return chunk
    })

  const ROOF_Y = SURFACE_Y + 2
  const ROOM_Y = SURFACE_Y + 1

  it.effect('answers OutOfWorld above and below the world, exactly as getBlock does', () =>
    Effect.gen(function* () {
      const store = yield* ChunkStore

      expect((yield* store.getLight(blockPosition(0, -1, 0)))._tag).toBe('OutOfWorld')
      expect((yield* store.getLight(blockPosition(0, CHUNK_HEIGHT, 0)))._tag).toBe('OutOfWorld')
    }).pipe(Effect.provide(ChunkStoreLayer(roofedSource))),
  )

  it.effect('answers ChunkNotLoaded rather than darkness for a chunk nobody loaded', () =>
    Effect.gen(function* () {
      const store = yield* ChunkStore

      // THE DISTINCTION THE WHOLE THREE-VALUED SHAPE EXISTS FOR. Collapsing this
      // into 0 would read as pitch dark, and the spawn rule would put a hostile
      // at the edge of the loaded area in broad daylight.
      expect((yield* store.getLight(blockPosition(0, ROOM_Y, 0)))._tag).toBe('ChunkNotLoaded')
    }).pipe(Effect.provide(ChunkStoreLayer(roofedSource))),
  )

  it.effect('reports sky and block light separately for a loaded chunk', () =>
    Effect.gen(function* () {
      const store = yield* ChunkStore
      yield* store.load(chunkCoord(0, 0))

      const reading = yield* store.getLight(blockPosition(4, ROOM_Y, 4))
      expect(reading).toStrictEqual({ _tag: 'Light', sky: 0, block: 0 })

      const open = yield* store.getLight(blockPosition(4, ROOF_Y + 1, 4))
      expect(open).toStrictEqual({ _tag: 'Light', sky: 15, block: 0 })
    }).pipe(Effect.provide(ChunkStoreLayer(roofedSource))),
  )

  it.effect('A BLOCK WRITE INVALIDATES LIGHT — the claim the store header rests on', () =>
    Effect.gen(function* () {
      const store = yield* ChunkStore
      yield* store.load(chunkCoord(0, 0))

      // Read FIRST, so that the grid is computed and cached. Without this read
      // the test would pass against an implementation that never caches at all,
      // and it is the cached-and-stale case that is the bug.
      const roofed = yield* store.getLight(blockPosition(4, ROOM_Y, 4))
      expect(roofed).toStrictEqual({ _tag: 'Light', sky: 0, block: 0 })

      // Mine a hole in the roof directly above the cell just read.
      const written = yield* store.setBlock(blockPosition(4, ROOF_Y, 4), BLOCK.AIR)
      expect(written._tag).toBe('Written')

      const opened = yield* store.getLight(blockPosition(4, ROOM_Y, 4))
      expect(opened).toStrictEqual({ _tag: 'Light', sky: 15, block: 0 })
    }).pipe(Effect.provide(ChunkStoreLayer(roofedSource))),
  )

  it.effect('a placed torch is visible to the very next read', () =>
    Effect.gen(function* () {
      const store = yield* ChunkStore
      yield* store.load(chunkCoord(0, 0))

      expect(yield* store.getLight(blockPosition(5, ROOM_Y, 4))).toStrictEqual({
        _tag: 'Light',
        sky: 0,
        block: 0,
      })

      yield* store.setBlock(blockPosition(4, ROOM_Y, 4), TORCH)

      expect(yield* store.getLight(blockPosition(5, ROOM_Y, 4))).toStrictEqual({
        _tag: 'Light',
        sky: 0,
        block: 13,
      })
    }).pipe(Effect.provide(ChunkStoreLayer(roofedSource))),
  )

  it.effect('an Unchanged write does not invalidate, for the reason it does not dirty', () =>
    Effect.gen(function* () {
      const store = yield* ChunkStore
      yield* store.load(chunkCoord(0, 0))

      yield* store.setBlock(blockPosition(4, ROOM_Y, 4), TORCH)
      const lit = yield* store.getLight(blockPosition(5, ROOM_Y, 4))

      // Re-placing the block that is already there. A fluid re-asserting its
      // level does this every tick, and invalidating on it would relight the
      // chunk every tick forever — the light-side twin of the remesh-forever
      // bug `withBlockAt` guards against for the dirty channel.
      const again = yield* store.setBlock(blockPosition(4, ROOM_Y, 4), TORCH)
      expect(again._tag).toBe('Unchanged')

      expect(yield* store.getLight(blockPosition(5, ROOM_Y, 4))).toStrictEqual(lit)
    }).pipe(Effect.provide(ChunkStoreLayer(roofedSource))),
  )

  it.effect('a write to ANOTHER chunk does not invalidate this one', () =>
    Effect.gen(function* () {
      const store = yield* ChunkStore
      yield* store.load(chunkCoord(0, 0))
      yield* store.load(chunkCoord(1, 0))

      yield* store.getLight(blockPosition(4, ROOM_Y, 4))
      // Chunk (1, 0) starts at world x = 16.
      yield* store.setBlock(blockPosition(20, ROOF_Y, 4), BLOCK.AIR)

      expect(yield* store.getLight(blockPosition(4, ROOM_Y, 4))).toStrictEqual({
        _tag: 'Light',
        sky: 0,
        block: 0,
      })
      expect(yield* store.getLight(blockPosition(20, ROOM_Y, 4))).toStrictEqual({
        _tag: 'Light',
        sky: 15,
        block: 0,
      })
    }).pipe(Effect.provide(ChunkStoreLayer(roofedSource))),
  )

  it.effect('unloading drops the grid, and reloading recomputes it', () =>
    Effect.gen(function* () {
      const store = yield* ChunkStore
      yield* store.load(chunkCoord(0, 0))
      yield* store.setBlock(blockPosition(4, ROOM_Y, 4), TORCH)
      expect(yield* store.getLight(blockPosition(5, ROOM_Y, 4))).toStrictEqual({
        _tag: 'Light',
        sky: 0,
        block: 13,
      })

      yield* store.unload(chunkCoord(0, 0))
      expect((yield* store.getLight(blockPosition(5, ROOM_Y, 4)))._tag).toBe('ChunkNotLoaded')

      // The source regenerates a torchless chunk, and the light must follow the
      // blocks rather than the coordinate. A grid kept across an unload would
      // light the fresh chunk with the old one's torch.
      yield* store.load(chunkCoord(0, 0))
      expect(yield* store.getLight(blockPosition(5, ROOM_Y, 4))).toStrictEqual({
        _tag: 'Light',
        sky: 0,
        block: 0,
      })
    }).pipe(Effect.provide(ChunkStoreLayer(roofedSource))),
  )

  it.effect('reset drops every grid along with every chunk', () =>
    Effect.gen(function* () {
      const store = yield* ChunkStore
      yield* store.load(chunkCoord(0, 0))
      yield* store.setBlock(blockPosition(4, ROOM_Y, 4), TORCH)
      yield* store.getLight(blockPosition(5, ROOM_Y, 4))

      yield* store.reset

      expect((yield* store.getLight(blockPosition(5, ROOM_Y, 4)))._tag).toBe('ChunkNotLoaded')

      yield* store.load(chunkCoord(0, 0))
      expect(yield* store.getLight(blockPosition(5, ROOM_Y, 4))).toStrictEqual({
        _tag: 'Light',
        sky: 0,
        block: 0,
      })
    }).pipe(Effect.provide(ChunkStoreLayer(roofedSource))),
  )
})
