/* oxlint-disable id-length, max-statements, no-magic-numbers, sort-imports */

import { describe, expect, it } from '@effect/vitest'
import { blockPosition } from '@nerima-games/mc-kernel'
import {
  END_GATEWAY_BLOCK,
  configureEndGatewayPlacement,
  createEndGatewayPlacement,
  delayedEndGatewayExitSearch,
  knownEndGatewayExit,
  moveEndGatewayPlacement,
  resolveEndGatewayExit,
} from '../src/domain/end-gateway'

describe('End gateway', () => {
  it('creates an immutable bedrock shell with a gateway center', () => {
    const position = blockPosition(10, 64, -3)
    const placement = createEndGatewayPlacement(position)
    const center = placement.blocks.find(({ position: at }) => at === position)
    const bedrock = placement.blocks.filter(({ block }) => block === END_GATEWAY_BLOCK.BEDROCK)

    expect(placement.position).toStrictEqual(position)
    expect(placement.blocks).toHaveLength(27)
    expect(center).toStrictEqual({ position, block: END_GATEWAY_BLOCK.GATEWAY })
    expect(bedrock).toHaveLength(26)
    expect(placement.blocks.some(({ position: at, block }) => at === position && block === END_GATEWAY_BLOCK.BEDROCK)).toBe(
      false,
    )
    expect(placement.configuration).toStrictEqual({ exact: false })
    expect(Object.isFrozen(placement)).toBe(true)
    expect(Object.isFrozen(placement.blocks)).toBe(true)
    expect(Object.isFrozen(placement.configuration)).toBe(true)
    expect(Object.isFrozen(center)).toBe(true)
  })

  it('preserves known and delayed exits through movement and configuration changes', () => {
    const origin = blockPosition(0, 64, 0)
    const movedTo = blockPosition(8, 70, -4)
    const exit = blockPosition(100, 80, -200)
    const known = knownEndGatewayExit(exit, true)
    const delayed = delayedEndGatewayExitSearch()
    const placement = createEndGatewayPlacement(origin, known)
    const moved = moveEndGatewayPlacement(placement, movedTo)
    const configured = configureEndGatewayPlacement(moved, delayed)

    expect(resolveEndGatewayExit(known)).toStrictEqual({ position: exit, exact: true })
    expect(resolveEndGatewayExit(known, blockPosition(1, 2, 3))).toStrictEqual({ position: exit, exact: true })
    expect(resolveEndGatewayExit(delayed)).toBeUndefined()
    expect(resolveEndGatewayExit(delayed, exit)).toStrictEqual({ position: exit, exact: false })
    expect(placement.position).toStrictEqual(origin)
    expect(placement.configuration).toStrictEqual(known)
    expect(moved.position).toStrictEqual(movedTo)
    expect(moved.configuration).toStrictEqual(known)
    expect(moved.blocks).not.toBe(placement.blocks)
    expect(moved.blocks.find(({ position: at }) => at === movedTo)).toStrictEqual({
      position: movedTo,
      block: END_GATEWAY_BLOCK.GATEWAY,
    })
    expect(configured.position).toStrictEqual(movedTo)
    expect(configured.configuration).toStrictEqual(delayed)
    expect(Object.isFrozen(known)).toBe(true)
    expect(Object.isFrozen(delayed)).toBe(true)
    expect(Object.isFrozen(moved)).toBe(true)
  })
})
