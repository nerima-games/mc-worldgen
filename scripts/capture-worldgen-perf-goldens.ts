import { createHash } from 'node:crypto'
import { Effect, Result } from 'effect'
import { NoiseSeed } from '@nerima-games/mc-noise'
import { encodeSave } from '@nerima-games/mc-save'
import {
  CHUNK_FORMAT,
  packBlockStatesV3,
  packBlocksV2,
  type ChunkEncoded,
} from '../src/domain/chunk-format'
import { withDefaultBlockStates } from '../src/domain/chunk'
import { CAVE_CEILING_Y, CAVE_FLOOR_Y, computeWaterFloorYs } from '../src/domain/carver'
import { BLOCK } from '../src/domain/biome'
import { blockIndex, CHUNK_HEIGHT, CHUNK_SIZE_XZ, DEFAULT_TERRAIN_LEVELS, WATER_FLOOR_MARGIN } from '../src/domain/constants'
import { blockAxis, chunkAxis } from '../src/domain/coordinate-compatibility'
import { generateChunkAt, surfaceBiomeAt } from '../src/domain/terrain'

const SEEDS = [1, 20260726, 4242] as const

type ScenarioCategory = 'surface' | 'cave' | 'water-bottom' | 'mountain' | 'structure'

type CoordinateSpec = Readonly<{
  readonly category: ScenarioCategory
  readonly cx: number
  readonly cz: number
}>

const findMountainCoordinates = (): ReadonlyArray<CoordinateSpec> => {
  const seed = Result.getOrThrow(NoiseSeed.result(20260726))
  const coordinates = new Map<string, CoordinateSpec>()

  for (let wz = -4096; wz < 4096 && coordinates.size < 3; wz += 128) {
    for (let wx = -4096; wx < 4096 && coordinates.size < 3; wx += 128) {
      if (surfaceBiomeAt(seed, blockAxis(wx), blockAxis(wz), DEFAULT_TERRAIN_LEVELS).biome !== 'MOUNTAINS') {
        continue
      }

      const coordinate = { category: 'mountain' as const, cx: Math.floor(wx / CHUNK_SIZE_XZ), cz: Math.floor(wz / CHUNK_SIZE_XZ) }
      coordinates.set(`${coordinate.cx},${coordinate.cz}`, coordinate)
    }
  }

  if (coordinates.size !== 3) {
    throw new Error(`expected three mountain chunks, found ${String(coordinates.size)}`)
  }

  return [...coordinates.values()]
}

const COORDINATES: ReadonlyArray<CoordinateSpec> = [
  { category: 'surface', cx: 5, cz: 7 },
  { category: 'cave', cx: 11, cz: 3 },
  { category: 'cave', cx: 5, cz: -6 },
  { category: 'water-bottom', cx: 4, cz: 9 },
  { category: 'water-bottom', cx: -8, cz: 8 },
  { category: 'structure', cx: -37, cz: 92 },
  ...findMountainCoordinates(),
]

const MOUNTAIN_BIOMES: ReadonlySet<string> = new Set([
  'MOUNTAINS',
  'cherry_grove',
  'frozen_peaks',
  'grove',
  'jagged_peaks',
  'meadow',
  'snowy_slopes',
  'stony_peaks',
  'windswept_forest',
  'windswept_gravelly_hills',
  'windswept_hills',
])

const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    const serialized = JSON.stringify(value)
    if (serialized === undefined) {
      throw new TypeError('cannot serialize a generated value as canonical JSON')
    }
    return serialized
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`
  }
  if (typeof value === 'object') {
    const fields = Object.entries(value).sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0,
    )
    return `{${fields.map(([key, field]) => `${JSON.stringify(key)}:${canonicalJson(field)}`).join(',')}}`
  }
  throw new TypeError('cannot serialize a generated value as canonical JSON')
}

const sha256 = (bytes: Uint8Array | string): string =>
  createHash('sha256').update(bytes).digest('hex')

const sha256CanonicalJson = (value: unknown): string =>
  sha256(canonicalJson(value))

const countBlocks = (blocks: Uint16Array, wanted: number): number => {
  let count = 0
  for (const block of blocks) {
    if (block === wanted) {
      count += 1
    }
  }
  return count
}

const caveBandAirCount = (blocks: Uint16Array): number => {
  let count = 0
  for (let lx = 0; lx < CHUNK_SIZE_XZ; lx += 1) {
    for (let lz = 0; lz < CHUNK_SIZE_XZ; lz += 1) {
      for (let y = CAVE_FLOOR_Y; y <= CAVE_CEILING_Y; y += 1) {
        if (blocks[blockIndex(lx, y, lz)] === BLOCK.AIR) {
          count += 1
        }
      }
    }
  }
  return count
}

const waterFloorCaveBandColumnCount = (blocks: Uint16Array): number => {
  const waterFloors = computeWaterFloorYs(blocks, WATER_FLOOR_MARGIN)
  let count = 0
  for (const waterFloorY of waterFloors) {
    if (waterFloorY > 0 && waterFloorY <= CAVE_CEILING_Y) {
      count += 1
    }
  }
  return count
}

const surfaceCoverage = (blocks: Uint16Array) => {
  let columns = 0
  let surfaceYMin = CHUNK_HEIGHT
  let surfaceYMax = 0

  for (let lx = 0; lx < CHUNK_SIZE_XZ; lx += 1) {
    for (let lz = 0; lz < CHUNK_SIZE_XZ; lz += 1) {
      for (let y = CHUNK_HEIGHT - 1; y >= 0; y -= 1) {
        const block = blocks[blockIndex(lx, y, lz)]
        if (block !== BLOCK.AIR && block !== BLOCK.WATER) {
          columns += 1
          surfaceYMin = Math.min(surfaceYMin, y)
          surfaceYMax = Math.max(surfaceYMax, y)
          break
        }
      }
    }
  }

  return { columns, surfaceYMax, surfaceYMin }
}

const captureEntry = (seedValue: number, coordinate: CoordinateSpec) => {
  const seed = Result.getOrThrow(NoiseSeed.result(seedValue))
  const generated = Result.getOrThrow(
    generateChunkAt(seed, chunkAxis(coordinate.cx), chunkAxis(coordinate.cz)),
  )
  const chunk = Result.getOrThrow(withDefaultBlockStates(generated))
  const envelope = Effect.runSync(encodeSave(CHUNK_FORMAT, chunk))
  const payload = envelope.payload as ChunkEncoded
  const structures = {
    endFeatureIds: payload.endFeatureIds,
    endFeatureMarkers: payload.endFeatureMarkers,
    naturalStructureIds: payload.naturalStructureIds,
    naturalStructureMarkers: payload.naturalStructureMarkers,
  }
  const surface = surfaceCoverage(generated.blocks)

  return {
    category: coordinate.category,
    coord: { cx: coordinate.cx, cz: coordinate.cz },
    coverage: {
      caveBandAir: caveBandAirCount(generated.blocks),
      mountainBiomeColumns: generated.biomes.filter((biome) => MOUNTAIN_BIOMES.has(biome)).length,
      naturalStructureIds: generated.naturalStructureIds.length,
      naturalStructureMarkers: generated.naturalStructureMarkers.length,
      surfaceColumns: surface.columns,
      surfaceYMax: surface.surfaceYMax,
      surfaceYMin: surface.surfaceYMin,
      waterBlocks: countBlocks(generated.blocks, BLOCK.WATER),
      waterFloorCaveBandColumns: waterFloorCaveBandColumnCount(generated.blocks),
    },
    hashes: {
      blockStatesSha256: sha256(packBlockStatesV3(chunk.blockStates)),
      blocksSha256: sha256(packBlocksV2(chunk.blocks)),
      biomesSha256: sha256CanonicalJson(chunk.biomes),
      chunkFormatV3PayloadSha256: sha256CanonicalJson(payload),
      integrityMetadataSha256: sha256CanonicalJson(payload.integrity),
      naturalStructuresSha256: sha256CanonicalJson(structures),
    },
    seed: seedValue,
  }
}

const entries = SEEDS.flatMap((seed) => COORDINATES.map((coordinate) => captureEntry(seed, coordinate)))

const coverageBySeed = SEEDS.map((seed) => {
  const seedEntries = entries.filter((entry) => entry.seed === seed)
  return {
    seed,
    chunksWithCaveBandAir: seedEntries.filter((entry) => entry.coverage.caveBandAir > 0).length,
    chunksWithMountainBiomes: seedEntries.filter((entry) => entry.coverage.mountainBiomeColumns > 0).length,
    chunksWithNaturalStructureData: seedEntries.filter(
      (entry) => entry.coverage.naturalStructureIds > 0 || entry.coverage.naturalStructureMarkers > 0,
    ).length,
    chunksWithWaterFloorCaveBand: seedEntries.filter((entry) => entry.coverage.waterFloorCaveBandColumns > 0).length,
    chunksWithWater: seedEntries.filter((entry) => entry.coverage.waterBlocks > 0).length,
    chunksWithSurface: seedEntries.filter((entry) => entry.coverage.surfaceColumns > 0).length,
  }
})

const output = {
  coverageBySeed,
  coordinates: COORDINATES,
  entries,
  hashContract: {
    binary: 'SHA-256 over chunk-format packed bytes (blocks v2 and block states v3, little-endian)',
    json: 'SHA-256 over UTF-8 canonical JSON with lexicographically sorted object keys and original array order',
  },
  schemaVersion: 1,
  seeds: SEEDS,
}

process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
