import {
  BlockAxis,
  type BlockAxis as BlockAxisValue,
  ChunkAxis,
  type ChunkAxis as ChunkAxisValue,
  LocalAxis,
  type LocalAxis as LocalAxisValue,
} from '@nerima-games/mc-kernel/domain/coordinates'
import { Result } from 'effect'

export const blockAxis = (value: number): BlockAxisValue => Result.getOrThrow(BlockAxis.result(value))

export const chunkAxis = (value: number): ChunkAxisValue => Result.getOrThrow(ChunkAxis.result(value))

export const localAxis = (value: number): LocalAxisValue => Result.getOrThrow(LocalAxis.result(value))
