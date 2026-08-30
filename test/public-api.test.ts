import * as worldgen from '../src/index'
import { describe, expect, it } from '@effect/vitest'
import { PortalRegistry as DOMAIN_PORTAL_REGISTRY } from '../src/application/portal-registry'
import { CHUNK_FORMAT as DOMAIN_CHUNK_FORMAT } from '../src/domain/chunk-format'
import {
  isNearFortressSite as DOMAIN_IS_NEAR_FORTRESS_SITE,
  planNetherFortressForRegion as DOMAIN_PLAN_NETHER_FORTRESS,
} from '../src/domain/nether-fortress'
import {
  netherToOverworld as DOMAIN_NETHER_TO_OVERWORLD,
  overworldToNether as DOMAIN_OVERWORLD_TO_NETHER,
} from '../src/domain/nether-link'
import { PORTAL_REGISTRY_FORMAT as DOMAIN_PORTAL_REGISTRY_FORMAT } from '../src/domain/portal-registry-format'
import { resolveNetherTravel as DOMAIN_RESOLVE_NETHER_TRAVEL } from '../src/domain/nether-travel'
import { blockPosition } from '@nerima-games/mc-kernel'

const TEST_PLAYER_X = 0
const TEST_PLAYER_Y = 64
const TEST_PLAYER_POSITION = blockPosition(TEST_PLAYER_X, TEST_PLAYER_Y, TEST_PLAYER_X)
const TEST_CHUNK_X = 0
const TEST_CHUNK_Z = 0
const TEST_GENERATION_SEED = 1

const expectNaturalStructureChunk = (chunk: worldgen.NaturalStructureChunk, coord: worldgen.ChunkCoord): void => {
  expect(chunk.coord).toBe(coord)
  expect(chunk.blocks).toHaveLength(worldgen.CHUNK_VOLUME)
  expect(chunk.biomes).toHaveLength(worldgen.CHUNK_SIZE_XZ * worldgen.CHUNK_SIZE_XZ)
  expect(Array.isArray(chunk.naturalStructureIds)).toBe(true)
  expect(Array.isArray(chunk.naturalStructureMarkers)).toBe(true)
}

describe('public API surface', () => {
  it('publishes the chunk persistence format from the package root', () => {
    expect(worldgen.CHUNK_FORMAT).toBe(DOMAIN_CHUNK_FORMAT)
  })

  it('publishes the dimension type and nether travel resolver from the package root', () => {
    const dimensions: ReadonlyArray<worldgen.Dimension> = ['overworld', 'nether', 'end']

    expect(dimensions).toStrictEqual(['overworld', 'nether', 'end'])
    expect(worldgen.resolveNetherTravel).toBe(DOMAIN_RESOLVE_NETHER_TRAVEL)
    expect(worldgen.resolveNetherTravel('overworld', TEST_PLAYER_POSITION, []).toDimension).toBe('nether')
  })

  it('publishes the portal registry service and format from the package root', () => {
    expect(worldgen.PortalRegistry).toBe(DOMAIN_PORTAL_REGISTRY)
    expect(worldgen.PORTAL_REGISTRY_FORMAT).toBe(DOMAIN_PORTAL_REGISTRY_FORMAT)
  })

  it('publishes the Nether coordinate transformations from the package root', () => {
    expect(worldgen.overworldToNether).toBe(DOMAIN_OVERWORLD_TO_NETHER)
    expect(worldgen.netherToOverworld).toBe(DOMAIN_NETHER_TO_OVERWORLD)
    expect(worldgen.overworldToNether(blockPosition(-1, TEST_PLAYER_Y, 8))).toStrictEqual(
      blockPosition(-1, TEST_PLAYER_Y, 1),
    )
  })

  it('publishes all dimension chunk generators from the package root', () => {
    const coord = worldgen.chunkCoord(TEST_CHUNK_X, TEST_CHUNK_Z)

    expectNaturalStructureChunk(
      worldgen.generateChunk(TEST_GENERATION_SEED, coord, { decorate: false }),
      coord,
    )
    expectNaturalStructureChunk(worldgen.generateNetherChunk(TEST_GENERATION_SEED, coord), coord)
    expectNaturalStructureChunk(worldgen.generateEndChunk(TEST_GENERATION_SEED, coord), coord)
  })

  it('publishes End feature planning and gateway value APIs from the package root', () => {
    const gatewayPosition = blockPosition(TEST_PLAYER_X, TEST_PLAYER_Y, TEST_PLAYER_X)
    const plan = worldgen.endFeaturePlanForSeed(TEST_GENERATION_SEED)
    const placement = worldgen.createEndGatewayPlacement(gatewayPosition)
    const knownExit = worldgen.resolveEndGatewayExit(
      worldgen.knownEndGatewayExit(blockPosition(8, TEST_PLAYER_Y, 8), true),
    )

    expect(plan.spikes).toHaveLength(10)
    expect(placement.blocks.some(({ block }) => block === worldgen.END_GATEWAY_BLOCK.GATEWAY)).toBe(true)
    expect(worldgen.resolveEndGatewayExit(placement.configuration)).toBeUndefined()
    expect(knownExit).toStrictEqual({ exact: true, position: blockPosition(8, TEST_PLAYER_Y, 8) })
  })

  it('publishes Nether fortress planning from the package root', () => {
    expect(worldgen.planNetherFortressForRegion).toBe(DOMAIN_PLAN_NETHER_FORTRESS)
    expect(worldgen.isNearFortressSite).toBe(DOMAIN_IS_NEAR_FORTRESS_SITE)
  })
})
