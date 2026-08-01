/* oxlint-disable id-length, max-statements, no-magic-numbers, no-ternary, no-undefined, sort-imports */

/** Deterministic, absolute-coordinate terrain generation for the Nether. */
import { columnIndex, emptyBlocks, worldX, worldZ, type Chunk } from './chunk'
import { blockIndex, CHUNK_HEIGHT, CHUNK_SIZE_XZ } from './constants'
import { BlockId, chunkCoord, type ChunkCoord } from './kernel-vocabulary'
import {
  applyNaturalStructurePlansToChunk,
  naturalStructurePlansForChunk,
  type NaturalStructureChunk,
  type NetherStructureTerrainSample,
} from './natural-structure'
import { channelSeed, fbm2D, latticeValue } from './seeded-random'

export const NETHER_BLOCK = Object.freeze({
  AIR: BlockId(0),
  BEDROCK: BlockId(1),
  LAVA: BlockId(11),
  SOUL_SAND: BlockId(47),
  NETHERRACK: BlockId(117),
})

export const NETHER_LAVA_LEVEL = 31

const smoothstep = (value: number): number => value * value * (3 - 2 * value)
const interpolate = (left: number, right: number, amount: number): number => left + (right - left) * amount

const latticeValue3D = (seed: number, x: number, y: number, z: number): number =>
  latticeValue(channelSeed(seed, `nether-y:${String(y)}`), x, z)

const valueNoise3D = (seed: number, x: number, y: number, z: number, frequency: number): number => {
  const sx = x * frequency
  const sy = y * frequency
  const sz = z * frequency
  const x0 = Math.floor(sx)
  const y0 = Math.floor(sy)
  const z0 = Math.floor(sz)
  const tx = smoothstep(sx - x0)
  const ty = smoothstep(sy - y0)
  const tz = smoothstep(sz - z0)
  const plane = (iy: number): number => {
    const north = interpolate(latticeValue3D(seed, x0, iy, z0), latticeValue3D(seed, x0 + 1, iy, z0), tx)
    const south = interpolate(latticeValue3D(seed, x0, iy, z0 + 1), latticeValue3D(seed, x0 + 1, iy, z0 + 1), tx)
    return interpolate(north, south, tz)
  }
  return interpolate(plane(y0), plane(y0 + 1), ty)
}

const netherDensityAt = (seed: number, x: number, y: number, z: number): number => {
  const broad = valueNoise3D(channelSeed(seed, 'nether-density-broad'), x, y, z, 1 / 48)
  const detail = valueNoise3D(channelSeed(seed, 'nether-density-detail'), x, y, z, 1 / 20)
  const floor = 35 + (fbm2D(channelSeed(seed, 'nether-floor'), x, z, {
    frequency: 1 / 80, octaves: 3, persistence: 0.5,
  }) - 0.5) * 22
  const ceiling = 116 + (fbm2D(channelSeed(seed, 'nether-ceiling'), x, z, {
    frequency: 1 / 96, octaves: 3, persistence: 0.5,
  }) - 0.5) * 26
  const shell = y <= floor ? (floor - y) / 10 : y >= ceiling ? (y - ceiling) / 10 : -0.35
  return broad * 0.65 + detail * 0.35 + shell
}

const bedrockThicknessAt = (seed: number, x: number, z: number, top: boolean): number =>
  1 + Math.floor(latticeValue(channelSeed(seed, top ? 'nether-bedrock-top' : 'nether-bedrock-bottom'), x, z) * 5)

/** Authoritative block query shared by generation and structure siting. */
export const netherBlockAt = (seed: number, x: number, y: number, z: number): BlockId => {
  if (y < 0 || y >= CHUNK_HEIGHT) return NETHER_BLOCK.AIR
  if (y < bedrockThicknessAt(seed, x, z, false) || y >= CHUNK_HEIGHT - bedrockThicknessAt(seed, x, z, true)) {
    return NETHER_BLOCK.BEDROCK
  }
  const solid = netherDensityAt(seed, x, y, z) >= 0.55
  if (!solid) return y <= NETHER_LAVA_LEVEL ? NETHER_BLOCK.LAVA : NETHER_BLOCK.AIR
  if (y > NETHER_LAVA_LEVEL && netherDensityAt(seed, x, y + 1, z) < 0.55 &&
      latticeValue(channelSeed(seed, 'nether-soul-sand'), x, z) < 0.16) {
    return NETHER_BLOCK.SOUL_SAND
  }
  return NETHER_BLOCK.NETHERRACK
}

/** Finds a real solid floor and the first solid ceiling above its open headroom. */
export const netherStructureTerrainAt = (
  seed: number,
  x: number,
  z: number,
): NetherStructureTerrainSample | undefined => {
  for (let floorY = NETHER_LAVA_LEVEL + 1; floorY < CHUNK_HEIGHT - 8; floorY += 1) {
    if (netherBlockAt(seed, x, floorY, z) === NETHER_BLOCK.AIR) continue
    let open = true
    for (let y = floorY + 1; y <= floorY + 7; y += 1) {
      if (netherBlockAt(seed, x, y, z) !== NETHER_BLOCK.AIR) open = false
    }
    if (!open) continue
    let ceilingY = floorY + 8
    while (ceilingY < CHUNK_HEIGHT && netherBlockAt(seed, x, ceilingY, z) === NETHER_BLOCK.AIR) ceilingY += 1
    return Object.freeze({ ceilingY, surfaceY: floorY })
  }
  return undefined
}

/** Generates Nether terrain without natural structures. */
export const generateNetherTerrainChunk = (seed: number, coord: ChunkCoord): Chunk => {
  const blocks = emptyBlocks()
  const biomes = Array.from({ length: CHUNK_SIZE_XZ * CHUNK_SIZE_XZ }, () => 'NETHER' as const)
  for (let lx = 0; lx < CHUNK_SIZE_XZ; lx += 1) {
    for (let lz = 0; lz < CHUNK_SIZE_XZ; lz += 1) {
      const x = worldX(coord, lx)
      const z = worldZ(coord, lz)
      for (let y = 0; y < CHUNK_HEIGHT; y += 1) blocks[blockIndex(lx, y, lz)] = netherBlockAt(seed, x, y, z)
      biomes[columnIndex(lx, lz)] = 'NETHER'
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
