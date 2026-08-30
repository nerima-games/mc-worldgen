import { type BlockPosition, blockPositionKeyOf } from '@nerima-games/mc-kernel'
import type { Dimension } from './nether-travel'

export type PortalRegistryState = {
  readonly overworld: ReadonlyArray<BlockPosition>
  readonly nether: ReadonlyArray<BlockPosition>
  readonly end: ReadonlyArray<BlockPosition>
}

export const emptyPortalRegistryState: PortalRegistryState = {
  end: [],
  nether: [],
  overworld: [],
}

export const portalsInDimension = (
  state: PortalRegistryState,
  dimension: Dimension,
): ReadonlyArray<BlockPosition> => state[dimension]

const withPortals = (
  state: PortalRegistryState,
  dimension: Dimension,
  portals: ReadonlyArray<BlockPosition>,
): PortalRegistryState => ({ ...state, [dimension]: portals })

export const registerPortal = (
  state: PortalRegistryState,
  dimension: Dimension,
  position: BlockPosition,
): PortalRegistryState => {
  const portals = portalsInDimension(state, dimension)
  const positionKey = blockPositionKeyOf(position)
  if (portals.some((portal) => blockPositionKeyOf(portal) === positionKey)) {
    return state
  }
  return withPortals(state, dimension, [...portals, position])
}

export const unregisterPortal = (
  state: PortalRegistryState,
  dimension: Dimension,
  position: BlockPosition,
): PortalRegistryState => {
  const portals = portalsInDimension(state, dimension)
  const positionKey = blockPositionKeyOf(position)
  const remaining = portals.filter((portal) => blockPositionKeyOf(portal) !== positionKey)
  if (remaining.length === portals.length) {
    return state
  }
  return withPortals(state, dimension, remaining)
}
