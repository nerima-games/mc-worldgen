import {
  BLOCK_IDS,
  BlockId,
  type LightLevel,
  lightEmissionOfBlockId,
  transmitsLight,
} from '@nerima-games/mc-kernel'
import { Result } from 'effect'

const LIGHT_EMISSION_BY_BLOCK_ID: Array<LightLevel | undefined> = []
const TRANSMITS_LIGHT_BY_BLOCK_ID: Array<boolean | undefined> = []
for (const blockId of BLOCK_IDS) {
  LIGHT_EMISSION_BY_BLOCK_ID[blockId] = Result.getOrThrow(lightEmissionOfBlockId(blockId))
  TRANSMITS_LIGHT_BY_BLOCK_ID[blockId] = Result.getOrThrow(transmitsLight(blockId))
}

export const lightEmissionAt = (blockId: number): LightLevel => {
  const cached = LIGHT_EMISSION_BY_BLOCK_ID[blockId] ?? null
  if (cached !== null) {
    return cached
  }
  return Result.getOrThrow(lightEmissionOfBlockId(Result.getOrThrow(BlockId.result(blockId))))
}

export const blockTransmitsLight = (blockId: number): boolean => {
  const cached = TRANSMITS_LIGHT_BY_BLOCK_ID[blockId] ?? null
  if (cached !== null) {
    return cached
  }
  return Result.getOrThrow(transmitsLight(Result.getOrThrow(BlockId.result(blockId))))
}
