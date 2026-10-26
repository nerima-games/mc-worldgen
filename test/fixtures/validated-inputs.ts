import { Result } from 'effect'
import {
  blockPosition as createBlockPosition,
  chunkCoord as createChunkCoord,
  type BlockPosition,
  type ChunkCoord,
} from '@nerima-games/mc-kernel'
import { NoiseSeed, type NoiseSeed as NoiseSeedValue } from '@nerima-games/mc-noise'
import {
  SaveFormatName,
  SaveFormatVersion,
  type SaveFormatName as SaveFormatNameValue,
  type SaveFormatVersion as SaveFormatVersionValue,
} from '@nerima-games/mc-save'
import { blockAxis, chunkAxis, localAxis } from '../../src/domain/coordinate-compatibility'

export { blockAxis, chunkAxis, localAxis }

export const noiseSeed = (value: number): NoiseSeedValue => Result.getOrThrow(NoiseSeed.result(value))

export const validatedBlockPosition = (x: number, y: number, z: number): BlockPosition =>
  createBlockPosition(blockAxis(x), blockAxis(y), blockAxis(z))

export const validatedChunkCoord = (cx: number, cz: number): ChunkCoord =>
  createChunkCoord(chunkAxis(cx), chunkAxis(cz))

export const saveFormatName = (value: string): SaveFormatNameValue =>
  Result.getOrThrow(SaveFormatName.result(value))

export const saveFormatVersion = (value: number): SaveFormatVersionValue =>
  Result.getOrThrow(SaveFormatVersion.result(value))
