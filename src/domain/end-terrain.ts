/** Deterministic terrain generation for the End dimension. */
import { columnIndex, emptyBlocks, worldX, worldZ, type Chunk } from './chunk'
import { blockIndex, CHUNK_SIZE_XZ } from './constants'
import { BlockId, chunkCoord, type ChunkCoord } from './kernel-vocabulary'
import {
  applyNaturalStructurePlansToChunk,
  naturalStructurePlansForChunk,
  type NaturalStructureChunk,
} from './natural-structure'
import { channelSeed, fbm2D } from './seeded-random'

export const END_STONE_BLOCK_ID = BlockId(86)
export const END_BASE_Y = 64
export const END_CENTRAL_ISLAND_RADIUS = 112
export const END_OUTER_ISLAND_START = 384

type EndColumn = {
  readonly surfaceY: number
  readonly bottomY: number
}

const endColumnAt = (seed: number, wx: number, wz: number): EndColumn | undefined => {
  const distance = Math.hypot(wx, wz)
  const shapeNoise = fbm2D(channelSeed(seed, 'end-shape'), wx, wz, {
    octaves: 3,
    frequency: 1 / 72,
    persistence: 0.5,
  })

  if (distance <= END_CENTRAL_ISLAND_RADIUS) {
    const strength = 1 - distance / END_CENTRAL_ISLAND_RADIUS
    const surfaceY = Math.floor(END_BASE_Y + strength * 8 + (shapeNoise - 0.5) * 6)
    return { surfaceY, bottomY: surfaceY - Math.floor(8 + strength * 20) }
  }

  if (distance < END_OUTER_ISLAND_START || shapeNoise < 0.6) {
    return undefined
  }

  const strength = Math.min(1, (shapeNoise - 0.6) / 0.22)
  const detail = fbm2D(channelSeed(seed, 'end-height'), wx, wz, {
    octaves: 2,
    frequency: 1 / 32,
    persistence: 0.5,
  })
  const surfaceY = Math.floor(END_BASE_Y - 8 + strength * 12 + (detail - 0.5) * 4)
  return { surfaceY, bottomY: surfaceY - Math.floor(5 + strength * 12) }
}

/** Surface query that returns `undefined` for the void between islands. */
export const endSurfaceHeightAt = (seed: number, wx: number, wz: number): number | undefined =>
  endColumnAt(seed, wx, wz)?.surfaceY

/** Generate one End terrain chunk using only absolute world coordinates. */
export const generateEndTerrainChunk = (seed: number, coord: ChunkCoord): Chunk => {
  const blocks = emptyBlocks()
  const biomes = Array.from({ length: CHUNK_SIZE_XZ * CHUNK_SIZE_XZ }, () => 'END' as const)

  for (let lx = 0; lx < CHUNK_SIZE_XZ; lx += 1) {
    for (let lz = 0; lz < CHUNK_SIZE_XZ; lz += 1) {
      const column = endColumnAt(seed, worldX(coord, lx), worldZ(coord, lz))
      if (column === undefined) {
        continue
      }
      for (let y = column.bottomY; y <= column.surfaceY; y += 1) {
        blocks[blockIndex(lx, y, lz)] = END_STONE_BLOCK_ID
      }
      biomes[columnIndex(lx, lz)] = 'END'
    }
  }

  return { coord, blocks, biomes }
}

/** Generate End terrain and apply every city or ship plan touching the chunk. */
export const generateEndChunk = (seed: number, coord: ChunkCoord): NaturalStructureChunk =>
  applyNaturalStructurePlansToChunk(
    generateEndTerrainChunk(seed, coord),
    naturalStructurePlansForChunk(seed, 'end', coord),
  )

export const generateEndChunkAt = (seed: number, cx: number, cz: number): NaturalStructureChunk =>
  generateEndChunk(seed, chunkCoord(cx, cz))
