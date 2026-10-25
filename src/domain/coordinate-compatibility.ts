import { Result } from 'effect'
import {
  BlockAxis,
  ChunkAxis,
  LocalAxis,
  type BlockAxis as BlockAxisValue,
  type ChunkAxis as ChunkAxisValue,
  type LocalAxis as LocalAxisValue,
} from '@nerima-games/mc-kernel/domain/coordinates'

export const blockAxis = (value: number): BlockAxisValue => Result.getOrThrow(BlockAxis.result(value))

export const chunkAxis = (value: number): ChunkAxisValue => Result.getOrThrow(ChunkAxis.result(value))

export const localAxis = (value: number): LocalAxisValue => Result.getOrThrow(LocalAxis.result(value))
