import { describe, expect, it } from '@effect/vitest'
import * as fc from 'fast-check'
import { Effect } from 'effect'
import type { BiomeType } from '@nerima-games/mc-kernel/domain/biome'
import type { ChunkCoord } from '@nerima-games/mc-kernel/domain/coordinates'
import { BLOCK } from '../src/domain/biome'
import { BEDROCK_Y, blockIndex, CHUNK_HEIGHT, CHUNK_SIZE_XZ, DEEPSLATE_CEILING } from '../src/domain/constants'
import {
  DEEPSLATE_ORE_BLOCK,
  EMERALD_MOUNTAIN_BIOME_IDS,
  ORE_BLOCK,
  ORE_CONFIGS,
  ORE_IDS,
  ORE_MAX_Y,
  ORE_MIN_Y_FLOOR,
  UNAVAILABLE_ORE_FEATURES,
  growVein,
  oreStreamSeed,
  placeOres,
  sampleOreY,
  type OreConfig,
  type OreName,
} from '../src/domain/ore'
import { mulberry32 } from '@nerima-games/mc-noise'
import { chunkAxis, noiseSeed } from './fixtures/validated-inputs'
import { generateChunkAt } from './helpers/unwrapped-worldgen'

const COLUMN_COUNT = CHUNK_SIZE_XZ * CHUNK_SIZE_XZ
const BLOCK_COUNT = CHUNK_HEIGHT * COLUMN_COUNT
const FALLBACK_ORE_MIN_Y = 10
const FALLBACK_ORE_MAX_Y = 20
const FALLBACK_ORE_EXPECTED_Y = 16
const BIOME_FILTER_SEED = 1234
const ORE_SAMPLE_SEED_SEARCH_LIMIT = 128
const ORE_NAMES: ReadonlyArray<OreName> = ['COAL', 'COPPER', 'DIAMOND', 'EMERALD', 'GOLD', 'IRON', 'LAPIS', 'REDSTONE']
const EMERALD_MOUNTAIN_BIOME_SET: ReadonlySet<string> = new Set(EMERALD_MOUNTAIN_BIOME_IDS)

const allPlainsBiomes = (): ReadonlyArray<BiomeType> => {
  const biomes: Array<BiomeType> = []
  for (let index = 0; index < COLUMN_COUNT; index += 1) {
    biomes.push('plains')
  }
  return biomes
}

const allMountainBiomes = (): ReadonlyArray<BiomeType> => {
  const biomes: Array<BiomeType> = []
  for (let index = 0; index < COLUMN_COUNT; index += 1) {
    biomes.push('meadow')
  }
  return biomes
}

const solidOverworldBlocks = (): Uint16Array => {
  const blocks = new Uint16Array(BLOCK_COUNT)
  for (let x = 0; x < CHUNK_SIZE_XZ; x += 1) {
    for (let z = 0; z < CHUNK_SIZE_XZ; z += 1) {
      for (let y = 0; y < CHUNK_HEIGHT; y += 1) {
        const block = y === BEDROCK_Y
          ? BLOCK.BEDROCK
          : y < DEEPSLATE_CEILING
            ? BLOCK.DEEPSLATE
            : BLOCK.STONE
        blocks[blockIndex(x, y, z)] = block
      }
    }
  }
  return blocks
}

const oreNameById = (): ReadonlyMap<number, OreName> => {
  const entries = new Map<number, OreName>()
  for (const name of ORE_NAMES) {
    entries.set(ORE_BLOCK[name], name)
    entries.set(DEEPSLATE_ORE_BLOCK[name], name)
  }
  return entries
}

const ORE_NAME_BY_ID = oreNameById()

const orePlacementsIn = (blocks: Uint16Array): ReadonlyArray<Readonly<{ id: number; index: number; name: OreName; y: number }>> => {
  const placements: Array<Readonly<{ id: number; index: number; name: OreName; y: number }>> = []
  for (let index = 0; index < blocks.length; index += 1) {
    const id = blocks[index]
    if (id === undefined) continue
    const name = ORE_NAME_BY_ID.get(id)
    if (name === undefined) continue
    placements.push({ id, index, name, y: index % CHUNK_HEIGHT })
  }
  return placements
}

// Independent Java Edition 26.3 expectations from the Minecraft Wiki:
// https://minecraft.wiki/w/Copper_ore and https://minecraft.wiki/w/Ore_%28feature%29
// https://minecraft.wiki/w/Deepslate_Emerald_Ore
const expectedFeatureRows = [
  { feature: 'coal-lower', name: 'COAL', minY: 0, maxY: 192, distribution: 'trapezoid', plateau: 0, attemptsPerChunk: 20, size: 17, biomeRule: null },
  { feature: 'coal-upper', name: 'COAL', minY: 136, maxY: 319, distribution: 'uniform', plateau: 0, attemptsPerChunk: 30, size: 17, biomeRule: null },
  { feature: 'iron-small', name: 'IRON', minY: -64, maxY: 72, distribution: 'uniform', plateau: 0, attemptsPerChunk: 10, size: 4, biomeRule: null },
  { feature: 'iron-middle', name: 'IRON', minY: -24, maxY: 56, distribution: 'trapezoid', plateau: 0, attemptsPerChunk: 10, size: 9, biomeRule: null },
  { feature: 'iron-upper', name: 'IRON', minY: 80, maxY: 384, distribution: 'trapezoid', plateau: 0, attemptsPerChunk: 90, size: 9, biomeRule: null },
  { feature: 'copper-small', name: 'COPPER', minY: -16, maxY: 112, distribution: 'trapezoid', plateau: 0, attemptsPerChunk: 16, size: 10, biomeRule: 'not-dripstone-caves' },
  { feature: 'redstone', name: 'REDSTONE', minY: -64, maxY: 15, distribution: 'uniform', plateau: 0, attemptsPerChunk: 4, size: 8, biomeRule: null },
  { feature: 'redstone-lower', name: 'REDSTONE', minY: -64, maxY: -32, distribution: 'trapezoid', plateau: 0, attemptsPerChunk: 8, size: 8, biomeRule: null },
  { feature: 'lapis', name: 'LAPIS', minY: -32, maxY: 32, distribution: 'trapezoid', plateau: 0, attemptsPerChunk: 2, size: 7, biomeRule: null },
  { feature: 'lapis-buried', name: 'LAPIS', minY: -64, maxY: 64, distribution: 'uniform', plateau: 0, attemptsPerChunk: 4, size: 7, biomeRule: null },
  { feature: 'gold', name: 'GOLD', minY: -64, maxY: 32, distribution: 'trapezoid', plateau: 0, attemptsPerChunk: 4, size: 9, biomeRule: null },
  { feature: 'gold-lower', name: 'GOLD', minY: -64, maxY: -48, distribution: 'uniform', plateau: 0, attemptsPerChunk: 0.5, size: 9, biomeRule: null },
  { feature: 'gold-extra', name: 'GOLD', minY: 32, maxY: 256, distribution: 'uniform', plateau: 0, attemptsPerChunk: 50, size: 9, biomeRule: 'badlands' },
  { feature: 'diamond-small', name: 'DIAMOND', minY: -64, maxY: 16, distribution: 'trapezoid', plateau: 0, attemptsPerChunk: 7, size: 4, biomeRule: null },
  { feature: 'diamond-buried', name: 'DIAMOND', minY: -64, maxY: 16, distribution: 'trapezoid', plateau: 0, attemptsPerChunk: 4, size: 8, biomeRule: null },
  { feature: 'diamond-large', name: 'DIAMOND', minY: -64, maxY: 16, distribution: 'trapezoid', plateau: 0, attemptsPerChunk: 1 / 9, size: 12, biomeRule: null },
  { feature: 'diamond-medium', name: 'DIAMOND', minY: -64, maxY: -4, distribution: 'uniform', plateau: 0, attemptsPerChunk: 2, size: 8, biomeRule: null },
  { feature: 'emerald', name: 'EMERALD', minY: -16, maxY: 480, distribution: 'trapezoid', plateau: 0, attemptsPerChunk: 100, size: 3, biomeRule: 'mountain' },
] as const

const rowOf = (config: OreConfig) => ({
  feature: config.feature,
  name: config.name,
  minY: config.minY,
  maxY: config.maxY,
  distribution: config.distribution,
  plateau: config.plateau ?? 0,
  attemptsPerChunk: config.attemptsPerChunk,
  size: config.size,
  biomeRule: config.biomeRule ?? null,
})

describe('the vanilla ore feature table', () => {
  it.effect('matches Java Edition feature ranges, attempts, sizes, distributions and biome filters', () =>
    Effect.sync(() => {
      expect(ORE_CONFIGS.map(rowOf)).toStrictEqual(expectedFeatureRows)
      expect(UNAVAILABLE_ORE_FEATURES).toStrictEqual([{
        feature: 'copper-large',
        reason: 'Tracked in the facilitator W6 FIX list: "Y で決まる洞窟のバイオームと copper-large".',
      }])
      expect(ORE_MIN_Y_FLOOR).toBe(0)
      expect(ORE_MAX_Y).toBe(255)

      const clippedDiamondMedium = ORE_CONFIGS.find((config) => config.feature === 'diamond-medium')
      expect(clippedDiamondMedium).toBeDefined()
      if (clippedDiamondMedium === undefined) return
      expect(Math.min(clippedDiamondMedium.maxY, ORE_MAX_Y)).toBeLessThan(
        Math.max(clippedDiamondMedium.minY, ORE_MIN_Y_FLOOR),
      )
    }),
  )

  it.effect('uses only the supported stone and deepslate ore ids, including kernel copper ids', () =>
    Effect.sync(() => {
      expect(ORE_BLOCK).toStrictEqual({
        COAL: 50,
        COPPER: 123,
        DIAMOND: 53,
        EMERALD: 56,
        GOLD: 52,
        IRON: 51,
        LAPIS: 55,
        REDSTONE: 54,
      })
      expect(DEEPSLATE_ORE_BLOCK).toStrictEqual({
        COAL: 57,
        COPPER: 124,
        DIAMOND: 60,
        EMERALD: 63,
        GOLD: 59,
        IRON: 58,
        LAPIS: 62,
        REDSTONE: 61,
      })
      expect(ORE_IDS).toHaveLength(16)
      expect(new Set(ORE_IDS).size).toBe(16)
    }),
  )

  it.effect('keeps the documented mountain biome set for emerald', () =>
    Effect.sync(() => {
      expect(EMERALD_MOUNTAIN_BIOME_IDS).toStrictEqual([
        'meadow',
        'cherry_grove',
        'grove',
        'snowy_slopes',
        'jagged_peaks',
        'frozen_peaks',
        'stony_peaks',
        'windswept_hills',
        'windswept_gravelly_hills',
        'windswept_forest',
      ])
    }),
  )
})

describe('ore height providers', () => {
  it.effect('samples uniform endpoints and the vanilla trapezoid formula at boundaries', () =>
    Effect.sync(() => {
      const uniformRow = expectedFeatureRows.find((row) => row.distribution === 'uniform')
      const trapezoidRow = expectedFeatureRows.find((row) => row.distribution === 'trapezoid')
      const uniform = ORE_CONFIGS.find((config) => config.feature === uniformRow?.feature)
      const trapezoid = ORE_CONFIGS.find((config) => config.feature === trapezoidRow?.feature)
      expect(uniform).toBeDefined()
      expect(trapezoid).toBeDefined()
      expect(uniformRow).toBeDefined()
      expect(trapezoidRow).toBeDefined()
      if (uniform === undefined || trapezoid === undefined || uniformRow === undefined || trapezoidRow === undefined) return

      expect(sampleOreY(uniform, 10, 18, () => 0)).toBe(10)
      expect(sampleOreY(uniform, 10, 18, () => 0.999999)).toBe(18)

      const ironSmallRow = expectedFeatureRows.find((row) => row.feature === 'iron-small')
      const ironUpperRow = expectedFeatureRows.find((row) => row.feature === 'iron-upper')
      const ironSmall = ORE_CONFIGS.find((config) => config.feature === ironSmallRow?.feature)
      const ironUpper = ORE_CONFIGS.find((config) => config.feature === ironUpperRow?.feature)
      expect(ironSmall).toBeDefined()
      expect(ironUpper).toBeDefined()
      expect(ironSmallRow).toBeDefined()
      expect(ironUpperRow).toBeDefined()
      if (ironSmall === undefined || ironUpper === undefined || ironSmallRow === undefined || ironUpperRow === undefined) return
      expect(sampleOreY(ironSmall, ironSmallRow.minY, ironSmallRow.maxY, () => 0)).toBe(ironSmallRow.minY)
      expect(sampleOreY(ironUpper, ironUpperRow.minY, ironUpperRow.maxY, () => 0.999999)).toBe(ironUpperRow.maxY)

      let trapezoidDraws = 0
      const edgeTrapezoid = sampleOreY(trapezoid, 10, 18, () => {
        trapezoidDraws += 1
        return trapezoidDraws === 1 ? 0 : 0.999999
      })
      expect(edgeTrapezoid).toBe(14)
      expect(trapezoidDraws).toBe(2)

      expect(sampleOreY(trapezoid, 40, 40, () => 0.5)).toBe(40)

      const copper = ORE_CONFIGS.find((config) => config.feature === 'copper-small')
      const emerald = ORE_CONFIGS.find((config) => config.feature === 'emerald')
      expect(copper).toBeDefined()
      expect(emerald).toBeDefined()
      if (copper === undefined || emerald === undefined) return

      expect(sampleOreY(copper, -16, 112, () => 0.5)).toBe(48)
      expect(sampleOreY(emerald, -16, 480, () => 0.5)).toBe(232)

      const trapezoidWithoutPlateau: OreConfig = {
        attemptsPerChunk: 1,
        distribution: 'trapezoid',
        feature: 'coal-lower',
        maxY: FALLBACK_ORE_MAX_Y,
        minY: FALLBACK_ORE_MIN_Y,
        name: 'COAL',
        size: 1,
      }
      expect(sampleOreY(trapezoidWithoutPlateau, FALLBACK_ORE_MIN_Y, FALLBACK_ORE_MAX_Y, () => 0.5)).toBe(FALLBACK_ORE_EXPECTED_Y)
    }),
  )

  it.effect('samples the original vanilla range even when its levels are outside the stored Y interval', () =>
    Effect.sync(() => {
      let outsideStoredYDraws = 0
      for (const expected of expectedFeatureRows) {
        const config = ORE_CONFIGS.find((row) => row.feature === expected.feature)
        if (config === undefined) throw new Error(`missing configured ore feature ${expected.feature}`)
        const next = mulberry32(noiseSeed(expected.feature.length))
        for (let draw = 0; draw < 50; draw += 1) {
          const y = sampleOreY(config, expected.minY, expected.maxY, next)
          expect(y).toBeGreaterThanOrEqual(expected.minY)
          expect(y).toBeLessThanOrEqual(expected.maxY)
          if (y < ORE_MIN_Y_FLOOR || y > ORE_MAX_Y) {
            outsideStoredYDraws += 1
          }
        }
      }
      expect(outsideStoredYDraws).toBeGreaterThan(0)
    }),
  )

  it.effect('skips an off-buffer iron sample instead of redistributing it into the chunk', () =>
    Effect.sync(() => {
      const expected = expectedFeatureRows.find((row) => row.feature === 'iron-small')
      const config = ORE_CONFIGS.find((row) => row.feature === expected?.feature)
      expect(config).toBeDefined()
      expect(expected).toBeDefined()
      if (config === undefined || expected === undefined) return

      const coord: ChunkCoord = { cx: chunkAxis(0), cz: chunkAxis(0) }
      let foundSkippedSample = false
      for (let seedValue = 0; seedValue < ORE_SAMPLE_SEED_SEARCH_LIMIT && !foundSkippedSample; seedValue += 1) {
        const seed = noiseSeed(seedValue)
        const fullRangeNext = mulberry32(oreStreamSeed(seed, config, 0, 0))
        const seedX = Math.floor(fullRangeNext() * CHUNK_SIZE_XZ)
        const vanillaY = sampleOreY(config, expected.minY, expected.maxY, fullRangeNext)
        const seedZ = Math.floor(fullRangeNext() * CHUNK_SIZE_XZ)

        const clippedRangeNext = mulberry32(oreStreamSeed(seed, config, 0, 0))
        const clippedX = Math.floor(clippedRangeNext() * CHUNK_SIZE_XZ)
        const clippedY = sampleOreY(
          config,
          Math.max(expected.minY, ORE_MIN_Y_FLOOR),
          Math.min(expected.maxY, ORE_MAX_Y),
          clippedRangeNext,
        )
        const clippedZ = Math.floor(clippedRangeNext() * CHUNK_SIZE_XZ)

        if (vanillaY >= ORE_MIN_Y_FLOOR || clippedY < DEEPSLATE_CEILING) continue

        expect(seedX).toBe(clippedX)
        expect(seedZ).toBe(clippedZ)
        const blocks = new Uint16Array(BLOCK_COUNT)
        blocks[blockIndex(clippedX, clippedY, clippedZ)] = BLOCK.STONE
        placeOres(blocks, seed, coord, allPlainsBiomes())
        foundSkippedSample = !blocks.some((block) => ORE_IDS.includes(block))
      }

      expect(foundSkippedSample).toBe(true)
    }),
  )
})

describe('ore placement', () => {
  it.effect('fails closed when biome-filtered features have missing or unrecognized biome ids', () =>
    Effect.sync(() => {
      const coord: ChunkCoord = { cx: chunkAxis(0), cz: chunkAxis(0) }
      const missingBiomeBlocks = solidOverworldBlocks()
      placeOres(missingBiomeBlocks, noiseSeed(BIOME_FILTER_SEED), coord, [])
      expect(missingBiomeBlocks).not.toContain(ORE_BLOCK.EMERALD)
      expect(missingBiomeBlocks).not.toContain(DEEPSLATE_ORE_BLOCK.EMERALD)

      const goldExtra = ORE_CONFIGS.find((config) => config.feature === 'gold-extra')
      if (goldExtra === undefined) throw new Error('gold-extra feature is required by the vanilla table')
      const previousRule = goldExtra.biomeRule
      expect(Reflect.set(goldExtra, 'biomeRule', 'unregistered')).toBe(true)
      try {
        placeOres(solidOverworldBlocks(), noiseSeed(BIOME_FILTER_SEED), coord, allPlainsBiomes())
      } finally {
        Reflect.set(goldExtra, 'biomeRule', previousRule)
      }
      expect(goldExtra.biomeRule).toBe(previousRule)
    }),
  )

  it.effect('skips off-buffer samples and keeps every placed ore inside its clipped feature band', () =>
    Effect.sync(() => {
      const blocks = solidOverworldBlocks()
      const biomes = allPlainsBiomes()
      const coord: ChunkCoord = { cx: chunkAxis(-2), cz: chunkAxis(3) }
      placeOres(blocks, noiseSeed(20261109), coord, biomes)

      let placed = 0
      const placedNames = new Set<OreName>()
      for (let x = 0; x < CHUNK_SIZE_XZ; x += 1) {
        for (let z = 0; z < CHUNK_SIZE_XZ; z += 1) {
          for (let y = 0; y < CHUNK_HEIGHT; y += 1) {
            const block = blocks[blockIndex(x, y, z)]
            if (block === undefined) continue
            const name = ORE_NAME_BY_ID.get(block)
            if (name === undefined) continue

            placed += 1
            placedNames.add(name)
            expect(ORE_IDS).toContain(block)
            expect(
              expectedFeatureRows.some((expected) =>
                expected.name === name &&
                y >= Math.max(expected.minY, ORE_MIN_Y_FLOOR) &&
                y <= Math.min(expected.maxY, ORE_MAX_Y),
              ),
              `${name} at Y=${String(y)} has no vanilla feature range`,
            ).toBe(true)
          }
        }
      }

      expect(placed).toBeGreaterThan(0)
      expect(placedNames).toContain('COPPER')
    }),
  )

  it.effect('places every supported ore kind across fixed deterministic seed and chunk samples', () =>
    Effect.sync(() => {
      const samples = [
        { cx: 0, cz: 0, seed: 1 },
        { cx: -2, cz: 3, seed: 42 },
        { cx: 4, cz: -7, seed: 1337 },
        { cx: -4, cz: 5, seed: 77 },
        { cx: 3, cz: -2, seed: 20261109 },
      ] as const
      const found = new Set<OreName>()
      const biomes = allMountainBiomes()

      for (const sample of samples) {
        const blocks = solidOverworldBlocks()
        placeOres(blocks, noiseSeed(sample.seed), { cx: chunkAxis(sample.cx), cz: chunkAxis(sample.cz) }, biomes)
        for (const { name } of orePlacementsIn(blocks)) {
          found.add(name)
        }
      }

      expect([...found].sort()).toStrictEqual([...ORE_NAMES].sort())
    }),
  )

  it.effect('integrates ore ids and feature bands in generated chunks, independent of decoration', () =>
    Effect.sync(() => {
      const seed = noiseSeed(20261109)
      const chunkX = chunkAxis(-2)
      const chunkZ = chunkAxis(3)
      const undecorated = generateChunkAt(seed, chunkX, chunkZ, { decorate: false })
      const decorated = generateChunkAt(seed, chunkX, chunkZ)
      const placements = orePlacementsIn(undecorated.blocks)

      expect(placements.length).toBeGreaterThan(0)
      expect(orePlacementsIn(decorated.blocks).map(({ id, index }) => [index, id])).toStrictEqual(
        placements.map(({ id, index }) => [index, id]),
      )
      for (const placement of placements) {
        expect(ORE_IDS).toContain(placement.id)
        expect(
          expectedFeatureRows.some((expected) =>
            expected.name === placement.name &&
            placement.y >= Math.max(expected.minY, ORE_MIN_Y_FLOOR) &&
            placement.y <= Math.min(expected.maxY, ORE_MAX_Y),
          ),
          `${placement.name} at Y=${String(placement.y)} has no eligible generated feature`,
        ).toBe(true)
      }
    }),
  )

  it.effect('is deterministic for the same seed, coordinate and biome columns', () =>
    Effect.sync(() => {
      const biomes = allPlainsBiomes()
      const coord: ChunkCoord = { cx: chunkAxis(-4), cz: chunkAxis(5) }
      const first = solidOverworldBlocks()
      const second = solidOverworldBlocks()
      placeOres(first, noiseSeed(77), coord, biomes)
      placeOres(second, noiseSeed(77), coord, biomes)
      expect(first).toStrictEqual(second)
    }),
  )

  it.effect('changes stream by feature, world seed and chunk origin', () =>
    Effect.sync(() => {
      const config = ORE_CONFIGS[0]
      expect(config).toBeDefined()
      if (config === undefined) return
      expect(oreStreamSeed(noiseSeed(1), config, 0, 0)).not.toBe(oreStreamSeed(noiseSeed(2), config, 0, 0))
      expect(oreStreamSeed(noiseSeed(1), config, 0, 0)).not.toBe(oreStreamSeed(noiseSeed(1), config, 16, 0))
      expect(oreStreamSeed(noiseSeed(1), config, 0, 0)).not.toBe(oreStreamSeed(noiseSeed(1), ORE_CONFIGS[1] ?? config, 0, 0))
    }),
  )

  it.effect('generates emerald on each of the ten listed mountain biomes', () =>
    Effect.sync(() => {
      for (const biome of EMERALD_MOUNTAIN_BIOME_IDS) {
        const biomes: ReadonlyArray<BiomeType> = Array.from({ length: COLUMN_COUNT }, () => biome)
        const blocks = solidOverworldBlocks()
        placeOres(blocks, noiseSeed(4242), { cx: chunkAxis(0), cz: chunkAxis(0) }, biomes)
        const emeraldPlacements = orePlacementsIn(blocks).filter(({ name }) => name === 'EMERALD')

        expect(emeraldPlacements.length, `no emeralds generated in ${biome}`).toBeGreaterThan(0)
        for (const { y } of emeraldPlacements) {
          expect(y, `emerald outside the stored Y=0..255 range in ${biome}`).toBeGreaterThanOrEqual(0)
          expect(y, `emerald outside the stored Y=0..255 range in ${biome}`).toBeLessThanOrEqual(255)
        }
      }
    }),
  )

  it.effect('never grows emerald into a non-mountain biome column for generated seeds and coordinates', () =>
    Effect.sync(() => {
      const arbitraryBiomes = fc.array(fc.boolean(), { minLength: COLUMN_COUNT, maxLength: COLUMN_COUNT }).map((mask) =>
        mask.map((isMountain, index): BiomeType => {
          if (index === 0) return 'meadow'
          if (index === 1) return 'plains'
          return isMountain ? 'jagged_peaks' : 'plains'
        }),
      )

      fc.assert(
        fc.property(
          fc.nat(0xffff_ffff),
          fc.integer({ min: -8, max: 8 }),
          fc.integer({ min: -8, max: 8 }),
          arbitraryBiomes,
          (seed, cx, cz, biomes) => {
            const blocks = solidOverworldBlocks()
            placeOres(blocks, noiseSeed(seed), { cx: chunkAxis(cx), cz: chunkAxis(cz) }, biomes)

            for (let x = 0; x < CHUNK_SIZE_XZ; x += 1) {
              for (let z = 0; z < CHUNK_SIZE_XZ; z += 1) {
                const biome = biomes[z * CHUNK_SIZE_XZ + x]
                const allowed = biome !== undefined && EMERALD_MOUNTAIN_BIOME_SET.has(biome)
                if (allowed) continue
                for (let y = 0; y < CHUNK_HEIGHT; y += 1) {
                  const block = blocks[blockIndex(x, y, z)]
                  expect(block === ORE_BLOCK.EMERALD || block === DEEPSLATE_ORE_BLOCK.EMERALD).toBe(false)
                }
              }
            }
          },
        ),
        { numRuns: 12 },
      )
    }),
  )

  it.effect('keeps an emerald-free chunk when all columns are non-mountain biomes', () =>
    Effect.sync(() => {
      const blocks = solidOverworldBlocks()
      placeOres(blocks, noiseSeed(123), { cx: chunkAxis(0), cz: chunkAxis(0) }, allPlainsBiomes())
      expect(blocks).not.toContain(ORE_BLOCK.EMERALD)
      expect(blocks).not.toContain(DEEPSLATE_ORE_BLOCK.EMERALD)
    }),
  )
})

describe('vein growth', () => {
  it.effect('replaces stone only and obeys the supplied Y bounds', () =>
    Effect.sync(() => {
      const blocks = new Uint16Array(BLOCK_COUNT).fill(BLOCK.STONE)
      const placed = growVein({
        blocks,
        host: BLOCK.STONE,
        next: mulberry32(noiseSeed(12345)),
        ore: ORE_BLOCK.COAL,
        seedX: 8,
        seedY: 30,
        seedZ: 8,
        targetSize: 200,
        yMax: 35,
        yMin: 25,
      })
      expect(placed).toBeGreaterThan(0)
      for (let x = 0; x < CHUNK_SIZE_XZ; x += 1) {
        for (let z = 0; z < CHUNK_SIZE_XZ; z += 1) {
          for (let y = 0; y < CHUNK_HEIGHT; y += 1) {
            if (blocks[blockIndex(x, y, z)] !== ORE_BLOCK.COAL) continue
            expect(y).toBeGreaterThanOrEqual(25)
            expect(y).toBeLessThanOrEqual(35)
          }
        }
      }
    }),
  )

  it.effect('preserves a mixed buffer and replaces only stone hosts', () =>
    Effect.sync(() => {
      const blocks = new Uint16Array(BLOCK_COUNT).fill(BLOCK.DIRT)
      for (let x = 6; x <= 10; x += 1) {
        for (let y = 28; y <= 32; y += 1) {
          for (let z = 6; z <= 10; z += 1) {
            blocks[blockIndex(x, y, z)] = BLOCK.STONE
          }
        }
      }
      blocks[blockIndex(7, 30, 8)] = BLOCK.BEDROCK
      blocks[blockIndex(9, 30, 8)] = BLOCK.WATER
      blocks[blockIndex(8, 29, 8)] = BLOCK.DIRT
      blocks[blockIndex(8, 31, 8)] = BLOCK.GRAVEL
      blocks[blockIndex(8, 30, 7)] = BLOCK.AIR
      const before = blocks.slice()

      const placed = growVein({
        blocks,
        host: BLOCK.STONE,
        next: mulberry32(noiseSeed(12345)),
        ore: ORE_BLOCK.COAL,
        seedX: 8,
        seedY: 30,
        seedZ: 8,
        targetSize: 40,
        yMax: 32,
        yMin: 28,
      })

      expect(placed).toBeGreaterThan(0)
      for (let index = 0; index < BLOCK_COUNT; index += 1) {
        const original = before[index]
        const after = blocks[index]
        if (original === undefined || after === undefined) continue
        if (after === original) continue
        expect(original).toBe(BLOCK.STONE)
        expect(after).toBe(ORE_BLOCK.COAL)
      }
      expect(blocks[blockIndex(7, 30, 8)]).toBe(BLOCK.BEDROCK)
      expect(blocks[blockIndex(9, 30, 8)]).toBe(BLOCK.WATER)
      expect(blocks[blockIndex(8, 29, 8)]).toBe(BLOCK.DIRT)
      expect(blocks[blockIndex(8, 31, 8)]).toBe(BLOCK.GRAVEL)
      expect(blocks[blockIndex(8, 30, 7)]).toBe(BLOCK.AIR)
    }),
  )
})
