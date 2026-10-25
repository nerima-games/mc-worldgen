/* oxlint-disable id-length, max-statements, new-cap, no-magic-numbers */

import {
  type BlockAt,
  BlockAxis,
  type BlockId,
  type BlockPosition,
  MAX_PORTAL_HEIGHT,
  MAX_PORTAL_WIDTH,
  type PortalAxis,
  type PortalFrame,
  PortalHeight,
  type PortalLayout,
  PortalWidth,
  blockPosition,
} from '@nerima-games/mc-kernel'
import { Option, Result } from 'effect'
import { BLOCK } from './biome.js'

type PlanePoint = Readonly<{ h: number; y: number }>
type PortalExtent = Readonly<{ height: number; width: number }>
type PlaneContext = Readonly<{ axis: PortalAxis; blockAt: BlockAt; fixed: BlockAxis }>

const RING_MARGIN = 1
const OVER_SIZED_MARGIN = 1

const axisAt = (coordinate: number): BlockAxis => Result.getOrThrow(BlockAxis.result(coordinate))

const probe = (context: PlaneContext, h: number, y: number): BlockId | undefined => {
  const horizontal = BlockAxis.option(h)
  const vertical = BlockAxis.option(y)
  if (Option.isNone(horizontal) || Option.isNone(vertical)) {return}
  if (context.axis === 'x') {
    return context.blockAt(horizontal.value, vertical.value, context.fixed)
  }
  return context.blockAt(context.fixed, vertical.value, horizontal.value)
}

const positionAt = (axis: PortalAxis, fixed: BlockAxis, h: number, y: number): BlockPosition => {
  if (axis === 'x') {
    return blockPosition(axisAt(h), axisAt(y), fixed)
  }
  return blockPosition(fixed, axisAt(y), axisAt(h))
}

const countAir = (context: PlaneContext, start: PlanePoint, step: PlanePoint, max: number): number => {
  let count = 0
  while (count < max && probe(context, start.h + step.h * count, start.y + step.y * count) === BLOCK.AIR) {
    count += 1
  }
  return count
}

const findBottomLeftCorner = (context: PlaneContext, h0: number, y0: number): PlanePoint => {
  const bottomY =
    y0 -
    (countAir(context, { h: h0, y: y0 }, { h: 0, y: -1 }, MAX_PORTAL_HEIGHT + OVER_SIZED_MARGIN) - 1)
  const leftH =
    h0 -
    (countAir(context, { h: h0, y: bottomY }, { h: -1, y: 0 }, MAX_PORTAL_WIDTH + OVER_SIZED_MARGIN) - 1)
  return { h: leftH, y: bottomY }
}

const measureInterior = (context: PlaneContext, corner: PlanePoint): PortalExtent => ({
  height: countAir(context, corner, { h: 0, y: 1 }, MAX_PORTAL_HEIGHT + OVER_SIZED_MARGIN),
  width: countAir(context, corner, { h: 1, y: 0 }, MAX_PORTAL_WIDTH + OVER_SIZED_MARGIN),
})

const collectRectangle = (
  axis: PortalAxis,
  fixed: BlockAxis,
  corner: PlanePoint,
  extent: PortalExtent,
): BlockPosition[] => {
  const { h: cornerH, y: cornerY } = corner
  const { height, width } = extent
  const cells: BlockPosition[] = []
  for (let h = cornerH; h < cornerH + width; h += 1) {
    for (let y = cornerY; y < cornerY + height; y += 1) {
      cells.push(positionAt(axis, fixed, h, y))
    }
  }
  return cells
}

const collectRing = (
  axis: PortalAxis,
  fixed: BlockAxis,
  corner: PlanePoint,
  extent: PortalExtent,
): BlockPosition[] => {
  const cells: BlockPosition[] = []
  for (let h = corner.h - RING_MARGIN; h <= corner.h + extent.width; h += 1) {
    for (let y = corner.y - RING_MARGIN; y <= corner.y + extent.height; y += 1) {
      if (
        h === corner.h - RING_MARGIN ||
        h === corner.h + extent.width ||
        y === corner.y - RING_MARGIN ||
        y === corner.y + extent.height
      ) {
        cells.push(positionAt(axis, fixed, h, y))
      }
    }
  }
  return cells
}

const interiorIsClear = (context: PlaneContext, corner: PlanePoint, extent: PortalExtent): boolean => {
  const { h: cornerH, y: cornerY } = corner
  const { height, width } = extent
  for (let h = cornerH; h < cornerH + width; h += 1) {
    for (let y = cornerY; y < cornerY + height; y += 1) {
      if (probe(context, h, y) !== BLOCK.AIR) {
        return false
      }
    }
  }
  return true
}

const ringIsObsidian = (context: PlaneContext, corner: PlanePoint, extent: PortalExtent): boolean => {
  const { h: cornerH, y: cornerY } = corner
  const { height, width } = extent
  for (let h = cornerH; h < cornerH + width; h += 1) {
    if (
      probe(context, h, cornerY - RING_MARGIN) !== BLOCK.OBSIDIAN ||
      probe(context, h, cornerY + height) !== BLOCK.OBSIDIAN
    ) {
      return false
    }
  }
  for (let y = cornerY; y < cornerY + height; y += 1) {
    if (
      probe(context, cornerH - RING_MARGIN, y) !== BLOCK.OBSIDIAN ||
      probe(context, cornerH + width, y) !== BLOCK.OBSIDIAN
    ) {
      return false
    }
  }
  return true
}

const detectInPlane = (context: PlaneContext, h0: number, y0: number): PortalFrame | undefined => {
  const corner = findBottomLeftCorner(context, h0, y0)
  const extent = measureInterior(context, corner)
  const width = PortalWidth.option(extent.width)
  const height = PortalHeight.option(extent.height)
  if (Option.isNone(width) || Option.isNone(height)) {return}
  if (!interiorIsClear(context, corner, extent)) {return}
  if (!ringIsObsidian(context, corner, extent)) {return}
  /* eslint-disable sort-keys -- Preserve the public JSON serialization order. */
  return {
    axis: context.axis,
    width: width.value,
    height: height.value,
    interior: collectRectangle(context.axis, context.fixed, corner, extent),
  }
  /* eslint-enable sort-keys */
}

/** Detects a complete obsidian framed portal containing `ignition`. */
export const detectNetherPortal = (blockAt: BlockAt, ignition: BlockPosition): PortalFrame | undefined => {
  if (blockAt(ignition.x, ignition.y, ignition.z) !== BLOCK.AIR) {return}
  return (
    detectInPlane({ axis: 'x', blockAt, fixed: ignition.z }, ignition.x, ignition.y) ??
    detectInPlane({ axis: 'z', blockAt, fixed: ignition.x }, ignition.z, ignition.y)
  )
}

const resolveOrigin = (
  axis: PortalAxis,
  origin: BlockPosition,
): Readonly<{ corner: PlanePoint; fixed: BlockAxis }> => {
  if (axis === 'x') {
    return { corner: { h: origin.x, y: origin.y }, fixed: origin.z }
  }
  return { corner: { h: origin.z, y: origin.y }, fixed: origin.x }
}

/** Plans the obsidian ring and clear interior for a validated portal size. */
export const generatePortalLayout = (
  origin: BlockPosition,
  axis: PortalAxis,
  width: PortalWidth,
  height: PortalHeight,
): PortalLayout => {
  const { corner, fixed } = resolveOrigin(axis, origin)
  const extent = { height, width }
  return {
    frame: collectRing(axis, fixed, corner, extent),
    interior: collectRectangle(axis, fixed, corner, extent),
  }
}
