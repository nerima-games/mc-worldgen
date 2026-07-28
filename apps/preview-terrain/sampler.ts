/**
 * The preview's window onto the library.
 *
 * A dev application, not shipped API.
 *
 * ---------------------------------------------------------------------------
 * Two sampling paths, on purpose
 * ---------------------------------------------------------------------------
 *
 * The top-down views need one number and one biome per column. That is exactly
 * what `surfaceHeightAt` and `biomeFor` return, and `domain/terrain.ts` says why
 * they are exported: "the cheapest possible query about the world … without
 * generating a whole chunk". Rendering a 400 × 200 block map through them costs
 * 80,000 noise evaluations; through `generateChunk` it would cost 313 chunks and
 * 20 MB of block buffers to read 80,000 bytes out of.
 *
 * The cross-section view cannot take that shortcut and must not try: it exists
 * to show carved caves, the water column and planted trees, none of which the
 * column queries know about. Those are properties of the block buffer, so the
 * slice view reads real `generateChunk` output.
 *
 * That split is also a free consistency check. The two paths agree only if
 * `surfaceHeightAt` really does predict what `generateChunk` fills — the
 * property `test/determinism.test.ts` pins — so flipping between the map and
 * the slice at the same coordinate is a visual assertion of it.
 */
import type { BiomeType } from '../../domain/biome'
import { BLOCK } from '../../domain/biome'
import type { CarveOptions } from '../../domain/carver'
import type { Chunk } from '../../domain/chunk'
import { readBlock } from '../../domain/chunk'
import { chunkCoord } from '../../domain/kernel-vocabulary'
import type { TerrainLevels } from '../../domain/constants'
import { blockIndex, CHUNK_HEIGHT, CHUNK_SIZE_XZ } from '../../domain/constants'
import { ravineDepthAt, ravineDistanceAt } from '../../domain/ravine'
import { biomeFor, generateChunk, surfaceHeightAt } from '../../domain/terrain'
import { shouldPlaceTree } from '../../domain/tree-placement'

export type WorldParams = {
  readonly seed: number
  readonly levels: TerrainLevels
  readonly carve: CarveOptions
  readonly decorate: boolean
}

export type ColumnSample = {
  readonly worldX: number
  readonly worldZ: number
  readonly surfaceY: number
  readonly biome: BiomeType
  readonly submerged: boolean
  /** Blocks of water above the surface, 0 when dry. */
  readonly waterDepth: number
  /** Whether the tree placer selects this column. Matches what `generateChunk` does. */
  readonly hasTree: boolean
  /**
   * Depth of the ravine cut at this column, 0 where none.
   *
   * The cheap column query for the ravine pass, and it belongs here for the
   * reason the header gives about `surfaceHeightAt`: colouring a 400 x 200
   * block map by "is there a ravine here" through `generateChunk` would cost
   * 313 chunks and 20 MB to read 80,000 answers out of.
   *
   * It is the RULE's answer and not the buffer's, so it is a prediction rather
   * than an observation — the water guard can still refuse a column this
   * reports as carved. `ravineCarved` below applies the half of the guard a
   * column query can see; the block-probing half needs the buffer, which is
   * what the slice view is for.
   */
  readonly ravineDepth: number
  /** `ravineDepth > 0` and the biome layer of the water guard does not refuse it. */
  readonly ravineCarved: boolean
}

export const sampleColumn = (params: WorldParams, wx: number, wz: number): ColumnSample => {
  const surfaceY = surfaceHeightAt(params.seed, wx, wz)
  const biome = biomeFor(params.seed, wx, wz, surfaceY, params.levels)
  const submerged = surfaceY < params.levels.seaLevel
  const ravineDepth = ravineDepthAt(ravineDistanceAt(params.seed, wx, wz))

  return {
    ravineDepth,
    // Only the biome layer of the guard is checkable from a column query. The
    // block-probing layer — the one `docs/design-notes.md` DN-2 says is the
    // load-bearing half — needs the buffer, so a column this reports as carved
    // may still be refused. Stated rather than smoothed over: a preview that
    // silently disagrees with the generator is worse than one that says where.
    ravineCarved: ravineDepth > 0 && biome !== 'OCEAN' && !submerged,
    worldX: wx,
    worldZ: wz,
    surfaceY,
    biome,
    submerged,
    waterDepth: submerged ? params.levels.seaLevel - surfaceY : 0,
    hasTree:
      params.decorate &&
      shouldPlaceTree({
        worldX: wx,
        worldZ: wz,
        surfaceY,
        biome,
        terrainLevels: params.levels,
      }),
  }
}

const floorDiv = (value: number, divisor: number): number => Math.floor(value / divisor)

/** Positive remainder, so that negative world coordinates land in [0, 16). */
const positiveMod = (value: number, divisor: number): number => value - floorDiv(value, divisor) * divisor

const paramsKey = (params: WorldParams): string =>
  [
    String(params.seed),
    String(params.levels.seaLevel),
    String(params.levels.lakeLevel),
    String(params.carve.waterFloorMargin ?? 'default'),
    String(params.decorate),
  ].join('|')

/**
 * Bounded chunk cache.
 *
 * A chunk is 64 KB (docs/testing.md §6 "大きいバッファに注意"), so an unbounded
 * cache turns a few minutes of panning into a few gigabytes. Insertion-ordered
 * eviction is enough here: the slice view walks a contiguous strip, so the
 * oldest entry really is the one furthest from the camera.
 */
const MAX_CACHED_CHUNKS = 96

export type ChunkCache = {
  readonly entries: Map<string, Chunk>
  /** Chunks generated since the cache was created. Shown in the HUD. */
  generated: number
}

export const createChunkCache = (): ChunkCache => ({ entries: new Map(), generated: 0 })

export const chunkFor = (
  cache: ChunkCache,
  params: WorldParams,
  chunkX: number,
  chunkZ: number,
): Chunk => {
  const key = `${paramsKey(params)}@${String(chunkX)},${String(chunkZ)}`
  const cached = cache.entries.get(key)
  if (cached !== undefined) {
    return cached
  }

  const chunk = generateChunk(params.seed, chunkCoord(chunkX, chunkZ), {
    terrainLevels: params.levels,
    carve: params.carve,
    decorate: params.decorate,
  })

  if (cache.entries.size >= MAX_CACHED_CHUNKS) {
    const oldest = cache.entries.keys().next()
    if (oldest.done !== true) {
      cache.entries.delete(oldest.value)
    }
  }

  cache.entries.set(key, chunk)
  cache.generated += 1
  return chunk
}

/** Real block id at a world coordinate, from a real generated chunk. */
export const blockAt = (
  cache: ChunkCache,
  params: WorldParams,
  wx: number,
  wy: number,
  wz: number,
): number => {
  if (wy < 0 || wy >= CHUNK_HEIGHT) {
    return BLOCK.AIR
  }
  const chunk = chunkFor(cache, params, floorDiv(wx, CHUNK_SIZE_XZ), floorDiv(wz, CHUNK_SIZE_XZ))
  const lx = positiveMod(wx, CHUNK_SIZE_XZ)
  const lz = positiveMod(wz, CHUNK_SIZE_XZ)
  return readBlock(chunk.blocks, blockIndex(lx, wy, lz))
}

export { floorDiv, positiveMod }
