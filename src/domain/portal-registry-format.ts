import { FIRST_VERSION, defineFormat } from '@nerima-games/mc-save'
import { BlockAxis } from '@nerima-games/mc-kernel'
import type { PortalRegistryState } from './portal-registry'
import { Schema } from 'effect'

const BlockAxisFromNumber = Schema.Number.pipe(Schema.fromBrand(BlockAxis))

const PORTAL_POSITION_STRUCT = Schema.Struct({
  x: BlockAxisFromNumber,
  y: BlockAxisFromNumber,
  z: BlockAxisFromNumber,
})

const PORTAL_REGISTRY_STRUCT = Schema.Struct({
  end: Schema.Array(PORTAL_POSITION_STRUCT),
  nether: Schema.Array(PORTAL_POSITION_STRUCT),
  overworld: Schema.Array(PORTAL_POSITION_STRUCT),
})

const PersistablePortalRegistrySchema = Schema.declare(
  (value: unknown): value is PortalRegistryState => typeof value === 'object' && value !== null,
)

type PortalRegistryEncoded = Schema.Schema.Encoded<typeof PORTAL_REGISTRY_STRUCT>

export const PORTAL_REGISTRY_SCHEMA: Schema.Schema<PortalRegistryState, PortalRegistryEncoded> = Schema.transform(
  PORTAL_REGISTRY_STRUCT,
  PersistablePortalRegistrySchema,
  {
    decode: (value) => value,
    encode: (state) => ({
      end: [...state.end],
      nether: [...state.nether],
      overworld: [...state.overworld],
    }),
  },
)

export const PORTAL_REGISTRY_FORMAT = defineFormat({
  name: '@nerima-games/mc-worldgen/portal-registry',
  schema: PORTAL_REGISTRY_SCHEMA,
  version: FIRST_VERSION,
})
