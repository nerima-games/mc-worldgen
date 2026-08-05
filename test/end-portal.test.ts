/* oxlint-disable id-length, no-magic-numbers, no-ternary, sort-imports */

import { describe, expect, it } from '@effect/vitest'
import { Effect, Option, Schema } from 'effect'
import {
  END_PORTAL_BLOCK,
  END_PORTAL_FRAME_OFFSETS,
  type EndPortalBlockAt,
  EndPortalCenterSchema,
  type EndPortalFrameFacing,
  detectCompletedEndPortal,
  endArrivalDescriptor,
} from '../src/domain/end-portal'
import { blockPosition } from '@nerima-games/mc-kernel'

const center = blockPosition(100, 32, -200)
const key = (x: number, y: number, z: number): string => `${x},${y},${z}`

const completedFrame = (): Map<string, { readonly block: number; readonly facing: EndPortalFrameFacing }> =>
  new Map(END_PORTAL_FRAME_OFFSETS.map(({ dx, dz, facing }) => [
    key(center.x + dx, center.y, center.z + dz),
    { block: END_PORTAL_BLOCK.FRAME_FILLED, facing },
  ]))

const accessor = (blocks: ReadonlyMap<string, { readonly block: number; readonly facing: EndPortalFrameFacing }>): EndPortalBlockAt =>
  (x, y, z) => blocks.get(key(x, y, z))

describe('detectCompletedEndPortal', () => {
  it.effect('requires all twelve inward-facing filled frames and emits the inner 3x3 deterministically', () => Effect.sync(() => {
    const found = Option.getOrThrow(detectCompletedEndPortal(accessor(completedFrame()), 'overworld', center))
    expect(found.frames).toHaveLength(12)
    expect(found.materialization.map(({ at }) => key(at.x, at.y, at.z))).toStrictEqual([
      '99,32,-201', '100,32,-201', '101,32,-201',
      '99,32,-200', '100,32,-200', '101,32,-200',
      '99,32,-199', '100,32,-199', '101,32,-199',
    ])
    expect(found.materialization.every(({ block }) => block === END_PORTAL_BLOCK.PORTAL)).toBe(true)
  }))

  it.effect('rejects every missing frame and every wrong orientation', () => Effect.sync(() => {
    for (const offset of END_PORTAL_FRAME_OFFSETS) {
      const missing = completedFrame()
      const at = key(center.x + offset.dx, center.y, center.z + offset.dz)
      missing.delete(at)
      expect(Option.isNone(detectCompletedEndPortal(accessor(missing), 'overworld', center))).toBe(true)

      const wrong = completedFrame()
      const wrongFacing = offset.facing === 'north' ? 'south' : 'north'
      wrong.set(at, { block: END_PORTAL_BLOCK.FRAME_FILLED, facing: wrongFacing })
      expect(Option.isNone(detectCompletedEndPortal(accessor(wrong), 'overworld', center))).toBe(true)
    }
  }))

  it.effect('rejects empty frames, unrelated blocks, and non-overworld dimensions', () => Effect.sync(() => {
    const empty = completedFrame()
    const first = END_PORTAL_FRAME_OFFSETS[0]!
    empty.set(key(center.x + first.dx, center.y, center.z + first.dz), {
      block: END_PORTAL_BLOCK.FRAME_EMPTY,
      facing: first.facing,
    })
    expect(Option.isNone(detectCompletedEndPortal(accessor(empty), 'overworld', center))).toBe(true)
    expect(Option.isNone(detectCompletedEndPortal(accessor(completedFrame()), 'nether', center))).toBe(true)
    expect(Option.isNone(detectCompletedEndPortal(accessor(completedFrame()), 'end', center))).toBe(true)
  }))
})

describe('endArrivalDescriptor', () => {
  it.effect('builds a stable 5x5 platform, clears headroom, and spawns above its center', () => Effect.sync(() => {
    const descriptor = endArrivalDescriptor(blockPosition(-4, 60, 9))
    expect(descriptor.dimension).toBe('end')
    expect(descriptor.platform).toHaveLength(25)
    expect(descriptor.clear).toHaveLength(27)
    expect(descriptor.spawn).toStrictEqual(blockPosition(-4, 61, 9))
    expect(new Set(descriptor.platform.map(({ at }) => key(at.x, at.y, at.z))).size).toBe(25)
    expect(new Set(descriptor.clear.map(({ x, y, z }) => key(x, y, z))).size).toBe(27)
  }))

  it.effect('is deterministic and rejects unsafe coordinates at the public codec boundary', () => Effect.sync(() => {
    const origin = blockPosition(7, 70, 8)
    expect(endArrivalDescriptor(origin)).toStrictEqual(endArrivalDescriptor(origin))
    expect(Schema.decodeUnknownSync(EndPortalCenterSchema)({ x: 7, y: 70, z: 8 })).toStrictEqual(origin)
    expect(() => Schema.decodeUnknownSync(EndPortalCenterSchema)({ x: 1.5, y: 70, z: 8 })).toThrow()
    expect(() => Schema.decodeUnknownSync(EndPortalCenterSchema)({ x: Number.MAX_SAFE_INTEGER + 1, y: 70, z: 8 })).toThrow()
  }))
})
