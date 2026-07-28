/**
 * The kernel mirror is pinned against kernel's documented shape.
 *
 * Same defence, and the same reasoning, as `mc-sim/test/kernel-mirror.test.ts`:
 * `domain/kernel-vocabulary.ts` promises that deleting it and repointing every
 * import at the published package will typecheck, and nothing but a test can
 * enforce that promise. Kernel's declarations are RESTATED here rather than
 * imported, because mc-kernel is not published — which is the same reason the
 * mirror exists at all. When it is published, each restatement becomes an
 * `import type` and every assertion below keeps its meaning unchanged.
 *
 * This repository's mirror has one hazard mc-sim's does not: the block ids.
 * `domain/biome.ts`'s `BLOCK` constant and kernel's `BLOCK_REGISTRY` must agree
 * on eleven numbers, and those numbers are a SAVE FORMAT. A drift is not a
 * compile error anywhere in the organisation — it is a world whose deserts load
 * as oceans. It is checked here, in both directions, block by block.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { BLOCK } from '../domain/biome'
import { CHUNK_SIZE_XZ as CONSTANTS_CHUNK_SIZE_XZ } from '../domain/constants'
import {
  AIR_BLOCK_ID,
  BLOCK_ID_MAX,
  BLOCK_OPACITIES,
  BlockAxis,
  BlockId,
  blockPosition,
  blockPositionOfChunkLocal,
  ChunkAxis,
  chunkCoord,
  chunkCoordOfBlock,
  clampLightLevel,
  lightEmissionOfBlockId,
  LIGHT_LEVEL_MAX,
  LIGHT_LEVEL_MIN,
  LocalAxis,
  localCoordOfBlock,
  opacityOfBlockId,
  transmitsLight,
  type BlockPosition,
  type ChunkCoord,
  type LocalBlockCoord,
} from '../domain/kernel-vocabulary'
import { ORE_BLOCK } from '../domain/ore'
import { PLANT } from '../domain/vegetation'

describe('coordinate vocabulary matches mc-kernel/domain/coordinates.ts', () => {
  /** Kernel's `ChunkCoord`, restated from `mc-kernel/domain/coordinates.ts:87-90`. */
  type KernelChunkCoord = {
    readonly cx: ChunkAxis
    readonly cz: ChunkAxis
  }

  /** Kernel's `BlockPosition`, same source, lines 74-78. */
  type KernelBlockPosition = {
    readonly x: BlockAxis
    readonly y: BlockAxis
    readonly z: BlockAxis
  }

  /** Kernel's `LocalBlockCoord`, same source, lines 104-108. */
  type KernelLocalBlockCoord = {
    readonly lx: LocalAxis
    readonly ly: BlockAxis
    readonly lz: LocalAxis
  }

  it.effect('is assignable to kernel\'s shapes and back, field for field', () =>
    Effect.sync(() => {
      // The assertion is the ASSIGNMENT, in both directions. A field added,
      // removed or renamed on either side stops the build here rather than at
      // the repoint. The `expect`s exist only so the values are used.
      const asKernelChunk: KernelChunkCoord = chunkCoord(1, 2)
      const backFromKernelChunk: ChunkCoord = asKernelChunk
      const asKernelBlock: KernelBlockPosition = blockPosition(1, 2, 3)
      const backFromKernelBlock: BlockPosition = asKernelBlock
      const asKernelLocal: KernelLocalBlockCoord = localCoordOfBlock(blockPosition(17, 2, 33))
      const backFromKernelLocal: LocalBlockCoord = asKernelLocal

      expect(backFromKernelChunk).toStrictEqual({ cx: 1, cz: 2 })
      expect(backFromKernelBlock).toStrictEqual({ x: 1, y: 2, z: 3 })
      expect(backFromKernelLocal).toStrictEqual({ lx: 1, ly: 2, lz: 1 })
    }),
  )

  it.effect('spells the chunk axes cx/cz, not x/z', () =>
    Effect.sync(() => {
      const coord = chunkCoord(3, -7)
      expect(Object.keys(coord).sort()).toStrictEqual(['cx', 'cz'])
      expect(coord.cx).toBe(3)
      expect(coord.cz).toBe(-7)
    }),
  )

  it.effect('agrees with domain/constants.ts on the chunk width', () =>
    Effect.sync(() => {
      // The mirror consumes this constant rather than restating it; kernel's
      // `CHUNK_SIZE_XZ` is 16 too, and all three must stay one number.
      expect(CONSTANTS_CHUNK_SIZE_XZ).toBe(16)
    }),
  )

  it.effect('round-trips block <-> (chunk, local) including on the negative side', () =>
    Effect.sync(() => {
      // Kernel's stated invariant, `mc-kernel/domain/coordinates.ts:17`.
      for (const [x, y, z] of [
        [0, 0, 0],
        [15, 70, 15],
        [16, 70, 16],
        [-1, 12, -1],
        [-17, 250, -33],
        [1234, 5, -4321],
      ] as const) {
        const position = blockPosition(x, y, z)
        const back = blockPositionOfChunkLocal(chunkCoordOfBlock(position), localCoordOfBlock(position))
        expect(back).toStrictEqual(position)
      }
    }),
  )

  it.effect('normalises -0, so one chunk cannot have two map keys', () =>
    Effect.sync(() => {
      const negative = chunkCoordOfBlock(blockPosition(-1, 0, -1))
      expect(Object.is(negative.cx, -1)).toBe(true)

      const zero = chunkCoordOfBlock(blockPosition(-0, 0, -0))
      expect(Object.is(zero.cx, 0)).toBe(true)
      expect(Object.is(zero.cz, 0)).toBe(true)
      expect(`${zero.cx},${zero.cz}`).toBe('0,0')
    }),
  )

  it.effect('brands reject what kernel says they reject', () =>
    Effect.sync(() => {
      expect(() => BlockAxis(1.5)).toThrow()
      expect(() => ChunkAxis(Number.NaN)).toThrow()
      expect(() => LocalAxis(-1)).toThrow()
      expect(() => LocalAxis(CONSTANTS_CHUNK_SIZE_XZ)).toThrow()
      expect(LocalAxis(CONSTANTS_CHUNK_SIZE_XZ - 1)).toBe(15)
    }),
  )
})

describe('block ids match mc-kernel/domain/block-registry.ts', () => {
  /**
   * Kernel's assignment, transcribed from `BLOCK_REGISTRY`. These are the rows
   * kernel adopted FROM this repository, so the arrow of authorship runs the
   * other way from the rest of this file — but the agreement still has to be
   * checked, because either side can drift.
   */
  const KERNEL_IDS = {
    air: 0,
    bedrock: 1,
    stone: 2,
    dirt: 3,
    grass_block: 4,
    sand: 5,
    water: 6,
    snow: 7,
    gravel: 8,
    oak_log: 9,
    oak_leaves: 10,
    // The one row where the arrow of authorship runs kernel -> here. The eleven
    // above are this repository's numbering that kernel adopted; 40 is kernel's
    // and `domain/biome.ts` adopted it, so a drift on THIS row is this
    // repository's to fix. `mc-kernel/domain/block-registry.ts:1269`.
    obsidian: 40,
  } as const

  it.effect('assigns the same number to every block this generator writes', () =>
    Effect.sync(() => {
      expect(BLOCK.AIR).toBe(KERNEL_IDS.air)
      expect(BLOCK.BEDROCK).toBe(KERNEL_IDS.bedrock)
      expect(BLOCK.STONE).toBe(KERNEL_IDS.stone)
      expect(BLOCK.DIRT).toBe(KERNEL_IDS.dirt)
      // This repository's generation vocabulary is not kernel's `BlockType`
      // vocabulary: GRASS is `grass_block`, LOG is `oak_log`, LEAVES is
      // `oak_leaves`. The NUMBERS are what cross the boundary.
      expect(BLOCK.GRASS).toBe(KERNEL_IDS.grass_block)
      expect(BLOCK.SAND).toBe(KERNEL_IDS.sand)
      expect(BLOCK.WATER).toBe(KERNEL_IDS.water)
      expect(BLOCK.SNOW).toBe(KERNEL_IDS.snow)
      expect(BLOCK.GRAVEL).toBe(KERNEL_IDS.gravel)
      expect(BLOCK.LOG).toBe(KERNEL_IDS.oak_log)
      expect(BLOCK.LEAVES).toBe(KERNEL_IDS.oak_leaves)
      // Read by `domain/portal-frame.ts`, written by nothing yet. A wrong number
      // here does not corrupt a save the way the eleven above would — it makes
      // `detectNetherPortal` refuse every portal ever built, silently, because
      // the rule's failure mode is `Option.none()` and a portal that is not
      // there looks exactly like a portal that was not built.
      expect(BLOCK.OBSIDIAN).toBe(KERNEL_IDS.obsidian)
    }),
  )

  it.effect('leaves no id unaccounted for on this side', () =>
    Effect.sync(() => {
      // If a generator gains a block, this fails until the kernel row and the
      // transcription above are both updated.
      expect(Object.keys(BLOCK).length).toBe(Object.keys(KERNEL_IDS).length)
      expect(new Set(Object.values(BLOCK)).size).toBe(Object.keys(BLOCK).length)
    }),
  )

  /**
   * The ore and plant ids, which are NOT in `BLOCK` and are transcribed all the
   * same.
   *
   * They live in `domain/ore.ts` and `domain/vegetation.ts` rather than in
   * `BLOCK` because `BLOCK` is re-exported by `index.ts` and appears in
   * `api-lock.md`, and plan.md §6 Step 3 gates publication on that file being
   * unchanged for four weeks. That is a deliberate trade and it has a cost:
   * without this block, eleven ids that a generated chunk actually contains
   * would have no cross-check against kernel at all, and the `Object.keys`
   * count above — which is what catches an untranscribed addition to `BLOCK` —
   * cannot see them.
   *
   * The arrow of authorship runs kernel -> here for all eleven, like
   * `OBSIDIAN` and unlike the first eleven terrain ids. A drift on any of them
   * is this repository's to fix.
   */
  const KERNEL_DECORATION_IDS = {
    // `block-registry.ts:869` dandelion, `:889` poppy, `:949` tall_grass,
    // `:969` fern. All four are `opacity: 'transparentSolid'` there, which the
    // opacity table below already carries — so a flower casts no shadow.
    dandelion: 21,
    poppy: 22,
    tall_grass: 25,
    fern: 26,
    // `block-registry.ts:1367` .. `:1444`, the seven STONE-variant ores.
    // Kernel also assigns the deepslate twins 57-63; this repository generates
    // no deepslate stratum for them to sit in, so it writes none of them and
    // `domain/ore.ts` records the pair as one owed item.
    coal_ore: 50,
    iron_ore: 51,
    gold_ore: 52,
    diamond_ore: 53,
    redstone_ore: 54,
    lapis_ore: 55,
    emerald_ore: 56,
  } as const

  it.effect('assigns kernel’s number to every ore and plant this generator writes', () =>
    Effect.sync(() => {
      expect(PLANT.DANDELION).toBe(KERNEL_DECORATION_IDS.dandelion)
      expect(PLANT.POPPY).toBe(KERNEL_DECORATION_IDS.poppy)
      expect(PLANT.TALL_GRASS).toBe(KERNEL_DECORATION_IDS.tall_grass)
      expect(PLANT.FERN).toBe(KERNEL_DECORATION_IDS.fern)

      expect(ORE_BLOCK.COAL).toBe(KERNEL_DECORATION_IDS.coal_ore)
      expect(ORE_BLOCK.IRON).toBe(KERNEL_DECORATION_IDS.iron_ore)
      expect(ORE_BLOCK.GOLD).toBe(KERNEL_DECORATION_IDS.gold_ore)
      expect(ORE_BLOCK.DIAMOND).toBe(KERNEL_DECORATION_IDS.diamond_ore)
      expect(ORE_BLOCK.REDSTONE).toBe(KERNEL_DECORATION_IDS.redstone_ore)
      expect(ORE_BLOCK.LAPIS).toBe(KERNEL_DECORATION_IDS.lapis_ore)
      expect(ORE_BLOCK.EMERALD).toBe(KERNEL_DECORATION_IDS.emerald_ore)

      // Closed on this side too, so adding a generated id without transcribing
      // its kernel row fails here rather than in a save file.
      expect(Object.keys(PLANT).length + Object.keys(ORE_BLOCK).length).toBe(
        Object.keys(KERNEL_DECORATION_IDS).length,
      )
    }),
  )

  it.effect('keeps every generated id distinct across all three tables', () =>
    Effect.sync(() => {
      // `BLOCK`, `PLANT` and `ORE_BLOCK` are three separate tables that share
      // one byte-wide id space and one chunk buffer. Nothing but this checks
      // that they do not collide, and a collision would be a block that loads
      // as a different block — the save-format failure this whole file exists
      // to prevent, arriving by a route the `BLOCK`-only checks cannot see.
      const all = [...Object.values(BLOCK), ...Object.values(PLANT), ...Object.values(ORE_BLOCK)]
      expect(new Set(all).size).toBe(all.length)
    }),
  )

  /**
   * REDSTONE ORE EMITS 9, AND THIS FILE USED TO ASSERT THAT IT DID NOT.
   *
   * The test that stood here pinned `lightEmissionOfBlockId(REDSTONE)` to
   * `LIGHT_LEVEL_MIN` and added `.not.toBe(9)`, describing the gap as a column
   * 「this repository knowingly does not transcribe」 and as the CONSERVATIVE
   * direction. Both halves were wrong. Dark is the NON-conservative direction —
   * `docs/design-notes.md` DN-7 says so, because `hostile-spawn.ts` refuses a
   * spawn above light 7, so a cell read darker than it is permits a spawn the
   * real level forbids. And the gap was not knowing: kernel had seventeen
   * emitters against this mirror's three.
   *
   * So the assertion was not recording a divergence, it was holding one open —
   * a test that would have gone RED on the correct transcription. It is kept as
   * a note because a green test asserting a defect is worth naming once: the
   * emitting-set pin below is closed over kernel's whole range and would have
   * caught this on its own, had its expected value not been hand-written from
   * the same stale table it was checking.
   */
  it.effect('transcribes redstone ore’s emission of 9, which is kernel’s number', () =>
    Effect.sync(() => {
      // `block-registry.ts:1361-1363`. Nine rather than fifteen is the case a
      // boolean `emissive` could not express, which is why the column is a level.
      expect(lightEmissionOfBlockId(ORE_BLOCK.REDSTONE)).toBe(9)
      expect(lightEmissionOfBlockId(ORE_BLOCK.REDSTONE)).not.toBe(LIGHT_LEVEL_MIN)
    }),
  )

  it.effect('brands ids to the byte range the chunk buffer can hold', () =>
    Effect.sync(() => {
      expect(AIR_BLOCK_ID).toBe(0)
      expect(BLOCK_ID_MAX).toBe(255)
      expect(() => BlockId(-1)).toThrow()
      expect(() => BlockId(256)).toThrow()
      expect(() => BlockId(2.5)).toThrow()
    }),
  )
})

/**
 * The two PROPERTY columns, which are guarded here and nowhere else.
 *
 * `domain/kernel-vocabulary.ts`'s header names this gap rather than leaving it
 * to be found: mc-dev-meta's `pnpm check:mirrors` probes transcribed capability
 * FLAGS by importing kernel's `capabilityOfBlockId` and diffing all 256 ids, and
 * it has no property half. `lightEmission` and `opacity` are properties, so this
 * file is the whole of their defence.
 *
 * That is the weaker of the two guarantees available, and it is the same weaker
 * guarantee that let `replaceable` silently lose lava in mx-gameplay until the
 * cross-repository check was built. The rows below are therefore restated from
 * `mc-kernel/domain/block-registry.ts` WITH THEIR LINE NUMBERS, so that a
 * reviewer can check the transcription against the source without running
 * anything.
 */
describe('light columns match mc-kernel/domain/block-properties.ts', () => {
  /**
   * Every emitting row kernel has, with its level.
   *
   * Dumped from `mc-kernel/domain/block-registry.ts` rather than typed, for the
   * reason the previous version of this pin demonstrates: it swept the whole id
   * range correctly and still passed over fourteen missing emitters, because its
   * expected value — `[11, 14, 15]` — was hand-written from the very table it
   * was meant to be checking. A closed sweep against a hand-authored expectation
   * only proves the mirror agrees with itself.
   *
   * SEVEN DISTINCT LEVELS, which is the assertion that keeps the column a number:
   * 1 and 3 for the two `end_portal_frame` states, 7 for a redstone torch, 9 for
   * both redstone ores, 11 for the nether portal, 14 for a torch, 15 for the
   * rest.
   */
  const KERNEL_EMISSION_ROWS: ReadonlyArray<readonly [number, number]> = [
    [11, 15], // lava
    [14, 14], // torch
    [15, 15], // glowstone
    [44, 15], // amethyst_cluster
    [54, 9], // redstone_ore
    [61, 9], // deepslate_redstone_ore
    [68, 15], // redstone_block
    [75, 7], // redstone_torch
    [80, 15], // redstone_lamp_lit
    [87, 1], // end_portal_frame
    [88, 3], // end_portal_frame_filled
    [89, 15], // end_portal
    [94, 15], // end_gateway
    [95, 15], // end_rod
    [97, 15], // ender_chest
    [118, 11], // nether_portal
    [119, 15], // fire
  ]

  it.effect('transcribes every emitting row, and no others', () =>
    Effect.sync(() => {
      // `block-registry.ts:372` lava 15, `:422` torch 14, `:438` glowstone 15.
      // Kernel's audit §5: `EMISSIVE_LEVEL_OVERRIDES` in the reference already
      // made `emissive: boolean` a lie, which is why this is a number.
      expect(lightEmissionOfBlockId(11)).toBe(15) // lava
      expect(lightEmissionOfBlockId(14)).toBe(14) // torch
      expect(lightEmissionOfBlockId(15)).toBe(15) // glowstone

      // The one-level gap between torch and glowstone is the whole reason the
      // column is not a boolean. If a future edit flattens it, this fails.
      expect(lightEmissionOfBlockId(14)).not.toBe(lightEmissionOfBlockId(15))

      // Each row reads back, id AND level. Asserted as a pair so that a wrong
      // level fails as loudly as a missing row: a redstone torch transcribed at
      // 15 instead of 7 lights a corridor kernel leaves dim.
      for (const [id, level] of KERNEL_EMISSION_ROWS) {
        expect({ id, level: lightEmissionOfBlockId(id) }).toStrictEqual({ id, level })
      }

      // CLOSED, over kernel's whole assigned range and not just the rows above.
      // This is the direction that catches an eighteenth emitter added to kernel
      // and never transcribed here — the failure that actually happened, twice.
      const emitting: Array<readonly [number, number]> = []
      for (let id = 0; id <= BLOCK_ID_MAX; id += 1) {
        if (lightEmissionOfBlockId(id) > LIGHT_LEVEL_MIN) {
          emitting.push([id, lightEmissionOfBlockId(id)])
        }
      }
      expect(emitting).toStrictEqual(KERNEL_EMISSION_ROWS)

      // The levels kernel actually uses. A flattening edit that made every
      // emitter 15 would still satisfy a set-of-ids check; it fails here.
      expect(new Set(KERNEL_EMISSION_ROWS.map(([, level]) => level))).toStrictEqual(
        new Set([1, 3, 7, 9, 11, 14, 15]),
      )
    }),
  )

  it.effect('defaults emission to kernel’s LIGHT_LEVEL_MIN for everything else', () =>
    Effect.sync(() => {
      expect(LIGHT_LEVEL_MIN).toBe(0)
      expect(LIGHT_LEVEL_MAX).toBe(15)

      expect(lightEmissionOfBlockId(BLOCK.AIR)).toBe(LIGHT_LEVEL_MIN)
      expect(lightEmissionOfBlockId(BLOCK.STONE)).toBe(LIGHT_LEVEL_MIN)
      expect(lightEmissionOfBlockId(BLOCK.WATER)).toBe(LIGHT_LEVEL_MIN)
      // Total, exactly as `resolveBlockProperties` is for an id kernel cannot
      // name: an unknown byte is an ordinary opaque cube that emits nothing.
      expect(lightEmissionOfBlockId(200)).toBe(LIGHT_LEVEL_MIN)
    }),
  )

  it.effect('transcribes kernel’s three opacity classes, in kernel’s order', () =>
    Effect.sync(() => {
      // Order is plan.md §3.3's render priority, not an alphabetisation, and
      // mc-render consumes all three. A local two-value enum would have to be
      // widened on the day this is published.
      expect(BLOCK_OPACITIES).toStrictEqual(['transparentSolid', 'fluid', 'opaque'])
    }),
  )

  it.effect('gives AIR a transparentSolid opacity, which is kernel’s row and not an oversight', () =>
    Effect.sync(() => {
      // `block-registry.ts:218`. Air really is in kernel's non-opaque table
      // rather than being a fourth class, and the whole light grid depends on
      // it: an air row that fell through to the `'opaque'` default would make a
      // world in which no light travels at all.
      expect(opacityOfBlockId(BLOCK.AIR)).toBe('transparentSolid')
      expect(transmitsLight(BLOCK.AIR)).toBe(true)
    }),
  )

  /**
   * EVERY id kernel has assigned, not a sample of them.
   *
   * This test used to check five rows, and that is precisely how the mirror
   * came to hold six of kernel's twenty-four non-opaque rows without any gate
   * noticing: kernel's roster grew from 18 block literals to 36, eighteen of
   * the new rows were non-opaque, and a test that asserts only what it already
   * knows cannot fail on a row nobody transcribed. `./light.ts` was meanwhile
   * treating a ladder, a rail, a flower, a cactus and a stone slab as fully
   * light-blocking.
   *
   * AND THEN IT WENT STALE THE SAME WAY A SECOND TIME. The table was re-derived
   * to kernel's then-current 36 literals and stopped there, so when the roster
   * reached 120 it pinned 36 rows against 49 non-opaque ones and passed —
   * "closed at both ends" was only ever closed at the end the author knew about.
   * Ice, the three crops, the redstone wiring, the End blocks, the purpur slab
   * and stairs, both doors, the bed, the brewing stand, the nether portal and
   * fire were all read as opaque, all in the DARK direction.
   *
   * The table below is therefore DUMPED from `mc-kernel/domain/block-registry.ts`
   * rather than transcribed, and it carries every one of kernel's 120 assigned
   * ids — opaque rows included, so that the pin fails on a row that CHANGES class
   * as well as on one that is missing. The count assertions underneath are
   * derived from the table rather than restated, so they cannot drift from it.
   *
   * The cross-repository half now exists too: mc-dev-meta's `MIRROR_SPECS`
   * carries property probes for `opacityOfBlockId` and `lightEmissionOfBlockId`,
   * so `pnpm check:mirrors` diffs both columns against kernel id by id. That is
   * the stronger guarantee — it reads kernel, this file only reads itself.
   */
  const KERNEL_OPACITY_ROWS: ReadonlyArray<readonly [number, string]> = [
    [0, 'transparentSolid'], // air
    [1, 'opaque'], // bedrock
    [2, 'opaque'], // stone
    [3, 'opaque'], // dirt
    [4, 'opaque'], // grass_block
    [5, 'opaque'], // sand
    [6, 'fluid'], // water
    [7, 'opaque'], // snow
    [8, 'opaque'], // gravel
    [9, 'opaque'], // oak_log
    [10, 'transparentSolid'], // oak_leaves
    [11, 'fluid'], // lava
    [12, 'opaque'], // oak_planks
    [13, 'transparentSolid'], // glass
    [14, 'transparentSolid'], // torch
    [15, 'opaque'], // glowstone
    [16, 'opaque'], // piston
    [17, 'opaque'], // cobblestone
    [18, 'transparentSolid'], // ladder
    [19, 'transparentSolid'], // cobweb
    [20, 'transparentSolid'], // sapling
    [21, 'transparentSolid'], // dandelion
    [22, 'transparentSolid'], // poppy
    [23, 'transparentSolid'], // brown_mushroom
    [24, 'transparentSolid'], // red_mushroom
    [25, 'transparentSolid'], // tall_grass
    [26, 'transparentSolid'], // fern
    [27, 'transparentSolid'], // sugar_cane
    [28, 'transparentSolid'], // lily_pad
    [29, 'transparentSolid'], // kelp
    [30, 'transparentSolid'], // seagrass
    [31, 'transparentSolid'], // rail
    [32, 'transparentSolid'], // powered_rail
    [33, 'transparentSolid'], // cactus
    [34, 'transparentSolid'], // pressure_plate
    [35, 'transparentSolid'], // stone_slab
    [36, 'opaque'], // granite
    [37, 'opaque'], // diorite
    [38, 'opaque'], // andesite
    [39, 'opaque'], // deepslate
    [40, 'opaque'], // obsidian
    [41, 'opaque'], // smooth_basalt
    [42, 'opaque'], // calcite
    [43, 'opaque'], // amethyst_block
    [44, 'opaque'], // amethyst_cluster
    [45, 'opaque'], // sandstone
    [46, 'opaque'], // prismarine
    [47, 'opaque'], // soul_sand
    [48, 'transparentSolid'], // ice
    [49, 'opaque'], // farmland
    [50, 'opaque'], // coal_ore
    [51, 'opaque'], // iron_ore
    [52, 'opaque'], // gold_ore
    [53, 'opaque'], // diamond_ore
    [54, 'opaque'], // redstone_ore
    [55, 'opaque'], // lapis_ore
    [56, 'opaque'], // emerald_ore
    [57, 'opaque'], // deepslate_coal_ore
    [58, 'opaque'], // deepslate_iron_ore
    [59, 'opaque'], // deepslate_gold_ore
    [60, 'opaque'], // deepslate_diamond_ore
    [61, 'opaque'], // deepslate_redstone_ore
    [62, 'opaque'], // deepslate_lapis_ore
    [63, 'opaque'], // deepslate_emerald_ore
    [64, 'opaque'], // coal_block
    [65, 'opaque'], // iron_block
    [66, 'opaque'], // gold_block
    [67, 'opaque'], // diamond_block
    [68, 'opaque'], // redstone_block
    [69, 'opaque'], // lapis_block
    [70, 'opaque'], // emerald_block
    [71, 'transparentSolid'], // wheat_crop
    [72, 'transparentSolid'], // potato_crop
    [73, 'transparentSolid'], // nether_wart_crop
    [74, 'transparentSolid'], // redstone_wire
    [75, 'transparentSolid'], // redstone_torch
    [76, 'transparentSolid'], // lever
    [77, 'transparentSolid'], // stone_button
    [78, 'transparentSolid'], // repeater
    [79, 'opaque'], // redstone_lamp
    [80, 'opaque'], // redstone_lamp_lit
    [81, 'opaque'], // observer
    [82, 'opaque'], // comparator
    [83, 'opaque'], // dispenser
    [84, 'opaque'], // hopper
    [85, 'opaque'], // piston_head
    [86, 'opaque'], // end_stone
    [87, 'opaque'], // end_portal_frame
    [88, 'opaque'], // end_portal_frame_filled
    [89, 'transparentSolid'], // end_portal
    [90, 'transparentSolid'], // chorus_flower
    [91, 'transparentSolid'], // chorus_plant
    [92, 'transparentSolid'], // dragon_egg
    [93, 'transparentSolid'], // end_crystal
    [94, 'transparentSolid'], // end_gateway
    [95, 'transparentSolid'], // end_rod
    [96, 'opaque'], // end_stone_bricks
    [97, 'opaque'], // ender_chest
    [98, 'opaque'], // purpur_block
    [99, 'opaque'], // purpur_pillar
    [100, 'transparentSolid'], // purpur_slab
    [101, 'transparentSolid'], // purpur_stairs
    [102, 'opaque'], // shulker_box
    [103, 'opaque'], // crafting_table
    [104, 'opaque'], // furnace
    [105, 'opaque'], // chest
    [106, 'transparentSolid'], // door
    [107, 'transparentSolid'], // door_open
    [108, 'transparentSolid'], // oak_stairs
    [109, 'opaque'], // anvil
    [110, 'opaque'], // cauldron
    [111, 'opaque'], // water_cauldron
    [112, 'transparentSolid'], // bed
    [113, 'opaque'], // enchanting_table
    [114, 'transparentSolid'], // brewing_stand
    [115, 'opaque'], // tnt
    [116, 'opaque'], // nether_brick
    [117, 'opaque'], // netherrack
    [118, 'transparentSolid'], // nether_portal
    [119, 'transparentSolid'], // fire
  ]

  it.effect('transcribes kernel’s opacity for EVERY assigned id, not a sample of them', () =>
    Effect.sync(() => {
      for (const [id, opacity] of KERNEL_OPACITY_ROWS) {
        expect({ id, opacity: opacityOfBlockId(id) }).toStrictEqual({ id, opacity })
      }

      // Kernel gives `'fluid'` to water and lava and to nothing else. Spelled as
      // a closed set so that promoting some future block into the fluid bucket
      // has to be transcribed rather than absorbed.
      const fluids = KERNEL_OPACITY_ROWS.filter(([, opacity]) => opacity === 'fluid').map(([id]) => id)
      expect(fluids).toStrictEqual([6, 11])

      // The table covers kernel's WHOLE assigned range, contiguous from 0. This
      // is the assertion the previous version could not make: it stopped at 35
      // and had no way to say so. If kernel assigns id 120, this fails.
      expect(KERNEL_OPACITY_ROWS.map(([id]) => id)).toStrictEqual(
        KERNEL_OPACITY_ROWS.map((_row, index) => index),
      )
      expect(KERNEL_OPACITY_ROWS).toHaveLength(120)

      // 49 of kernel's 120 rows transmit light. The count is asserted because it
      // is the number that was wrong twice: this table held 6, then 24.
      expect(KERNEL_OPACITY_ROWS.filter(([id]) => transmitsLight(id))).toHaveLength(49)
    }),
  )

  it.effect('keeps the opaque default for ids kernel has not assigned', () =>
    Effect.sync(() => {
      // Kernel's `propertyOfBlockId` is TOTAL and falls back to
      // `BLOCK_PROPERTY_DEFAULTS.opacity`. This is the assertion that decides
      // the DIRECTION of the transcription: a mirror that listed the opaque
      // rows positively would have to answer non-opaque here, and would
      // disagree with kernel on every byte a newer build or a corrupt chunk
      // can produce.
      // 120 is the first id kernel has NOT assigned — the roster runs 0-119. It
      // used to be 36 here, which kernel has since assigned (`granite`), so
      // this assertion had quietly stopped testing the unassigned case at all.
      expect(opacityOfBlockId(120)).toBe('opaque')
      expect(opacityOfBlockId(200)).toBe('opaque')
      expect(opacityOfBlockId(BLOCK_ID_MAX)).toBe('opaque')
      expect(transmitsLight(200)).toBe(false)
    }),
  )

  it.effect('does not let light stand in for solidity — GLASS collides and still transmits', () =>
    Effect.sync(() => {
      // Kernel's audit §4.9 is a section about the five "non-solid" concepts
      // that disagree row by row. This mirror carries only the light column, so
      // the one thing it must not do is let a reader infer the others from it.
      // Glass transmits light and is not passable; a stone slab transmits light
      // and is a spawn surface; a cactus transmits light and damages you.
      expect(transmitsLight(13)).toBe(true) // glass
      expect(transmitsLight(33)).toBe(true) // cactus
      expect(transmitsLight(35)).toBe(true) // stone_slab

      // And the direction that actually bit: these are the rows the stale table
      // read as opaque, which is the DARK misreading DN-7 calls non-conservative.
      expect(transmitsLight(18)).toBe(true) // ladder
      expect(transmitsLight(31)).toBe(true) // rail
      expect(transmitsLight(21)).toBe(true) // dandelion
    }),
  )

  it.effect('GLOWSTONE IS OPAQUE AND STILL EMITS, which is the row that needs both columns', () =>
    Effect.sync(() => {
      // The case that proves the two columns are independent. Kernel gives
      // glowstone no `opacity` override, so it resolves to `'opaque'`, and gives
      // it `lightEmission: 15`. A transcription that inferred one from the other
      // — "emitters are transparent", or "opaque blocks are dark" — would get
      // this row wrong in whichever direction it guessed.
      expect(opacityOfBlockId(15)).toBe('opaque')
      expect(transmitsLight(15)).toBe(false)
      expect(lightEmissionOfBlockId(15)).toBe(15)
    }),
  )

  it.effect('clamps into the 4-bit range at both ends, like kernel’s clampLightLevel', () =>
    Effect.sync(() => {
      expect(clampLightLevel(-1)).toBe(0)
      expect(clampLightLevel(0)).toBe(0)
      expect(clampLightLevel(15)).toBe(15)
      expect(clampLightLevel(16)).toBe(15)
      // `Math.trunc`, so a fractional level from a save file becomes an integer
      // rather than a nibble that reads back as something else.
      expect(clampLightLevel(7.9)).toBe(7)
    }),
  )
})
