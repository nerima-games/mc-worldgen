import { BIOME_SURFACES, type BiomeType } from './biome'
import type { BlockId } from '@nerima-games/mc-kernel'

export type ResolvedSurfaceMaterial = Readonly<{
  readonly filler: BlockId
  readonly fillerDepth: number
  readonly submerged: boolean
  readonly top: BlockId
}>

export type SurfaceMaterialOptions = Readonly<{
  readonly hasLakeBasin: boolean
  readonly isShore: boolean
}>

const DEFAULT_SURFACE_OPTIONS: SurfaceMaterialOptions = {
  hasLakeBasin: false,
  isShore: false,
}

/** Resolve the material pair for one column without coupling filling to biome data. */
export const resolveSurfaceMaterial = (
  biome: BiomeType,
  surfaceY: number,
  waterLevel: number,
  options: SurfaceMaterialOptions = DEFAULT_SURFACE_OPTIONS,
): ResolvedSurfaceMaterial => {
  const { filler, top: dryTop, underwaterTop } = BIOME_SURFACES[biome]
  const submerged = surfaceY < waterLevel

  if (options.hasLakeBasin) {
    return {
      filler: BIOME_SURFACES.BEACH.filler,
      fillerDepth: 2,
      submerged,
      top: BIOME_SURFACES.BEACH.top,
    }
  }

  if (options.isShore) {
    return {
      filler,
      fillerDepth: 2,
      submerged,
      top: BIOME_SURFACES.BEACH.top,
    }
  }

  if (submerged) {
    return {
      filler,
      fillerDepth: 4,
      submerged,
      top: underwaterTop,
    }
  }

  return {
    filler,
    fillerDepth: 4,
    submerged,
    top: dryTop,
  }
}
