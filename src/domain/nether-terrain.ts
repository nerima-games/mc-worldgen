/** Deterministic, absolute-coordinate terrain generation for the Nether. */
import { BlockId, type ChunkCoord, chunkCoord } from '@nerima-games/mc-kernel'
import { CHUNK_HEIGHT, CHUNK_SIZE_XZ, blockIndex } from './constants'
import { type Chunk, emptyBlocks, worldX, worldZ } from './chunk'
import {
  type NaturalStructureChunk,
  type NaturalStructurePosition,
  type NetherStructureTerrainSample,
  applyNaturalStructurePlansToChunk,
  naturalStructurePlansForChunk,
} from './natural-structure'
import { channelSeed, fbm2D, latticeValue } from './seeded-random'

/** Advances a loop counter, or steps to the adjacent lattice point, by one unit. */
const UNIT_STEP = 1

const NETHER_AIR_ID = 0
const NETHER_BEDROCK_ID = 1
const NETHER_LAVA_ID = 11
const NETHER_NETHERRACK_ID = 117
const NETHER_SOUL_SAND_ID = 47

export const NETHER_BLOCK = Object.freeze({
  AIR: BlockId(NETHER_AIR_ID),
  BEDROCK: BlockId(NETHER_BEDROCK_ID),
  LAVA: BlockId(NETHER_LAVA_ID),
  NETHERRACK: BlockId(NETHER_NETHERRACK_ID),
  SOUL_SAND: BlockId(NETHER_SOUL_SAND_ID),
})

export const NETHER_LAVA_LEVEL = 31

/** The classic Hermite smoothstep polynomial: 3t² - 2t³. */
const SMOOTHSTEP_QUADRATIC_COEFFICIENT = 3
const SMOOTHSTEP_CUBIC_COEFFICIENT = 2
const smoothstep = (value: number): number =>
  value * value * (SMOOTHSTEP_QUADRATIC_COEFFICIENT - SMOOTHSTEP_CUBIC_COEFFICIENT * value)

const interpolate = (left: number, right: number, amount: number): number => left + (right - left) * amount

const latticeValue3D = (seed: number, x: number, y: number, z: number): number =>
  latticeValue(channelSeed(seed, `nether-y:${String(y)}`), x, z)

/** The scaled lattice cell a sample position falls in, and its smoothstep weight within it. */
type ScaledLatticeCell = {
  readonly tx: number
  readonly ty: number
  readonly tz: number
  readonly x0: number
  readonly y0: number
  readonly z0: number
}

const scaledLatticeCell = (position: NaturalStructurePosition, frequency: number): ScaledLatticeCell => {
  const sx = position.x * frequency
  const sy = position.y * frequency
  const sz = position.z * frequency
  const x0 = Math.floor(sx)
  const y0 = Math.floor(sy)
  const z0 = Math.floor(sz)
  return { tx: smoothstep(sx - x0), ty: smoothstep(sy - y0), tz: smoothstep(sz - z0), x0, y0, z0 }
}

const valueNoise3D = (seed: number, position: NaturalStructurePosition, frequency: number): number => {
  const { tx, ty, tz, x0, y0, z0 } = scaledLatticeCell(position, frequency)
  const plane = (iy: number): number => {
    const north = interpolate(latticeValue3D(seed, x0, iy, z0), latticeValue3D(seed, x0 + UNIT_STEP, iy, z0), tx)
    const south = interpolate(
      latticeValue3D(seed, x0, iy, z0 + UNIT_STEP),
      latticeValue3D(seed, x0 + UNIT_STEP, iy, z0 + UNIT_STEP),
      tx,
    )
    return interpolate(north, south, tz)
  }
  return interpolate(plane(y0), plane(y0 + UNIT_STEP), ty)
}

const NOISE_FREQUENCY_UNIT = 1
const NETHER_DENSITY_BROAD_WAVELENGTH = 48
const NETHER_DENSITY_DETAIL_WAVELENGTH = 20
const NETHER_FLOOR_NOISE_WAVELENGTH = 80
const NETHER_CEILING_NOISE_WAVELENGTH = 96
const NETHER_DENSITY_BROAD_FREQUENCY = NOISE_FREQUENCY_UNIT / NETHER_DENSITY_BROAD_WAVELENGTH
const NETHER_DENSITY_DETAIL_FREQUENCY = NOISE_FREQUENCY_UNIT / NETHER_DENSITY_DETAIL_WAVELENGTH
const NETHER_FLOOR_NOISE_FREQUENCY = NOISE_FREQUENCY_UNIT / NETHER_FLOOR_NOISE_WAVELENGTH
const NETHER_CEILING_NOISE_FREQUENCY = NOISE_FREQUENCY_UNIT / NETHER_CEILING_NOISE_WAVELENGTH

const NETHER_FLOOR_BASE_Y = 35
const NETHER_FLOOR_NOISE_AMPLITUDE = 22
const NETHER_CEILING_BASE_Y = 116
const NETHER_CEILING_NOISE_AMPLITUDE = 26
/** `fbm2D` returns [0, 1]; subtracting this centers its output on 0. */
const NETHER_NOISE_BIAS = 0.5

const NETHER_SHELL_FALLOFF_DISTANCE = 10
const NETHER_SHELL_MID_VALUE = -0.35

const netherShellAt = (y: number, floor: number, ceiling: number): number => {
  if (y <= floor) {
    return (floor - y) / NETHER_SHELL_FALLOFF_DISTANCE
  }
  if (y >= ceiling) {
    return (y - ceiling) / NETHER_SHELL_FALLOFF_DISTANCE
  }
  return NETHER_SHELL_MID_VALUE
}

const NETHER_DENSITY_BROAD_WEIGHT = 0.65
const NETHER_DENSITY_DETAIL_WEIGHT = 0.35

const netherDensityAt = (seed: number, x: number, y: number, z: number): number => {
  const position = { x, y, z }
  const broad = valueNoise3D(channelSeed(seed, 'nether-density-broad'), position, NETHER_DENSITY_BROAD_FREQUENCY)
  const detail = valueNoise3D(channelSeed(seed, 'nether-density-detail'), position, NETHER_DENSITY_DETAIL_FREQUENCY)
  const floor = NETHER_FLOOR_BASE_Y + (fbm2D(channelSeed(seed, 'nether-floor'), x, z, {
    frequency: NETHER_FLOOR_NOISE_FREQUENCY, octaves: 3, persistence: 0.5,
  }) - NETHER_NOISE_BIAS) * NETHER_FLOOR_NOISE_AMPLITUDE
  const ceiling = NETHER_CEILING_BASE_Y + (fbm2D(channelSeed(seed, 'nether-ceiling'), x, z, {
    frequency: NETHER_CEILING_NOISE_FREQUENCY, octaves: 3, persistence: 0.5,
  }) - NETHER_NOISE_BIAS) * NETHER_CEILING_NOISE_AMPLITUDE
  const shell = netherShellAt(y, floor, ceiling)
  return broad * NETHER_DENSITY_BROAD_WEIGHT + detail * NETHER_DENSITY_DETAIL_WEIGHT + shell
}

const NETHER_BEDROCK_BASE_THICKNESS = 1
const NETHER_BEDROCK_THICKNESS_VARIATION = 5

const bedrockChannelName = (top: boolean): string => {
  if (top) {
    return 'nether-bedrock-top'
  }
  return 'nether-bedrock-bottom'
}

const bedrockThicknessAt = (seed: number, x: number, z: number, top: boolean): number =>
  NETHER_BEDROCK_BASE_THICKNESS +
  Math.floor(latticeValue(channelSeed(seed, bedrockChannelName(top)), x, z) * NETHER_BEDROCK_THICKNESS_VARIATION)

const netherFluidOrAirAt = (y: number): BlockId => {
  if (y <= NETHER_LAVA_LEVEL) {
    return NETHER_BLOCK.LAVA
  }
  return NETHER_BLOCK.AIR
}

const NETHER_WORLD_MIN_Y = 0
const NETHER_SOLID_DENSITY_THRESHOLD = 0.55
const NETHER_SOUL_SAND_CHANCE = 0.16

/** Authoritative block query shared by generation and structure siting. */
export const netherBlockAt = (seed: number, x: number, y: number, z: number): BlockId => {
  if (y < NETHER_WORLD_MIN_Y || y >= CHUNK_HEIGHT) {return NETHER_BLOCK.AIR}
  if (y < bedrockThicknessAt(seed, x, z, false) || y >= CHUNK_HEIGHT - bedrockThicknessAt(seed, x, z, true)) {
    return NETHER_BLOCK.BEDROCK
  }
  const solid = netherDensityAt(seed, x, y, z) >= NETHER_SOLID_DENSITY_THRESHOLD
  if (!solid) {return netherFluidOrAirAt(y)}
  if (y > NETHER_LAVA_LEVEL && netherDensityAt(seed, x, y + UNIT_STEP, z) < NETHER_SOLID_DENSITY_THRESHOLD &&
      latticeValue(channelSeed(seed, 'nether-soul-sand'), x, z) < NETHER_SOUL_SAND_CHANCE) {
    return NETHER_BLOCK.SOUL_SAND
  }
  return NETHER_BLOCK.NETHERRACK
}

const NETHER_STRUCTURE_HEADROOM = 8
const NETHER_STRUCTURE_MIN_CLEARANCE = 7

/** Whether every block from one above `floorY` up through the minimum clearance is air. */
const hasOpenHeadroom = (seed: number, x: number, floorY: number, z: number): boolean => {
  for (let y = floorY + UNIT_STEP; y <= floorY + NETHER_STRUCTURE_MIN_CLEARANCE; y += UNIT_STEP) {
    if (netherBlockAt(seed, x, y, z) !== NETHER_BLOCK.AIR) {
      return false
    }
  }
  return true
}

/** The first solid block at or above the headroom, scanning up from `floorY`. */
const firstSolidCeilingAbove = (seed: number, x: number, floorY: number, z: number): number => {
  let ceilingY = floorY + NETHER_STRUCTURE_HEADROOM
  while (ceilingY < CHUNK_HEIGHT && netherBlockAt(seed, x, ceilingY, z) === NETHER_BLOCK.AIR) {
    ceilingY += UNIT_STEP
  }
  return ceilingY
}

/** Finds a real solid floor and the first solid ceiling above its open headroom. */
export const netherStructureTerrainAt = (
  seed: number,
  x: number,
  z: number,
): NetherStructureTerrainSample | undefined => {
  for (let floorY = NETHER_LAVA_LEVEL + UNIT_STEP; floorY < CHUNK_HEIGHT - NETHER_STRUCTURE_HEADROOM; floorY += UNIT_STEP) {
    if (netherBlockAt(seed, x, floorY, z) !== NETHER_BLOCK.AIR && hasOpenHeadroom(seed, x, floorY, z)) {
      return Object.freeze({ ceilingY: firstSolidCeilingAbove(seed, x, floorY, z), surfaceY: floorY })
    }
  }
  return
}

/** Generates Nether terrain without natural structures. */
export const generateNetherTerrainChunk = (seed: number, coord: ChunkCoord): Chunk => {
  const blocks = emptyBlocks()
  const biomes = Array.from<'NETHER'>({ length: CHUNK_SIZE_XZ * CHUNK_SIZE_XZ }).fill('NETHER')
  for (let lx = 0; lx < CHUNK_SIZE_XZ; lx += UNIT_STEP) {
    for (let lz = 0; lz < CHUNK_SIZE_XZ; lz += UNIT_STEP) {
      const x = worldX(coord, lx)
      const z = worldZ(coord, lz)
      for (let y = 0; y < CHUNK_HEIGHT; y += UNIT_STEP) {blocks[blockIndex(lx, y, lz)] = netherBlockAt(seed, x, y, z)}
    }
  }
  return { biomes, blocks, coord }
}

/** Generates Nether terrain and applies every cross-boundary portal plan touching the chunk. */
export const generateNetherChunk = (seed: number, coord: ChunkCoord): NaturalStructureChunk => {
  const terrain = generateNetherTerrainChunk(seed, coord)
  const sampler = (x: number, z: number): NetherStructureTerrainSample | undefined =>
    netherStructureTerrainAt(seed, x, z)
  return applyNaturalStructurePlansToChunk(terrain, naturalStructurePlansForChunk(seed, 'nether', coord, { nether: sampler }))
}

export const generateNetherChunkAt = (seed: number, cx: number, cz: number): NaturalStructureChunk =>
  generateNetherChunk(seed, chunkCoord(cx, cz))
