/**
 * ---------------------------------------------------------------------------
 * Seed-fixed goldens — docs/testing.md §3, 完了条件 3.
 * ---------------------------------------------------------------------------
 *
 * `generateChunk` is already known to be deterministic (`test/determinism.test.ts`),
 * and that is exactly what makes a golden cheap here: there is nothing to
 * stabilise, only something to write down. What it buys is the one class of
 * failure the property tests structurally cannot see — a VERSION-TO-VERSION
 * DRIFT that keeps every property true. A refactor that changes the order of two
 * noise octaves produces terrain that is still deterministic, still seamless,
 * still has a sea and still has unfused canopies. It is also a different world,
 * and every save file in existence stores a seed rather than the blocks.
 *
 * ---------------------------------------------------------------------------
 * What backs each digest, and why a digest alone would not be worth much
 * ---------------------------------------------------------------------------
 *
 * A golden agrees with whatever produced it. If the generator has a bug today,
 * the digest committed today records the bug, and the test then defends it.
 * mc-noise learned this on `buildPermutation` this week: goldens plus an API
 * lock, and neither could see that the permutation table might not be a
 * bijection, because the goldens are whatever the table produces
 * (mc-noise/test/permutation.test.ts:5-26).
 *
 * So each digest is paired here with at least one INDEPENDENT property — a fact
 * about the chunk that is derivable without reference to
 * `test/golden/chunk-goldens.json`, and that a blessed-bug regeneration would
 * therefore fail:
 *
 *   blocksSha256  <- I-1  every byte is a declared GENERATED id
 *                   I-2  bedrock floor under all 256 columns
 *                   I-3  water surface is exactly SEA_LEVEL          (DN-1)
 *                   I-4  no air inside the shell under water         (DN-2)
 *                   I-4b and the guard is what causes I-4            (DN-2)
 *                   I-5  LEAVES == trees * 20, so no fused canopy    (F-2)
 *   biomesSha256  <- I-6  agrees with `biomeFor` recomputed per column
 *                   I-7  every entry is a member of the closed roster
 *   both          <- I-8  regenerating is byte-identical
 *
 * Two generation passes arrived after this list and brought their own backing
 * with them, in their own files rather than here, because both needed a survey
 * wider than the ten golden chunks:
 *
 *   ore           <- `test/ore.test.ts` O-1 .. O-5. O-2 is the conclusive one
 *                   (a vein replaces STONE and nothing else, on a buffer whose
 *                   contents are known) and O-5 reproduces the defect the
 *                   corrected depth bands fix.
 *   ground cover  <- `test/vegetation.test.ts` V-1 .. V-6.
 *
 * I-2 is doing double duty since ore arrived and is worth naming for it: a vein
 * that ate the bedrock floor is the one way this pass could corrupt a world
 * rather than merely decorate it, and I-2 is what refuses it.
 *
 * I-6 is the load-bearing one for the biome half. `generateChunk` fills
 * `chunk.biomes` inside its own column loop; recomputing the array through
 * `biomeFor` one column at a time is a different code path to the same claim,
 * so the two agreeing is evidence and not a tautology.
 *
 * Regression names (docs/design-notes.md): worldgen-golden-drift,
 * worldgen-golden-matrix-coverage.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { BIOMES, BLOCK, type BiomeType } from '../src/domain/biome'
import { columnIndex, readBlock, type Chunk } from '../src/domain/chunk'
import {
  BEDROCK_Y,
  blockIndex,
  CHUNK_HEIGHT,
  CHUNK_SIZE_XZ,
  DEFAULT_TERRAIN_LEVELS,
  LAKE_LEVEL,
  SEA_LEVEL,
  WATER_FLOOR_MARGIN,
} from '../src/domain/constants'
import { ORE_IDS } from '../src/domain/ore'
import { biomeFor, generateChunkAt, surfaceHeightAt } from '../src/domain/terrain'
import { PLANT_IDS } from '../src/domain/vegetation'
import {
  generateGoldenChunk,
  goldenEntry,
  GOLDEN_SEED,
  GOLDEN_SPECS,
  type GoldenFile,
  type GoldenSpec,
} from '../scripts/golden-fixture'

/**
 * Read the committed file as DATA, not as a module.
 *
 * `resolveJsonModule` is off in `tsconfig.base.json` and this is not a reason to
 * turn it on: importing the goldens would let the type checker infer a literal
 * type from them, and "the committed digest is the digest" would then be true
 * by construction in the one place it must be checked by comparison.
 */
const committed = JSON.parse(
  readFileSync(fileURLToPath(new URL('./golden/chunk-goldens.json', import.meta.url)), 'utf8'),
) as GoldenFile

/** One generation per spec, reused by every test below. A chunk is 64KB. */
const generated: ReadonlyArray<{ readonly spec: GoldenSpec; readonly chunk: Chunk }> =
  GOLDEN_SPECS.map((spec) => ({ spec, chunk: generateGoldenChunk(spec) }))

const describeSpec = (spec: GoldenSpec): string =>
  `${spec.biome} (${String(spec.cx)}, ${String(spec.cz)})${spec.decorate ? '' : ' no-decorate'}`

const countBlocks = (chunk: Chunk, wanted: number): number => {
  let count = 0
  for (let lx = 0; lx < CHUNK_SIZE_XZ; lx += 1) {
    for (let lz = 0; lz < CHUNK_SIZE_XZ; lz += 1) {
      for (let y = 0; y < CHUNK_HEIGHT; y += 1) {
        if (readBlock(chunk.blocks, blockIndex(lx, y, lz)) === wanted) {
          count += 1
        }
      }
    }
  }
  return count
}

describe('the committed goldens', () => {
  it.effect('are taken at the seed this repository previews and benches', () =>
    Effect.sync(() => {
      expect(committed.seed).toBe(GOLDEN_SEED)
      expect(committed.entries.length).toBe(GOLDEN_SPECS.length)
    }),
  )

  /**
   * THE golden assertion. `toBe` and not `toMatchSnapshot`, deliberately:
   * docs/testing.md §3 requires that updating a golden be an explicit act, and a
   * snapshot is precisely the artefact `vitest -u` rewrites in silence. The only
   * way to move these is `pnpm goldens:update`, which prints what moved.
   *
   * A failure here does NOT mean this test is wrong. It means generated terrain
   * changed, and every existing save — which stores a seed and not the blocks —
   * now loads a different world. Read the summary diff before regenerating.
   */
  it.effect('reproduce their digests exactly, chunk for chunk', () =>
    Effect.sync(() => {
      for (const spec of GOLDEN_SPECS) {
        const fresh = goldenEntry(spec)
        const stored = committed.entries.find(
          (entry) => entry.cx === spec.cx && entry.cz === spec.cz && entry.decorate === spec.decorate,
        )

        expect(stored, `no committed golden for ${describeSpec(spec)}`).toBeDefined()
        expect(fresh.blocksSha256, `blocks digest moved for ${describeSpec(spec)}`).toBe(
          stored?.blocksSha256,
        )
        expect(fresh.biomesSha256, `biomes digest moved for ${describeSpec(spec)}`).toBe(
          stored?.biomesSha256,
        )
        // The readable half. It cannot fail while the digests pass, which is the
        // point: it exists so that when they DO fail, the diff of the committed
        // file names what changed instead of showing 64 hex characters.
        expect(fresh.summary, `summary moved for ${describeSpec(spec)}`).toStrictEqual(stored?.summary)
      }
    }),
  )

  /**
   * A digest that collided, or a hash function that returned a constant, would
   * make every assertion above pass while distinguishing nothing. Distinct
   * chunks must produce distinct digests — including the two FOREST rows, which
   * are the same coordinate and differ only in decoration.
   */
  it.effect('discriminate: every row has its own digest', () =>
    Effect.sync(() => {
      const digests = committed.entries.map((entry) => entry.blocksSha256)

      expect(new Set(digests).size).toBe(GOLDEN_SPECS.length)
      for (const digest of digests) {
        expect(digest).toMatch(/^[0-9a-f]{64}$/u)
      }
    }),
  )
})

/**
 * ---------------------------------------------------------------------------
 * The matrix, checked against the rule that produced it.
 * ---------------------------------------------------------------------------
 *
 * The coordinates in `GOLDEN_SPECS` are literals, and a literal is a claim that
 * decays. These tests re-derive the claim.
 */
describe('the golden matrix', () => {
  it.effect('covers every biome, including the two a narrow window says do not exist', () =>
    Effect.sync(() => {
      const covered = new Set(GOLDEN_SPECS.map((spec) => spec.biome))

      // docs/testing.md §4-b F-5: measured over 384 x 384 blocks, DESERT and
      // SNOW read as 0.0% and the report concluded they were unreachable. They
      // are 0.1% and 0.8% of the world. A golden matrix drawn from a 3 x 3
      // square at the origin would repeat that mistake in permanent form — it
      // could not notice the day either stopped generating.
      expect([...covered].sort()).toStrictEqual([...BIOMES].sort())
    }),
  )

  it.effect('really is one biome per chunk, all 256 columns, as the selection rule claims', () =>
    Effect.sync(() => {
      for (const { spec, chunk } of generated) {
        const distinct = new Set<BiomeType>(chunk.biomes as ReadonlyArray<BiomeType>)

        expect(distinct.size, `${describeSpec(spec)} is no longer a single-biome chunk`).toBe(1)
        expect([...distinct][0]).toBe(spec.biome)
      }
    }),
  )

  /**
   * Not vacuous. A matrix of nine dry, flat, cave-free, treeless chunks would
   * satisfy every invariant below by having nothing in it, and would pin a
   * generator that had lost water, carving and vegetation entirely.
   */
  it.effect('contains water, carved caves and trees somewhere, so the invariants have work to do', () =>
    Effect.sync(() => {
      const totals = generated.map(({ chunk }) => ({
        water: countBlocks(chunk, BLOCK.WATER),
        logs: countBlocks(chunk, BLOCK.LOG),
      }))

      expect(totals.filter((total) => total.water > 0).length).toBeGreaterThan(0)
      expect(totals.filter((total) => total.logs > 0).length).toBeGreaterThan(0)
      expect(
        committed.entries.filter((entry) => entry.summary.caveBandAir > 0).length,
      ).toBeGreaterThan(0)
    }),
  )

  /**
   * The ninth row earns its place only if it differs from the sixth in exactly
   * one respect. If decoration ever leaked into the base pass — a tree that
   * displaced a stone block, say — this is what would catch it.
   *
   * GROUND COVER JOINED THE SET AND ORE DELIBERATELY DID NOT. Plants are
   * decoration and appear below; ore is stone, runs before this flag is
   * consulted, and is asserted to be identical across it by
   * `test/ore.test.ts` O-4. If a future change put ore behind `decorate`, the
   * set comparison below is what would fail, which is the right place for it to
   * fail — this test is the definition of what the flag means.
   */
  it.effect('isolates the decoration pass: the two FOREST rows differ only in vegetation', () =>
    Effect.sync(() => {
      const decorated = generateChunkAt(GOLDEN_SEED, 8, -8, { decorate: true })
      const bare = generateChunkAt(GOLDEN_SEED, 8, -8, { decorate: false })

      const changed: Array<number> = []
      for (let index = 0; index < decorated.blocks.length; index += 1) {
        const before = readBlock(bare.blocks, index)
        const after = readBlock(decorated.blocks, index)
        if (before !== after) {
          changed.push(after)
        }
      }

      expect(changed.length).toBeGreaterThan(0)
      // Every difference is a log, a leaf or a ground plant — and this chunk is
      // FOREST, so all four plant variants are reachable in it.
      const vegetation = new Set<number>([BLOCK.LOG, BLOCK.LEAVES, ...PLANT_IDS])
      for (const value of changed) {
        expect(vegetation.has(value), `decoration wrote a non-vegetation id ${String(value)}`).toBe(true)
      }
      // Both halves are present, so this is not passing because one of them
      // stopped generating.
      expect(changed.some((value) => value === BLOCK.LOG)).toBe(true)
      expect(changed.some((value) => PLANT_IDS.includes(value))).toBe(true)

      // And every one of them replaced AIR: decoration adds, it never digs.
      for (let index = 0; index < decorated.blocks.length; index += 1) {
        if (readBlock(bare.blocks, index) !== readBlock(decorated.blocks, index)) {
          expect(readBlock(bare.blocks, index)).toBe(BLOCK.AIR)
        }
      }
    }),
  )
})

/**
 * ---------------------------------------------------------------------------
 * The independent backing. None of this reads the committed file.
 * ---------------------------------------------------------------------------
 */
describe('what backs the block digest', () => {
  it.effect('I-1: every byte in every golden chunk is a declared GENERATED id', () =>
    Effect.sync(() => {
      // `BLOCK` is the ids this repository NAMES, which since `OBSIDIAN` arrived
      // is a strictly larger set than the ids terrain GENERATES. Taking the
      // whole of it here would have quietly widened this invariant on the day
      // that row was added: a stray obsidian byte in a golden chunk would have
      // started passing, and this test would have gone on reporting success
      // about a claim it had stopped making. So the generated set is spelled as
      // a subtraction, and a future non-generated id has to be subtracted too.
      //
      // IT IS NOW ALSO A UNION, and that is the visible cost of holding the ore
      // and plant ids outside `BLOCK`. They live in `domain/ore.ts` and
      // `domain/vegetation.ts` because `BLOCK` is re-exported by `index.ts` and
      // therefore sits in `api-lock.md`, whose four-week clock is plan.md §6
      // Step 3's publish gate. The union is written out here so that the set
      // this invariant ranges over is one readable expression rather than three
      // tables a reader has to go and find.
      const declared = new Set<number>([...Object.values(BLOCK), ...ORE_IDS, ...PLANT_IDS])
      declared.delete(BLOCK.OBSIDIAN)
      expect(declared.size).toBe(Object.keys(BLOCK).length - 1 + ORE_IDS.length + PLANT_IDS.length)

      // ONE `expect` FOR 655,360 BYTES, and the loop collects rather than
      // asserting. The obvious form — `expect(...)` inside the inner loop — is
      // ten chunks times 65,536 matcher invocations, which measured at 2.3s
      // alone and over 11s under a loaded `vitest run`, i.e. past the 10s
      // `testTimeout`. An invariant that fails intermittently because the
      // machine was busy teaches everyone to re-run it, which is the one habit
      // that makes a golden suite useless.
      const offenders = new Map<string, Set<number>>()
      for (const { spec, chunk } of generated) {
        for (const value of chunk.blocks) {
          if (!declared.has(value)) {
            const key = describeSpec(spec)
            offenders.set(key, (offenders.get(key) ?? new Set<number>()).add(value))
          }
        }
      }

      expect(
        [...offenders].map(([where, ids]) => `${where}: ${[...ids].join(', ')}`),
        'golden chunks contain block ids nothing declares',
      ).toStrictEqual([])
    }),
  )

  /**
   * I-2 DOES NOT BACK THE ORE PASS, and this comment used to say it did.
   *
   * The claim was that a vein reaching the bedrock floor is the one way ore
   * could corrupt a world rather than decorate it, and that I-2 refuses it.
   * Measured by mutation: dropping `ORE_MIN_Y_FLOOR` from `BEDROCK_Y + 1` to
   * `BEDROCK_Y` leaves this test green, because `growVein` replaces `BLOCK.STONE`
   * and the floor cell is `BLOCK.BEDROCK` — the band was never what stood
   * between them. `test/ore.test.ts` O-2 is the test that goes red.
   *
   * What I-2 still does for ore is real but narrower: it is the check that
   * nothing in the new pass introduced a BEDROCK byte anywhere, which is a
   * different failure from eating one.
   *
   * Collected rather than asserted per cell, for the reason I-1 gives.
   */
  it.effect('I-2: every column stands on bedrock, and bedrock is only at the floor', () =>
    Effect.sync(() => {
      const missing: Array<string> = []
      const stray: Array<string> = []

      for (const { spec, chunk } of generated) {
        for (let lx = 0; lx < CHUNK_SIZE_XZ; lx += 1) {
          for (let lz = 0; lz < CHUNK_SIZE_XZ; lz += 1) {
            if (readBlock(chunk.blocks, blockIndex(lx, BEDROCK_Y, lz)) !== BLOCK.BEDROCK) {
              missing.push(`${describeSpec(spec)} (${String(lx)}, ${String(lz)})`)
            }
            for (let y = BEDROCK_Y + 1; y < CHUNK_HEIGHT; y += 1) {
              if (readBlock(chunk.blocks, blockIndex(lx, y, lz)) === BLOCK.BEDROCK) {
                stray.push(`${describeSpec(spec)} (${String(lx)}, ${String(y)}, ${String(lz)})`)
              }
            }
          }
        }
      }

      expect(missing, 'columns with no bedrock floor').toStrictEqual([])
      expect(stray, 'bedrock above the floor').toStrictEqual([])
    }),
  )

  /**
   * I-3 — docs/design-notes.md DN-1. `SEA_LEVEL` is 63 and `LAKE_LEVEL` is the
   * same value; plan.md §3.7's 48 and 62 are both wrong. A golden regenerated on
   * top of a world whose water had moved to 48 would sail through the digest
   * comparison and fail here.
   */
  it.effect('I-3: water stops exactly at SEA_LEVEL and never rises above LAKE_LEVEL', () =>
    Effect.sync(() => {
      let wetColumns = 0

      for (const { spec, chunk } of generated) {
        for (let lx = 0; lx < CHUNK_SIZE_XZ; lx += 1) {
          for (let lz = 0; lz < CHUNK_SIZE_XZ; lz += 1) {
            let top = -1
            for (let y = 0; y < CHUNK_HEIGHT; y += 1) {
              if (readBlock(chunk.blocks, blockIndex(lx, y, lz)) === BLOCK.WATER) {
                top = y
                expect(y, `${describeSpec(spec)} has water above LAKE_LEVEL`).toBeLessThanOrEqual(LAKE_LEVEL)
              }
            }
            if (top >= 0) {
              wetColumns += 1
              expect(top, `${describeSpec(spec)} water surface is not SEA_LEVEL`).toBe(SEA_LEVEL)
            }
          }
        }
      }

      // The vacuity guard docs/testing.md §6 asks for: with no water anywhere,
      // "no water above LAKE_LEVEL" is true and says nothing.
      expect(wetColumns).toBeGreaterThan(0)
    }),
  )

  /**
   * I-4 — docs/design-notes.md DN-2, the hollow lake. The carver's guard keeps
   * `WATER_FLOOR_MARGIN` blocks of shell beneath a water body; without it the
   * bed is eaten from below and the water becomes a floating sheet over an
   * unlit void.
   *
   * THIS TEST WAS VACUOUS IN ITS FIRST FORM, and the failure is instructive
   * enough to record. It asserted only that no golden chunk has air inside the
   * shell — and passed, unchanged, with the guard deleted from `carveCaves`
   * (`waterFloorMargin ?? 0`). docs/testing.md §4-b F-4 explains why: at this
   * seed near the origin no cave comes within three blocks of a lake bed, so
   * there was nothing for the guard to do and nothing for its absence to break.
   * The eight biome chunks all sit in that region.
   *
   * The fix is the `test/carver.test.ts` rule — REPRODUCE THE BUG. The tenth
   * golden row, (4, 9), is a chunk where the guard demonstrably bites, and both
   * halves are asserted below: solid with the guard, hollow without it. The
   * second half is what makes the first half evidence.
   */
  const airInShell = (chunk: Chunk): number => {
    let columns = 0
    for (let lx = 0; lx < CHUNK_SIZE_XZ; lx += 1) {
      for (let lz = 0; lz < CHUNK_SIZE_XZ; lz += 1) {
        let floor = -1
        for (let y = 0; y < CHUNK_HEIGHT; y += 1) {
          if (readBlock(chunk.blocks, blockIndex(lx, y, lz)) === BLOCK.WATER) {
            floor = y
            break
          }
        }
        if (floor < 0) {
          continue
        }
        for (let y = Math.max(0, floor - WATER_FLOOR_MARGIN); y < floor; y += 1) {
          if (readBlock(chunk.blocks, blockIndex(lx, y, lz)) === BLOCK.AIR) {
            columns += 1
            break
          }
        }
      }
    }
    return columns
  }

  it.effect('I-4: the shell under every water body in the matrix is solid', () =>
    Effect.sync(() => {
      let submergedColumns = 0

      for (const { spec, chunk } of generated) {
        expect(airInShell(chunk), `${describeSpec(spec)} has air inside the water-floor shell`).toBe(0)

        for (let lx = 0; lx < CHUNK_SIZE_XZ; lx += 1) {
          for (let lz = 0; lz < CHUNK_SIZE_XZ; lz += 1) {
            for (let y = 1; y < CHUNK_HEIGHT; y += 1) {
              if (readBlock(chunk.blocks, blockIndex(lx, y, lz)) === BLOCK.WATER) {
                submergedColumns += 1
                // The floating-sheet signature itself: water resting on nothing.
                expect(readBlock(chunk.blocks, blockIndex(lx, y - 1, lz))).not.toBe(BLOCK.AIR)
                break
              }
            }
          }
        }
      }

      expect(submergedColumns).toBeGreaterThan(0)
    }),
  )

  it.effect('I-4b: and the guard is what does it — without it, 200+ columns of (4, 9) go hollow', () =>
    Effect.sync(() => {
      const guarded = generateChunkAt(GOLDEN_SEED, 4, 9)
      const unguarded = generateChunkAt(GOLDEN_SEED, 4, 9, { carve: { waterFloorMargin: 0 } })

      expect(airInShell(guarded)).toBe(0)
      // Measured 229 of 256. The bound is loose because the point is that the
      // number is LARGE, not that it is 229; a shaper change may move it.
      expect(airInShell(unguarded)).toBeGreaterThan(200)
    }),
  )

  /**
   * I-5 — docs/testing.md §4-b F-2. One crown is a 5 x 5 square minus its four
   * corners, and the trunk already occupies the centre column at the crown's Y,
   * so an unclipped tree contributes exactly 5 LOG and 20 LEAVES. Any excess of
   * leaves over `trees * 20` is two crowns that have merged — the walkable leaf
   * slab the jittered grid exists to prevent.
   */
  it.effect('I-5: LEAVES is exactly 20 per tree, so no two crowns have fused', () =>
    Effect.sync(() => {
      const logsPerTree = 5
      const leavesPerTree = 20
      let treesSeen = 0

      for (const { spec, chunk } of generated) {
        const logs = countBlocks(chunk, BLOCK.LOG)
        const leaves = countBlocks(chunk, BLOCK.LEAVES)

        expect(logs % logsPerTree, `${describeSpec(spec)} has a clipped trunk`).toBe(0)
        const trees = logs / logsPerTree
        treesSeen += trees
        expect(leaves, `${describeSpec(spec)} canopy is not ${String(leavesPerTree)} per tree`).toBe(
          trees * leavesPerTree,
        )
      }

      expect(treesSeen).toBeGreaterThan(0)
    }),
  )
})

describe('what backs the biome digest', () => {
  /**
   * I-6. `generateChunk` writes `chunk.biomes` from inside its own column loop.
   * This rebuilds the same array through `biomeFor` one column at a time — a
   * different path to the same claim, so agreement is evidence rather than a
   * restatement. It is also the check that would catch the field being filled
   * with a placeholder: an array of 256 'PLAINS' hashes perfectly well.
   */
  it.effect('I-6: the stored biome array agrees with biomeFor recomputed per column', () =>
    Effect.sync(() => {
      for (const { spec, chunk } of generated) {
        for (let lx = 0; lx < CHUNK_SIZE_XZ; lx += 1) {
          for (let lz = 0; lz < CHUNK_SIZE_XZ; lz += 1) {
            const wx = spec.cx * CHUNK_SIZE_XZ + lx
            const wz = spec.cz * CHUNK_SIZE_XZ + lz
            const expected = biomeFor(
              GOLDEN_SEED,
              wx,
              wz,
              surfaceHeightAt(GOLDEN_SEED, wx, wz),
              DEFAULT_TERRAIN_LEVELS,
            )

            expect(
              chunk.biomes[columnIndex(lx, lz)],
              `${describeSpec(spec)} disagrees at column (${String(lx)}, ${String(lz)})`,
            ).toBe(expected)
          }
        }
      }
    }),
  )

  it.effect('I-7: every entry is a member of the closed roster, and there are 256 of them', () =>
    Effect.sync(() => {
      const roster = new Set<string>(BIOMES)

      for (const { spec, chunk } of generated) {
        expect(chunk.biomes.length).toBe(CHUNK_SIZE_XZ * CHUNK_SIZE_XZ)
        for (const biome of chunk.biomes) {
          expect(roster.has(biome), `${describeSpec(spec)} carries unknown biome ${biome}`).toBe(true)
        }
      }
    }),
  )
})

describe('what backs both digests', () => {
  /**
   * I-8. The digest is only meaningful if the thing digested is stable. This is
   * `test/determinism.test.ts`'s property narrowed to the exact nine chunks the
   * goldens pin, so that a failure here says "the golden matrix is unstable"
   * rather than "some chunk somewhere is".
   */
  it.effect('I-8: regenerating a golden chunk is byte-identical', () =>
    Effect.sync(() => {
      for (const { spec, chunk } of generated) {
        const again = generateGoldenChunk(spec)

        expect(again.blocks, `${describeSpec(spec)} is not reproducible`).toStrictEqual(chunk.blocks)
        expect(again.biomes).toStrictEqual(chunk.biomes)
      }
    }),
  )
})
