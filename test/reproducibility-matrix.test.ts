import { createHash } from 'node:crypto'
import { describe, expect, it } from '@effect/vitest'
import { chunkCoord, type ChunkCoord } from '@nerima-games/mc-kernel'
import { computeChunkLights } from '../src/domain/light'
import { generateChunk } from '../src/domain/terrain'
import { generateEndChunk } from '../src/domain/end-terrain'
import { generateNetherChunk } from '../src/domain/nether-terrain'

/** Fixed input set for the cross-dimension byte-for-byte reproducibility check. */
export const REPRODUCIBILITY_SEEDS = [0, 1, 1337, 424242, 20260726] as const
export const REPRODUCIBILITY_CENTERS = [
  [-8, -8],
  [-3, 5],
  [0, 0],
  [2, -4],
  [7, 9],
  [16, -16],
  [31, 12],
  [64, 64],
] as const

const DIMENSIONS = ['overworld', 'nether', 'end'] as const
const REPRODUCIBILITY_CHUNK_COUNT = REPRODUCIBILITY_SEEDS.length * DIMENSIONS.length * REPRODUCIBILITY_CENTERS.length * 9

const chunkKey = (coord: ChunkCoord): string => `${String(coord.cx)},${String(coord.cz)}`

const updateChunkDigest = (hash: ReturnType<typeof createHash>, chunk: { readonly blocks: Uint16Array; readonly biomes: ReadonlyArray<string> }): void => {
  hash.update(new Uint8Array(chunk.blocks.buffer, chunk.blocks.byteOffset, chunk.blocks.byteLength))
  hash.update(JSON.stringify(chunk.biomes))
}

const generators = {
  end: generateEndChunk,
  nether: generateNetherChunk,
  overworld: generateChunk,
} as const

describe('cross-dimension reproducibility matrix', () => {
  it('keeps the recorded 5-seed x 3-dimension x 8-center input set byte-stable', () => {
    const terrainHash = createHash('sha256')
    const lightHash = createHash('sha256')
    let generatedChunks = 0
    let measuredLights = 0

    for (const seed of REPRODUCIBILITY_SEEDS) {
      for (const dimension of DIMENSIONS) {
        for (const [centerX, centerZ] of REPRODUCIBILITY_CENTERS) {
          const coordinates = Array.from({ length: 9 }, (_, index) => chunkCoord(
            centerX + (index % 3) - 1,
            centerZ + Math.floor(index / 3) - 1,
          ))
          const chunks = coordinates.map((coord) => generators[dimension](seed, coord))
          const loaded = new Map<string, (typeof chunks)[number]>()

          for (const [index, chunk] of chunks.entries()) {
            const coord = coordinates[index]
            if (coord === undefined) {throw new Error('reproducibility coordinate set is incomplete')}
            loaded.set(chunkKey(coord), chunk)
            updateChunkDigest(terrainHash, chunk)
            generatedChunks++
          }

          const lights = computeChunkLights(loaded)
          for (const [key, light] of lights) {
            lightHash.update(key)
            lightHash.update(light.sky)
            lightHash.update(light.block)
            measuredLights++
          }
        }
      }
    }

    expect(generatedChunks).toBe(REPRODUCIBILITY_CHUNK_COUNT)
    expect(measuredLights).toBe(REPRODUCIBILITY_CHUNK_COUNT)
    expect(terrainHash.digest('hex')).toBe('a9dd92fe3823f067f7869249dc06716f6f18c143776430fae681ee42cb260110')
    expect(lightHash.digest('hex')).toBe('847d8f0b6c14eae5ed3b264a3ed03bc030b4b5ac7683fc01e2dbcf23dce51b84')
  }, 300_000)
})
