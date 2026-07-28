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
import { BIOMES, BIOME_SURFACES, BLOCK, type BiomeType } from '../domain/biome'
import { columnIndex, readBlock, type Chunk } from '../domain/chunk'
import { blockIndex, CHUNK_HEIGHT, CHUNK_SIZE_XZ } from '../domain/constants'
import { generateChunkAt } from '../domain/terrain'
import {
  GROUND_PLANT_DENSITY,
  PLANT,
  PLANT_IDS,
  biomeCanGrowGroundPlants,
  canPlaceGroundPlantAt,
  groundPlantAt,
  plantRoll,
  shouldPlaceGroundPlant,
} from '../domain/vegetation'
import { GOLDEN_SEED, GOLDEN_SPECS } from '../scripts/golden-fixture'

const PLANT_ID_SET = new Set<number>(PLANT_IDS)

/** One single-biome chunk per biome, from the golden matrix's own selection rule. */
const CHUNK_FOR_BIOME: ReadonlyMap<BiomeType, { readonly cx: number; readonly cz: number }> = new Map(
  GOLDEN_SPECS.filter((spec) => spec.decorate).map((spec) => [spec.biome, { cx: spec.cx, cz: spec.cz }] as const),
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

describe('the plant id table', () => {
  it.effect('carries kernel’s four ground-cover ids and nothing else', () =>
    Effect.sync(() => {
      // Transcribed from `mc-kernel/domain/block-registry.ts` — dandelion :869,
      // poppy :889, tall_grass :949, fern :969. `test/kernel-mirror.test.ts`
      // pins the same four against kernel's roster; this is the local shape.
      expect(PLANT).toStrictEqual({ DANDELION: 21, POPPY: 22, TALL_GRASS: 25, FERN: 26 })
      expect(new Set(PLANT_IDS).size).toBe(PLANT_IDS.length)
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
      // Correlated channels are the trap `domain/seeded-random.ts` names: if
      // these were one stream, every placed plant would be the same variant.
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
    OCEAN: 0,
    BEACH: 0.02,
    DESERT: 0,
    SAVANNA: 0.08,
    PLAINS: 0.22,
    FOREST: 0.14,
    TAIGA: 0.12,
    SNOW: 0,
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

  it.effect('V-1: every plant stands on GRASS or DIRT with the plant itself directly above it', () =>
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
              if (below !== BLOCK.GRASS && below !== BLOCK.DIRT) {
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

  it.effect('V-2: a plant is exactly one block tall, so no column carries two', () =>
    Effect.sync(() => {
      const crowded: Array<string> = []

      for (const { biome, chunk } of decoratedChunks) {
        for (let lx = 0; lx < CHUNK_SIZE_XZ; lx += 1) {
          for (let lz = 0; lz < CHUNK_SIZE_XZ; lz += 1) {
            let inColumn = 0
            for (let y = 0; y < CHUNK_HEIGHT; y += 1) {
              if (PLANT_ID_SET.has(readBlock(chunk.blocks, blockIndex(lx, y, lz)))) {
                inColumn += 1
              }
            }
            if (inColumn > 1) {
              crowded.push(`${biome} (${String(lx)}, ${String(lz)}) carries ${String(inColumn)}`)
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
  it.effect('V-3: exactly the biomes whose surface is soil grow anything, and it is the four expected', () =>
    Effect.sync(() => {
      const growing = decoratedChunks.filter(({ chunk }) => countPlants(chunk) > 0).map(({ biome }) => biome)

      expect([...growing].sort()).toStrictEqual(['FOREST', 'PLAINS', 'SAVANNA', 'TAIGA'])

      // And the derived predicate agrees with the realised terrain, in both
      // directions, for all eight biomes.
      for (const { biome, chunk } of decoratedChunks) {
        expect(biomeCanGrowGroundPlants(biome), `${biome} predicate disagrees with its chunk`).toBe(
          countPlants(chunk) > 0,
        )
      }

      // BEACH is the interesting row: a non-zero density that the surface table
      // makes unreachable. Both halves are asserted so neither can drift alone.
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
   * V-5 SURVEYS A BLOCK OF CHUNKS RATHER THAN THE EIGHT BIOME ROWS, because the
   * eight rows do not contain enough trees for the claim to be testable. FOREST
   * (8, -8) carries three, and a collision needs a tree column whose plant roll
   * also passes — at 0.14 that is 0.4 expected events across the whole matrix.
   * Measured: weakening `canPlaceGroundPlantAt`'s air check so that a plant may
   * overwrite a trunk left this test GREEN on the eight rows. (The support-rule
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
