import { FIRST_VERSION, type SaveFormat, defineFormat } from '@nerima-games/mc-save'
import { BlockAxis } from '@nerima-games/mc-kernel/domain/coordinates'
import type { PortalRegistryState } from './portal-registry.js'
import { Result, Schema, SchemaGetter } from 'effect'

type PortalPosition = PortalRegistryState['end'][number]
type PortalPositionEncoded = { readonly x: number; readonly y: number; readonly z: number }
type PortalRegistryEncoded = {
  readonly end: ReadonlyArray<PortalPositionEncoded>
  readonly nether: ReadonlyArray<PortalPositionEncoded>
  readonly overworld: ReadonlyArray<PortalPositionEncoded>
}

const BlockAxisFromNumber: Schema.Codec<BlockAxis, number> = Schema.Number.pipe(
  Schema.fromBrand('BlockAxis', BlockAxis),
)

const PORTAL_POSITION_STRUCT: Schema.Codec<PortalPosition, PortalPositionEncoded> = Schema.Struct({
  x: BlockAxisFromNumber,
  y: BlockAxisFromNumber,
  z: BlockAxisFromNumber,
})

const PORTAL_REGISTRY_STRUCT: Schema.Codec<PortalRegistryState, PortalRegistryEncoded> = Schema.Struct({
  end: Schema.Array(PORTAL_POSITION_STRUCT),
  nether: Schema.Array(PORTAL_POSITION_STRUCT),
  overworld: Schema.Array(PORTAL_POSITION_STRUCT),
})

const PersistablePortalRegistrySchema: Schema.Codec<PortalRegistryState> = Schema.declare(
  (value: unknown): value is PortalRegistryState => typeof value === 'object' && value !== null,
)

export const PORTAL_REGISTRY_SCHEMA: Schema.Codec<PortalRegistryState, PortalRegistryEncoded> = PORTAL_REGISTRY_STRUCT.pipe(
  Schema.decodeTo(PersistablePortalRegistrySchema, {
    decode: SchemaGetter.transform<PortalRegistryState, PortalRegistryState>((value) => value),
    encode: SchemaGetter.transform<PortalRegistryState, PortalRegistryState>((state) => ({
      end: [...state.end],
      nether: [...state.nether],
      overworld: [...state.overworld],
    })),
  }),
)

export const PORTAL_REGISTRY_FORMAT: SaveFormat<PortalRegistryState, PortalRegistryEncoded> = Result.getOrThrow(defineFormat({
  name: '@nerima-games/mc-worldgen/portal-registry',
  schema: PORTAL_REGISTRY_SCHEMA,
  version: FIRST_VERSION,
}))
