import { Result } from 'effect'
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
import type { ValidatedNaturalStructureChunkCoordinates } from '../src/domain/natural-structure-chunk-planner'
import type { ValidatedNaturalStructureRegionAxis } from '../src/domain/natural-structure-coordinate-validation'

const blockAxis = Result.getOrThrow(BlockAxis.result(1))
const chunkAxis = Result.getOrThrow(ChunkAxis.result(1))
const localAxis = Result.getOrThrow(LocalAxis.result(1))
const chunkHeight = Result.getOrThrow(ChunkHeight(256))
const chunkKey = chunkKeyOf(chunkCoord(Result.getOrThrow(ChunkAxis.result(0)), Result.getOrThrow(ChunkAxis.result(0))))
const noiseSeed = Result.getOrThrow(NoiseSeed.result(1))
const saveKey = SaveKey('world/chunk')
const unvalidatedChunkCoordinates = { coord: chunkCoord(chunkAxis, chunkAxis), minBlockX: blockAxis, minBlockZ: blockAxis }

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

// Coordinate proofs must come from their validators, not matching object fields or plain numbers.
// @ts-expect-error A structurally matching chunk coordinate object is not validated.
const forgedValidatedChunkCoordinates: ValidatedNaturalStructureChunkCoordinates = unvalidatedChunkCoordinates
// @ts-expect-error A plain region number is not a validated region axis.
const forgedValidatedRegionAxis: ValidatedNaturalStructureRegionAxis = 1

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
void forgedValidatedChunkCoordinates
void forgedValidatedRegionAxis
