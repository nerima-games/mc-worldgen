/**
 * Ground cover: grass, ferns and flowers.
 *
 * `domain/vegetation.ts` is a placement rule plus a support rule, and the two
 * fail in different ways, so they are tested separately before they are tested
 * together in generated terrain:
 *
 *   the PLACEMENT rule fails by frequency — it runs, it is deterministic, and it
 *     puts down a tenth of the flowers the density asks for. Nothing crashes.
 *     That is the failure this repository has on record twice (docs/testing.md
 *     §4-b F-2 and F-5), so the density is MEASURED against its parameter here
 *     rather than assumed from the arithmetic.
 *
 *   the SUPPORT rule fails by position — a flower floating over a carved cave,
 *     standing in water, or written into a cell a tree trunk also wanted.
 *
 * The last group is the one that backs the regenerated goldens: docs/testing.md
 * §3 allows a golden to move only when an INDEPENDENT property says the new
 * output is right, and `V-1` .. `V-4` below are that property for the vegetation
 * half of the move. None of them reads `test/golden/chunk-goldens.json`.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { blockIdOf } from '@nerima-games/mc-kernel'
import { BIOMES, BIOME_SURFACES, BLOCK, type BiomeType } from '../src/domain/biome'
import { columnIndex, readBlock, type Chunk } from '../src/domain/chunk'
import { BEDROCK_Y, blockIndex, CHUNK_HEIGHT, CHUNK_SIZE_XZ } from '../src/domain/constants'
import { generateChunkAt } from '../src/domain/terrain'
import {
  AQUATIC_PLANT_IDS,
  GROUND_COVER_IDS,
  GROUND_PLANT_DENSITY,
  MUSHROOM_IDS,
  PLANT,
  PLANT_IDS,
  STACKED_PLANT_IDS,
  biomeCanGrowGroundPlants,
  canPlaceAquaticPlantAt,
  canPlaceCactusAt,
  canPlaceGroundPlantAt,
  canPlaceLilyPadAt,
  canPlaceSugarCaneAt,
  groundPlantAt,
  plantSpecialVegetation,
  plantRoll,
  shouldPlaceGroundPlant,
} from '../src/domain/vegetation'
import { GOLDEN_SEED, GOLDEN_SPECS } from '../scripts/golden-fixture'

const PLANT_ID_SET = new Set<number>(PLANT_IDS)

const isSupportedPlant = (id: number, below: number): boolean => {
  if (GROUND_COVER_IDS.includes(id) || MUSHROOM_IDS.includes(id)) {
    return below === BLOCK.GRASS || below === BLOCK.DIRT
  }
  if (id === PLANT.CACTUS) {
    return below === BLOCK.SAND || below === PLANT.CACTUS
  }
  if (id === PLANT.SUGAR_CANE) {
    return below === BLOCK.DIRT || below === BLOCK.GRASS || below === BLOCK.SAND || below === PLANT.SUGAR_CANE
  }
  if (id === PLANT.LILY_PAD) {
    return below === BLOCK.WATER
  }
  if (id === PLANT.SEAGRASS || id === PLANT.KELP) {
    return below === BLOCK.DIRT || below === BLOCK.GRASS || below === BLOCK.SAND || below === BLOCK.GRAVEL || below === PLANT.KELP
  }
  return false
}

/** One single-biome chunk per biome, from the golden matrix's own selection rule. */
const CHUNK_FOR_BIOME: ReadonlyMap<BiomeType, { readonly cx: number; readonly cz: number }> = new Map(
  GOLDEN_SPECS.slice(0, BIOMES.length).map((spec) => [spec.biome, { cx: spec.cx, cz: spec.cz }] as const),
)

const chunkFor = (biome: BiomeType): Chunk => {
  const at = CHUNK_FOR_BIOME.get(biome)
  if (at === undefined) {
    throw new Error(`no golden chunk for ${biome}`)
  }
  return generateChunkAt(GOLDEN_SEED, at.cx, at.cz)
}

const countPlants = (chunk: Chunk): number => {
  let total = 0
  for (const value of chunk.blocks) {
    if (PLANT_ID_SET.has(value)) {
      total += 1
    }
  }
  return total
}

const emptyBlocks = (): Uint8Array => new Uint8Array(CHUNK_HEIGHT * CHUNK_SIZE_XZ * CHUNK_SIZE_XZ)

const putBlock = (blocks: Uint8Array, lx: number, y: number, lz: number, id: number): void => {
  blocks[blockIndex(lx, y, lz)] = id
}

const specialInput = (
  blocks: Uint8Array,
  biome: BiomeType,
  surfaceY: number,
  seed: number,
  waterLevel = 63,
) => ({
  blocks,
  biome,
  lx: 8,
  lz: 8,
  surfaceY,
  waterLevel,
  seed,
  worldX: 8,
  worldZ: 8,
})

describe('the plant id table', () => {
  it.effect('carries the kernel ids for every supported natural plant', () =>
    Effect.sync(() => {
      expect(PLANT).toStrictEqual({
        BROWN_MUSHROOM: blockIdOf('brown_mushroom'),
        CACTUS: blockIdOf('cactus'),
        DANDELION: blockIdOf('dandelion'),
        FERN: blockIdOf('fern'),
        KELP: blockIdOf('kelp'),
        LILY_PAD: blockIdOf('lily_pad'),
        POPPY: blockIdOf('poppy'),
        RED_MUSHROOM: blockIdOf('red_mushroom'),
        SEAGRASS: blockIdOf('seagrass'),
        SUGAR_CANE: blockIdOf('sugar_cane'),
        TALL_GRASS: blockIdOf('tall_grass'),
      })
      expect(new Set(PLANT_IDS).size).toBe(PLANT_IDS.length)
      expect(new Set([...GROUND_COVER_IDS, ...MUSHROOM_IDS, ...AQUATIC_PLANT_IDS, ...STACKED_PLANT_IDS])).toStrictEqual(
        new Set(PLANT_IDS),
      )
    }),
  )

  it.effect('does not collide with any terrain id', () =>
    Effect.sync(() => {
      const terrain = new Set<number>(Object.values(BLOCK))
      for (const id of PLANT_IDS) {
        expect(terrain.has(id), `plant id ${String(id)} collides with a BLOCK id`).toBe(false)
      }
    }),
  )
})

describe('the placement roll', () => {
  it.effect('is deterministic: the same seed and column always give the same draw', () =>
    Effect.sync(() => {
      for (const [wx, wz] of [
        [0, 0],
        [17, -33],
        [-1234, 5678],
      ] as const) {
        expect(plantRoll(GOLDEN_SEED, wx, wz, 'ground-plant-placement')).toBe(
          plantRoll(GOLDEN_SEED, wx, wz, 'ground-plant-placement'),
        )
      }
    }),
  )

  /**
   * THE DIVERGENCE, ASSERTED.
   *
   * `domain/vegetation.ts` replaces the reference's seedless sin-hash with this
   * repository's seeded `channelSeed` + `latticeValue`, and the entire argument
   * for doing so is that two worlds must not carry the same flowers at the same
   * absolute coordinates. If this ever passes vacuously — because someone
   * "simplified" the roll back to a coordinate hash — the divergence is gone and
   * nothing else would notice.
   */
  it.effect('depends on the world seed, which is the whole reason it is not the reference’s hash', () =>
    Effect.sync(() => {
      let differing = 0
      for (let wx = 0; wx < 64; wx += 1) {
        for (let wz = 0; wz < 64; wz += 1) {
          if (plantRoll(1, wx, wz, 'ground-plant-placement') !== plantRoll(2, wx, wz, 'ground-plant-placement')) {
            differing += 1
          }
        }
      }
      // Two independent streams agree on a column only by collision, so this is
      // "almost all of them" rather than "all of them".
      expect(differing).toBeGreaterThan(4000)
    }),
  )

  it.effect('gives the two channels independent draws, so variant does not track placement', () =>
    Effect.sync(() => {
      let same = 0
      for (let wx = 0; wx < 64; wx += 1) {
        for (let wz = 0; wz < 64; wz += 1) {
          if (
            plantRoll(GOLDEN_SEED, wx, wz, 'ground-plant-placement') ===
            plantRoll(GOLDEN_SEED, wx, wz, 'ground-plant-variant')
          ) {
            same += 1
          }
        }
      }
      // Correlated channels are the failure mode avoided by named noise channels:
      // if these were one stream, every placed plant would be the same variant.
      expect(same).toBeLessThan(16)
    }),
  )

  /**
   * The frequency check. `density` is a per-column probability and this measures
   * whether it is one — a rule that is off by a factor is the F-2 failure, and
   * arithmetic in a comment is exactly what let it through last time.
   *
   * THE EXPECTED RATES ARE LITERALS AND NOT `GROUND_PLANT_DENSITY`, and the
   * first version of this test got that wrong in a way worth recording. It read
   * the density out of the table and then asserted that the realised frequency
   * matched it — comparing the table to itself. Halving `PLAINS` from 0.22 to
   * 0.11 changed both sides and the test went on passing; it was found by
   * mutating the table and watching nothing go red.
   *
   * So the numbers below are transcribed independently from the reference's
   * `GROUND_PLANT_DENSITY_BY_BIOME` (`plant-placement-model.ts:66-75`), and the
   * table is checked against them as a separate statement. A change to either
   * one now has to be made twice, deliberately, which is the whole point of a
   * transcription test.
   */
  const REFERENCE_DENSITY: Readonly<Record<BiomeType, number>> = {
    DESERT: 0,
    PLAINS: 0.22,
    FOREST: 0.14,
    FLOWER_FOREST: 0.42,
    OCEAN: 0,
    MOUNTAINS: 0,
    SNOW: 0,
    SWAMP: 0.1,
    JUNGLE: 0.18,
    BEACH: 0.02,
    RIVER: 0,
    TAIGA: 0.12,
    SAVANNA: 0.08,
  }

  it.effect('transcribes the reference’s densities exactly', () =>
    Effect.sync(() => {
      expect(GROUND_PLANT_DENSITY).toStrictEqual(REFERENCE_DENSITY)
    }),
  )

  it.effect('realises each biome’s density as an actual per-column frequency', () =>
    Effect.sync(() => {
      for (const biome of BIOMES) {
        const expected = REFERENCE_DENSITY[biome]
        let passed = 0
        let columns = 0

        for (let wx = -100; wx < 100; wx += 1) {
          for (let wz = -100; wz < 100; wz += 1) {
            columns += 1
            if (shouldPlaceGroundPlant({ seed: GOLDEN_SEED, worldX: wx, worldZ: wz, biome, surfaceY: 64 })) {
              passed += 1
            }
          }
        }

        const realised = passed / columns
        if (expected === 0) {
          expect(realised, `${biome} has density 0 and must place nothing`).toBe(0)
        } else {
          // 40,000 columns, so the sampling error on a 0.02 rate is well under
          // this band. A factor-of-two bug cannot hide in it.
          expect(realised, `${biome} should realise ${String(expected)}, realised ${String(realised)}`).toBeGreaterThan(
            expected * 0.9,
          )
          expect(realised).toBeLessThan(expected * 1.1)
        }
      }
    }),
  )

  it.effect('refuses a surface at the floor or the ceiling of the world', () =>
    Effect.sync(() => {
      const base = { seed: GOLDEN_SEED, worldX: 0, worldZ: 0, biome: 'PLAINS' } as const
      expect(shouldPlaceGroundPlant({ ...base, surfaceY: 0 })).toBe(false)
      expect(shouldPlaceGroundPlant({ ...base, surfaceY: CHUNK_HEIGHT - 1 })).toBe(false)
    }),
  )
})

describe('the variant table', () => {
  /**
   * The thresholds are transcribed cumulatively from the reference
   * (`plant-placement-rules.ts:99-121`), and a cumulative table is the shape
   * that silently loses a branch: writing `< 0.2` where `< 0.22` belongs takes
   * 2% of the poppies away and nothing fails. So the proportions are measured.
   */
  it.effect('splits each biome in the proportions the reference states', () =>
    Effect.sync(() => {
      const proportions = (biome: BiomeType): Record<number, number> => {
        const counts: Record<number, number> = {}
        let total = 0
        for (let wx = -100; wx < 100; wx += 1) {
          for (let wz = -100; wz < 100; wz += 1) {
            const plant = groundPlantAt(GOLDEN_SEED, wx, wz, biome)
            counts[plant] = (counts[plant] ?? 0) + 1
            total += 1
          }
        }
        return Object.fromEntries(Object.entries(counts).map(([id, n]) => [Number(id), n / total]))
      }

      const forest = proportions('FOREST')
      expect(forest[PLANT.DANDELION] ?? 0).toBeCloseTo(0.12, 1)
      expect(forest[PLANT.POPPY] ?? 0).toBeCloseTo(0.08, 1)
      expect(forest[PLANT.FERN] ?? 0).toBeCloseTo(0.35, 1)
      expect(forest[PLANT.TALL_GRASS] ?? 0).toBeCloseTo(0.45, 1)

      const plains = proportions('PLAINS')
      expect(plains[PLANT.DANDELION] ?? 0).toBeCloseTo(0.12, 1)
      expect(plains[PLANT.POPPY] ?? 0).toBeCloseTo(0.1, 1)
      expect(plains[PLANT.TALL_GRASS] ?? 0).toBeCloseTo(0.78, 1)
      // PLAINS grows no ferns at all — a row that would be easy to add by
      // copying FOREST's branch, and that the reference does not have.
      expect(plains[PLANT.FERN] ?? 0).toBe(0)

      const taiga = proportions('TAIGA')
      expect(taiga[PLANT.FERN] ?? 0).toBeCloseTo(0.65, 1)
      expect(taiga[PLANT.TALL_GRASS] ?? 0).toBeCloseTo(0.35, 1)
      // Taiga has no flowers in the reference's table.
      expect(taiga[PLANT.DANDELION] ?? 0).toBe(0)
      expect(taiga[PLANT.POPPY] ?? 0).toBe(0)
    }),
  )

  /**
   * `groundPlantAt` is callable with ANY biome, not only the ones
   * `shouldPlaceGroundPlant` would let through first — nothing in its type
   * gates it on density. The six biomes with `GROUND_PLANT_DENSITY` 0 have no
   * row in the threshold table at all, so this is the fallback branch:
   * `GROUND_PLANT_VARIANT_TABLE[biome] ?? []` yields an empty table, the
   * first-match-wins loop finds nothing to match, and the function falls
   * through to `PLANT.TALL_GRASS` — the same value the reference's
   * `selectGroundPlantBlockIndex` defaults to for an unlisted biome.
   */
  it.effect('a biome with no threshold row always falls through to TALL_GRASS', () =>
    Effect.sync(() => {
      const zeroTableBiomes = (['OCEAN', 'DESERT', 'MOUNTAINS', 'SNOW', 'RIVER', 'BEACH'] as const).filter(
        (biome) => GROUND_PLANT_DENSITY[biome] === 0,
      )
      expect(zeroTableBiomes.length, 'no zero-density biomes left to exercise the fallback').toBeGreaterThan(0)

      for (const biome of zeroTableBiomes) {
        for (const [wx, wz] of [
          [0, 0],
          [17, -33],
          [-1234, 5678],
        ] as const) {
          expect(groundPlantAt(GOLDEN_SEED, wx, wz, biome)).toBe(PLANT.TALL_GRASS)
        }
      }
    }),
  )
})

describe('the support rule', () => {
  it.effect('wants soil below and air above, and refuses everything else', () =>
    Effect.sync(() => {
      const blocks = new Uint8Array(CHUNK_HEIGHT * CHUNK_SIZE_XZ * CHUNK_SIZE_XZ)
      const put = (y: number, id: number): void => {
        blocks[blockIndex(0, y, 0)] = id
      }

      put(64, BLOCK.GRASS)
      expect(canPlaceGroundPlantAt(blocks, 0, 64, 0)).toBe(true)

      put(64, BLOCK.DIRT)
      expect(canPlaceGroundPlantAt(blocks, 0, 64, 0)).toBe(true)

      // Sand is what BEACH and DESERT actually have, and it is refused.
      put(64, BLOCK.SAND)
      expect(canPlaceGroundPlantAt(blocks, 0, 64, 0)).toBe(false)

      put(64, BLOCK.SNOW)
      expect(canPlaceGroundPlantAt(blocks, 0, 64, 0)).toBe(false)

      // Occupied above: a trunk, and then water. Both must refuse.
      put(64, BLOCK.GRASS)
      put(65, BLOCK.LOG)
      expect(canPlaceGroundPlantAt(blocks, 0, 64, 0)).toBe(false)

      put(65, BLOCK.WATER)
      expect(canPlaceGroundPlantAt(blocks, 0, 64, 0)).toBe(false)

      // A column whose top was carved away is air under air, and is refused.
      put(64, BLOCK.AIR)
      put(65, BLOCK.AIR)
      expect(canPlaceGroundPlantAt(blocks, 0, 64, 0)).toBe(false)
    }),
  )
})

describe('special vegetation support and placement', () => {
  it.effect('applies the distinct support rules for cactus, sugar cane and aquatic plants', () =>
    Effect.sync(() => {
      const cactus = emptyBlocks()
      putBlock(cactus, 8, 64, 8, BLOCK.SAND)
      expect(canPlaceCactusAt(cactus, 8, 64, 8)).toBe(true)
      putBlock(cactus, 7, 65, 8, BLOCK.LOG)
      expect(canPlaceCactusAt(cactus, 8, 64, 8)).toBe(false)
      expect(canPlaceCactusAt(cactus, 0, 64, 8)).toBe(false)
      putBlock(cactus, 7, 65, 8, BLOCK.AIR)
      putBlock(cactus, 8, 64, 8, BLOCK.DIRT)
      expect(canPlaceCactusAt(cactus, 8, 64, 8)).toBe(false)

      const sugarCane = emptyBlocks()
      putBlock(sugarCane, 8, 64, 8, BLOCK.DIRT)
      expect(canPlaceSugarCaneAt(sugarCane, 8, 64, 8)).toBe(false)
      putBlock(sugarCane, 7, 64, 8, BLOCK.WATER)
      expect(canPlaceSugarCaneAt(sugarCane, 8, 64, 8)).toBe(true)
      putBlock(sugarCane, 7, 64, 8, BLOCK.AIR)
      expect(canPlaceSugarCaneAt(sugarCane, 8, 64, 8)).toBe(false)

      const aquatic = emptyBlocks()
      putBlock(aquatic, 8, 62, 8, BLOCK.GRAVEL)
      putBlock(aquatic, 8, 63, 8, BLOCK.WATER)
      expect(canPlaceAquaticPlantAt(aquatic, 8, 62, 8)).toBe(true)
      putBlock(aquatic, 8, 63, 8, BLOCK.AIR)
      expect(canPlaceAquaticPlantAt(aquatic, 8, 62, 8)).toBe(false)
    }),
  )

  it.effect('requires a swamp water surface for lily pads and rejects invalid boundaries', () =>
    Effect.sync(() => {
      const blocks = emptyBlocks()
      putBlock(blocks, 8, 63, 8, BLOCK.WATER)
      expect(canPlaceLilyPadAt({ biome: 'SWAMP', blocks, lx: 8, lz: 8, waterLevel: 63, surfaceY: 60 })).toBe(true)
      expect(canPlaceLilyPadAt({ biome: 'PLAINS', blocks, lx: 8, lz: 8, waterLevel: 63, surfaceY: 60 })).toBe(false)
      expect(canPlaceLilyPadAt({ biome: 'SWAMP', blocks, lx: 8, lz: 8, waterLevel: 63, surfaceY: 63 })).toBe(false)
      putBlock(blocks, 8, 64, 8, BLOCK.LOG)
      expect(canPlaceLilyPadAt({ biome: 'SWAMP', blocks, lx: 8, lz: 8, waterLevel: 63, surfaceY: 60 })).toBe(false)
      expect(canPlaceLilyPadAt({ biome: 'SWAMP', blocks, lx: 8, lz: 8, waterLevel: CHUNK_HEIGHT - 1, surfaceY: 60 })).toBe(false)
      expect(canPlaceLilyPadAt({ biome: 'SWAMP', blocks, lx: -1, lz: 8, waterLevel: 63, surfaceY: 60 })).toBe(false)
    }),
  )

  it.effect('places bounded cactus, sugar cane and mushrooms on their own channels', () =>
    Effect.sync(() => {
      const cactus = emptyBlocks()
      putBlock(cactus, 8, 64, 8, BLOCK.SAND)
      plantSpecialVegetation(specialInput(cactus, 'DESERT', 64, 18))
      expect(cactus[blockIndex(8, 65, 8)]).toBe(PLANT.CACTUS)
      expect(cactus[blockIndex(8, 66, 8)]).toBe(PLANT.CACTUS)
      expect(cactus[blockIndex(8, 67, 8)]).toBe(BLOCK.AIR)

      const blockedCactus = emptyBlocks()
      putBlock(blockedCactus, 8, 64, 8, BLOCK.SAND)
      putBlock(blockedCactus, 7, 65, 8, BLOCK.LOG)
      plantSpecialVegetation(specialInput(blockedCactus, 'DESERT', 64, 18))
      expect(blockedCactus[blockIndex(8, 65, 8)]).toBe(BLOCK.AIR)

      const cappedCactus = emptyBlocks()
      putBlock(cappedCactus, 8, 64, 8, BLOCK.SAND)
      putBlock(cappedCactus, 7, 66, 8, BLOCK.LOG)
      plantSpecialVegetation(specialInput(cappedCactus, 'DESERT', 64, 18))
      expect(cappedCactus[blockIndex(8, 65, 8)]).toBe(PLANT.CACTUS)
      expect(cappedCactus[blockIndex(8, 66, 8)]).toBe(BLOCK.AIR)

      const sugarCane = emptyBlocks()
      putBlock(sugarCane, 8, 64, 8, BLOCK.DIRT)
      putBlock(sugarCane, 7, 64, 8, BLOCK.WATER)
      putBlock(sugarCane, 8, 66, 8, BLOCK.LOG)
      plantSpecialVegetation(specialInput(sugarCane, 'PLAINS', 64, 18))
      expect(sugarCane[blockIndex(8, 65, 8)]).toBe(PLANT.SUGAR_CANE)
      expect(sugarCane[blockIndex(8, 66, 8)]).toBe(BLOCK.LOG)

      const mushroom = emptyBlocks()
      putBlock(mushroom, 8, 64, 8, BLOCK.DIRT)
      plantSpecialVegetation(specialInput(mushroom, 'FOREST', 64, 54))
      expect(mushroom[blockIndex(8, 65, 8)]).toBe(PLANT.BROWN_MUSHROOM)
    }),
  )

  it.effect('places seagrass, kelp and a swamp lily pad only in water', () =>
    Effect.sync(() => {
      const seagrass = emptyBlocks()
      putBlock(seagrass, 8, 62, 8, BLOCK.GRAVEL)
      putBlock(seagrass, 8, 63, 8, BLOCK.WATER)
      plantSpecialVegetation(specialInput(seagrass, 'OCEAN', 62, 0))
      expect(seagrass[blockIndex(8, 63, 8)]).toBe(PLANT.SEAGRASS)

      const kelp = emptyBlocks()
      putBlock(kelp, 8, 62, 8, BLOCK.GRAVEL)
      putBlock(kelp, 8, 63, 8, BLOCK.WATER)
      putBlock(kelp, 8, 64, 8, BLOCK.WATER)
      plantSpecialVegetation(specialInput(kelp, 'OCEAN', 62, 18))
      expect(kelp[blockIndex(8, 63, 8)]).toBe(PLANT.KELP)
      expect(kelp[blockIndex(8, 64, 8)]).toBe(PLANT.KELP)

      const lilyPad = emptyBlocks()
      putBlock(lilyPad, 8, 60, 8, BLOCK.DIRT)
      putBlock(lilyPad, 8, 61, 8, BLOCK.WATER)
      putBlock(lilyPad, 8, 63, 8, BLOCK.WATER)
      plantSpecialVegetation(specialInput(lilyPad, 'SWAMP', 60, 6))
      expect(lilyPad[blockIndex(8, 61, 8)]).toBe(PLANT.SEAGRASS)
      expect(lilyPad[blockIndex(8, 64, 8)]).toBe(PLANT.LILY_PAD)

      const dry = emptyBlocks()
      putBlock(dry, 8, 62, 8, BLOCK.GRAVEL)
      plantSpecialVegetation(specialInput(dry, 'OCEAN', 62, 0))
      expect(dry[blockIndex(8, 63, 8)]).toBe(BLOCK.AIR)
    }),
  )

  it.effect('does not write at world height boundaries', () =>
    Effect.sync(() => {
      const floor = emptyBlocks()
      putBlock(floor, 8, BEDROCK_Y, 8, BLOCK.SAND)
      plantSpecialVegetation(specialInput(floor, 'DESERT', BEDROCK_Y, 18))
      expect(floor.some((id) => id !== BLOCK.AIR && id !== BLOCK.SAND)).toBe(false)

      const ceiling = emptyBlocks()
      putBlock(ceiling, 8, CHUNK_HEIGHT - 1, 8, BLOCK.SAND)
      plantSpecialVegetation(specialInput(ceiling, 'DESERT', CHUNK_HEIGHT - 1, 18))
      expect(ceiling.some((id) => id !== BLOCK.AIR && id !== BLOCK.SAND)).toBe(false)
    }),
  )
})

/**
 * ---------------------------------------------------------------------------
 * V-1 .. V-4: what backs the moved goldens.
 *
 * None of these reads the committed digest file. They are the independent
 * property docs/testing.md §3 requires before a golden may be regenerated.
 * ---------------------------------------------------------------------------
 */
describe('what backs the vegetation half of the golden move', () => {
  const decoratedChunks = BIOMES.map((biome) => ({ biome, chunk: chunkFor(biome) }))

  it.effect('V-1: every plant obeys its category support rule', () =>
    Effect.sync(() => {
      let seen = 0
      // Collected rather than asserted per cell: 655,360 matcher calls is slow
      // enough to trip `testTimeout` under a loaded run. Same reason as I-1.
      const floating: Array<string> = []

      for (const { biome, chunk } of decoratedChunks) {
        for (let lx = 0; lx < CHUNK_SIZE_XZ; lx += 1) {
          for (let lz = 0; lz < CHUNK_SIZE_XZ; lz += 1) {
            for (let y = 0; y < CHUNK_HEIGHT; y += 1) {
              if (!PLANT_ID_SET.has(readBlock(chunk.blocks, blockIndex(lx, y, lz)))) {
                continue
              }
              seen += 1
              const below = readBlock(chunk.blocks, blockIndex(lx, y - 1, lz))
              const id = readBlock(chunk.blocks, blockIndex(lx, y, lz))
              const supported = isSupportedPlant(id, below)
              if (!supported) {
                floating.push(`${biome} (${String(lx)}, ${String(y)}, ${String(lz)}) on ${String(below)}`)
              }
            }
          }
        }
      }

      expect(floating, 'plants standing on something that is not soil').toStrictEqual([])
      // The vacuity guard: with no plants anywhere, "every plant stands on soil"
      // is true and says nothing. docs/testing.md §6.
      expect(seen).toBeGreaterThan(0)
    }),
  )

  it.effect('V-2: single-block plants do not stack and natural columns stay bounded', () =>
    Effect.sync(() => {
      const crowded: Array<string> = []

      for (const { biome, chunk } of decoratedChunks) {
        for (let lx = 0; lx < CHUNK_SIZE_XZ; lx += 1) {
          for (let lz = 0; lz < CHUNK_SIZE_XZ; lz += 1) {
            let singleBlockPlants = 0
            const stackedPlants = new Map<number, number>()
            for (let y = 0; y < CHUNK_HEIGHT; y += 1) {
              const id = readBlock(chunk.blocks, blockIndex(lx, y, lz))
              if (GROUND_COVER_IDS.includes(id) || MUSHROOM_IDS.includes(id) || id === PLANT.LILY_PAD) {
                singleBlockPlants += 1
              }
              if (STACKED_PLANT_IDS.includes(id)) {
                stackedPlants.set(id, (stackedPlants.get(id) ?? 0) + 1)
              }
            }
            if (singleBlockPlants > 1) {
              crowded.push(`${biome} (${String(lx)}, ${String(lz)}) carries ${String(singleBlockPlants)} single-block plants`)
            }
            for (const [id, count] of stackedPlants) {
              if (count > 3) {
                crowded.push(`${biome} (${String(lx)}, ${String(lz)}) carries ${String(count)} of ${String(id)}`)
              }
            }
          }
        }
      }

      expect(crowded, 'columns carrying more than one plant').toStrictEqual([])
    }),
  )

  /**
   * V-3. The header of `domain/vegetation.ts` claims BEACH's transcribed 0.02
   * cannot place anything because this repository's BEACH surface is SAND, and
   * that DESERT, SNOW and OCEAN are zero on both sides. That is a claim about
   * the interaction of two tables, so it is measured rather than reasoned — if
   * `BIOME_SURFACES` ever gives BEACH a dirt patch, this fails and the header
   * gets corrected instead of quietly becoming false.
   */
  it.effect('V-3: each generated plant biome has an explicit expected category', () =>
    Effect.sync(() => {
      const growing = decoratedChunks.filter(({ chunk }) => countPlants(chunk) > 0).map(({ biome }) => biome)

      expect([...growing].sort()).toStrictEqual([
        'BEACH',
        'DESERT',
        'FLOWER_FOREST',
        'FOREST',
        'JUNGLE',
        'MOUNTAINS',
        'OCEAN',
        'PLAINS',
        'RIVER',
        'SAVANNA',
        'SWAMP',
        'TAIGA',
      ])

      // A generated ground-cover block must be supported by the static biome
      // predicate. A capable biome may still produce no ground cover when
      // this sampled column is submerged or otherwise unsuitable.
      for (const { biome, chunk } of decoratedChunks) {
        const groundCoverCount = chunk.blocks.filter((id) => GROUND_COVER_IDS.includes(id)).length
        if (groundCoverCount > 0) expect(biomeCanGrowGroundPlants(biome), `${biome} predicate disagrees with its chunk`).toBe(true)
      }

      // BEACH keeps a non-zero ground-cover density, but its sand surface is
      // reached by the separate cactus/sugar-cane rules.
      expect(GROUND_PLANT_DENSITY.BEACH).toBeGreaterThan(0)
      expect(BIOME_SURFACES.BEACH.top).toBe(BLOCK.SAND)
      expect(biomeCanGrowGroundPlants('BEACH')).toBe(false)
    }),
  )

  it.effect('V-4: vegetation is decoration — `decorate: false` produces none of it', () =>
    Effect.sync(() => {
      for (const biome of BIOMES) {
        const at = CHUNK_FOR_BIOME.get(biome)
        if (at === undefined) {
          continue
        }
        expect(countPlants(generateChunkAt(GOLDEN_SEED, at.cx, at.cz, { decorate: false }))).toBe(0)
      }

      // ... and it is not vacuous: the same coordinate decorated does carry some.
      const forest = CHUNK_FOR_BIOME.get('FOREST')
      expect(forest).toBeDefined()
      expect(countPlants(generateChunkAt(GOLDEN_SEED, forest?.cx ?? 0, forest?.cz ?? 0))).toBeGreaterThan(0)
    }),
  )

  /**
   * V-5 SURVEYS A BLOCK OF CHUNKS RATHER THAN THE THIRTEEN BIOME ROWS, because
   * the rows do not contain enough trees for the claim to be testable. FOREST
   * (5, -12) carries three, and a collision needs a tree column whose plant roll
   * also passes — at 0.14 that is 0.4 expected events across the whole matrix.
   * Measured: weakening `canPlaceGroundPlantAt`'s air check so that a plant may
   * overwrite a trunk left this test GREEN on the rows. (The support-rule
   * unit test above catches that mutation, which is why it is a weakness here
   * and not a hole in the suite.)
   *
   * A wider survey is the fix rather than a cleverer assertion: the property is
   * about generated terrain, so it needs enough terrain to be about.
   */
  it.effect('V-5: plants never displace a tree — every trunk column is plant-free', () =>
    Effect.sync(() => {
      let trunks = 0
      const collided: Array<string> = []

      const survey: Array<{ readonly biome: string; readonly chunk: Chunk }> = []
      for (let cx = -5; cx < 5; cx += 1) {
        for (let cz = -5; cz < 5; cz += 1) {
          survey.push({ biome: `(${String(cx)}, ${String(cz)})`, chunk: generateChunkAt(GOLDEN_SEED, cx, cz) })
        }
      }

      for (const { biome, chunk } of survey) {
        for (let lx = 0; lx < CHUNK_SIZE_XZ; lx += 1) {
          for (let lz = 0; lz < CHUNK_SIZE_XZ; lz += 1) {
            let hasLog = false
            let hasPlant = false
            for (let y = 0; y < CHUNK_HEIGHT; y += 1) {
              const id = readBlock(chunk.blocks, blockIndex(lx, y, lz))
              if (id === BLOCK.LOG) {
                hasLog = true
              }
              if (PLANT_ID_SET.has(id)) {
                hasPlant = true
              }
            }
            if (hasLog) {
              trunks += 1
              if (hasPlant) {
                collided.push(`${biome} (${String(lx)}, ${String(lz)})`)
              }
            }
          }
        }
      }

      expect(collided, 'columns holding both a trunk and a plant').toStrictEqual([])
      // Enough trees for a collision to be likely if the rule were wrong: at the
      // FOREST/PLAINS densities this is tens of expected events, not fractions.
      expect(trunks).toBeGreaterThan(50)
    }),
  )

  it.effect('V-6: the biome array is untouched — decoration writes blocks, not biomes', () =>
    Effect.sync(() => {
      for (const biome of BIOMES) {
        const at = CHUNK_FOR_BIOME.get(biome)
        if (at === undefined) {
          continue
        }
        const decorated = generateChunkAt(GOLDEN_SEED, at.cx, at.cz, { decorate: true })
        const bare = generateChunkAt(GOLDEN_SEED, at.cx, at.cz, { decorate: false })
        expect(decorated.biomes).toStrictEqual(bare.biomes)
        expect(decorated.biomes[columnIndex(0, 0)]).toBe(biome)
      }
    }),
  )
})
