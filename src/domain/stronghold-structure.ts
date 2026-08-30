import type {
  NaturalStructureBlockPlacement,
  NaturalStructureMarker,
  NaturalStructurePlan,
} from './natural-structure-types.js'
import { STRONGHOLD_FLOOR_Y, strongholdSiteForRegion } from './structure-siting.js'
import { Option } from 'effect'
import { finishPlanFromValidatedPlacements } from './natural-structure-plan-builder.js'
import { generateStrongholdPlan } from './stronghold.js'

export const planStrongholdForRegion = (
  seed: number,
  regionX: number,
  regionZ: number,
): Option.Option<NaturalStructurePlan> => {
  const siteOption = strongholdSiteForRegion(seed, regionX, regionZ)
  if (Option.isNone(siteOption)) {
    return Option.none()
  }

  return Option.map(
    Option.fromNullable(generateStrongholdPlan(seed, siteOption.value)),
    (stronghold) => {
      const blocks = stronghold.mutations.map((mutation): NaturalStructureBlockPlacement =>
        Object.freeze({
          block: mutation.block,
          x: mutation.x,
          y: mutation.y,
          z: mutation.z,
        }),
      )
      const markers = stronghold.frames.map((frame): NaturalStructureMarker => Object.freeze({
        eye: frame.eye,
        facing: frame.facing,
        kind: 'end-portal-frame',
        x: frame.x,
        y: frame.y,
        z: frame.z,
      }))
      return finishPlanFromValidatedPlacements(
        {
          dimension: 'overworld',
          id: `stronghold:${String(seed)}:${String(regionX)}:${String(regionZ)}`,
          kind: 'stronghold',
          origin: { x: siteOption.value.x, y: STRONGHOLD_FLOOR_Y, z: siteOption.value.z },
          region: { x: regionX, z: regionZ },
        },
        blocks,
        markers,
      )
    },
  )
}
