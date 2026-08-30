import type {
  AppliedNaturalStructureMarker,
  NaturalStructureChunk,
  NaturalStructureChunkSlice,
  NaturalStructurePlan,
} from './natural-structure-types.js'
import { type Chunk, setBlockAt } from './chunk.js'
import { CHUNK_SIZE_XZ } from './constants.js'
import { plansInStableOrder } from './natural-structure-order.js'

/** Projects a plan without observing or mutating loaded neighbouring chunks. */
export const naturalStructureSliceForChunk = (
  plan: NaturalStructurePlan,
  chunkX: number,
  chunkZ: number,
): NaturalStructureChunkSlice => Object.freeze({
  blocks: Object.freeze(plan.blocks.filter((block) =>
    Math.floor(block.x / CHUNK_SIZE_XZ) === chunkX && Math.floor(block.z / CHUNK_SIZE_XZ) === chunkZ,
  )),
  chunkX,
  chunkZ,
  markers: Object.freeze(plan.markers.filter((marker) =>
    Math.floor(marker.x / CHUNK_SIZE_XZ) === chunkX && Math.floor(marker.z / CHUNK_SIZE_XZ) === chunkZ,
  )),
})

type ChunkApplyAccumulator = {
  readonly blocks: Uint8Array
  readonly ids: Array<string>
  readonly markers: Array<AppliedNaturalStructureMarker>
}

type ChunkWindow = {
  readonly maxX: number
  readonly maxZ: number
  readonly minX: number
  readonly minZ: number
}

const chunkWindowFor = (chunk: Chunk): ChunkWindow => {
  const minX = chunk.coord.cx * CHUNK_SIZE_XZ
  const minZ = chunk.coord.cz * CHUNK_SIZE_XZ
  return { maxX: minX + CHUNK_SIZE_XZ, maxZ: minZ + CHUNK_SIZE_XZ, minX, minZ }
}

const placementIsInChunk = (x: number, z: number, window: ChunkWindow): boolean =>
  x >= window.minX && x < window.maxX && z >= window.minZ && z < window.maxZ

const planOverlapsChunk = (plan: NaturalStructurePlan, window: ChunkWindow): boolean =>
  plan.bounds.maxX >= window.minX
    && plan.bounds.minX < window.maxX
    && plan.bounds.maxZ >= window.minZ
    && plan.bounds.minZ < window.maxZ

const writePlanBlocks = (
  accumulator: ChunkApplyAccumulator,
  plan: NaturalStructurePlan,
  window: ChunkWindow,
): boolean => {
  let hasSlice = false
  for (const placement of plan.blocks) {
    if (placementIsInChunk(placement.x, placement.z, window)) {
      hasSlice = true
      setBlockAt(
        accumulator.blocks,
        placement.x - window.minX,
        placement.y,
        placement.z - window.minZ,
        placement.block,
      )
    }
  }
  return hasSlice
}

const writePlanMarkers = (
  accumulator: ChunkApplyAccumulator,
  plan: NaturalStructurePlan,
  window: ChunkWindow,
): boolean => {
  let hasSlice = false
  for (const marker of plan.markers) {
    if (placementIsInChunk(marker.x, marker.z, window)) {
      hasSlice = true
      accumulator.markers.push(Object.freeze({ ...marker, structureId: plan.id, structureKind: plan.kind }))
    }
  }
  return hasSlice
}

/** Writes one plan's slice into `accumulator.blocks` and records its id/markers, unless the slice touches nothing here. */
const applyPlanSlice = (accumulator: ChunkApplyAccumulator, window: ChunkWindow, plan: NaturalStructurePlan): void => {
  if (planOverlapsChunk(plan, window)) {
    const hasBlocks = writePlanBlocks(accumulator, plan, window)
    const hasMarkers = writePlanMarkers(accumulator, plan, window)
    if (hasBlocks || hasMarkers) {
      accumulator.ids.push(plan.id)
    }
  }
}

/** Applies cross-chunk plan slices without mutating the terrain chunk or plans. */
export const applyNaturalStructurePlansToChunk = (
  chunk: Chunk,
  plans: ReadonlyArray<NaturalStructurePlan>,
): NaturalStructureChunk => {
  const accumulator: ChunkApplyAccumulator = { blocks: chunk.blocks.slice(), ids: [], markers: [] }
  const window = chunkWindowFor(chunk)
  for (const plan of plansInStableOrder(plans)) {
    applyPlanSlice(accumulator, window, plan)
  }
  return {
    ...chunk,
    blocks: accumulator.blocks,
    naturalStructureIds: Object.freeze(accumulator.ids),
    naturalStructureMarkers: Object.freeze(accumulator.markers),
  }
}
