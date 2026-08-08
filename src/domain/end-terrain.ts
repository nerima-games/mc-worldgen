/** Deterministic terrain generation for the End dimension. */
import { BlockId, type ChunkCoord, chunkCoord } from '@nerima-games/mc-kernel'
import { CHUNK_SIZE_XZ, blockIndex } from './constants'
import { type Chunk, emptyBlocks, worldX, worldZ } from './chunk'
import {
  type NaturalStructureChunk,
  applyNaturalStructurePlansToChunk,
  naturalStructurePlansForChunk,
} from './natural-structure'
import { channelSeed, fbm2D } from './seeded-random'

const END_STONE_KERNEL_ID = 86
export const END_STONE_BLOCK_ID = BlockId(END_STONE_KERNEL_ID)
export const END_BASE_Y = 64
export const END_CENTRAL_ISLAND_RADIUS = 112
export const END_OUTER_ISLAND_START = 384

/** Numerator of `frequency = 1 / wavelengthInBlocks` — one full noise cycle. */
const FREQUENCY_UNIT = 1
/** Wavelength of the shared shape field that both islands sample. */
const CENTRAL_ISLAND_NOISE_WAVELENGTH = 72
/** The interpolation strength at its maximum (island centre / full effect). */
const FULL_STRENGTH = 1
/** Recentres a `[0, 1]` noise sample onto `[-0.5, 0.5]`. */
const NOISE_MIDPOINT = 0.5

/** How much `strength` raises the central island's surface above `END_BASE_Y`. */
const CENTRAL_ISLAND_HEIGHT_BOOST = 8
/** Amplitude of the surface-noise wobble on the central island. */
const CENTRAL_ISLAND_SURFACE_NOISE_AMPLITUDE = 6
/** Central island thickness at the outer edge (`strength` = 0). */
const CENTRAL_ISLAND_BASE_THICKNESS = 8
/** Extra thickness the central island gains as `strength` rises to 1. */
const CENTRAL_ISLAND_THICKNESS_STRENGTH_SCALE = 20

/** `shapeNoise` must clear this before an outer island forms at all. */
const OUTER_ISLAND_NOISE_THRESHOLD = 0.6
/** Normalises `shapeNoise`'s excess over the threshold into `[0, 1]`. */
const OUTER_ISLAND_NOISE_RANGE = 0.22
/** Wavelength of the outer islands' own detail field. */
const OUTER_ISLAND_NOISE_WAVELENGTH = 32
/** Outer islands sit this far below `END_BASE_Y` at the outer edge. */
const OUTER_ISLAND_HEIGHT_DROP = 8
/** How much `strength` raises an outer island's surface. */
const OUTER_ISLAND_HEIGHT_BOOST = 12
/** Amplitude of the surface-noise wobble on an outer island. */
const OUTER_ISLAND_SURFACE_NOISE_AMPLITUDE = 4
/** Outer island thickness at its own edge (`strength` = 0). */
const OUTER_ISLAND_BASE_THICKNESS = 5
/** Extra thickness an outer island gains as `strength` rises to 1. */
const OUTER_ISLAND_THICKNESS_STRENGTH_SCALE = 12

type EndColumn = {
  readonly surfaceY: number
  readonly bottomY: number
}

/** The central island: a dome centred on the origin, `strength` = 1 at its core. */
const centralIslandColumn = (distance: number, shapeNoise: number): EndColumn => {
  const strength = FULL_STRENGTH - distance / END_CENTRAL_ISLAND_RADIUS
  const surfaceY = Math.floor(
    END_BASE_Y +
      strength * CENTRAL_ISLAND_HEIGHT_BOOST +
      (shapeNoise - NOISE_MIDPOINT) * CENTRAL_ISLAND_SURFACE_NOISE_AMPLITUDE,
  )

  return {
    bottomY: surfaceY - Math.floor(CENTRAL_ISLAND_BASE_THICKNESS + strength * CENTRAL_ISLAND_THICKNESS_STRENGTH_SCALE),
    surfaceY,
  }
}

/**
 * An outer island, or none — `shapeNoise` must clear `OUTER_ISLAND_NOISE_THRESHOLD`
 * for one to form here at all. Its own detail field then shapes the island.
 */
const outerIslandColumn = (seed: number, wx: number, wz: number, shapeNoise: number): EndColumn | undefined => {
  if (shapeNoise < OUTER_ISLAND_NOISE_THRESHOLD) {
    return
  }

  const strength = Math.min(FULL_STRENGTH, (shapeNoise - OUTER_ISLAND_NOISE_THRESHOLD) / OUTER_ISLAND_NOISE_RANGE)
  const detail = fbm2D(channelSeed(seed, 'end-height'), wx, wz, {
    frequency: FREQUENCY_UNIT / OUTER_ISLAND_NOISE_WAVELENGTH,
    octaves: 2,
    persistence: 0.5,
  })
  const surfaceY = Math.floor(
    END_BASE_Y -
      OUTER_ISLAND_HEIGHT_DROP +
      strength * OUTER_ISLAND_HEIGHT_BOOST +
      (detail - NOISE_MIDPOINT) * OUTER_ISLAND_SURFACE_NOISE_AMPLITUDE,
  )

  return {
    bottomY: surfaceY - Math.floor(OUTER_ISLAND_BASE_THICKNESS + strength * OUTER_ISLAND_THICKNESS_STRENGTH_SCALE),
    surfaceY,
  }
}

const endColumnAt = (seed: number, wx: number, wz: number): EndColumn | undefined => {
  const distance = Math.hypot(wx, wz)
  const shapeNoise = fbm2D(channelSeed(seed, 'end-shape'), wx, wz, {
    frequency: FREQUENCY_UNIT / CENTRAL_ISLAND_NOISE_WAVELENGTH,
    octaves: 3,
    persistence: 0.5,
  })

  if (distance <= END_CENTRAL_ISLAND_RADIUS) {
    return centralIslandColumn(distance, shapeNoise)
  }

  if (distance < END_OUTER_ISLAND_START) {
    return
  }

  return outerIslandColumn(seed, wx, wz, shapeNoise)
}

/** Surface query that returns `undefined` for the void between islands. */
export const endSurfaceHeightAt = (seed: number, wx: number, wz: number): number | undefined =>
  endColumnAt(seed, wx, wz)?.surfaceY

/** Generate one End terrain chunk using only absolute world coordinates. */
export const generateEndTerrainChunk = (seed: number, coord: ChunkCoord): Chunk => {
  const blocks = emptyBlocks()
  const biomes = Array.from<'END'>({ length: CHUNK_SIZE_XZ * CHUNK_SIZE_XZ }).fill('END')

  for (let lx = 0; lx < CHUNK_SIZE_XZ; lx++) {
    for (let lz = 0; lz < CHUNK_SIZE_XZ; lz++) {
      const column = endColumnAt(seed, worldX(coord, lx), worldZ(coord, lz))

      if (column) {
        for (let y = column.bottomY; y <= column.surfaceY; y++) {
          blocks[blockIndex(lx, y, lz)] = END_STONE_BLOCK_ID
        }
      }
    }
  }

  return { biomes, blocks, coord }
}

/** Generate End terrain and apply every city or ship plan touching the chunk. */
export const generateEndChunk = (seed: number, coord: ChunkCoord): NaturalStructureChunk =>
  applyNaturalStructurePlansToChunk(
    generateEndTerrainChunk(seed, coord),
    naturalStructurePlansForChunk(seed, 'end', coord),
  )

export const generateEndChunkAt = (seed: number, cx: number, cz: number): NaturalStructureChunk =>
  generateEndChunk(seed, chunkCoord(cx, cz))
