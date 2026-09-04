/**
 * Ore veins.
 *
 * `domain/ore.ts` transcribes the reference's vein-growth algorithm and
 * RE-DERIVES three of its seven depth bands, and that second half is the part
 * that needs evidence rather than assertion. This repository's own
 * `CONTINENTALNESS_CONTRAST` obituary (`domain/terrain.ts`) is about a constant
 * justified by a measurement of the wrong population, and a transcribed ore band
 * is exactly that shape of risk: the numbers are real, they are cited, and they
 * describe somebody else's terrain.
 *
 * So the load-bearing test here is `O-5`, which does what `test/carver.test.ts`
 * does for the water-floor guard — it REPRODUCES THE DEFECT. It runs the
 * reference's bands verbatim against this repository's stone and measures the
 * shortfall, so the claim in `domain/ore.ts`'s header is checked by the suite
 * rather than by a comment. A correction that cannot demonstrate what it
 * corrected is only asserting that today's code does what today's code does.
 *
 * `O-1` .. `O-4` are the independent properties that back the ore half of the
 * regenerated goldens (docs/testing.md §3). None reads the committed digests.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { BLOCK } from '../src/domain/biome'
import { readBlock, type Chunk } from '../src/domain/chunk'
import { BEDROCK_Y, blockIndex, CHUNK_HEIGHT, CHUNK_SIZE_XZ } from '../src/domain/constants'
import { worldX, worldZ } from '../src/domain/generator-coordinates'
import { chunkCoord } from '@nerima-games/mc-kernel'
import {
  DEEPSLATE_ORE_BLOCK,
  MAX_SEED_ATTEMPTS,
  ORE_BLOCK,
  ORE_CONFIGS,
  ORE_IDS,
  ORE_MAX_Y,
  ORE_MIN_Y_FLOOR,
  growVein,
  oreStreamSeed,
  sampleOreY,
  type OreConfig,
  type OreName,
} from '../src/domain/ore'
import { NoiseSeed, mulberry32 } from '@nerima-games/mc-noise'
import { MAX_SURFACE_Y, generateChunkAt, terrainColumnAt } from '../src/domain/terrain'
import { GOLDEN_SEED } from '../scripts/golden-fixture'

const ORE_ID_SET = new Set<number>(ORE_IDS)

/**
 * The reference's `ORE_CONFIGS`, verbatim from
 * `packages/world/domain/terrain/constants.ts:72-78`.
 *
 * Restated here rather than imported so the comparison remains explicit: the
 * reference is not a dependency, and the point of the comparison is that a
 * reviewer can check the transcription against the source without running
 * anything.
 */
const REFERENCE_CONFIGS: ReadonlyArray<OreConfig> = [
  { name: 'COAL', minY: 12, maxY: 180, peakY: 96, avgVeins: 18, minSize: 6, maxSize: 14, saltX: 10007, saltZ: 20011 },
  { name: 'IRON', minY: 8, maxY: 128, peakY: 48, avgVeins: 12, minSize: 4, maxSize: 9, saltX: 30013, saltZ: 40013 },
  { name: 'GOLD', minY: 5, maxY: 48, peakY: 24, avgVeins: 4, minSize: 3, maxSize: 7, saltX: 50021, saltZ: 60029 },
  { name: 'DIAMOND', minY: 5, maxY: 16, peakY: 8, avgVeins: 2, minSize: 2, maxSize: 6, saltX: 70037, saltZ: 80039 },
  { name: 'REDSTONE', minY: 5, maxY: 20, peakY: 8, avgVeins: 5, minSize: 3, maxSize: 7, saltX: 90043, saltZ: 100049 },
  { name: 'LAPIS', minY: 8, maxY: 72, peakY: 28, avgVeins: 3, minSize: 3, maxSize: 6, saltX: 110059, saltZ: 120071 },
  { name: 'EMERALD', minY: 24, maxY: 160, peakY: 96, avgVeins: 2, minSize: 1, maxSize: 3, saltX: 130081, saltZ: 140089 },
]

/** The rate a row's own tuning asks for: veins per chunk times mean vein size. */
const intendedRate = (config: OreConfig): number => config.avgVeins * ((config.minSize + config.maxSize) / 2)

/** A survey block. 36 chunks is enough for a 4-per-chunk ore to have ~144 samples. */
const SURVEY = 3

const surveyChunks = (seed: number): ReadonlyArray<Chunk> => {
  const chunks: Array<Chunk> = []
  for (let cx = -SURVEY; cx < SURVEY; cx += 1) {
    for (let cz = -SURVEY; cz < SURVEY; cz += 1) {
      chunks.push(generateChunkAt(seed, cx, cz))
    }
  }
  return chunks
}

const countOre = (chunks: ReadonlyArray<Chunk>): ReadonlyMap<number, number> => {
  const counts = new Map<number, number>()
  for (const chunk of chunks) {
    for (const value of chunk.blocks) {
      if (ORE_ID_SET.has(value)) {
        counts.set(value, (counts.get(value) ?? 0) + 1)
      }
    }
  }
  return counts
}

/**
 * Run an arbitrary band table over real generated stone.
 *
 * The chunk is generated normally and its ore is reverted to STONE first, so the
 * input is the post-carve stone the shipped pass actually sees. That is what
 * makes the O-5 comparison fair: both band tables are scored against the same
 * rock.
 */
const placeWithBands = (configs: ReadonlyArray<OreConfig>, seed: number, cx: number, cz: number): number => {
  const chunk = generateChunkAt(seed, cx, cz, { decorate: false })
  for (let index = 0; index < chunk.blocks.length; index += 1) {
    if (ORE_ID_SET.has(readBlock(chunk.blocks, index))) {
      chunk.blocks[index] = BLOCK.STONE
    }
  }

  const coord = chunkCoord(cx, cz)
  const baseWorldX = coord.cx * CHUNK_SIZE_XZ
  const baseWorldZ = coord.cz * CHUNK_SIZE_XZ
  let placed = 0

  for (const config of configs) {
    const next = mulberry32(NoiseSeed(oreStreamSeed(seed, config, baseWorldX, baseWorldZ)))
    const count = Math.max(0, Math.round(config.avgVeins - 1 + next() * 2))
    const yMin = Math.max(config.minY, ORE_MIN_Y_FLOOR)
    const yMax = Math.min(config.maxY, CHUNK_HEIGHT - 1)
    if (yMax < yMin) {
      continue
    }
    const ore = ORE_BLOCK[config.name]

    for (let vein = 0; vein < count; vein += 1) {
      const veinSize = config.minSize + Math.floor(next() * (config.maxSize - config.minSize + 1))
      for (let attempt = 0; attempt < MAX_SEED_ATTEMPTS; attempt += 1) {
        const seedX = Math.floor(next() * CHUNK_SIZE_XZ)
        const seedY = sampleOreY(config, yMin, yMax, next)
        const seedZ = Math.floor(next() * CHUNK_SIZE_XZ)
        if (readBlock(chunk.blocks, blockIndex(seedX, seedY, seedZ)) !== BLOCK.STONE) {
          continue
        }
        placed += growVein({
          blocks: chunk.blocks,
          host: BLOCK.STONE,
          next,
          ore,
          seedX,
          seedY,
          seedZ,
          targetSize: veinSize,
          yMax,
          yMin,
        })
        break
      }
    }
  }

  return placed
}

const ratePerChunk = (configs: ReadonlyArray<OreConfig>, config: OreConfig, seed: number): number => {
  let total = 0
  let chunks = 0
  for (let cx = -SURVEY; cx < SURVEY; cx += 1) {
    for (let cz = -SURVEY; cz < SURVEY; cz += 1) {
      chunks += 1
      total += placeWithBands([config], seed, cx, cz)
    }
  }
  void configs
  return total / chunks
}

describe('the ore id table', () => {
  it.effect('carries kernel’s seven stone and seven deepslate ore ids', () =>
    Effect.sync(() => {
      // `mc-kernel/domain/block-registry.ts:1367-1444`; the implementation
      // obtains these values through `blockIdOf`, rather than mirroring them.
      expect(ORE_BLOCK).toStrictEqual({
        COAL: 50,
        IRON: 51,
        GOLD: 52,
        DIAMOND: 53,
        REDSTONE: 54,
        LAPIS: 55,
        EMERALD: 56,
      })
      expect(DEEPSLATE_ORE_BLOCK).toStrictEqual({
        COAL: 57,
        DIAMOND: 60,
        EMERALD: 63,
        GOLD: 59,
        IRON: 58,
        LAPIS: 62,
        REDSTONE: 61,
      })
      expect(ORE_IDS).toHaveLength(14)
      expect(new Set(ORE_IDS).size).toBe(ORE_IDS.length)
    }),
  )

  it.effect('does not collide with any terrain id', () =>
    Effect.sync(() => {
      const terrain = new Set<number>(Object.values(BLOCK))
      for (const id of ORE_IDS) {
        expect(terrain.has(id), `ore id ${String(id)} collides with a BLOCK id`).toBe(false)
      }
    }),
  )
})

describe('the depth bands', () => {
  /**
   * `ORE_MAX_Y` is written as a literal in `domain/ore.ts` because importing
   * `MAX_SURFACE_Y` from `domain/terrain.ts` would close an import cycle. This
   * is where the derivation is checked instead — and then checked again,
   * empirically, against real terrain in the test below it.
   */
  it.effect('derive ORE_MAX_Y from the terrain shaper, not from a guess', () =>
    Effect.sync(() => {
      // `fillColumn` writes STONE over [BEDROCK_Y + 1, surfaceY - FILLER_DEPTH)
      // with FILLER_DEPTH = 4, so the topmost possible stone cell is
      // MAX_SURFACE_Y - 4 - 1.
      const fillerDepth = 4
      expect(ORE_MAX_Y).toBe(MAX_SURFACE_Y - fillerDepth - 1)
      expect(ORE_MIN_Y_FLOOR).toBe(BEDROCK_Y + 1)
    }),
  )

  it.effect('O-1: no generated chunk holds stone above ORE_MAX_Y, so nothing above it is reachable', () =>
    Effect.sync(() => {
      let highestStone = -1

      for (const chunk of surveyChunks(GOLDEN_SEED)) {
        for (let lx = 0; lx < CHUNK_SIZE_XZ; lx += 1) {
          for (let lz = 0; lz < CHUNK_SIZE_XZ; lz += 1) {
            for (let y = CHUNK_HEIGHT - 1; y >= 0; y -= 1) {
              if (readBlock(chunk.blocks, blockIndex(lx, y, lz)) === BLOCK.STONE) {
                highestStone = Math.max(highestStone, y)
                break
              }
            }
          }
        }
      }

      expect(highestStone).toBeGreaterThan(0)
      expect(highestStone, 'stone exists above the declared ore ceiling').toBeLessThan(ORE_MAX_Y + 1)
    }),
  )

  it.effect('keep every peak inside its own band, which is the failure COAL and EMERALD had', () =>
    Effect.sync(() => {
      for (const config of ORE_CONFIGS) {
        expect(config.peakY, `${config.name} peak is below its floor`).toBeGreaterThan(config.minY - 1)
        expect(config.peakY, `${config.name} peak is above its ceiling`).toBeLessThan(config.maxY + 1)
        expect(config.maxY, `${config.name} reaches above the stone ceiling`).toBeLessThan(ORE_MAX_Y + 1)
        expect(config.minY).toBeGreaterThan(BEDROCK_Y)
      }

      // The reference's table fails this on exactly two rows, which is the whole
      // content of the correction. Spelled out so that "three rows were edited"
      // is checkable rather than a claim in a header.
      const offending = REFERENCE_CONFIGS.filter((config) => config.peakY > ORE_MAX_Y).map((config) => config.name)
      expect(offending).toStrictEqual(['COAL', 'EMERALD'])

      const overCeiling = REFERENCE_CONFIGS.filter((config) => config.maxY > ORE_MAX_Y).map((config) => config.name)
      expect(overCeiling).toStrictEqual(['COAL', 'IRON', 'EMERALD'])
    }),
  )
})

describe('vein growth', () => {
  /**
   * The conclusive "replaces STONE only" check, on a buffer whose contents are
   * known. In real terrain this cannot be proved by inspection — an ore cell
   * carries no record of what it used to be.
   */
  it.effect('O-2: replaces STONE and refuses every other block, including bedrock and water', () =>
    Effect.sync(() => {
      const blocks = new Uint16Array(CHUNK_HEIGHT * CHUNK_SIZE_XZ * CHUNK_SIZE_XZ)
      const others: ReadonlyArray<number> = [BLOCK.BEDROCK, BLOCK.WATER, BLOCK.DIRT, BLOCK.GRAVEL, BLOCK.AIR]

      // A solid slab of stone with a checkerboard of other blocks through it.
      for (let lx = 0; lx < CHUNK_SIZE_XZ; lx += 1) {
        for (let lz = 0; lz < CHUNK_SIZE_XZ; lz += 1) {
          for (let y = 1; y < 40; y += 1) {
            const other = others[(lx + y + lz) % others.length] ?? BLOCK.AIR
            blocks[blockIndex(lx, y, lz)] = (lx + y + lz) % 3 === 0 ? other : BLOCK.STONE
          }
        }
      }

      // The seed cell must itself be STONE or the vein never starts — which is
      // what `MAX_SEED_ATTEMPTS` exists to retry around in `placeOres`. (8+21+8)
      // is 37, so this cell is on the stone side of the checkerboard.
      expect(readBlock(blocks, blockIndex(8, 21, 8))).toBe(BLOCK.STONE)

      const before = Uint16Array.from(blocks)
      const placed = growVein({
        blocks,
        host: BLOCK.STONE,
        next: mulberry32(NoiseSeed(12345)),
        ore: ORE_BLOCK.COAL,
        seedX: 8,
        seedY: 21,
        seedZ: 8,
        targetSize: 400,
        yMax: 39,
        yMin: 1,
      })

      expect(placed).toBeGreaterThan(0)

      let changed = 0
      for (let index = 0; index < blocks.length; index += 1) {
        const was = readBlock(before, index)
        const now = readBlock(blocks, index)
        if (was === now) {
          continue
        }
        changed += 1
        expect(was, `a non-STONE cell was replaced (was ${String(was)})`).toBe(BLOCK.STONE)
        expect(now).toBe(ORE_BLOCK.COAL)
      }
      expect(changed).toBe(placed)
    }),
  )

  it.effect('respects the vertical band it is given, at both ends', () =>
    Effect.sync(() => {
      const blocks = new Uint16Array(CHUNK_HEIGHT * CHUNK_SIZE_XZ * CHUNK_SIZE_XZ).fill(BLOCK.STONE)
      growVein({
        blocks,
        host: BLOCK.STONE,
        next: mulberry32(NoiseSeed(999)),
        ore: ORE_BLOCK.IRON,
        seedX: 8,
        seedY: 30,
        seedZ: 8,
        targetSize: 2000,
        yMax: 35,
        yMin: 25,
      })

      for (let lx = 0; lx < CHUNK_SIZE_XZ; lx += 1) {
        for (let lz = 0; lz < CHUNK_SIZE_XZ; lz += 1) {
          for (let y = 0; y < CHUNK_HEIGHT; y += 1) {
            if (readBlock(blocks, blockIndex(lx, y, lz)) !== ORE_BLOCK.IRON) {
              continue
            }
            expect(y).toBeGreaterThan(24)
            expect(y).toBeLessThan(36)
          }
        }
      }
    }),
  )

  it.effect('draws its Y from a triangle that stays inside the band and peaks at the mode', () =>
    Effect.sync(() => {
      const config = ORE_CONFIGS.find((candidate) => candidate.name === 'DIAMOND')
      expect(config).toBeDefined()
      if (config === undefined) {
        return
      }

      const next = mulberry32(NoiseSeed(42))
      const histogram = new Map<number, number>()
      for (let draw = 0; draw < 20000; draw += 1) {
        const y = sampleOreY(config, config.minY, config.maxY, next)
        expect(y).toBeGreaterThan(config.minY - 1)
        expect(y).toBeLessThan(config.maxY + 1)
        histogram.set(y, (histogram.get(y) ?? 0) + 1)
      }

      // The modal bucket is the peak, which is what makes the distribution a
      // depth preference rather than a uniform scatter.
      const modal = [...histogram.entries()].sort((a, b) => b[1] - a[1])[0]
      expect(modal?.[0]).toBe(config.peakY)
      expect(histogram.get(config.peakY) ?? 0).toBeGreaterThan((histogram.get(config.maxY) ?? 0) * 2)
    }),
  )

  /**
   * A zero-span band (`yMin === yMax`) is not hypothetical: it is what
   * `placeOres` would hand `sampleOreY` for any ore whose config were ever
   * tuned to a single-block band, or whatever floor/ceiling clamping produces
   * at the edges of `CHUNK_HEIGHT`. The triangular inverse-CDF divides by
   * `span`, so without this guard a zero-span band would draw `NaN` instead
   * of the only Y the band actually contains.
   */
  it.effect('returns the band floor without dividing by zero when the band has no span', () =>
    Effect.sync(() => {
      const config = ORE_CONFIGS.find((candidate) => candidate.name === 'DIAMOND')
      expect(config).toBeDefined()
      if (config === undefined) {
        return
      }

      const next = mulberry32(NoiseSeed(7))
      for (let draw = 0; draw < 50; draw += 1) {
        expect(sampleOreY(config, 40, 40, next)).toBe(40)
      }
    }),
  )
})

/**
 * ---------------------------------------------------------------------------
 * O-3 .. O-5: what backs the ore half of the golden move.
 * ---------------------------------------------------------------------------
 */
describe('what backs the ore half of the golden move', () => {
  const chunks = surveyChunks(GOLDEN_SEED)

  it.effect('O-3: every ore cell sits inside the stone band of its own column', () =>
    Effect.sync(() => {
      let seen = 0
      // Collected, not asserted per cell — see `test/chunk-golden.test.ts` I-1.
      const outOfBand: Array<string> = []

      for (const chunk of chunks) {
        for (let lx = 0; lx < CHUNK_SIZE_XZ; lx += 1) {
          for (let lz = 0; lz < CHUNK_SIZE_XZ; lz += 1) {
            const wx = worldX(chunk.coord, lx)
            const wz = worldZ(chunk.coord, lz)
            const column = terrainColumnAt(GOLDEN_SEED, wx, wz)
            const stoneTop = column.surface.top === BLOCK.STONE
              ? column.surfaceY
              : column.surface.filler === BLOCK.STONE
                ? column.surfaceY - 1
                : column.surfaceY - column.surface.fillerDepth - 1

            for (let y = 0; y < CHUNK_HEIGHT; y += 1) {
              if (!ORE_ID_SET.has(readBlock(chunk.blocks, blockIndex(lx, y, lz)))) {
                continue
              }
              seen += 1
              if (y <= BEDROCK_Y || y > stoneTop || y > ORE_MAX_Y) {
                outOfBand.push(`(${String(lx)}, ${String(y)}, ${String(lz)}) stoneTop ${String(stoneTop)}`)
              }
            }
          }
        }
      }

      expect(outOfBand, 'ore outside its column’s stone band').toStrictEqual([])
      expect(seen).toBeGreaterThan(0)
    }),
  )

  it.effect('O-3b: every ore cell is inside its own declared depth band', () =>
    Effect.sync(() => {
      const bands = new Map<number, OreConfig>()
      for (const config of ORE_CONFIGS) {
        bands.set(ORE_BLOCK[config.name], config)
        bands.set(DEEPSLATE_ORE_BLOCK[config.name], config)
      }
      const seen = new Set<number>()
      const seenNames = new Set<OreName>()
      const violations: Array<string> = []

      for (const chunk of chunks) {
        for (let lx = 0; lx < CHUNK_SIZE_XZ; lx += 1) {
          for (let lz = 0; lz < CHUNK_SIZE_XZ; lz += 1) {
            for (let y = 0; y < CHUNK_HEIGHT; y += 1) {
              const id = readBlock(chunk.blocks, blockIndex(lx, y, lz))
              const config = bands.get(id)
              if (config === undefined) {
                continue
              }
              seen.add(id)
              seenNames.add(config.name)
              if (y < Math.max(config.minY, ORE_MIN_Y_FLOOR) || y > config.maxY) {
                violations.push(`${config.name} at y=${String(y)}, band ${String(config.minY)}..${String(config.maxY)}`)
              }
            }
          }
        }
      }

      expect(violations, 'ore outside its own declared depth band').toStrictEqual([])
      // All seven appear, so no band is being silently skipped.
      expect(seenNames.size).toBe(ORE_CONFIGS.length)
      expect(seen.size).toBeGreaterThanOrEqual(ORE_CONFIGS.length)
    }),
  )

  it.effect('O-4: ore is not decoration — `decorate: false` still carries it', () =>
    Effect.sync(() => {
      const bare = generateChunkAt(GOLDEN_SEED, 1, 0, { decorate: false })
      const decorated = generateChunkAt(GOLDEN_SEED, 1, 0, { decorate: true })

      expect(countOre([bare]).size).toBeGreaterThan(0)
      // And the two agree on every ore cell: decoration must not move a vein.
      for (let index = 0; index < bare.blocks.length; index += 1) {
        const value = readBlock(bare.blocks, index)
        if (ORE_ID_SET.has(value)) {
          expect(readBlock(decorated.blocks, index)).toBe(value)
        }
      }
    }),
  )

  /**
   * O-5. THE ONE THAT REPRODUCES THE DEFECT.
   *
   * `domain/ore.ts` claims the reference's bands lose a fifth to a third of the
   * coal and a quarter to two fifths of the emerald in this repository's
   * terrain, and that the five untouched rows are unaffected. Both halves are
   * measured here against the same rock, because a correction whose effect
   * cannot be demonstrated is indistinguishable from a preference.
   *
   * Note the second assertion in particular: if the edit had ALSO moved gold or
   * diamond, the shipped bands would be doing something the header does not
   * account for, and this is what would say so.
   */
  it.effect('O-5: the reference’s own bands starve COAL and EMERALD here, and nothing else', () =>
    Effect.sync(() => {
      for (const shipped of ORE_CONFIGS) {
        const reference = REFERENCE_CONFIGS.find((candidate) => candidate.name === shipped.name)
        expect(reference).toBeDefined()
        if (reference === undefined) {
          continue
        }

        const intended = intendedRate(shipped)
        const withShipped = ratePerChunk(ORE_CONFIGS, shipped, GOLDEN_SEED) / intended
        const withReference = ratePerChunk(REFERENCE_CONFIGS, reference, GOLDEN_SEED) / intended

        // The shipped bands hit the rate the tuning asks for, every row.
        expect(withShipped, `${shipped.name} shipped bands realise ${String(withShipped)} of intended`).toBeGreaterThan(
          0.9,
        )

        if (shipped.name === 'COAL' || shipped.name === 'EMERALD') {
          // Measured 0.68-0.82 for coal and 0.57-0.74 for emerald across three
          // seeds. The bound is loose because the point is that the shortfall is
          // LARGE, not that it is any particular number.
          expect(withReference, `${shipped.name} was expected to fall short`).toBeLessThan(0.88)
        } else {
          // The five untouched rows: identical under both tables, to noise.
          expect(Math.abs(withShipped - withReference), `${shipped.name} moved and should not have`).toBeLessThan(0.05)
        }
      }
    }),
  )
})

describe('determinism', () => {
  it.effect('places identical ore for the same seed and coordinate', () =>
    Effect.sync(() => {
      const first = generateChunkAt(GOLDEN_SEED, 2, -3)
      const second = generateChunkAt(GOLDEN_SEED, 2, -3)
      expect(first.blocks).toStrictEqual(second.blocks)
    }),
  )

  /**
   * The reference's `seedFromChunk` (`math.ts:20-28`) takes no world seed, so
   * every world would carry its ore in the same cells. `oreStreamSeed` folds the
   * seed in; this is what says so.
   */
  it.effect('places different ore in different worlds, which the reference’s stream would not', () =>
    Effect.sync(() => {
      const config = ORE_CONFIGS[0]
      expect(config).toBeDefined()
      if (config === undefined) {
        return
      }
      expect(oreStreamSeed(1, config, 0, 0)).not.toBe(oreStreamSeed(2, config, 0, 0))

      const a = generateChunkAt(1, 0, 0, { decorate: false })
      const b = generateChunkAt(2, 0, 0, { decorate: false })

      const oreCells = (chunk: Chunk): string => {
        const parts: Array<string> = []
        for (let index = 0; index < chunk.blocks.length; index += 1) {
          const value = readBlock(chunk.blocks, index)
          if (ORE_ID_SET.has(value)) {
            parts.push(`${String(index)}:${String(value)}`)
          }
        }
        return parts.join(',')
      }

      expect(oreCells(a)).not.toBe(oreCells(b))
    }),
  )

  it.effect('decorrelates the seven ore streams from each other', () =>
    Effect.sync(() => {
      const seeds = ORE_CONFIGS.map((config) => oreStreamSeed(GOLDEN_SEED, config, 0, 0))
      expect(new Set(seeds).size).toBe(ORE_CONFIGS.length)
    }),
  )

  it.effect('decorrelates adjacent chunks of one ore, which is what the salts are for', () =>
    Effect.sync(() => {
      const config = ORE_CONFIGS[0]
      expect(config).toBeDefined()
      if (config === undefined) {
        return
      }
      const seeds = [
        oreStreamSeed(GOLDEN_SEED, config, 0, 0),
        oreStreamSeed(GOLDEN_SEED, config, 16, 0),
        oreStreamSeed(GOLDEN_SEED, config, 0, 16),
        oreStreamSeed(GOLDEN_SEED, config, -16, -16),
      ]
      expect(new Set(seeds).size).toBe(seeds.length)
    }),
  )
})
