import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from '@effect/vitest'
import { NoiseSeed } from '@nerima-games/mc-noise'
import { encodeSave } from '@nerima-games/mc-save'
import { Effect, Result } from 'effect'
import { BLOCK } from '../src/domain/biome'
import { CAVE_CEILING_Y, CAVE_FLOOR_Y, computeWaterFloorYs } from '../src/domain/carver'
import {
  CHUNK_FORMAT,
  packBlockStatesV3,
  packBlocksV2,
  type ChunkEncoded,
} from '../src/domain/chunk-format'
import { withDefaultBlockStates, type ChunkWithBlockStates } from '../src/domain/chunk'
import { blockIndex, CHUNK_HEIGHT, CHUNK_SIZE_XZ, WATER_FLOOR_MARGIN } from '../src/domain/constants'
import { chunkAxis } from '../src/domain/coordinate-compatibility'
import { generateChunkAt } from '../src/domain/terrain'

type ScenarioCategory = 'surface' | 'cave' | 'water-bottom' | 'mountain' | 'structure'

type CoordinateSpec = Readonly<{
  readonly category: ScenarioCategory
  readonly cx: number
  readonly cz: number
}>

type Coverage = Readonly<{
  readonly caveBandAir: number
  readonly mountainBiomeColumns: number
  readonly naturalStructureIds: number
  readonly naturalStructureMarkers: number
  readonly surfaceColumns: number
  readonly surfaceYMax: number
  readonly surfaceYMin: number
  readonly waterBlocks: number
  readonly waterFloorCaveBandColumns: number
}>

type Hashes = Readonly<{
  readonly blockStatesSha256: string
  readonly blocksSha256: string
  readonly biomesSha256: string
  readonly chunkFormatV3PayloadSha256: string
  readonly integrityMetadataSha256: string
  readonly naturalStructuresSha256: string
}>

type GoldenEntry = Readonly<{
  readonly category: ScenarioCategory
  readonly coord: Readonly<{ readonly cx: number; readonly cz: number }>
  readonly coverage: Coverage
  readonly hashes: Hashes
  readonly seed: number
}>

type GoldenFile = Readonly<{
  readonly coverageBySeed: ReadonlyArray<Readonly<Record<string, number>>>
  readonly coordinates: ReadonlyArray<CoordinateSpec>
  readonly entries: ReadonlyArray<GoldenEntry>
  readonly hashContract: Readonly<{ readonly binary: string; readonly json: string }>
  readonly schemaVersion: number
  readonly seeds: ReadonlyArray<number>
}>

const EXPECTED_SEEDS = [1, 20260726, 4242] as const
const EXPECTED_HASH_CONTRACT = {
  binary: 'SHA-256 over chunk-format packed bytes (blocks v2 and block states v3, little-endian)',
  json: 'SHA-256 over UTF-8 canonical JSON with lexicographically sorted object keys and original array order',
} as const

const EXPECTED_COORDINATES: ReadonlyArray<CoordinateSpec> = [
  { category: 'surface', cx: 5, cz: 7 },
  { category: 'cave', cx: 11, cz: 3 },
  { category: 'cave', cx: 5, cz: -6 },
  { category: 'water-bottom', cx: 4, cz: 9 },
  { category: 'water-bottom', cx: -8, cz: 8 },
  { category: 'structure', cx: -37, cz: 92 },
  { category: 'mountain', cx: -192, cz: -256 },
  { category: 'mountain', cx: 48, cz: -256 },
  { category: 'mountain', cx: 88, cz: -256 },
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

const committed = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/worldgen-perf-v0.9.0.json', import.meta.url)), 'utf8'),
) as GoldenFile

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
    const fields = Object.entries(value).sort(([left], [right]) => {
      if (left < right) return -1
      if (left > right) return 1
      return 0
    })
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

const coverageFor = (chunk: ChunkWithBlockStates, structureCount: Readonly<{ ids: number; markers: number }>): Coverage => {
  let caveBandAir = 0
  for (let lx = 0; lx < CHUNK_SIZE_XZ; lx += 1) {
    for (let lz = 0; lz < CHUNK_SIZE_XZ; lz += 1) {
      for (let y = CAVE_FLOOR_Y; y <= CAVE_CEILING_Y; y += 1) {
        if (chunk.blocks[blockIndex(lx, y, lz)] === BLOCK.AIR) {
          caveBandAir += 1
        }
      }
    }
  }

  const waterFloors = computeWaterFloorYs(chunk.blocks, WATER_FLOOR_MARGIN)
  let waterFloorCaveBandColumns = 0
  for (const waterFloorY of waterFloors) {
    if (waterFloorY > 0 && waterFloorY <= CAVE_CEILING_Y) {
      waterFloorCaveBandColumns += 1
    }
  }

  let surfaceColumns = 0
  let surfaceYMin = CHUNK_HEIGHT
  let surfaceYMax = 0
  for (let lx = 0; lx < CHUNK_SIZE_XZ; lx += 1) {
    for (let lz = 0; lz < CHUNK_SIZE_XZ; lz += 1) {
      for (let y = CHUNK_HEIGHT - 1; y >= 0; y -= 1) {
        const block = chunk.blocks[blockIndex(lx, y, lz)]
        if (block !== BLOCK.AIR && block !== BLOCK.WATER) {
          surfaceColumns += 1
          surfaceYMin = Math.min(surfaceYMin, y)
          surfaceYMax = Math.max(surfaceYMax, y)
          break
        }
      }
    }
  }

  return {
    caveBandAir,
    mountainBiomeColumns: chunk.biomes.filter((biome) => MOUNTAIN_BIOMES.has(biome)).length,
    naturalStructureIds: structureCount.ids,
    naturalStructureMarkers: structureCount.markers,
    surfaceColumns,
    surfaceYMax,
    surfaceYMin,
    waterBlocks: countBlocks(chunk.blocks, BLOCK.WATER),
    waterFloorCaveBandColumns,
  }
}

const hashesFor = (chunk: ChunkWithBlockStates, payload: ChunkEncoded): Hashes => ({
  blockStatesSha256: sha256(packBlockStatesV3(chunk.blockStates)),
  blocksSha256: sha256(packBlocksV2(chunk.blocks)),
  biomesSha256: sha256CanonicalJson(chunk.biomes),
  chunkFormatV3PayloadSha256: sha256CanonicalJson(payload),
  integrityMetadataSha256: sha256CanonicalJson(payload.integrity),
  naturalStructuresSha256: sha256CanonicalJson({
    endFeatureIds: payload.endFeatureIds,
    endFeatureMarkers: payload.endFeatureMarkers,
    naturalStructureIds: payload.naturalStructureIds,
    naturalStructureMarkers: payload.naturalStructureMarkers,
  }),
})

const generated = committed.entries.map((entry) => {
  const seed = Result.getOrThrow(NoiseSeed.result(entry.seed))
  const generatedChunk = Result.getOrThrow(
    generateChunkAt(seed, chunkAxis(entry.coord.cx), chunkAxis(entry.coord.cz)),
  )
  const chunk = Result.getOrThrow(withDefaultBlockStates(generatedChunk))
  const envelope = Effect.runSync(encodeSave(CHUNK_FORMAT, chunk))
  const payload = envelope.payload as ChunkEncoded

  return {
    coverage: coverageFor(chunk, {
      ids: generatedChunk.naturalStructureIds.length,
      markers: generatedChunk.naturalStructureMarkers.length,
    }),
    entry,
    hashes: hashesFor(chunk, payload),
  }
})

const expectedEntryCoordinates = EXPECTED_SEEDS.flatMap((seed) =>
  EXPECTED_COORDINATES.map(({ category, cx, cz }) => ({ category, coord: { cx, cz }, seed })),
)

describe('the v0.9.0 worldgen performance baseline', () => {
  it.effect('pins output hashes for a fixed three-seed, nine-coordinate matrix', () =>
    Effect.sync(() => {
      expect(committed.schemaVersion).toBe(1)
      expect(committed.hashContract).toStrictEqual(EXPECTED_HASH_CONTRACT)
      expect(committed.seeds).toStrictEqual(EXPECTED_SEEDS)
      expect(committed.coordinates).toStrictEqual(EXPECTED_COORDINATES)
      expect(committed.entries).toHaveLength(EXPECTED_SEEDS.length * EXPECTED_COORDINATES.length)
      expect(
        committed.entries.map(({ category, coord, seed }) => ({ category, coord, seed })),
      ).toStrictEqual(expectedEntryCoordinates)

      for (const { coverage, entry, hashes } of generated) {
        const label = `seed ${String(entry.seed)} chunk (${String(entry.coord.cx)}, ${String(entry.coord.cz)})`
        expect(hashes, `${label} hashes`).toStrictEqual(entry.hashes)
        expect(coverage, `${label} coverage`).toStrictEqual(entry.coverage)
      }
    }),
  )

  it.effect('covers caves, water floors, mountain biomes, and structure data', () =>
    Effect.sync(() => {
      expect(generated.some(({ coverage }) => coverage.caveBandAir > 0)).toBe(true)
      expect(generated.some(({ coverage }) => coverage.waterFloorCaveBandColumns > 0)).toBe(true)
      expect(generated.some(({ coverage }) => coverage.mountainBiomeColumns > 0)).toBe(true)
      expect(
        generated.some(({ coverage }) =>
          coverage.naturalStructureIds > 0 || coverage.naturalStructureMarkers > 0,
        ),
      ).toBe(true)
    }),
  )
})
