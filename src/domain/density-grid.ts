import { BEDROCK_Y, CHUNK_SIZE_XZ, MAX_SURFACE_Y, MIN_SURFACE_Y } from './constants.js'
import type { BlockAxis } from '@nerima-games/mc-kernel/domain/coordinates'
import { Option } from 'effect'
import { blockAxisFromKnownSafeInteger } from './coordinate-compatibility.js'

export const TERRAIN_DENSITY_GRID_CELL_XZ = 8
export const TERRAIN_DENSITY_GRID_CELL_Y = 8

const GRID_MIN_Y = 0
const GRID_NODE_EXTENSION = 1
const GRID_CELL_NODE_SPAN = 2
const NEXT_GRID_NODE_OFFSET = 1
const GRID_LOOP_STEP = 1
const DENSITY_SURFACE_THRESHOLD = 0
const GRID_XZ_NODE_COUNT = Math.ceil(CHUNK_SIZE_XZ / TERRAIN_DENSITY_GRID_CELL_XZ) + GRID_NODE_EXTENSION
const GRID_MAX_Y = Math.ceil(MAX_SURFACE_Y / TERRAIN_DENSITY_GRID_CELL_Y) * TERRAIN_DENSITY_GRID_CELL_Y
const GRID_Y_NODE_COUNT = (GRID_MAX_Y - GRID_MIN_Y) / TERRAIN_DENSITY_GRID_CELL_Y + GRID_NODE_EXTENSION
const GRID_SAMPLE_COUNT = GRID_XZ_NODE_COUNT * GRID_Y_NODE_COUNT * GRID_XZ_NODE_COUNT
const LAST_SAFE_BLOCK_COORDINATE = Number.MAX_SAFE_INTEGER

export type TerrainDensityGrid = Readonly<{
  readonly sampleColumn: (lx: number, lz: number, samples: Float64Array) => void
}>

export type TerrainDensitySample = (wx: BlockAxis, wy: BlockAxis, wz: BlockAxis) => number
export type TerrainDensityColumnSampler = (wx: BlockAxis, wz: BlockAxis, samples: Float64Array) => boolean
export type TerrainDensitySurfaceSampler = (wx: BlockAxis, wz: BlockAxis) => Option.Option<BlockAxis>

type GridCell = Readonly<{ fraction: number; index: number }>

type TerrainDensityGridData = Readonly<{
  density: Float64Array
  maxLocalX: number
  maxLocalZ: number
}>

const gridIndex = (x: number, y: number, z: number): number =>
  (x * GRID_Y_NODE_COUNT + y) * GRID_XZ_NODE_COUNT + z

const densityValueAt = (density: Float64Array, index: number): number =>
  Option.getOrThrow(Option.fromNullishOr(density[index]))

const localXZNode = (index: number, maxLocal: number): number =>
  Math.min(index * TERRAIN_DENSITY_GRID_CELL_XZ, maxLocal)

const cellFor = (
  coordinate: number,
  maxLocal: number,
): GridCell => {
  const index = Math.min(Math.floor(coordinate / TERRAIN_DENSITY_GRID_CELL_XZ), GRID_XZ_NODE_COUNT - GRID_CELL_NODE_SPAN)
  const start = localXZNode(index, maxLocal)
  const end = localXZNode(index + NEXT_GRID_NODE_OFFSET, maxLocal)
  return { fraction: (coordinate - start) / (end - start), index }
}

const lerp = (start: number, end: number, fraction: number): number => start + (end - start) * fraction

const horizontalPlaneAt = (
  density: Float64Array,
  xCell: GridCell,
  zCell: GridCell,
  yIndex: number,
): number => {
  const x0 = xCell.index
  const x1 = x0 + NEXT_GRID_NODE_OFFSET
  const z0 = zCell.index
  const z1 = z0 + NEXT_GRID_NODE_OFFSET
  const xz00 = densityValueAt(density, gridIndex(x0, yIndex, z0))
  const xz10 = densityValueAt(density, gridIndex(x1, yIndex, z0))
  const xz01 = densityValueAt(density, gridIndex(x0, yIndex, z1))
  const xz11 = densityValueAt(density, gridIndex(x1, yIndex, z1))
  return lerp(lerp(xz00, xz10, xCell.fraction), lerp(xz01, xz11, xCell.fraction), zCell.fraction)
}

const densitySamplesForChunk = (
  sampleDensity: TerrainDensitySample,
  originX: BlockAxis,
  originZ: BlockAxis,
  maxLocalX: number,
  maxLocalZ: number,
): Float64Array => {
  const density = new Float64Array(GRID_SAMPLE_COUNT)
  for (let x = 0; x < GRID_XZ_NODE_COUNT; x += GRID_LOOP_STEP) {
    for (let y = 0; y < GRID_Y_NODE_COUNT; y += GRID_LOOP_STEP) {
      for (let z = 0; z < GRID_XZ_NODE_COUNT; z += GRID_LOOP_STEP) {
        const worldX = Number(originX) + localXZNode(x, maxLocalX)
        const worldY = GRID_MIN_Y + y * TERRAIN_DENSITY_GRID_CELL_Y
        const worldZ = Number(originZ) + localXZNode(z, maxLocalZ)
        density[gridIndex(x, y, z)] = sampleDensity(
          blockAxisFromKnownSafeInteger(worldX),
          blockAxisFromKnownSafeInteger(worldY),
          blockAxisFromKnownSafeInteger(worldZ),
        )
      }
    }
  }
  return density
}

const densityColumnSamplesFrom = (nodeValues: Float64Array, densitySamples: Float64Array): void => {
  for (let yCellIndex = 0; yCellIndex < GRID_Y_NODE_COUNT - NEXT_GRID_NODE_OFFSET; yCellIndex += GRID_LOOP_STEP) {
    const lowerY = GRID_MIN_Y + yCellIndex * TERRAIN_DENSITY_GRID_CELL_Y
    const lowerValue = densityValueAt(nodeValues, yCellIndex)
    const upperValue = densityValueAt(nodeValues, yCellIndex + NEXT_GRID_NODE_OFFSET)
    for (
      let yOffset = GRID_LOOP_STEP;
      yOffset <= TERRAIN_DENSITY_GRID_CELL_Y && lowerY + yOffset <= MAX_SURFACE_Y;
      yOffset += GRID_LOOP_STEP
    ) {
      const y = lowerY + yOffset
      densitySamples[y - BEDROCK_Y - GRID_NODE_EXTENSION] = lerp(
        lowerValue,
        upperValue,
        yOffset / TERRAIN_DENSITY_GRID_CELL_Y,
      )
    }
  }
}

type PointGridAxis = Readonly<{ cell: GridCell; start: BlockAxis; end: BlockAxis }>
type PointColumnGridCoordinates = Readonly<{ x: PointGridAxis; z: PointGridAxis }>

const pointGridAxisAt = (world: number, origin: number, maxLocal: number): PointGridAxis => {
  const cell = cellFor(world - origin, maxLocal)
  const start = origin + localXZNode(cell.index, maxLocal)
  const end = origin + localXZNode(cell.index + NEXT_GRID_NODE_OFFSET, maxLocal)
  return {
    cell,
    end: blockAxisFromKnownSafeInteger(end),
    start: blockAxisFromKnownSafeInteger(start),
  }
}

const pointColumnGridCoordinatesAt = (wx: BlockAxis, wz: BlockAxis): Option.Option<PointColumnGridCoordinates> => {
  const worldX = Number(wx)
  const worldZ = Number(wz)
  const originX = Math.floor(worldX / CHUNK_SIZE_XZ) * CHUNK_SIZE_XZ
  const originZ = Math.floor(worldZ / CHUNK_SIZE_XZ) * CHUNK_SIZE_XZ
  if (!Number.isSafeInteger(originX) || !Number.isSafeInteger(originZ)) {
    return Option.none()
  }

  const maxLocalX = Math.min(CHUNK_SIZE_XZ, LAST_SAFE_BLOCK_COORDINATE - originX)
  const maxLocalZ = Math.min(CHUNK_SIZE_XZ, LAST_SAFE_BLOCK_COORDINATE - originZ)
  return Option.some({
    x: pointGridAxisAt(worldX, originX, maxLocalX),
    z: pointGridAxisAt(worldZ, originZ, maxLocalZ),
  })
}

const createDensityNodeColumn = (
  sampleDensity: TerrainDensitySample,
  worldX: BlockAxis,
  worldZ: BlockAxis,
): Float64Array => {
  const values = new Float64Array(GRID_Y_NODE_COUNT)
  for (let yIndex = 0; yIndex < GRID_Y_NODE_COUNT; yIndex += GRID_LOOP_STEP) {
    const worldY = blockAxisFromKnownSafeInteger(GRID_MIN_Y + yIndex * TERRAIN_DENSITY_GRID_CELL_Y)
    values[yIndex] = sampleDensity(worldX, worldY, worldZ)
  }
  return values
}

const cacheDensityNodeColumn = (
  cache: Map<number, Map<number, Float64Array>>,
  worldX: BlockAxis,
  worldZ: BlockAxis,
  values: Float64Array,
): void => {
  const columnsAtX = cache.get(worldX)
  if (columnsAtX) {
    columnsAtX.set(worldZ, values)
  } else {
    cache.set(worldX, new Map([[worldZ, values]]))
  }
}

const densityNodeColumnAt = (
  sampleDensity: TerrainDensitySample,
  cache: Map<number, Map<number, Float64Array>>,
  worldX: BlockAxis,
  worldZ: BlockAxis,
): Float64Array => {
  const existing = cache.get(worldX)?.get(worldZ)
  if (existing) {
    return existing
  }
  const values = createDensityNodeColumn(sampleDensity, worldX, worldZ)
  cacheDensityNodeColumn(cache, worldX, worldZ, values)
  return values
}

const pointColumnNodeValuesFor = (
  sampleDensity: TerrainDensitySample,
  coordinates: PointColumnGridCoordinates,
  nodeValues: Float64Array,
  nodeColumnCache: Map<number, Map<number, Float64Array>>,
): void => {
  const { x, z } = coordinates
  const xz00 = densityNodeColumnAt(sampleDensity, nodeColumnCache, x.start, z.start)
  const xz10 = densityNodeColumnAt(sampleDensity, nodeColumnCache, x.end, z.start)
  const xz01 = densityNodeColumnAt(sampleDensity, nodeColumnCache, x.start, z.end)
  const xz11 = densityNodeColumnAt(sampleDensity, nodeColumnCache, x.end, z.end)
  for (let yIndex = 0; yIndex < GRID_Y_NODE_COUNT; yIndex += GRID_LOOP_STEP) {
    nodeValues[yIndex] = lerp(
      lerp(densityValueAt(xz00, yIndex), densityValueAt(xz10, yIndex), x.cell.fraction),
      lerp(densityValueAt(xz01, yIndex), densityValueAt(xz11, yIndex), x.cell.fraction),
      z.cell.fraction,
    )
  }
}

const surfaceHeightInDensityCell = (nodeValues: Float64Array, yCellIndex: number): Option.Option<BlockAxis> => {
  const lowerY = GRID_MIN_Y + yCellIndex * TERRAIN_DENSITY_GRID_CELL_Y
  const lowerValue = densityValueAt(nodeValues, yCellIndex)
  const upperValue = densityValueAt(nodeValues, yCellIndex + NEXT_GRID_NODE_OFFSET)
  if (lowerValue <= DENSITY_SURFACE_THRESHOLD && upperValue <= DENSITY_SURFACE_THRESHOLD) {
    return Option.none()
  }

  const topY = Math.min(lowerY + TERRAIN_DENSITY_GRID_CELL_Y, MAX_SURFACE_Y)
  for (let y = topY; y > lowerY && y >= MIN_SURFACE_Y; y -= GRID_LOOP_STEP) {
    if (lerp(lowerValue, upperValue, (y - lowerY) / TERRAIN_DENSITY_GRID_CELL_Y) > DENSITY_SURFACE_THRESHOLD) {
      return Option.some(blockAxisFromKnownSafeInteger(y))
    }
  }
  return Option.none()
}

const surfaceHeightFromDensityNodes = (nodeValues: Float64Array): BlockAxis => {
  for (let yCellIndex = GRID_Y_NODE_COUNT - GRID_CELL_NODE_SPAN; yCellIndex >= GRID_MIN_Y; yCellIndex -= GRID_LOOP_STEP) {
    const surfaceY = surfaceHeightInDensityCell(nodeValues, yCellIndex)
    if (Option.isSome(surfaceY)) {
      return surfaceY.value
    }
  }
  return blockAxisFromKnownSafeInteger(MIN_SURFACE_Y)
}

export const createTerrainDensitySurfaceSampler = (
  sampleDensity: TerrainDensitySample,
): TerrainDensitySurfaceSampler => {
  const nodeValues = new Float64Array(GRID_Y_NODE_COUNT)
  const nodeColumnCache = new Map<number, Map<number, Float64Array>>()
  return (wx, wz) => {
    const coordinates = pointColumnGridCoordinatesAt(wx, wz)
    if (Option.isNone(coordinates)) {
      return Option.none()
    }
    pointColumnNodeValuesFor(sampleDensity, coordinates.value, nodeValues, nodeColumnCache)
    return Option.some(surfaceHeightFromDensityNodes(nodeValues))
  }
}

export const createTerrainDensityColumnSampler = (
  sampleDensity: TerrainDensitySample,
): TerrainDensityColumnSampler => {
  const nodeValues = new Float64Array(GRID_Y_NODE_COUNT)
  const nodeColumnCache = new Map<number, Map<number, Float64Array>>()
  return (wx, wz, samples) => {
    const coordinates = pointColumnGridCoordinatesAt(wx, wz)
    if (Option.isNone(coordinates)) {
      return false
    }
    pointColumnNodeValuesFor(sampleDensity, coordinates.value, nodeValues, nodeColumnCache)
    densityColumnSamplesFrom(nodeValues, samples)
    return true
  }
}

const columnNodeValuesFor = (
  grid: TerrainDensityGridData,
  lx: number,
  lz: number,
  nodeValues: Float64Array,
): void => {
  const xCell = cellFor(lx, grid.maxLocalX)
  const zCell = cellFor(lz, grid.maxLocalZ)
  for (let yIndex = 0; yIndex < GRID_Y_NODE_COUNT; yIndex += GRID_LOOP_STEP) {
    nodeValues[yIndex] = horizontalPlaneAt(grid.density, xCell, zCell, yIndex)
  }
}

const densitySamplesForColumn = (
  grid: TerrainDensityGridData,
  lx: number,
  lz: number,
  nodeValues: Float64Array,
  densitySamples: Float64Array,
): void => {
  columnNodeValuesFor(grid, lx, lz, nodeValues)
  densityColumnSamplesFrom(nodeValues, densitySamples)
}

export const createTerrainDensityGrid = (
  sampleDensity: TerrainDensitySample,
  originX: BlockAxis,
  originZ: BlockAxis,
): TerrainDensityGrid => {
  // Validated chunk origins are 16-block aligned, so the 8-block X/Z lattice aligns across chunks.
  const maxLocalX = Math.min(CHUNK_SIZE_XZ, LAST_SAFE_BLOCK_COORDINATE - Number(originX))
  const maxLocalZ = Math.min(CHUNK_SIZE_XZ, LAST_SAFE_BLOCK_COORDINATE - Number(originZ))
  const density = densitySamplesForChunk(sampleDensity, originX, originZ, maxLocalX, maxLocalZ)
  const grid = Object.freeze({ density, maxLocalX, maxLocalZ })
  const nodeValues = new Float64Array(GRID_Y_NODE_COUNT)
  const sampleColumn = (lx: number, lz: number, samples: Float64Array): void =>
    densitySamplesForColumn(grid, lx, lz, nodeValues, samples)
  return Object.freeze({ sampleColumn })
}
