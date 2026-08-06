/* oxlint-disable id-length, max-statements, new-cap, no-magic-numbers, sort-imports */

import { type Option, Option as OptionValue, Schema } from 'effect'
import { BLOCK } from './biome'
import { BlockAxis, BlockId, type BlockPosition, blockPosition } from '@nerima-games/mc-kernel'
import type { Dimension } from './nether-travel'
import { STRONGHOLD_BLOCK } from './stronghold'
import { STRONGHOLD_FLOOR_Y } from './structure-siting'

export type EndPortalFrameFacing = 'north' | 'east' | 'south' | 'west'

export type EndPortalFrameState = {
  readonly block: BlockId
  readonly facing: EndPortalFrameFacing
}

export type EndPortalBlockAt = (x: number, y: number, z: number) => EndPortalFrameState | undefined

export type EndPortalMutation = {
  readonly at: BlockPosition
  readonly block: BlockId
}

export type CompletedEndPortal = {
  readonly center: BlockPosition
  readonly frames: ReadonlyArray<BlockPosition>
  readonly materialization: ReadonlyArray<EndPortalMutation>
}

export type EndArrivalDescriptor = {
  readonly dimension: 'end'
  readonly spawn: BlockPosition
  readonly facing: EndPortalFrameFacing
  readonly platform: ReadonlyArray<EndPortalMutation>
  readonly clear: ReadonlyArray<BlockPosition>
}

const BlockAxisFromNumber = Schema.Number.pipe(Schema.fromBrand(BlockAxis))

export const EndPortalFrameFacingSchema = Schema.Literal('north', 'east', 'south', 'west')

export const EndPortalCenterSchema: Schema.Schema<BlockPosition, {
  readonly x: number
  readonly y: number
  readonly z: number
}> = Schema.Struct({ x: BlockAxisFromNumber, y: BlockAxisFromNumber, z: BlockAxisFromNumber })

export const END_PORTAL_BLOCK = {
  FRAME_EMPTY: STRONGHOLD_BLOCK.END_PORTAL_FRAME,
  FRAME_FILLED: BlockId(88),
  PORTAL: BlockId(89),
} as const

type FrameOffset = {
  readonly dx: number
  readonly dz: number
  readonly facing: EndPortalFrameFacing
}

/** Clockwise, north edge first. Every frame faces the 3x3 interior. */
export const END_PORTAL_FRAME_OFFSETS: ReadonlyArray<FrameOffset> = [
  { dx: -1, dz: -2, facing: 'south' },
  { dx: 0, dz: -2, facing: 'south' },
  { dx: 1, dz: -2, facing: 'south' },
  { dx: 2, dz: -1, facing: 'west' },
  { dx: 2, dz: 0, facing: 'west' },
  { dx: 2, dz: 1, facing: 'west' },
  { dx: 1, dz: 2, facing: 'north' },
  { dx: 0, dz: 2, facing: 'north' },
  { dx: -1, dz: 2, facing: 'north' },
  { dx: -2, dz: 1, facing: 'east' },
  { dx: -2, dz: 0, facing: 'east' },
  { dx: -2, dz: -1, facing: 'east' },
]

export const endPortalCenterForStronghold = (site: { readonly x: number; readonly z: number }): BlockPosition =>
  blockPosition(site.x, STRONGHOLD_FLOOR_Y + 1, site.z)

export const detectCompletedEndPortal = (
  blockAt: EndPortalBlockAt,
  dimension: Dimension,
  center: BlockPosition,
): Option.Option<CompletedEndPortal> => {
  if (dimension !== 'overworld') {
    return OptionValue.none()
  }

  const frames: BlockPosition[] = []
  for (const offset of END_PORTAL_FRAME_OFFSETS) {
    const at = blockPosition(center.x + offset.dx, center.y, center.z + offset.dz)
    const state = blockAt(at.x, at.y, at.z)
    if (state?.block !== END_PORTAL_BLOCK.FRAME_FILLED || state.facing !== offset.facing) {
      return OptionValue.none()
    }
    frames.push(at)
  }

  const materialization: EndPortalMutation[] = []
  for (let dz = -1; dz <= 1; dz += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      materialization.push({
        at: blockPosition(center.x + dx, center.y, center.z + dz),
        block: END_PORTAL_BLOCK.PORTAL,
      })
    }
  }

  return OptionValue.some({ center, frames, materialization })
}

export const endArrivalDescriptor = (origin: BlockPosition): EndArrivalDescriptor => {
  const platform: EndPortalMutation[] = []
  const clear: BlockPosition[] = []

  for (let dz = -2; dz <= 2; dz += 1) {
    for (let dx = -2; dx <= 2; dx += 1) {
      platform.push({ at: blockPosition(origin.x + dx, origin.y, origin.z + dz), block: BLOCK.OBSIDIAN })
    }
  }
  for (let dy = 1; dy <= 3; dy += 1) {
    for (let dz = -1; dz <= 1; dz += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        clear.push(blockPosition(origin.x + dx, origin.y + dy, origin.z + dz))
      }
    }
  }

  return {
    clear,
    dimension: 'end',
    facing: 'north',
    platform,
    spawn: blockPosition(origin.x, origin.y + 1, origin.z),
  }
}
