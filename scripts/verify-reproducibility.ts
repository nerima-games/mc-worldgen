import { createHash } from 'node:crypto'
import { Result } from 'effect'
import { NoiseSeed, type NoiseSeed as NoiseSeedValue } from '@nerima-games/mc-noise'
import { chunkCoord as createChunkCoord, type ChunkCoord } from '@nerima-games/mc-kernel'
import { chunkAxis } from '../src/domain/coordinate-compatibility'
import { computeChunkLights } from '../src/domain/light.js'
import { generateEndChunk } from '../src/domain/end-terrain.js'
import { generateNetherChunk } from '../src/domain/nether-terrain.js'
import { generateChunk } from '../src/domain/terrain.js'

/** Fixed input set for the cross-dimension byte-for-byte reproducibility check. */
export const REPRODUCIBILITY_SEEDS: ReadonlyArray<NoiseSeedValue> = [0, 1, 1337, 424242, 20260726].map((seed) => Result.getOrThrow(NoiseSeed.result(seed)))
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
const generators = { end: generateEndChunk, nether: generateNetherChunk, overworld: generateChunk } as const

const updateChunkDigest = (hash: ReturnType<typeof createHash>, chunk: { readonly blocks: Uint16Array; readonly biomes: ReadonlyArray<string> }): void => {
  hash.update(new Uint8Array(chunk.blocks.buffer, chunk.blocks.byteOffset, chunk.blocks.byteLength))
  hash.update(JSON.stringify(chunk.biomes))
}

const main = (): void => {
  const terrainHash = createHash('sha256')
  const lightHash = createHash('sha256')
  let generatedChunks = 0
  let measuredLights = 0

  for (const seed of REPRODUCIBILITY_SEEDS) {
    for (const dimension of DIMENSIONS) {
      for (const [centerX, centerZ] of REPRODUCIBILITY_CENTERS) {
        const coordinates = Array.from({ length: 9 }, (_, index) => createChunkCoord(
          chunkAxis(centerX + (index % 3) - 1),
          chunkAxis(centerZ + Math.floor(index / 3) - 1),
        ))
        const chunks = coordinates.map((coord) => Result.getOrThrow(generators[dimension](seed, coord)))
        const loaded = new Map<string, (typeof chunks)[number]>()

        for (const [index, chunk] of chunks.entries()) {
          const coord = coordinates[index]
          if (coord === undefined) {throw new Error('reproducibility coordinate set is incomplete')}
          loaded.set(chunkKey(coord), chunk)
          updateChunkDigest(terrainHash, chunk)
          generatedChunks++
        }

        const lights = Result.getOrThrow(computeChunkLights(loaded))
        for (const [key, light] of lights) {
          lightHash.update(key)
          lightHash.update(light.sky)
          lightHash.update(light.block)
          measuredLights++
        }
      }
    }
  }

  if (generatedChunks !== REPRODUCIBILITY_CHUNK_COUNT || measuredLights !== REPRODUCIBILITY_CHUNK_COUNT) {
    throw new Error(`expected ${String(REPRODUCIBILITY_CHUNK_COUNT)} terrain/light results, got ${String(generatedChunks)}/${String(measuredLights)}`)
  }
  const terrainDigest = terrainHash.digest('hex')
  const lightDigest = lightHash.digest('hex')
  if (
    terrainDigest !== '0e63cc11a60f9a4686aa4d71d52b14aeb35dceac7ea6175032257d75e4265700' ||
    lightDigest !== 'a17ae6119812f2edbf5bc37e861cf2d05bd98841960d02079db23cb4b63459a5'
  ) {
    throw new Error(`reproducibility digests changed: terrain=${terrainDigest}; light=${lightDigest}`)
  }
  console.log(`reproducibility: ${String(generatedChunks)} chunks and ${String(measuredLights)} light maps verified`)
}

main()
