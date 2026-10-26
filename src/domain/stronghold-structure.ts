import {
  type InvalidNaturalStructureCoordinate,
  finishPlanFromValidatedPlacements,
} from './natural-structure-plan-builder.js'
import type {
  NaturalStructureBlockPlacement,
  NaturalStructureMarker,
  NaturalStructurePlan,
  NaturalStructureRegion,
} from './natural-structure-types.js'
import { Option, Result } from 'effect'
import { STRONGHOLD_FLOOR_Y, type StrongholdSite, strongholdSiteForRegion } from './structure-siting.js'
import { type StrongholdPlan, generateStrongholdPlan } from './stronghold.js'
import type { NoiseSeed } from '@nerima-games/mc-noise'

type StrongholdPlanRequest = {
  readonly region: NaturalStructureRegion
  readonly seed: NoiseSeed
  readonly site: StrongholdSite
  readonly stronghold: StrongholdPlan
}

type StrongholdSitePlanRequest = Omit<StrongholdPlanRequest, 'stronghold'>

const finishStrongholdPlan = ({ region, seed, site, stronghold }: StrongholdPlanRequest): Result.Result<NaturalStructurePlan, InvalidNaturalStructureCoordinate> => {
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
      id: `stronghold:${String(seed)}:${String(region.x)}:${String(region.z)}`,
      kind: 'stronghold',
      origin: { x: site.x, y: STRONGHOLD_FLOOR_Y, z: site.z },
      region,
    },
    blocks,
    markers,
  )
}

const planStrongholdSite = (request: StrongholdSitePlanRequest): Result.Result<Option.Option<NaturalStructurePlan>, InvalidNaturalStructureCoordinate> =>
  Result.map(finishStrongholdPlan({
    ...request,
    stronghold: generateStrongholdPlan(request.seed, request.site),
  }), Option.some)

export const planStrongholdForRegion = (
  seed: NoiseSeed,
  regionX: number,
  regionZ: number,
): Result.Result<Option.Option<NaturalStructurePlan>, InvalidNaturalStructureCoordinate> => {
  const region = { x: regionX, z: regionZ }
  const siteResult = strongholdSiteForRegion(seed, regionX, regionZ)
  if (Result.isFailure(siteResult)) {return Result.fail(siteResult.failure)}
  const siteOption = siteResult.success
  if (Option.isNone(siteOption)) {
    return Result.succeed(Option.none())
  }
  return planStrongholdSite({
    region,
    seed,
    site: siteOption.value,
  })
}
