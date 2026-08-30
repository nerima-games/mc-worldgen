/** Pure End gateway configuration, placement, and relocation values. */
import {
  type BlockId,
  type BlockPosition,
  blockIdOf,
  blockPosition,
} from '@nerima-games/mc-kernel'

export const END_GATEWAY_BLOCK = Object.freeze({
  BEDROCK: blockIdOf('bedrock'),
  GATEWAY: blockIdOf('end_gateway'),
})

export type EndGatewayConfiguration = {
  readonly exit?: BlockPosition
  readonly exact: boolean
}

export type EndGatewayExit = {
  readonly position: BlockPosition
  readonly exact: boolean
}

export type EndGatewayBlockPlacement = {
  readonly position: BlockPosition
  readonly block: BlockId
}

export type EndGatewayPlacement = {
  readonly position: BlockPosition
  readonly blocks: ReadonlyArray<EndGatewayBlockPlacement>
  readonly configuration: EndGatewayConfiguration
}

const GATEWAY_SHELL_RADIUS = 1

/** Match the vanilla known-exit gateway configuration. */
export const knownEndGatewayExit = (exit: BlockPosition, exact: boolean): EndGatewayConfiguration =>
  Object.freeze({ exact, exit })

/** Match the vanilla delayed-exit gateway configuration. */
export const delayedEndGatewayExitSearch = (): EndGatewayConfiguration =>
  Object.freeze({ exact: false })

type GatewayOffset = readonly [x: number, y: number, z: number]

const gatewayShellOffsets = (): ReadonlyArray<GatewayOffset> => {
  const offsets: Array<GatewayOffset> = []

  for (let x = -GATEWAY_SHELL_RADIUS; x <= GATEWAY_SHELL_RADIUS; x += GATEWAY_SHELL_RADIUS) {
    for (let y = -GATEWAY_SHELL_RADIUS; y <= GATEWAY_SHELL_RADIUS; y += GATEWAY_SHELL_RADIUS) {
      for (let z = -GATEWAY_SHELL_RADIUS; z <= GATEWAY_SHELL_RADIUS; z += GATEWAY_SHELL_RADIUS) {
        if (
          Math.abs(x) === GATEWAY_SHELL_RADIUS ||
          Math.abs(y) === GATEWAY_SHELL_RADIUS ||
          Math.abs(z) === GATEWAY_SHELL_RADIUS
        ) {
          offsets.push([x, y, z])
        }
      }
    }
  }

  return Object.freeze(offsets)
}

const END_GATEWAY_SHELL_OFFSETS = gatewayShellOffsets()

const offsetPosition = (origin: BlockPosition, [offsetX, offsetY, offsetZ]: GatewayOffset): BlockPosition =>
  blockPosition(origin.x + offsetX, origin.y + offsetY, origin.z + offsetZ)

const gatewayBlocksAt = (position: BlockPosition): ReadonlyArray<EndGatewayBlockPlacement> =>
  Object.freeze([
    Object.freeze({ block: END_GATEWAY_BLOCK.GATEWAY, position }),
    ...END_GATEWAY_SHELL_OFFSETS.map((offset) => Object.freeze({
      block: END_GATEWAY_BLOCK.BEDROCK,
      position: offsetPosition(position, offset),
    })),
  ])

/** Create the immutable gateway block shell and its exit configuration. */
export const createEndGatewayPlacement = (
  position: BlockPosition,
  configuration: EndGatewayConfiguration = delayedEndGatewayExitSearch(),
): EndGatewayPlacement => Object.freeze({
  blocks: gatewayBlocksAt(position),
  configuration,
  position,
})

/** Relocate a gateway without mutating the original placement. */
export const moveEndGatewayPlacement = (
  placement: EndGatewayPlacement,
  position: BlockPosition,
): EndGatewayPlacement => createEndGatewayPlacement(position, placement.configuration)

/** Replace a gateway's configuration while retaining its current position. */
export const configureEndGatewayPlacement = (
  placement: EndGatewayPlacement,
  configuration: EndGatewayConfiguration,
): EndGatewayPlacement => createEndGatewayPlacement(placement.position, configuration)

/** Resolve a configured exit first, then a host-provided delayed search result. */
export const resolveEndGatewayExit = (
  configuration: EndGatewayConfiguration,
  searchedExit?: BlockPosition,
): EndGatewayExit | undefined => {
  if (configuration.exit) {
    return Object.freeze({ exact: configuration.exact, position: configuration.exit })
  }

  if (!searchedExit) {
    return
  }

  return Object.freeze({ exact: false, position: searchedExit })
}
