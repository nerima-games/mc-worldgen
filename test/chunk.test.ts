/**
 * `domain/chunk.ts`'s own totality: `readBlock` and `biomeAt` are documented as
 * total over any index, not just one `blockIndex`/`columnIndex` produces, but
 * every existing caller only ever passes an in-range index (they all derive it
 * from `blockIndex`/`columnIndex` themselves). The out-of-range fallback each
 * function falls back to is real, public behaviour — `chunk-format.test.ts`
 * CF-6 and CF-8 both cite it by name as the reason an oversized buffer or an
 * out-of-range biome column is silently tolerated everywhere except the save
 * schema — so it is exercised directly here rather than only through a comment.
 */
import { describe, expect, it } from '@effect/vitest'
import { AIR_BLOCK_ID, chunkCoord } from '@nerima-games/mc-kernel'
import { BLOCK } from '../src/domain/biome'
import { biomeAt, emptyBlocks, readBlock, type Chunk } from '../src/domain/chunk'
import { CHUNK_SIZE_XZ, CHUNK_VOLUME, blockIndex } from '../src/domain/constants'

describe('readBlock', () => {
  it('answers the stored id for every in-range index', () => {
    const blocks = emptyBlocks()
    const index = blockIndex(4, 10, 7)
    blocks[index] = BLOCK.STONE

    expect(readBlock(blocks, index)).toBe(BLOCK.STONE)
  })

  it('is total: an out-of-range index reads as air rather than throwing or reading undefined', () => {
    const blocks = emptyBlocks()

    // One past the end, and comfortably negative — the two ways a caller's own
    // arithmetic (not `blockIndex`) could hand this function a bad index.
    expect(readBlock(blocks, CHUNK_VOLUME)).toBe(AIR_BLOCK_ID)
    expect(readBlock(blocks, -1)).toBe(AIR_BLOCK_ID)
  })
})

describe('biomeAt', () => {
  const chunkWithBiome = (lx: number, lz: number, biome: Chunk['biomes'][number]): Chunk => {
    const biomes: Array<Chunk['biomes'][number]> = Array.from(
      { length: CHUNK_SIZE_XZ * CHUNK_SIZE_XZ },
      () => 'PLAINS',
    )
    biomes[lz * CHUNK_SIZE_XZ + lx] = biome
    return { biomes, blocks: emptyBlocks(), coord: chunkCoord(0, 0) }
  }

  it('answers the stored biome for every in-range column', () => {
    const chunk = chunkWithBiome(3, 9, 'DESERT')

    expect(biomeAt(chunk, 3, 9)).toBe('DESERT')
  })

  it('is total: an out-of-range column falls back to PLAINS rather than reading undefined', () => {
    // `columnIndex` is `lz * CHUNK_SIZE_XZ + lx`, so a column past the last row
    // (`lz === CHUNK_SIZE_XZ`) is the realistic way a caller's own coordinate
    // math — not `columnIndex` itself — lands here, and a negative one covers
    // the other direction.
    const chunk = chunkWithBiome(0, 0, 'DESERT')

    expect(biomeAt(chunk, 0, CHUNK_SIZE_XZ)).toBe('PLAINS')
    expect(biomeAt(chunk, -1, 0)).toBe('PLAINS')
  })
})
