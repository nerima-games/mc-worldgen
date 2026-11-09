import { BLOCK, type ChunkBiomeType } from './biome.js'
import { type BlockId, type ChunkCoord, blockIdOf } from '@nerima-games/mc-kernel'
import { Brand, Option } from 'effect'
import {
  CHUNK_HEIGHT,
  CHUNK_SIZE_XZ,
  DEEPSLATE_CEILING,
  blockIndex,
} from './constants.js'
import { type NoiseSeed, mulberry32 } from '@nerima-games/mc-noise'
import type { BiomeType } from '@nerima-games/mc-kernel/domain/biome'
import { channelSeed } from './noise-compatibility.js'
import { readBlock } from './chunk.js'

/** The ten vanilla mountain biomes used by the emerald feature. */
export const EMERALD_MOUNTAIN_BIOME_IDS: ReadonlyArray<BiomeType> = [
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
]

const EMERALD_MOUNTAIN_BIOME_SET: ReadonlySet<string> = new Set(EMERALD_MOUNTAIN_BIOME_IDS)
const BADLANDS_BIOME_IDS = ['badlands', 'eroded_badlands', 'wooded_badlands'] as const satisfies ReadonlyArray<BiomeType>
const BADLANDS_BIOME_SET: ReadonlySet<string> = new Set(BADLANDS_BIOME_IDS)
const DRIPSTONE_CAVES_BIOME_ID: BiomeType = 'dripstone_caves'

/** The ore ids, transcribed from the kernel block registry. */
export const ORE_BLOCK: Readonly<
  Record<'COAL' | 'COPPER' | 'DIAMOND' | 'EMERALD' | 'GOLD' | 'IRON' | 'LAPIS' | 'REDSTONE', BlockId>
> = {
  COAL: Option.getOrThrow(blockIdOf('coal_ore')),
  COPPER: Option.getOrThrow(blockIdOf('copper_ore')),
  DIAMOND: Option.getOrThrow(blockIdOf('diamond_ore')),
  EMERALD: Option.getOrThrow(blockIdOf('emerald_ore')),
  GOLD: Option.getOrThrow(blockIdOf('gold_ore')),
  IRON: Option.getOrThrow(blockIdOf('iron_ore')),
  LAPIS: Option.getOrThrow(blockIdOf('lapis_ore')),
  REDSTONE: Option.getOrThrow(blockIdOf('redstone_ore')),
} as const

export const DEEPSLATE_ORE_BLOCK: Readonly<
  Record<'COAL' | 'COPPER' | 'DIAMOND' | 'EMERALD' | 'GOLD' | 'IRON' | 'LAPIS' | 'REDSTONE', BlockId>
> = {
  COAL: Option.getOrThrow(blockIdOf('deepslate_coal_ore')),
  COPPER: Option.getOrThrow(blockIdOf('deepslate_copper_ore')),
  DIAMOND: Option.getOrThrow(blockIdOf('deepslate_diamond_ore')),
  EMERALD: Option.getOrThrow(blockIdOf('deepslate_emerald_ore')),
  GOLD: Option.getOrThrow(blockIdOf('deepslate_gold_ore')),
  IRON: Option.getOrThrow(blockIdOf('deepslate_iron_ore')),
  LAPIS: Option.getOrThrow(blockIdOf('deepslate_lapis_ore')),
  REDSTONE: Option.getOrThrow(blockIdOf('deepslate_redstone_ore')),
} as const

export type OreName = keyof typeof ORE_BLOCK

/** Every id this module can write. */
export const ORE_IDS: ReadonlyArray<number> = [
  ...Object.values(ORE_BLOCK),
  ...Object.values(DEEPSLATE_ORE_BLOCK),
]

type OreTarget = Readonly<{
  host: BlockId
  ore: BlockId
}>

const oreTargetAt = (name: OreName, y: number): OreTarget => {
  if (y < DEEPSLATE_CEILING) {
    return { host: BLOCK.DEEPSLATE, ore: DEEPSLATE_ORE_BLOCK[name] }
  }
  return { host: BLOCK.STONE, ore: ORE_BLOCK[name] }
}

const WORLD_MIN_Y = 0
const LAST_BLOCK_OFFSET = 1
/** `CHUNK_HEIGHT` is a count, so this is the highest addressable Y cell. */
export const ORE_MAX_Y: number = CHUNK_HEIGHT - LAST_BLOCK_OFFSET
/** The generated buffer begins at Y=0; negative vanilla levels are clipped. */
export const ORE_MIN_Y_FLOOR: number = WORLD_MIN_Y

export type OreDistribution = 'uniform' | 'trapezoid'
type OreBiomeRule = 'badlands' | 'dripstone-caves' | 'mountain' | 'not-dripstone-caves'
type OreFeature =
  | 'coal-lower' | 'coal-upper'
  | 'iron-small' | 'iron-middle' | 'iron-upper'
  | 'copper-small' | 'copper-large'
  | 'redstone' | 'redstone-lower'
  | 'lapis' | 'lapis-buried'
  | 'gold' | 'gold-lower' | 'gold-extra'
  | 'diamond-small' | 'diamond-buried' | 'diamond-large' | 'diamond-medium'
  | 'emerald'

export type OreConfig = {
  /** Vanilla placed-feature name, also used to derive an independent stream. */
  readonly feature: OreFeature
  readonly name: OreName
  /** Vanilla absolute Y bounds, inclusive. Runtime clips them to the chunk buffer. */
  readonly minY: number
  readonly maxY: number
  readonly distribution: OreDistribution
  /** The trapezoid provider's flat center span; vanilla's listed features use 0. */
  readonly plateau?: number
  /** Attempts per chunk; fractional values model vanilla count/rarity providers. */
  readonly attemptsPerChunk: number
  /** Vanilla configured-feature ore size. */
  readonly size: number
  readonly biomeRule?: OreBiomeRule
}

/**
 * Java Edition ore feature settings from minecraft.wiki's Ore (feature) table
 * and placed/configured feature data. The upper coal feature's
 * `below_top: 0` ceiling is Y=319 in the 320-high Overworld. This chunk format
 * stores only Y=0..255, so `placeOres` intersects each listed range with that
 * addressable interval; the source values remain intact here for review.
 */
/* eslint-disable no-magic-numbers -- These literals are the vanilla feature table. */
export const ORE_CONFIGS: ReadonlyArray<OreConfig> = [
  { attemptsPerChunk: 20, distribution: 'trapezoid', feature: 'coal-lower', maxY: 192, minY: 0, name: 'COAL', plateau: 0, size: 17 },
  { attemptsPerChunk: 30, distribution: 'uniform', feature: 'coal-upper', maxY: 319, minY: 136, name: 'COAL', size: 17 },
  { attemptsPerChunk: 10, distribution: 'uniform', feature: 'iron-small', maxY: 72, minY: -64, name: 'IRON', size: 4 },
  { attemptsPerChunk: 10, distribution: 'trapezoid', feature: 'iron-middle', maxY: 56, minY: -24, name: 'IRON', plateau: 0, size: 9 },
  { attemptsPerChunk: 90, distribution: 'trapezoid', feature: 'iron-upper', maxY: 384, minY: 80, name: 'IRON', plateau: 0, size: 9 },
  { attemptsPerChunk: 16, biomeRule: 'not-dripstone-caves', distribution: 'trapezoid', feature: 'copper-small', maxY: 112, minY: -16, name: 'COPPER', plateau: 0, size: 10 },
  { attemptsPerChunk: 16, biomeRule: 'dripstone-caves', distribution: 'trapezoid', feature: 'copper-large', maxY: 112, minY: -16, name: 'COPPER', plateau: 0, size: 20 },
  { attemptsPerChunk: 4, distribution: 'uniform', feature: 'redstone', maxY: 15, minY: -64, name: 'REDSTONE', size: 8 },
  { attemptsPerChunk: 8, distribution: 'trapezoid', feature: 'redstone-lower', maxY: -32, minY: -64, name: 'REDSTONE', plateau: 0, size: 8 },
  { attemptsPerChunk: 2, distribution: 'trapezoid', feature: 'lapis', maxY: 32, minY: -32, name: 'LAPIS', plateau: 0, size: 7 },
  { attemptsPerChunk: 4, distribution: 'uniform', feature: 'lapis-buried', maxY: 64, minY: -64, name: 'LAPIS', size: 7 },
  { attemptsPerChunk: 4, distribution: 'trapezoid', feature: 'gold', maxY: 32, minY: -64, name: 'GOLD', plateau: 0, size: 9 },
  { attemptsPerChunk: 0.5, distribution: 'uniform', feature: 'gold-lower', maxY: -48, minY: -64, name: 'GOLD', size: 9 },
  { attemptsPerChunk: 50, biomeRule: 'badlands', distribution: 'uniform', feature: 'gold-extra', maxY: 256, minY: 32, name: 'GOLD', size: 9 },
  { attemptsPerChunk: 7, distribution: 'trapezoid', feature: 'diamond-small', maxY: 16, minY: -64, name: 'DIAMOND', plateau: 0, size: 4 },
  { attemptsPerChunk: 4, distribution: 'trapezoid', feature: 'diamond-buried', maxY: 16, minY: -64, name: 'DIAMOND', plateau: 0, size: 8 },
  { attemptsPerChunk: 1 / 9, distribution: 'trapezoid', feature: 'diamond-large', maxY: 16, minY: -64, name: 'DIAMOND', plateau: 0, size: 12 },
  { attemptsPerChunk: 2, distribution: 'uniform', feature: 'diamond-medium', maxY: -4, minY: -64, name: 'DIAMOND', size: 8 },
  { attemptsPerChunk: 100, biomeRule: 'mountain', distribution: 'trapezoid', feature: 'emerald', maxY: 480, minY: -16, name: 'EMERALD', plateau: 0, size: 3 },
]
/* eslint-enable no-magic-numbers */

/**
 * The per-feature, per-chunk stream seed. World seed, chunk origin, and feature
 * name are all included so independent features and adjacent chunks diverge.
 */
const INT32_ZERO = 0
const WORLD_X_MIX_PRIME = 0x27d4eb2d
const WORLD_Z_MIX_PRIME = 0x85ebca6b
const FINALIZE_MIX_PRIME_1 = 0x7feb352d
const FINALIZE_MIX_SHIFT_1 = 16
const FINALIZE_MIX_PRIME_2 = 0x846ca68b
const FINALIZE_MIX_SHIFT_2 = 15
const FINALIZE_MIX_SHIFT_3 = 16
const noiseSeedFromUint32 = Brand.nominal<NoiseSeed>()

export const oreStreamSeed = (seed: NoiseSeed, config: OreConfig, baseWorldX: number, baseWorldZ: number): NoiseSeed => {
  let hash: number = channelSeed(seed, `ore-${config.feature}`)
  hash = (Math.imul(baseWorldX | INT32_ZERO, WORLD_X_MIX_PRIME) ^ Math.imul(baseWorldZ | INT32_ZERO, WORLD_Z_MIX_PRIME) ^ hash) >>> INT32_ZERO
  hash = Math.imul(hash ^ (hash >>> FINALIZE_MIX_SHIFT_1), FINALIZE_MIX_PRIME_1) >>> INT32_ZERO
  hash = Math.imul(hash ^ (hash >>> FINALIZE_MIX_SHIFT_2), FINALIZE_MIX_PRIME_2) >>> INT32_ZERO
  return noiseSeedFromUint32((hash ^ (hash >>> FINALIZE_MIX_SHIFT_3)) >>> INT32_ZERO)
}

const MIN_SPAN = 0
const INCLUSIVE_RANGE_ADJUSTMENT = 1
const TRAPEZOID_SAMPLE_COUNT = 2

const sampleUniformOreY = (yMin: number, span: number, next: () => number): number => {
  const width = span + INCLUSIVE_RANGE_ADJUSTMENT
  const offset = Math.floor(next() * width)
  return yMin + offset
}

const sampleTrapezoidOreY = (
  config: OreConfig,
  yMin: number,
  span: number,
  next: () => number,
): number => {
  const plateau = config.plateau ?? MIN_SPAN
  const plateauStart = Math.floor((span - plateau) / TRAPEZOID_SAMPLE_COUNT)
  const plateauEnd = span - plateauStart
  const first = Math.floor(next() * (plateauEnd + INCLUSIVE_RANGE_ADJUSTMENT))
  const second = Math.floor(next() * (plateauStart + INCLUSIVE_RANGE_ADJUSTMENT))
  return yMin + first + second
}

/** Draw one Y using the vanilla uniform or trapezoid height provider. */
export const sampleOreY = (config: OreConfig, yMin: number, yMax: number, next: () => number): number => {
  const span = yMax - yMin
  if (span <= MIN_SPAN) {
    return yMin
  }

  if (config.distribution === 'uniform') {
    return sampleUniformOreY(yMin, span, next)
  }

  return sampleTrapezoidOreY(config, yMin, span, next)
}

const CELL_COMPONENT_COUNT = 3
const Y_COMPONENT_OFFSET = 1
const Z_COMPONENT_OFFSET = 2
const MIN_LOCAL_COORD = 0
const COUNT_STEP = 1
const EMPTY_STACK_LENGTH = 0
const NEIGHBOR_OFFSET = 1

type VeinCandidate = {
  readonly cx: number
  readonly cy: number
  readonly cz: number
}

type DepthBand = {
  readonly yMin: number
  readonly yMax: number
}

const readPackedCell = (stack: Array<number>, base: number): VeinCandidate => {
  const values = stack.slice(base, base + CELL_COMPONENT_COUNT)
  const componentAt = (componentIndex: number): number => Option.getOrThrow(Option.fromNullishOr(values[componentIndex]))
  return { cx: componentAt(MIN_LOCAL_COORD), cy: componentAt(Y_COMPONENT_OFFSET), cz: componentAt(Z_COMPONENT_OFFSET) }
}

const swapRemoveCell = (stack: Array<number>, pickIndex: number): void => {
  const lastBase = stack.length - CELL_COMPONENT_COUNT
  if (pickIndex !== lastBase) {
    const last = readPackedCell(stack, lastBase)
    stack[pickIndex] = last.cx
    stack[pickIndex + Y_COMPONENT_OFFSET] = last.cy
    stack[pickIndex + Z_COMPONENT_OFFSET] = last.cz
  }
  stack.length = lastBase
}

const popRandomCandidate = (stack: Array<number>, next: () => number): VeinCandidate => {
  const pickIndex = Math.floor(next() * (stack.length / CELL_COMPONENT_COUNT)) * CELL_COMPONENT_COUNT
  const candidate = readPackedCell(stack, pickIndex)
  swapRemoveCell(stack, pickIndex)
  return candidate
}

const isWithinChunkBounds = (cx: number, cz: number): boolean =>
  cx >= MIN_LOCAL_COORD && cx < CHUNK_SIZE_XZ && cz >= MIN_LOCAL_COORD && cz < CHUNK_SIZE_XZ

const isWithinDepthBand = (cy: number, band: DepthBand): boolean => cy >= band.yMin && cy <= band.yMax

type NullableColumns = ReadonlyArray<boolean> | null

const isAllowedColumn = (columns: NullableColumns, cx: number, cz: number): boolean => {
  if (columns === null) {
    return true
  }
  const index = cz * CHUNK_SIZE_XZ + cx
  return columns[index] === true
}

const tryPlaceOreAt = (
  blocks: Uint16Array,
  candidate: VeinCandidate,
  target: OreTarget,
  band: DepthBand,
  allowedColumns: NullableColumns,
): boolean => {
  const { cx, cy, cz } = candidate
  if (!isWithinChunkBounds(cx, cz) || !isWithinDepthBand(cy, band) || !isAllowedColumn(allowedColumns, cx, cz)) {
    return false
  }

  const index = blockIndex(cx, cy, cz)
  if (readBlock(blocks, index) !== target.host) {
    return false
  }

  blocks[index] = target.ore
  return true
}

const pushNeighbors = (stack: Array<number>, candidate: VeinCandidate): void => {
  const { cx, cy, cz } = candidate
  stack.push(cx + NEIGHBOR_OFFSET, cy, cz)
  stack.push(cx - NEIGHBOR_OFFSET, cy, cz)
  stack.push(cx, cy + NEIGHBOR_OFFSET, cz)
  stack.push(cx, cy - NEIGHBOR_OFFSET, cz)
  stack.push(cx, cy, cz + NEIGHBOR_OFFSET)
  stack.push(cx, cy, cz - NEIGHBOR_OFFSET)
}

type OreTargetResolver = (y: number) => OreTarget

export type GrowVeinOptions = {
  readonly blocks: Uint16Array
  readonly seedX: number
  readonly seedY: number
  readonly seedZ: number
  readonly targetSize: number
  readonly host: BlockId
  readonly ore: BlockId
  readonly yMin: number
  readonly yMax: number
  readonly next: () => number
  readonly allowedColumns?: ReadonlyArray<boolean>
  readonly resolveTargetAtY?: OreTargetResolver
}

type GrowVeinRuntimeOptions = Omit<GrowVeinOptions, 'allowedColumns' | 'resolveTargetAtY'> & {
  readonly allowedColumns: NullableColumns
  readonly resolveTargetAtY: OreTargetResolver | null
}

const targetForCandidate = (
  candidate: VeinCandidate,
  host: BlockId,
  ore: BlockId,
  resolver: OreTargetResolver | null,
): OreTarget => {
  if (resolver === null) {
    return { host, ore }
  }
  return resolver(candidate.cy)
}

const growVeinStep = (options: GrowVeinRuntimeOptions, stack: Array<number>): boolean => {
  const candidate = popRandomCandidate(stack, options.next)
  const target = targetForCandidate(candidate, options.host, options.ore, options.resolveTargetAtY)
  const band: DepthBand = { yMax: options.yMax, yMin: options.yMin }
  if (!tryPlaceOreAt(options.blocks, candidate, target, band, options.allowedColumns)) {
    return false
  }
  pushNeighbors(stack, candidate)
  return true
}

const growVeinInternal = (options: GrowVeinRuntimeOptions): number => {
  let placed = 0
  const stack: Array<number> = [options.seedX, options.seedY, options.seedZ]
  while (placed < options.targetSize && stack.length > EMPTY_STACK_LENGTH) {
    if (growVeinStep(options, stack)) {
      placed += COUNT_STEP
    }
  }
  return placed
}

/** Grow a deterministic random-walk blob, replacing only the configured host. */
export const growVein = (options: GrowVeinOptions): number => growVeinInternal({
  ...options,
  allowedColumns: options.allowedColumns ?? null,
  resolveTargetAtY: options.resolveTargetAtY ?? null,
})

const isBiomeAllowed = (config: OreConfig, biome: ChunkBiomeType | undefined): boolean => {
  const biomeRule = Option.fromNullishOr(config.biomeRule)
  if (Option.isNone(biomeRule)) {
    return true
  }

  const biomeValue = Option.fromNullishOr(biome)
  if (Option.isNone(biomeValue)) {
    return false
  }

  const biomeId: string = biomeValue.value
  switch (biomeRule.value) {
    case 'badlands':
      return BADLANDS_BIOME_SET.has(biomeId)
    case 'dripstone-caves':
      return biomeId === DRIPSTONE_CAVES_BIOME_ID
    case 'mountain':
      return EMERALD_MOUNTAIN_BIOME_SET.has(biomeId)
    case 'not-dripstone-caves':
      return biomeId !== DRIPSTONE_CAVES_BIOME_ID
    default:
      return false
  }
}

const biomeColumnIndex = (x: number, z: number): number => z * CHUNK_SIZE_XZ + x

const mountainColumnsFor = (biomes: ReadonlyArray<ChunkBiomeType>): ReadonlyArray<boolean> => {
  const columns: Array<boolean> = []
  for (let index = 0; index < CHUNK_SIZE_XZ * CHUNK_SIZE_XZ; index += COUNT_STEP) {
    const biome = Option.fromNullishOr(biomes[index])
    columns.push(Option.isSome(biome) && EMERALD_MOUNTAIN_BIOME_SET.has(biome.value))
  }
  return columns
}

const sampleAttemptCount = (config: OreConfig, next: () => number): number => {
  const wholeAttempts = Math.floor(config.attemptsPerChunk)
  const fractionalAttempt = config.attemptsPerChunk - wholeAttempts
  if (fractionalAttempt === MIN_SPAN) {
    return wholeAttempts
  }
  if (next() < fractionalAttempt) {
    return wholeAttempts + COUNT_STEP
  }
  return wholeAttempts
}

type PlaceVeinOptions = {
  readonly blocks: Uint16Array
  readonly config: OreConfig
  readonly seedX: number
  readonly seedY: number
  readonly seedZ: number
  readonly yMin: number
  readonly yMax: number
  readonly next: () => number
  readonly allowedColumns: NullableColumns
}

const placeVein = ({ blocks, config, seedX, seedY, seedZ, yMin, yMax, next, allowedColumns }: PlaceVeinOptions): void => {
  const target = oreTargetAt(config.name, seedY)
  if (readBlock(blocks, blockIndex(seedX, seedY, seedZ)) !== target.host) {
    return
  }

  growVeinInternal({
    allowedColumns,
    blocks,
    host: target.host,
    next,
    ore: target.ore,
    resolveTargetAtY: (y) => oreTargetAt(config.name, y),
    seedX,
    seedY,
    seedZ,
    targetSize: config.size,
    yMax,
    yMin,
  })
}

type PlaceOreFeatureOptions = {
  readonly blocks: Uint16Array
  readonly biomes: ReadonlyArray<ChunkBiomeType>
  readonly config: OreConfig
  readonly emeraldColumns: ReadonlyArray<boolean>
  readonly baseWorldX: number
  readonly baseWorldZ: number
  readonly seed: NoiseSeed
}

type PlaceOreAttemptOptions = {
  readonly blocks: Uint16Array
  readonly biomes: ReadonlyArray<ChunkBiomeType>
  readonly config: OreConfig
  readonly allowedColumns: NullableColumns
  readonly next: () => number
  readonly yMin: number
  readonly yMax: number
}

const allowedColumnsFor = (config: OreConfig, emeraldColumns: ReadonlyArray<boolean>): NullableColumns => {
  if (config.name === 'EMERALD') {
    return emeraldColumns
  }
  return null
}

const placeOreAttempt = ({ blocks, biomes, config, allowedColumns, next, yMin, yMax }: PlaceOreAttemptOptions): void => {
  const seedX = Math.floor(next() * CHUNK_SIZE_XZ)
  const seedY = sampleOreY(config, config.minY, config.maxY, next)
  const seedZ = Math.floor(next() * CHUNK_SIZE_XZ)
  if (seedY < ORE_MIN_Y_FLOOR || seedY > ORE_MAX_Y || yMax < yMin) {
    return
  }

  const biome = biomes[biomeColumnIndex(seedX, seedZ)]
  if (isBiomeAllowed(config, biome)) {
    placeVein({ allowedColumns, blocks, config, next, seedX, seedY, seedZ, yMax, yMin })
  }
}

const placeOreFeature = ({ blocks, biomes, config, emeraldColumns, baseWorldX, baseWorldZ, seed }: PlaceOreFeatureOptions): void => {
  const yMin = Math.max(config.minY, ORE_MIN_Y_FLOOR)
  const yMax = Math.min(config.maxY, ORE_MAX_Y)
  const next = mulberry32(oreStreamSeed(seed, config, baseWorldX, baseWorldZ))
  const attempts = sampleAttemptCount(config, next)
  const allowedColumns = allowedColumnsFor(config, emeraldColumns)
  for (let attempt = 0; attempt < attempts; attempt += COUNT_STEP) {
    placeOreAttempt({ allowedColumns, biomes, blocks, config, next, yMax, yMin })
  }
}

/** Place all vanilla ore-feature attempts for one chunk, in place. */
export const placeOres = (
  blocks: Uint16Array,
  seed: NoiseSeed,
  coord: ChunkCoord,
  biomes: ReadonlyArray<ChunkBiomeType>,
): void => {
  const baseWorldX = coord.cx * CHUNK_SIZE_XZ
  const baseWorldZ = coord.cz * CHUNK_SIZE_XZ
  const emeraldColumns = mountainColumnsFor(biomes)
  for (const config of ORE_CONFIGS) {
    placeOreFeature({ baseWorldX, baseWorldZ, biomes, blocks, config, emeraldColumns, seed })
  }
}
