import { type BlockId, blockIdOf } from '@nerima-games/mc-kernel'

/** Block ids used by the structure planners, sourced from mc-kernel's registry. */
import { Option } from 'effect'
export const NATURAL_STRUCTURE_BLOCK: Readonly<
  Record<
    | 'CHEST'
    | 'END_ROD'
    | 'END_STONE_BRICKS'
    | 'NETHERRACK'
    | 'OBSIDIAN'
    | 'PURPUR'
    | 'PURPUR_PILLAR'
    | 'SANDSTONE'
    | 'TNT',
    BlockId
  >
> = Object.freeze({
  CHEST: Option.getOrThrow(blockIdOf('chest')),
  END_ROD: Option.getOrThrow(blockIdOf('end_rod')),
  END_STONE_BRICKS: Option.getOrThrow(blockIdOf('end_stone_bricks')),
  NETHERRACK: Option.getOrThrow(blockIdOf('netherrack')),
  OBSIDIAN: Option.getOrThrow(blockIdOf('obsidian')),
  PURPUR: Option.getOrThrow(blockIdOf('purpur_block')),
  PURPUR_PILLAR: Option.getOrThrow(blockIdOf('purpur_pillar')),
  SANDSTONE: Option.getOrThrow(blockIdOf('sandstone')),
  TNT: Option.getOrThrow(blockIdOf('tnt')),
})
