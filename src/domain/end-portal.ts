/* oxlint-disable id-length, max-statements, new-cap, no-magic-numbers, sort-imports */

import { Option, Schema } from 'effect'
import { BLOCK } from './biome.js'
import { type BlockId, type BlockPosition, type Dimension, blockIdOf, blockPosition } from '@nerima-games/mc-kernel'
import { BlockAxis } from '@nerima-games/mc-kernel/domain/coordinates'
import { STRONGHOLD_BLOCK } from './stronghold.js'
import { type StrongholdSite, STRONGHOLD_FLOOR_Y } from './structure-siting.js'
import { blockAxis, blockAxisFromKnownSafeInteger } from './coordinate-compatibility.js'

export type EndPortalFrameFacing = 'north' | 'east' | 'south' | 'west'

export type EndPortalFrameState = {
  readonly block: BlockId
  readonly facing: EndPortalFrameFacing
}

export type EndPortalBlockAt = (x: BlockAxis, y: BlockAxis, z: BlockAxis) => EndPortalFrameState | undefined

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

const BlockAxisFromNumber = Schema.Number.pipe(Schema.fromBrand('BlockAxis', BlockAxis))

export const EndPortalFrameFacingSchema: Schema.Codec<EndPortalFrameFacing> = Schema.Literals(['north', 'east', 'south', 'west'])

export const EndPortalCenterSchema: Schema.Codec<BlockPosition, {
  readonly x: number
  readonly y: number
  readonly z: number
}> = Schema.Struct({ x: BlockAxisFromNumber, y: BlockAxisFromNumber, z: BlockAxisFromNumber })

export const END_PORTAL_BLOCK: Readonly<Record<'FRAME_EMPTY' | 'FRAME_FILLED' | 'PORTAL', BlockId>> = {
  FRAME_EMPTY: STRONGHOLD_BLOCK.END_PORTAL_FRAME,
  FRAME_FILLED: Option.getOrThrow(blockIdOf('end_portal_frame_filled')),
  PORTAL: Option.getOrThrow(blockIdOf('end_portal')),
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

export const endPortalCenterForStronghold = (site: StrongholdSite): BlockPosition =>
  blockPosition(site.x, blockAxis(STRONGHOLD_FLOOR_Y + 1), site.z)

export const detectCompletedEndPortal = (
  blockAt: EndPortalBlockAt,
  dimension: Dimension,
  center: BlockPosition,
): Option.Option<CompletedEndPortal> => {
  if (dimension !== 'overworld') {
    return Option.none()
  }

  const frames: BlockPosition[] = []
  for (const offset of END_PORTAL_FRAME_OFFSETS) {
    const x = BlockAxis.option(center.x + offset.dx)
    const z = BlockAxis.option(center.z + offset.dz)
    if (Option.isNone(x) || Option.isNone(z)) {
      return Option.none()
    }
    const at = blockPosition(x.value, center.y, z.value)
    const state = blockAt(at.x, at.y, at.z)
    if (state?.block !== END_PORTAL_BLOCK.FRAME_FILLED || state.facing !== offset.facing) {
      return Option.none()
    }
    frames.push(at)
  }

  const materialization: EndPortalMutation[] = []
  // The validated outer ring at radius two proves the inner radius-one coordinates are safe.
  for (let dz = -1; dz <= 1; dz += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      materialization.push({
        at: blockPosition(
          blockAxisFromKnownSafeInteger(center.x + dx),
          center.y,
          blockAxisFromKnownSafeInteger(center.z + dz),
        ),
        block: END_PORTAL_BLOCK.PORTAL,
      })
    }
  }

  return Option.some({ center, frames, materialization })
}

export const endArrivalDescriptor = (origin: BlockPosition): EndArrivalDescriptor => {
  const platform: EndPortalMutation[] = []
  const clear: BlockPosition[] = []

  for (let dz = -2; dz <= 2; dz += 1) {
    for (let dx = -2; dx <= 2; dx += 1) {
      platform.push({
        at: blockPosition(blockAxis(origin.x + dx), origin.y, blockAxis(origin.z + dz)),
        block: BLOCK.OBSIDIAN,
      })
    }
  }
  for (let dy = 1; dy <= 3; dy += 1) {
    for (let dz = -1; dz <= 1; dz += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        clear.push(blockPosition(
          blockAxis(origin.x + dx),
          blockAxis(origin.y + dy),
          blockAxis(origin.z + dz),
        ))
      }
    }
  }

  return {
    clear,
    dimension: 'end',
    facing: 'north',
    platform,
    spawn: blockPosition(origin.x, blockAxis(origin.y + 1), origin.z),
  }
}
