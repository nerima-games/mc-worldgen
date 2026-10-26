import * as endTerrain from '../../src/domain/end-terrain.js'
import type { EndFeatureChunk } from '../../src/domain/end-features.js'
import * as fortress from '../../src/domain/nether-fortress.js'
import * as netherTerrain from '../../src/domain/nether-terrain.js'
import * as structures from '../../src/domain/natural-structure.js'
import * as siting from '../../src/domain/structure-siting.js'
import * as stronghold from '../../src/domain/stronghold-structure.js'
import type { NaturalStructureChunk, NaturalStructurePlan } from '../../src/domain/natural-structure-types.js'
import type { StrongholdSite, VillageSite } from '../../src/domain/structure-siting.js'
import * as terrain from '../../src/domain/terrain.js'
import { Option, Result } from 'effect'

export * from '../../src/domain/end-terrain.js'
export * from '../../src/domain/nether-fortress.js'
export * from '../../src/domain/nether-terrain.js'
export * from '../../src/domain/natural-structure.js'
export * from '../../src/domain/stronghold-structure.js'
export * from '../../src/domain/terrain.js'

type NaturalStructurePlanOption = Option.Option<NaturalStructurePlan>

const unwrapResult = <Value, Error>(result: Result.Result<Value, Error>): Value => {
  if (Result.isFailure(result)) {throw result.failure}
  return result.success
}

const unwrapPlanResult = (result: Result.Result<NaturalStructurePlanOption, unknown>): NaturalStructurePlanOption =>
  unwrapResult(result)

export const planCompactStructureForRegion = (
  ...args: Parameters<typeof structures.planCompactStructureForRegion>
): NaturalStructurePlanOption => unwrapPlanResult(structures.planCompactStructureForRegion(...args))

export const planVillageForRegion = (
  ...args: Parameters<typeof structures.planVillageForRegion>
): NaturalStructurePlanOption => unwrapPlanResult(structures.planVillageForRegion(...args))

export const planDesertPyramidForRegion = (
  ...args: Parameters<typeof structures.planDesertPyramidForRegion>
): NaturalStructurePlanOption => unwrapPlanResult(structures.planDesertPyramidForRegion(...args))

export const planDesertWellForRegion = (
  ...args: Parameters<typeof structures.planDesertWellForRegion>
): NaturalStructurePlanOption => unwrapPlanResult(structures.planDesertWellForRegion(...args))

export const planIglooForRegion = (
  ...args: Parameters<typeof structures.planIglooForRegion>
): NaturalStructurePlanOption => unwrapPlanResult(structures.planIglooForRegion(...args))

export const planJunglePyramidForRegion = (
  ...args: Parameters<typeof structures.planJunglePyramidForRegion>
): NaturalStructurePlanOption => unwrapPlanResult(structures.planJunglePyramidForRegion(...args))

export const planMineshaftForRegion = (
  ...args: Parameters<typeof structures.planMineshaftForRegion>
): NaturalStructurePlanOption => unwrapPlanResult(structures.planMineshaftForRegion(...args))

export const planOceanMonumentForRegion = (
  ...args: Parameters<typeof structures.planOceanMonumentForRegion>
): NaturalStructurePlanOption => unwrapPlanResult(structures.planOceanMonumentForRegion(...args))

export const planOceanRuinForRegion = (
  ...args: Parameters<typeof structures.planOceanRuinForRegion>
): NaturalStructurePlanOption => unwrapPlanResult(structures.planOceanRuinForRegion(...args))

export const planShipwreckForRegion = (
  ...args: Parameters<typeof structures.planShipwreckForRegion>
): NaturalStructurePlanOption => unwrapPlanResult(structures.planShipwreckForRegion(...args))

export const planPillagerOutpostForRegion = (
  ...args: Parameters<typeof structures.planPillagerOutpostForRegion>
): NaturalStructurePlanOption => unwrapPlanResult(structures.planPillagerOutpostForRegion(...args))

export const planBastionRemnantForRegion = (
  ...args: Parameters<typeof structures.planBastionRemnantForRegion>
): NaturalStructurePlanOption => unwrapPlanResult(structures.planBastionRemnantForRegion(...args))

export const planEndCityForRegion = (
  ...args: Parameters<typeof structures.planEndCityForRegion>
): NaturalStructurePlanOption => unwrapPlanResult(structures.planEndCityForRegion(...args))

export const planRuinedNetherPortalForRegion = (
  ...args: Parameters<typeof structures.planRuinedNetherPortalForRegion>
): NaturalStructurePlanOption => unwrapPlanResult(structures.planRuinedNetherPortalForRegion(...args))

export const planStrongholdForRegion = (
  ...args: Parameters<typeof stronghold.planStrongholdForRegion>
): NaturalStructurePlanOption => unwrapPlanResult(stronghold.planStrongholdForRegion(...args))

export const planNetherFortressForRegion = (
  ...args: Parameters<typeof fortress.planNetherFortressForRegion>
): NaturalStructurePlanOption => unwrapPlanResult(fortress.planNetherFortressForRegion(...args))

export const planNaturalStructureForRegion = (
  ...args: Parameters<typeof structures.planNaturalStructureForRegion>
): NaturalStructurePlanOption => unwrapPlanResult(structures.planNaturalStructureForRegion(...args))

export const strongholdSiteForRegion = (
  ...args: Parameters<typeof siting.strongholdSiteForRegion>
): Option.Option<StrongholdSite> => unwrapResult(siting.strongholdSiteForRegion(...args))

export const villageSiteForRegion = (
  ...args: Parameters<typeof siting.villageSiteForRegion>
): Option.Option<VillageSite> => unwrapResult(siting.villageSiteForRegion(...args))

export const naturalStructurePlansForChunk = (
  ...args: Parameters<typeof structures.naturalStructurePlansForChunk>
): ReadonlyArray<NaturalStructurePlan> => unwrapResult(structures.naturalStructurePlansForChunk(...args))

export const generateChunk = (...args: Parameters<typeof terrain.generateChunk>): NaturalStructureChunk =>
  unwrapResult(terrain.generateChunk(...args))

export const generateChunkAt = (...args: Parameters<typeof terrain.generateChunkAt>): NaturalStructureChunk =>
  unwrapResult(terrain.generateChunkAt(...args))

export const generateNetherChunk = (...args: Parameters<typeof netherTerrain.generateNetherChunk>): NaturalStructureChunk =>
  unwrapResult(netherTerrain.generateNetherChunk(...args))

export const generateNetherChunkAt = (
  ...args: Parameters<typeof netherTerrain.generateNetherChunkAt>
): NaturalStructureChunk => unwrapResult(netherTerrain.generateNetherChunkAt(...args))

export const generateEndChunk = (...args: Parameters<typeof endTerrain.generateEndChunk>): EndFeatureChunk =>
  unwrapResult(endTerrain.generateEndChunk(...args))

export const generateEndChunkAt = (...args: Parameters<typeof endTerrain.generateEndChunkAt>): EndFeatureChunk =>
  unwrapResult(endTerrain.generateEndChunkAt(...args))
