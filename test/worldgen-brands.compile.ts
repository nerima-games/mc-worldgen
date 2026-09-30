import {
  BlockAxis,
  ChunkAxis,
  ChunkHeight,
  LocalAxis,
  chunkCoord,
  chunkKeyOf,
  type BlockAxis as BlockAxisType,
  type ChunkAxis as ChunkAxisType,
  type ChunkHeight as ChunkHeightType,
  type ChunkKey,
  type LocalAxis as LocalAxisType,
} from '@nerima-games/mc-kernel'
import { NoiseSeed, type NoiseSeed as NoiseSeedType } from '@nerima-games/mc-noise'
import { SaveKey, type SaveKey as SaveKeyType } from '@nerima-games/mc-save'

const blockAxis = BlockAxis(1)
const chunkAxis = ChunkAxis(1)
const localAxis = LocalAxis(1)
const chunkHeight = ChunkHeight(256)
const chunkKey = chunkKeyOf(chunkCoord(0, 0))
const noiseSeed = NoiseSeed(1)
const saveKey = SaveKey('world/chunk')

const acceptedBlockAxis: BlockAxisType = blockAxis
const acceptedChunkAxis: ChunkAxisType = chunkAxis
const acceptedLocalAxis: LocalAxisType = localAxis
const acceptedChunkHeight: ChunkHeightType = chunkHeight
const acceptedChunkKey: ChunkKey = chunkKey
const acceptedNoiseSeed: NoiseSeedType = noiseSeed
const acceptedSaveKey: SaveKeyType = saveKey

// Coordinate brands must not cross the chunk, block, and local boundaries.
// @ts-expect-error ChunkAxis and BlockAxis are distinct brands.
const blockFromChunk: BlockAxisType = chunkAxis
// @ts-expect-error ChunkAxis and LocalAxis are distinct brands.
const localFromChunk: LocalAxisType = chunkAxis
// @ts-expect-error BlockAxis and LocalAxis are distinct brands.
const localFromBlock: LocalAxisType = blockAxis
// @ts-expect-error ChunkHeight is distinct from every coordinate axis.
const axisFromHeight: ChunkAxisType = chunkHeight

// A validated ChunkKey cannot be reconstructed from an arbitrary string.
// @ts-expect-error string is not a validated ChunkKey.
const keyFromString: ChunkKey = '0,0'

// Noise and save brands must remain distinct from each other and coordinates.
// @ts-expect-error NoiseSeed is not a SaveKey.
const saveFromNoise: SaveKeyType = noiseSeed
// @ts-expect-error SaveKey is not a NoiseSeed.
const noiseFromSave: NoiseSeedType = saveKey
// @ts-expect-error NoiseSeed is not a BlockAxis.
const axisFromNoise: BlockAxisType = noiseSeed

void acceptedBlockAxis
void acceptedChunkAxis
void acceptedLocalAxis
void acceptedChunkHeight
void acceptedChunkKey
void acceptedNoiseSeed
void acceptedSaveKey
void blockFromChunk
void localFromChunk
void localFromBlock
void axisFromHeight
void keyFromString
void saveFromNoise
void noiseFromSave
void axisFromNoise
