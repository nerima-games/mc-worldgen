import * as worldgen from '../src/index'
import * as worldgenTesting from '../src/testing'
import { describe, expect, it } from '@effect/vitest'
import { Effect, Result } from 'effect'
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
import {
  detectNetherPortal as DOMAIN_DETECT_NETHER_PORTAL,
  generatePortalLayout as DOMAIN_GENERATE_PORTAL_LAYOUT,
} from '../src/domain/portal-frame'
import { resolveNetherTravel as DOMAIN_RESOLVE_NETHER_TRAVEL } from '../src/domain/nether-travel'
import {
  BlockId,
  chunkKeyOf as KERNEL_CHUNK_KEY_OF,
  type ChunkKey as KernelChunkKey,
} from '@nerima-games/mc-kernel'
import {
  blockAxis,
  localAxis,
  noiseSeed,
  validatedBlockPosition,
  validatedChunkCoord,
} from './fixtures/validated-inputs'
import type { SubscriberId } from '../src/testing'

const TEST_PLAYER_X = 0
const TEST_PLAYER_Y = 64
const TEST_PLAYER_POSITION = validatedBlockPosition(TEST_PLAYER_X, TEST_PLAYER_Y, TEST_PLAYER_X)
const TEST_CHUNK_COORD = validatedChunkCoord(0, 0)
const TEST_GENERATION_SEED = noiseSeed(1)
const TEST_BLOCK = Result.getOrThrow(BlockId.result(1))
const TEST_SUBSCRIBER_ID: SubscriberId = 1

type Assert<Condition extends true> = Condition
export type PublicRootExcludesTestHelpers = Assert<
  'emptyBlocks' extends keyof typeof worldgen ? false : true
> & Assert<'setBlockAt' extends keyof typeof worldgen ? false : true>
// @ts-expect-error SubscriberId is exported only by the testing entry.
export type PublicRootExcludesSubscriberId = worldgen.SubscriberId
export type PublicRootExportsRendererTypes = [
  worldgen.Chunk,
  worldgen.ChunkNeighbours,
  worldgen.LightReading,
  worldgen.ChunkStoreRegistry,
  worldgen.ChunkCapacity,
]
export type PublicRootExportsRegistry = Assert<
  worldgen.ChunkStoreRegistry['forDimension'] extends (
    dimension: worldgen.Dimension,
  ) => worldgen.ChunkStoreApi ? true : false
>
export type PublicRootExportsRendererReads = Assert<
  'peek' extends keyof worldgen.ChunkStoreApi ? true : false
>
  & Assert<'neighbours' extends keyof worldgen.ChunkStoreApi ? true : false>
  & Assert<'subscribeDirty' extends keyof worldgen.ChunkStoreApi ? true : false>
  & Assert<'getLight' extends keyof worldgen.ChunkStoreApi ? true : false>
  & Assert<'forDimension' extends keyof worldgen.ChunkStoreRegistry ? true : false>

type LoadChunkView = Effect.Success<ReturnType<worldgen.ChunkStoreApi['load']>>
type PeekChunkView = Exclude<Effect.Success<ReturnType<worldgen.ChunkStoreApi['peek']>>, undefined>
export type PublicRootExportsReadonlyChunkViews = Assert<
  LoadChunkView extends worldgen.ReadonlyChunk ? true : false
> & Assert<PeekChunkView extends worldgen.ReadonlyChunk ? true : false>
export type PublicRootReadonlyChunkViewsOmitAliasingCallbacks = Assert<
  'forEach' extends keyof worldgen.ReadonlyUint16Array ? false : true
> & Assert<'map' extends keyof worldgen.ReadonlyUint16Array ? false : true>
  & Assert<'reduce' extends keyof worldgen.ReadonlyUint16Array ? false : true>
export type PublicRootReadonlyChunkViewsHideBufferAliases = Assert<
  'buffer' extends keyof worldgen.ReadonlyUint16Array ? false : true
> & Assert<'subarray' extends keyof worldgen.ReadonlyUint16Array ? false : true>

const assertReadonlyChunkViews = (loaded: LoadChunkView, peeked: PeekChunkView): void => {
  // @ts-expect-error Published load views reject indexed writes.
  loaded.blocks[0] = TEST_BLOCK
  // @ts-expect-error Published peek views reject indexed writes.
  peeked.blocks[0] = TEST_BLOCK
  // @ts-expect-error The read-only view omits typed-array mutators.
  loaded.blocks.fill(TEST_BLOCK)
  // @ts-expect-error The read-only view omits typed-array mutators.
  peeked.blocks.set(new Uint16Array(1))
}
void assertReadonlyChunkViews

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

  it('exports test helpers only from the testing entry', () => {
    const blocks = worldgenTesting.emptyBlocks()
    worldgenTesting.setBlockAt(blocks, localAxis(1), blockAxis(2), localAxis(3), TEST_BLOCK)

    expect(blocks).toHaveLength(worldgen.CHUNK_VOLUME)
    expect(blocks[worldgen.blockIndex(localAxis(1), blockAxis(2), localAxis(3))]).toBe(TEST_BLOCK)
    expect(TEST_SUBSCRIBER_ID).toBe(1)
    expect('emptyBlocks' in worldgen).toBe(false)
    expect('setBlockAt' in worldgen).toBe(false)
    expect('SubscriberId' in worldgen).toBe(false)
  })

  it('keeps validated siting helpers out of the package root', () => {
    expect('strongholdCandidateExistsInRegion' in worldgen).toBe(false)
    expect('strongholdCandidateExistsWithPresenceChannelSeed' in worldgen).toBe(false)
    expect('strongholdPresenceChannelSeedFor' in worldgen).toBe(false)
    expect('strongholdSiteOptionForValidatedRegion' in worldgen).toBe(false)
    expect('villageCandidateExistsInRegion' in worldgen).toBe(false)
    expect('villageCandidateExistsWithPresenceChannelSeed' in worldgen).toBe(false)
    expect('villagePresenceChannelSeedFor' in worldgen).toBe(false)
    expect('villageSiteOptionForValidatedRegion' in worldgen).toBe(false)
  })

  it('re-exports NoiseSeed and rejects invalid seed values through its Result constructor', () => {
    expect(worldgen.NoiseSeed.result(1)._tag).toBe('Success')

    for (const invalidSeed of [0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      expect(worldgen.NoiseSeed.result(invalidSeed)._tag).toBe('Failure')
    }
  })

  it('publishes the render-facing chunk API from the package root', () => {
    const kernelKey: KernelChunkKey = KERNEL_CHUNK_KEY_OF(TEST_CHUNK_COORD)

    expect(worldgen.CHUNK_HEIGHT).toBe(256)
    expect(worldgen.ChunkCapacity.result(1)._tag).toBe('Success')
    expect(worldgen.ChunkCapacity.result(0)._tag).toBe('Failure')
    expect(worldgen.chunkKeyOf).toBe(KERNEL_CHUNK_KEY_OF)
    expect(worldgen.chunkKeyOf(TEST_CHUNK_COORD)).toBe(kernelKey)
    expect(worldgen.ChunkStoreRegistry).toBeDefined()
  })

  it('publishes the dimension type and nether travel resolver from the package root', () => {
    const dimensions: ReadonlyArray<worldgen.Dimension> = ['overworld', 'nether', 'end']

    expect(dimensions).toStrictEqual(['overworld', 'nether', 'end'])
    expect(worldgen.resolveNetherTravel).toBe(DOMAIN_RESOLVE_NETHER_TRAVEL)
    expect(worldgen.resolveNetherTravel('overworld', TEST_PLAYER_POSITION, []).toDimension).toBe('nether')
  })

  it('publishes portal frame detection and layout from the package root', () => {
    expect(worldgen.detectNetherPortal).toBe(DOMAIN_DETECT_NETHER_PORTAL)
    expect(worldgen.generatePortalLayout).toBe(DOMAIN_GENERATE_PORTAL_LAYOUT)
  })

  it('publishes the portal registry service and format from the package root', () => {
    expect(worldgen.PortalRegistry).toBe(DOMAIN_PORTAL_REGISTRY)
    expect(worldgen.PORTAL_REGISTRY_FORMAT).toBe(DOMAIN_PORTAL_REGISTRY_FORMAT)
  })

  it('publishes the Nether coordinate transformations from the package root', () => {
    expect(worldgen.overworldToNether).toBe(DOMAIN_OVERWORLD_TO_NETHER)
    expect(worldgen.netherToOverworld).toBe(DOMAIN_NETHER_TO_OVERWORLD)
    expect(worldgen.overworldToNether(validatedBlockPosition(-1, TEST_PLAYER_Y, 8))).toStrictEqual(
      validatedBlockPosition(-1, TEST_PLAYER_Y, 1),
    )
  })

  it('publishes all dimension chunk generators from the package root', () => {
    const coord = TEST_CHUNK_COORD

    expectNaturalStructureChunk(
      Result.getOrThrow(worldgen.generateChunk(TEST_GENERATION_SEED, coord, { decorate: false })),
      coord,
    )
    expectNaturalStructureChunk(Result.getOrThrow(worldgen.generateNetherChunk(TEST_GENERATION_SEED, coord)), coord)
    expectNaturalStructureChunk(Result.getOrThrow(worldgen.generateEndChunk(TEST_GENERATION_SEED, coord)), coord)
  })

  it('publishes End feature planning and gateway value APIs from the package root', () => {
    const gatewayPosition = TEST_PLAYER_POSITION
    const plan = worldgen.endFeaturePlanForSeed(TEST_GENERATION_SEED)
    const placement = worldgen.createEndGatewayPlacement(gatewayPosition)
    const knownExit = worldgen.resolveEndGatewayExit(
      worldgen.knownEndGatewayExit(validatedBlockPosition(8, TEST_PLAYER_Y, 8), true),
    )

    expect(plan.spikes).toHaveLength(10)
    expect(placement.blocks.some(({ block }) => block === worldgen.END_GATEWAY_BLOCK.GATEWAY)).toBe(true)
    expect(worldgen.resolveEndGatewayExit(placement.configuration)).toBeUndefined()
    expect(knownExit).toStrictEqual({ exact: true, position: validatedBlockPosition(8, TEST_PLAYER_Y, 8) })
  })

  it('publishes Nether fortress planning from the package root', () => {
    expect(worldgen.planNetherFortressForRegion).toBe(DOMAIN_PLAN_NETHER_FORTRESS)
    expect(worldgen.isNearFortressSite).toBe(DOMAIN_IS_NEAR_FORTRESS_SITE)
  })
})
