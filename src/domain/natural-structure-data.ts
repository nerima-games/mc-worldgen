import { type BlockId, blockIdOf } from '@nerima-games/mc-kernel'

/** Block ids used by the structure planners, sourced from mc-kernel's registry. */
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
  CHEST: blockIdOf('chest'),
  END_ROD: blockIdOf('end_rod'),
  END_STONE_BRICKS: blockIdOf('end_stone_bricks'),
  NETHERRACK: blockIdOf('netherrack'),
  OBSIDIAN: blockIdOf('obsidian'),
  PURPUR: blockIdOf('purpur_block'),
  PURPUR_PILLAR: blockIdOf('purpur_pillar'),
  SANDSTONE: blockIdOf('sandstone'),
  TNT: blockIdOf('tnt'),
})
