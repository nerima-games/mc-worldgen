/**
 * Ore veins.
 *
 * plan.md §3.7 gives this repository 鉱石. Ported from the reference
 * implementation's `packages/world/domain/terrain/ore-generator.ts` (187 LOC,
 * `docs/porting.md` §5), with the vein-growth algorithm transcribed and the
 * DEPTH BANDS re-derived. Read the section on the bands before touching a
 * number: three of the seven were not portable and it is provable rather than
 * arguable.
 *
 * ---------------------------------------------------------------------------
 * PASS ORDER: AFTER THE CARVER, BEFORE DECORATION, AND NOT OPTIONAL
 * ---------------------------------------------------------------------------
 *
 * The reference places ore after cave carving and says why in one line
 * (`terrain/constants.ts:57`): 「Ore veins placed AFTER cave carving —
 * cave-exposed ore walls appear」. Carving first and seeding into the result is
 * what puts ore in the wall of a cave the player can walk into; seeding first
 * and carving after would delete exactly the veins that were about to be
 * findable.
 *
 * It is NOT gated on `GenerateOptions.decorate`. Ore is stone, not decoration:
 * the reference runs it in the base pipeline, and `decorate: false` exists so
 * that `test/chunk-golden.test.ts` can isolate the VEGETATION pass. Putting ore
 * behind the same flag would silently widen what that flag means, and the ninth
 * golden row would stop being 「the FOREST chunk without the vegetation pass」.
 *
 * ---------------------------------------------------------------------------
 * THE DEPTH BANDS. THREE OF SEVEN DO NOT PORT, AND THE CEILING IS DERIVABLE
 * ---------------------------------------------------------------------------
 *
 * `ORE_CONFIGS` (`terrain/constants.ts:71-79`) is tuned for the reference's
 * terrain, which has a MOUNTAINS biome, an overhang pass and a taller stone
 * column. Transcribing its Y bands here would be the exact failure this
 * repository already has on record for `CONTINENTALNESS_CONTRAST`
 * (`./terrain.ts`): a figure justified by a measurement of a different
 * population.
 *
 * THE CEILING IS NOT A MEASUREMENT, IT IS A CONSTRUCTION. `./terrain.ts`'s
 * `fillColumn` writes STONE over `[BEDROCK_Y + 1, surfaceY - FILLER_DEPTH)` and
 * nothing else in the pipeline creates stone. With `MAX_SURFACE_Y = 92` and
 * `FILLER_DEPTH = 4`, the highest cell that can ever hold stone is
 *
 *     MAX_SURFACE_Y - FILLER_DEPTH - 1  =  92 - 4 - 1  =  87
 *
 * for every seed and every column, by construction. `growVein` replaces STONE
 * and nothing else, so a band reaching above 87 is a band that is DEAD above 87
 * — not rare, not unlikely: impossible.
 *
 * Measured, to say where the stone actually is rather than where it could be.
 * Method: every cell of 144 generated chunks (2304 x 2304 blocks) at the origin,
 * repeated at seeds 20260726, 1 and 4242.
 *
 *     seed        highest Y holding any stone    stone is a majority up to    p99 of stone mass
 *     20260726                 72                          63                      y <= 64
 *     1                        81                          67                      y <= 72
 *     4242                     72                          56                      y <= 64
 *
 * So the stone column tops out in the low 70s in practice and at 87 in
 * principle, and 99% of its mass is at or below 72. Against that:
 *
 *     ore        reference band (min/max/peak)   verdict
 *     COAL              12 / 180 /  96           peak is ABOVE the structural ceiling
 *     IRON               8 / 128 /  48           peak fine, ceiling 41 blocks dead
 *     GOLD               5 /  48 /  24           ports unchanged
 *     DIAMOND            5 /  16 /   8           ports unchanged
 *     REDSTONE           5 /  20 /   8           ports unchanged
 *     LAPIS              8 /  72 /  28           ports unchanged
 *     EMERALD           24 / 160 /  96           peak is ABOVE the structural ceiling
 *
 * HOW MUCH THIS COSTS WAS MEASURED, NOT REASONED — and the first reasoned
 * answer written here was wrong, which is why it is now a table. The guess was
 * that a mode above the stone would make all eight seed attempts miss and leave
 * the world with almost no coal. It does not: `MAX_SEED_ATTEMPTS` re-draws Y on
 * every attempt, so a band that is mostly dead still lands a vein eventually.
 * The real cost is a SHORTFALL, and it is confined to exactly the two rows whose
 * peak is out of range.
 *
 * Method: 144 chunks at the origin, both band sets run over the same generated
 * stone, at three seeds. 「intended」 is `avgVeins × mean(minSize..maxSize)` —
 * the rate the reference's own tuning asks for, and a figure neither band set
 * can exceed.
 *
 *     ore        intended   shipped bands        reference bands
 *     COAL          180      97 / 99 / 99 %      68 / 80 / 82 %
 *     EMERALD         4      94 / 100 / 102 %    57 / 74 / 74 %
 *     IRON           78      98 / 100 / 101 %    96 / 99 / 100 %
 *     GOLD           20      99 / 101 / 101 %    99 / 101 / 102 %
 *     DIAMOND         8      99 / 102 / 104 %    99 / 102 / 104 %
 *     REDSTONE       25      96 / 99 / 103 %     96 / 99 / 103 %
 *     LAPIS        13.5      95 / 100 / 100 %    95 / 101 / 101 %
 *
 * So the reference's bands lose between a fifth and a third of the coal and
 * between a quarter and two fifths of the emerald, silently, while every other
 * ore is untouched — and the five rows this file does NOT edit are identical
 * under both band sets to within sampling noise, which is the evidence that the
 * edit is doing what it claims and nothing else. `test/ore.test.ts` pins the
 * shipped rows against `intended`; a future band change that reintroduces the
 * shortfall fails there rather than in a player's mine.
 *
 * FOUR ROWS ARE THEREFORE TRANSCRIBED UNCHANGED and three are edited, each edit
 * doing the least it can:
 *
 *   - every `maxY` above 87 becomes `ORE_MAX_Y` (87). This trims dead range and
 *     changes no distribution the terrain could realise.
 *   - `peakY` moves only where the reference's peak is outside the surviving
 *     band: COAL 96 -> 64 and EMERALD 96 -> 64. 64 is the measured p99 of stone
 *     mass, i.e. the shallowest depth at which there is still stone to sit in,
 *     which is the local reading of what 96 meant in the reference — vanilla
 *     coal peaks just above the mean surface and is the ore you find in a cliff.
 *
 * EMERALD NEEDS ONE MORE SENTENCE, because its 96 was not arbitrary there
 * either: emerald is a MOUNTAINS ore, and its band is high because that is where
 * mountains are. `./biome.ts`'s roster has no MOUNTAINS. So emerald's band here
 * is LOCAL rather than transcribed — the reference's justification does not
 * survive the port at all, and 64 is chosen for the same reason coal's is, not
 * because it is a rescaling of 96. It stays the rarest ore in the table
 * (`avgVeins: 2`, sizes 1-3) because that part of the tuning is about scarcity
 * rather than about altitude.
 *
 * ---------------------------------------------------------------------------
 * `ORE_MIN_Y_FLOOR` IS 1 HERE AND 5 THERE, AND THAT IS THE SAME RULE
 * ---------------------------------------------------------------------------
 *
 * The reference writes `ORE_MIN_Y_FLOOR = BEDROCK_LAYER_TOP + 1` and evaluates
 * it to 5 (`terrain/constants.ts:82`), with the comment 「Protects bedrock
 * (y=0..4) even if an ore's minY is permissive」. Its bedrock is a probabilistic
 * band over `y = 0..4` (`terrain/constants.ts:15-20`).
 *
 * THIS REPOSITORY'S BEDROCK IS ONE BLOCK. `fillColumn` writes it at `BEDROCK_Y`
 * and `test/chunk-golden.test.ts` I-2 pins that bedrock appears at the floor and
 * nowhere else. So the local value of the reference's own expression is
 * `BEDROCK_Y + 1 = 1`, and transcribing the 5 would be carrying a figure whose
 * justification is a bedrock layer that does not exist here — four blocks of
 * stone made ore-free for a reason that had already stopped being true.
 *
 * It is written as the expression rather than as the literal so the two cannot
 * drift, which is the same treatment `./constants.ts` gives `LAKE_LEVEL`.
 *
 * AND IT IS NOT WHAT PROTECTS THE BEDROCK. This paragraph used to end by saying
 * that it was, and that `test/chunk-golden.test.ts` I-2 was the check. Both
 * halves were false, and the way they were found is worth the four lines:
 * setting `ORE_MIN_Y_FLOOR` to `BEDROCK_Y` and running the suite changed
 * NOTHING — I-2 passed, every ore test passed. `growVein` replaces `BLOCK.STONE`
 * and the floor cell is `BLOCK.BEDROCK`, so the floor was never reachable by way
 * of the band at all. The guarantee belongs to the STONE-only rule and to
 * `test/ore.test.ts` O-2, which is the test that does go red when that rule is
 * removed.
 *
 * What this constant actually is, stated accurately: a defensive floor on the
 * band that CURRENTLY NEVER BINDS, because every row's own `minY` is 5 or more.
 * It is kept because the reference keeps it and because the day it earns its
 * place is the day someone adds an ore with a permissive `minY` — which is
 * exactly the day nobody would think to add it.
 *
 * ---------------------------------------------------------------------------
 * NO DEEPSLATE VARIANTS, AND THAT IS A MISSING STRATUM RATHER THAN A SHORTCUT
 * ---------------------------------------------------------------------------
 *
 * Kernel carries all fourteen rows — seven ores in stone/deepslate pairs, ids
 * 50-63 (`block-registry.ts:1329-1544`) — and the reference chooses between them
 * per cell: `blocks[idx] = cy < DEEPSLATE_CEILING ? deepslateOreIndex :
 * oreIndex` (`ore-generator.ts`), with `DEEPSLATE_CEILING = 16`
 * (`terrain/constants.ts:17`).
 *
 * That branch is a fact about the STONE, not about the ore: below y=16 the
 * reference's `fillColumn` equivalent writes deepslate rather than stone, so
 * `deepslate_coal_ore` is coal embedded in the rock that is actually there.
 * `./terrain.ts` writes `BLOCK.STONE` from `BEDROCK_Y + 1` to the filler, with
 * no deepslate band at all. Writing `deepslate_coal_ore` into ordinary stone
 * would be inventing a stratum: the player would mine deepslate ore out of a
 * wall of grey stone, and mc-render would draw the two textures adjacent with
 * nothing between them.
 *
 * So the seven stone variants are placed and the seven deepslate ones are owed,
 * together with the deepslate band itself. `docs/porting.md` §5 records it as
 * one item rather than two, because doing either half alone is what produces the
 * artefact above.
 *
 * ---------------------------------------------------------------------------
 * THE SEED, AGAIN
 * ---------------------------------------------------------------------------
 *
 * The reference's per-ore stream is `seedFromChunk(baseWorldX, baseWorldZ,
 * cfg.saltX, cfg.saltZ)` (`math.ts:20-28`), which takes NO WORLD SEED — so every
 * world would carry its ore in the same places. `./vegetation.ts`'s header
 * records the same finding for plants and the reasoning is identical, so the
 * world seed is folded in here through `./seeded-random`'s `channelSeed`. The
 * reference's mixing constants and its per-ore salts ARE transcribed, because
 * unlike the plant salts they do work that a channel name does not: they
 * decorrelate ADJACENT CHUNKS of the same ore, not two streams of one chunk.
 */
import { BLOCK } from './biome'
import { readBlock } from './chunk'
import { BEDROCK_Y, blockIndex, CHUNK_HEIGHT, CHUNK_SIZE_XZ } from './constants'
import { BlockId, type ChunkCoord } from '@nerima-games/mc-kernel'
import { channelSeed, mulberry32 } from './seeded-random'

/**
 * The ore ids, transcribed from `mc-kernel/domain/block-registry.ts`.
 *
 * Kernel's assignment, adopted here — the same direction as `BLOCK.OBSIDIAN`.
 * Held outside `./biome.ts`'s `BLOCK` for the reason `./vegetation.ts` states:
 * `BLOCK` is in `api-lock.md` and this file is not re-exported by `index.ts`.
 *
 * All seven are ordinary opaque cubes in kernel, so `mc-kernel`'s
 * opaque default already answers for them and `./light.ts` needs no change.
 * `redstone_ore` alone emits light 9 there (`block-registry.ts:1361-1363`); this
 * repository does not transcribe that column for these ids, so a wall of
 * redstone reads as dark. That is the CONSERVATIVE direction for the one rule
 * that consumes block light (`docs/design-notes.md` DN-7), and it is a kernel
 * request rather than a local fix — see `test/ore.test.ts`.
 */
export const ORE_BLOCK = {
  /** `block-registry.ts:1367`. */
  COAL: BlockId(50),
  /** `block-registry.ts:1380`. */
  IRON: BlockId(51),
  /** `block-registry.ts:1392`. */
  GOLD: BlockId(52),
  /** `block-registry.ts:1404`. */
  DIAMOND: BlockId(53),
  /** `block-registry.ts:1417`. */
  REDSTONE: BlockId(54),
  /** `block-registry.ts:1431`. */
  LAPIS: BlockId(55),
  /** `block-registry.ts:1444`. */
  EMERALD: BlockId(56),
} as const

export type OreName = keyof typeof ORE_BLOCK

/** Every id this module can write. */
export const ORE_IDS: ReadonlyArray<number> = Object.values(ORE_BLOCK)

/**
 * Lowest cell an ore may occupy — the local value of the reference's
 * `BEDROCK_LAYER_TOP + 1`, which is 5 there and 1 here because that repository's
 * bedrock is a five-block band and this one's is a single layer.
 *
 * A defensive bound that never currently binds: every row's own `minY` is 5 or
 * more, and the bedrock floor is protected by the STONE-only replacement rule
 * rather than by this. The header says how that was established, because the
 * comment here used to claim the opposite.
 */
export const ORE_MIN_Y_FLOOR = BEDROCK_Y + 1

/**
 * Highest cell that can ever hold stone, and therefore ore.
 *
 * `MAX_SURFACE_Y - FILLER_DEPTH - 1 = 92 - 4 - 1`. Written as a literal because
 * importing `MAX_SURFACE_Y` from `./terrain.ts` would close an import cycle —
 * terrain imports this module. `test/ore.test.ts` re-derives it from the
 * exported `MAX_SURFACE_Y` AND checks the stronger empirical claim that no
 * generated chunk holds stone above it, so the literal cannot drift silently.
 */
export const ORE_MAX_Y = 87

/**
 * Re-roll a vein's seed voxel this many times before giving up on it.
 *
 * `MAX_SEED_ATTEMPTS = 8`, `ore-generator.ts`, whose comment states the failure
 * it prevents: without it 「caves/surface quirks can prevent nearly all veins
 * from placing at shallow-depth ores」. A vein whose first candidate lands in
 * air is not a vein that should not exist; it is a vein that should be tried
 * somewhere else in the chunk.
 */
export const MAX_SEED_ATTEMPTS = 8

export type OreConfig = {
  readonly name: OreName
  readonly minY: number
  readonly maxY: number
  readonly peakY: number
  readonly avgVeins: number
  readonly minSize: number
  readonly maxSize: number
  readonly saltX: number
  readonly saltZ: number
}

/**
 * Transcribed from `ORE_CONFIGS` (`terrain/constants.ts:72-78`), one row per
 * line there and per entry here.
 *
 * `avgVeins`, `minSize`, `maxSize`, `saltX` and `saltZ` are verbatim on every
 * row. `minY` is verbatim on every row. `maxY` and `peakY` carry the three
 * edits the header derives; each edited field says so on its own line so that a
 * reader diffing this against the reference sees the change at the change.
 */
export const ORE_CONFIGS: ReadonlyArray<OreConfig> = [
  // maxY 180 -> ORE_MAX_Y (dead above 87); peakY 96 -> 64 (above the ceiling).
  { name: 'COAL', minY: 12, maxY: ORE_MAX_Y, peakY: 64, avgVeins: 18, minSize: 6, maxSize: 14, saltX: 10007, saltZ: 20011 },
  // maxY 128 -> ORE_MAX_Y. peakY 48 is verbatim: it sits in the dense stone band.
  { name: 'IRON', minY: 8, maxY: ORE_MAX_Y, peakY: 48, avgVeins: 12, minSize: 4, maxSize: 9, saltX: 30013, saltZ: 40013 },
  // Verbatim: 48 is already under the ceiling.
  { name: 'GOLD', minY: 5, maxY: 48, peakY: 24, avgVeins: 4, minSize: 3, maxSize: 7, saltX: 50021, saltZ: 60029 },
  // Verbatim.
  { name: 'DIAMOND', minY: 5, maxY: 16, peakY: 8, avgVeins: 2, minSize: 2, maxSize: 6, saltX: 70037, saltZ: 80039 },
  // Verbatim.
  { name: 'REDSTONE', minY: 5, maxY: 20, peakY: 8, avgVeins: 5, minSize: 3, maxSize: 7, saltX: 90043, saltZ: 100049 },
  // Verbatim: 72 is already under the ceiling.
  { name: 'LAPIS', minY: 8, maxY: 72, peakY: 28, avgVeins: 3, minSize: 3, maxSize: 6, saltX: 110059, saltZ: 120071 },
  // maxY 160 -> ORE_MAX_Y; peakY 96 -> 64. The MOUNTAINS argument does not port.
  { name: 'EMERALD', minY: 24, maxY: ORE_MAX_Y, peakY: 64, avgVeins: 2, minSize: 1, maxSize: 3, saltX: 130081, saltZ: 140089 },
]

/**
 * The per-ore, per-chunk random stream's seed.
 *
 * `seedFromChunk`'s mixing (`math.ts:20-28`) with the world seed folded in
 * through `channelSeed`. The chunk's base world coordinates are what make two
 * adjacent chunks disagree; the salts are what make two ores in one chunk
 * disagree; the world seed is what makes two worlds disagree, and it is the one
 * the reference is missing.
 */
export const oreStreamSeed = (seed: number, config: OreConfig, baseWorldX: number, baseWorldZ: number): number => {
  let hash = channelSeed(seed, `ore-${config.name}`)
  hash = (Math.imul(baseWorldX | 0, 0x27d4eb2d) ^ Math.imul(baseWorldZ | 0, 0x85ebca6b) ^ hash) >>> 0
  hash = (hash ^ Math.imul(config.saltX | 0, 0xc2b2ae35)) >>> 0
  hash = (hash ^ Math.imul(config.saltZ | 0, 0x165667b1)) >>> 0
  hash = Math.imul(hash ^ (hash >>> 16), 0x7feb352d) >>> 0
  hash = Math.imul(hash ^ (hash >>> 15), 0x846ca68b) >>> 0
  return (hash ^ (hash >>> 16)) >>> 0
}

/**
 * A Y in `[yMin, yMax]` drawn from a triangular distribution peaking at the
 * ore's mode. `sampleOreY`, `ore-generator.ts`.
 *
 * The inverse-CDF of a triangle is two square-root branches meeting at the mode,
 * which is why this is arithmetic rather than rejection sampling: it draws once
 * and always succeeds, so the stream advances by exactly one step per call and
 * the whole generator stays replayable.
 *
 * The mode is CLAMPED into the band. That clamp is why an out-of-band `peakY` is
 * dangerous rather than merely wrong — see the header on COAL.
 */
export const sampleOreY = (config: OreConfig, yMin: number, yMax: number, next: () => number): number => {
  const mode = Math.max(yMin, Math.min(yMax, config.peakY))
  const value = next()
  const span = yMax - yMin

  if (span <= 0) {
    return yMin
  }

  const modeFraction = (mode - yMin) / span
  const sampled =
    value < modeFraction
      ? yMin + Math.sqrt(value * span * (mode - yMin))
      : yMax - Math.sqrt((1 - value) * span * (yMax - mode))

  return Math.max(yMin, Math.min(yMax, Math.round(sampled)))
}

/**
 * Grow one vein outwards from a seed voxel, replacing STONE only.
 *
 * `growVein`, `ore-generator.ts`. A stack of candidate cells with a RANDOM pick
 * rather than a queue with a first-in pick: the reference's comment gives the
 * reason — 「random-walk-ish — avoids linear BFS shape」. A FIFO drain grows a
 * diamond, which reads as manufactured; picking at random grows a blob.
 *
 * The swap-remove is the reference's too, and it is what keeps the pick O(1);
 * splicing out of the middle of the stack would make vein growth quadratic in
 * the vein size.
 *
 * Returns the number of cells actually placed, which the reference discards. It
 * is returned here because `test/ore.test.ts` needs to distinguish 「the vein
 * grew to its target」 from 「the vein ran out of stone」 without re-deriving the
 * walk, and a vein that always places zero is the failure mode this whole
 * module's band arithmetic exists to avoid.
 */
export const growVein = (
  blocks: Uint8Array,
  seedX: number,
  seedY: number,
  seedZ: number,
  targetSize: number,
  ore: BlockId,
  yMin: number,
  yMax: number,
  next: () => number,
): number => {
  let placed = 0
  const stack: Array<number> = [seedX, seedY, seedZ]

  while (placed < targetSize && stack.length > 0) {
    const pickIndex = Math.floor(next() * (stack.length / 3)) * 3
    const cx = stack[pickIndex] ?? 0
    const cy = stack[pickIndex + 1] ?? 0
    const cz = stack[pickIndex + 2] ?? 0

    const lastBase = stack.length - 3
    if (pickIndex !== lastBase) {
      stack[pickIndex] = stack[lastBase] ?? 0
      stack[pickIndex + 1] = stack[lastBase + 1] ?? 0
      stack[pickIndex + 2] = stack[lastBase + 2] ?? 0
    }
    stack.length = lastBase

    if (cx < 0 || cx >= CHUNK_SIZE_XZ || cz < 0 || cz >= CHUNK_SIZE_XZ) {
      continue
    }
    // The vertical clamp enforces the depth band. It is NOT what keeps ore out
    // of the bedrock floor — the STONE test below is. See the header.
    if (cy < yMin || cy > yMax) {
      continue
    }

    const index = blockIndex(cx, cy, cz)
    if (readBlock(blocks, index) !== BLOCK.STONE) {
      continue
    }

    blocks[index] = ore
    placed += 1

    stack.push(cx + 1, cy, cz)
    stack.push(cx - 1, cy, cz)
    stack.push(cx, cy + 1, cz)
    stack.push(cx, cy - 1, cz)
    stack.push(cx, cy, cz + 1)
    stack.push(cx, cy, cz - 1)
  }

  return placed
}

/**
 * Place every ore vein for one chunk, in place.
 *
 * Mutates for the same measured reason `carveCaves` does, and the same
 * confinement argument applies: the buffer belongs to `generateChunk`, which has
 * not shared it yet.
 */
export const placeOres = (blocks: Uint8Array, seed: number, coord: ChunkCoord): void => {
  const baseWorldX = coord.cx * CHUNK_SIZE_XZ
  const baseWorldZ = coord.cz * CHUNK_SIZE_XZ

  for (const config of ORE_CONFIGS) {
    const next = mulberry32(oreStreamSeed(seed, config, baseWorldX, baseWorldZ))

    // `avgVeins - 1 + rng * 2` — the reference's ±1 variance around the mean.
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

        if (readBlock(blocks, blockIndex(seedX, seedY, seedZ)) !== BLOCK.STONE) {
          continue
        }

        growVein(blocks, seedX, seedY, seedZ, veinSize, ore, yMin, yMax, next)
        break
      }
    }
  }
}
