import {
  BlockAxis,
  type BlockAxis as BlockAxisValue,
  ChunkAxis,
  type ChunkAxis as ChunkAxisValue,
  LocalAxis,
  type LocalAxis as LocalAxisValue,
} from '@nerima-games/mc-kernel/domain/coordinates'
import { Brand, Result } from 'effect'

/** Use only after callers prove the coordinate invariant; these brands add no runtime checks. */
const knownSafeBlockAxis = Brand.nominal<BlockAxisValue>()
const knownLocalAxis = Brand.nominal<LocalAxisValue>()

export const blockAxisFromKnownSafeInteger = (value: number): BlockAxisValue => knownSafeBlockAxis(value)
export const localAxisFromKnownRange = (value: number): LocalAxisValue => knownLocalAxis(value)
export const blockAxis = (value: number): BlockAxisValue => Result.getOrThrow(BlockAxis.result(value))

export const chunkAxis = (value: number): ChunkAxisValue => Result.getOrThrow(ChunkAxis.result(value))

export const localAxis = (value: number): LocalAxisValue => Result.getOrThrow(LocalAxis.result(value))
