/* oxlint-disable id-length, max-statements, new-cap, no-magic-numbers */

import { describe, expect, it } from '@effect/vitest'
import { Effect, Option, Result } from 'effect'
import { BLOCK } from '../src/domain/biome.js'
import {
  PortalHeight,
  PortalWidth,
  blockPosition,
  type BlockAt,
  type BlockPosition,
} from '@nerima-games/mc-kernel'
import { detectNetherPortal, generatePortalLayout } from '../src/domain/portal-frame.js'
import { blockAxis } from './fixtures/validated-inputs.js'

const at = (x: number, y: number, z: number): BlockPosition =>
  blockPosition(blockAxis(x), blockAxis(y), blockAxis(z))

const plain = (position: BlockPosition): { readonly x: number; readonly y: number; readonly z: number } => ({
  x: position.x,
  y: position.y,
  z: position.z,
})

const key = (position: BlockPosition): string => `${String(position.x)},${String(position.y)},${String(position.z)}`

const blockAtWithObsidian = (obsidian: ReadonlyArray<BlockPosition>): BlockAt => {
  const frame = new Set(obsidian.map(key))
  return (x, y, z) => (frame.has(key(blockPosition(x, y, z))) ? BLOCK.OBSIDIAN : BLOCK.AIR)
}

const WIDTH_TWO = Result.getOrThrow(PortalWidth.result(2))
const HEIGHT_THREE = Result.getOrThrow(PortalHeight.result(3))

const X_ORIGIN = at(4, 20, 10)
const X_FRAME: ReadonlyArray<BlockPosition> = [
  at(3, 19, 10),
  at(3, 20, 10),
  at(3, 21, 10),
  at(3, 22, 10),
  at(3, 23, 10),
  at(4, 19, 10),
  at(4, 23, 10),
  at(5, 19, 10),
  at(5, 23, 10),
  at(6, 19, 10),
  at(6, 20, 10),
  at(6, 21, 10),
  at(6, 22, 10),
  at(6, 23, 10),
]
const X_INTERIOR: ReadonlyArray<BlockPosition> = [
  at(4, 20, 10),
  at(4, 21, 10),
  at(4, 22, 10),
  at(5, 20, 10),
  at(5, 21, 10),
  at(5, 22, 10),
]

const Z_ORIGIN = at(10, 20, 4)
const Z_FRAME: ReadonlyArray<BlockPosition> = [
  at(10, 19, 3),
  at(10, 20, 3),
  at(10, 21, 3),
  at(10, 22, 3),
  at(10, 23, 3),
  at(10, 19, 4),
  at(10, 23, 4),
  at(10, 19, 5),
  at(10, 23, 5),
  at(10, 19, 6),
  at(10, 20, 6),
  at(10, 21, 6),
  at(10, 22, 6),
  at(10, 23, 6),
]
const Z_INTERIOR: ReadonlyArray<BlockPosition> = [
  at(10, 20, 4),
  at(10, 21, 4),
  at(10, 22, 4),
  at(10, 20, 5),
  at(10, 21, 5),
  at(10, 22, 5),
]

describe('generatePortalLayout', () => {
  it.effect('returns the expected x-axis ring and interior cells', () =>
    Effect.sync(() => {
      const layout = generatePortalLayout(X_ORIGIN, 'x', WIDTH_TWO, HEIGHT_THREE)
      expect(layout.frame.map(plain)).toStrictEqual(X_FRAME.map(plain))
      expect(layout.interior.map(plain)).toStrictEqual(X_INTERIOR.map(plain))
    }),
  )

  it.effect('returns the expected z-axis ring and interior cells', () =>
    Effect.sync(() => {
      const layout = generatePortalLayout(Z_ORIGIN, 'z', WIDTH_TWO, HEIGHT_THREE)
      expect(layout.frame.map(plain)).toStrictEqual(Z_FRAME.map(plain))
      expect(layout.interior.map(plain)).toStrictEqual(Z_INTERIOR.map(plain))
    }),
  )

  it.effect('the portal size brands reject out-of-range and fractional dimensions', () =>
    Effect.sync(() => {
      expect(Option.isSome(PortalWidth.option(2))).toBe(true)
      expect(Option.isSome(PortalHeight.option(3))).toBe(true)
      expect(Option.isNone(PortalWidth.option(1))).toBe(true)
      expect(Option.isNone(PortalWidth.option(22))).toBe(true)
      expect(Option.isNone(PortalWidth.option(2.5))).toBe(true)
      expect(Option.isNone(PortalHeight.option(2))).toBe(true)
      expect(Option.isNone(PortalHeight.option(22))).toBe(true)
      expect(Option.isNone(PortalHeight.option(Number.NaN))).toBe(true)
    }),
  )
})

describe('detectNetherPortal', () => {
  it.effect('detects an x-axis portal and reports its geometry', () =>
    Effect.sync(() => {
      const detected = detectNetherPortal(blockAtWithObsidian(X_FRAME), at(4, 21, 10))
      expect(detected).toBeDefined()
      expect(detected?.axis).toBe('x')
      expect(detected?.width).toBe(2)
      expect(detected?.height).toBe(3)
      expect(detected?.interior.map(plain)).toStrictEqual(X_INTERIOR.map(plain))
    }),
  )

  it.effect('detects a z-axis portal', () =>
    Effect.sync(() => {
      const detected = detectNetherPortal(blockAtWithObsidian(Z_FRAME), at(10, 21, 4))
      expect(detected?.axis).toBe('z')
      expect(detected?.interior.map(plain)).toStrictEqual(Z_INTERIOR.map(plain))
    }),
  )

  it.effect('rejects a non-air ignition cell and a broken obsidian ring', () =>
    Effect.sync(() => {
      expect(detectNetherPortal(blockAtWithObsidian([...X_FRAME, at(4, 21, 10)]), at(4, 21, 10))).toBeUndefined()

      const brokenFrame = X_FRAME.filter((cell) => key(cell) !== key(at(3, 21, 10)))
      expect(detectNetherPortal(blockAtWithObsidian(brokenFrame), at(4, 21, 10))).toBeUndefined()
    }),
  )
})
