import { type BlockAxis as BlockAxisValue, PositionAxis as positionAxis } from '@nerima-games/mc-kernel/domain/coordinates'
import { Data, Result } from 'effect'
import {
  type DensityBounds,
  type DensityFunction,
  type DensityNoiseSource,
  type DensityValue as DensityValueType,
  type NoiseFn3D,
  type NoiseSeed,
  createDensityFunctionRuntime,
  createDensityNoiseSource,
  createNoiseField,
  densityAdd,
  DensityBound as densityBound,
  densityConstant,
  densityMul,
  densityNoise,
  DensityScale as densityScale,
  DensityValue as densityValue,
  densityYClampedGradient,
} from '@nerima-games/mc-noise'
import { blockAxis, blockAxisFromKnownSafeInteger } from './coordinate-compatibility.js'
import { channelSeedValue, fbm2D } from './noise-compatibility.js'

/** Lowest Y sampled by the public surface query, matching the column fill pass after bedrock. */
export const MIN_SURFACE_Y = 1
export const MAX_SURFACE_Y = 210
export const CONTINENTALNESS_CONTRAST = 1.15

const DENSITY_BASE_MAGNITUDE = 1.45
const DENSITY_GRADIENT_TOP_Y = 133
const DENSITY_GRADIENT_START_Y = 0
const DENSITY_GRADIENT_END_VALUE = -DENSITY_BASE_MAGNITUDE
const DENSITY_GRADIENT_VALUE_DELTA = DENSITY_GRADIENT_END_VALUE - DENSITY_BASE_MAGNITUDE
const NOISE_FREQUENCY_UNIT = 1
const CONTINENTAL_XZ_WAVELENGTH_BLOCKS = 320
const CONTINENTAL_Y_WAVELENGTH_BLOCKS = 192
const CONTINENTAL_AMPLITUDE = 0.74
const REGIONAL_XZ_WAVELENGTH_BLOCKS = 96
const REGIONAL_Y_WAVELENGTH_BLOCKS = 80
const REGIONAL_AMPLITUDE = 0.27
const OVERHANG_XZ_WAVELENGTH_BLOCKS = 42
const OVERHANG_Y_WAVELENGTH_BLOCKS = 10
const OVERHANG_AMPLITUDE = 0.17
const DENSITY_MIN_BOUND = -1
const DENSITY_MAX_BOUND = 1
const DENSITY_SURFACE_THRESHOLD = 0
const SURFACE_SCAN_STEP = 1
const SURFACE_SCAN_START = MAX_SURFACE_Y
const UNIT_INTERVAL_MIN = 0
const UNIT_INTERVAL_MAX = 1
const UNIT_INTERVAL_MIDPOINT = 0.5
const CONTINENTALNESS_WAVELENGTH_BLOCKS = 180

const stretch = (value: number): number =>
  Math.min(
    UNIT_INTERVAL_MAX,
    Math.max(UNIT_INTERVAL_MIN, (value - UNIT_INTERVAL_MIDPOINT) * CONTINENTALNESS_CONTRAST + UNIT_INTERVAL_MIDPOINT),
  )

/** Retained for the coarse climate-query API; chunk generation uses the 3D density sampler below. */
export const continentalnessAt = (seed: NoiseSeed, wx: number, wz: number): number =>
  fbm2D(channelSeedValue(seed, 'continentalness'), wx, wz, {
    frequency: NOISE_FREQUENCY_UNIT / CONTINENTALNESS_WAVELENGTH_BLOCKS,
    octaves: 4,
    persistence: 0.5,
  })

export const surfaceHeightValueFromContinentalness = (continentalness: number): number =>
  Math.floor(MIN_SURFACE_Y + (MAX_SURFACE_Y - MIN_SURFACE_Y) * stretch(continentalness))

export const surfaceHeightFromContinentalness = (continentalness: number): BlockAxisValue => {
  const height = surfaceHeightValueFromContinentalness(continentalness)
  return blockAxis(height)
}

type TerrainDensityFailureFields = {
  readonly stage: 'construction' | 'evaluation'
  readonly message: string
}

export const TerrainDensityFailure: new (
  args: TerrainDensityFailureFields,
) => Error & { readonly _tag: 'TerrainDensityFailure' } & Readonly<TerrainDensityFailureFields> =
  // Effect's TaggedError is a factory, so its PascalCase API is called directly.
  // oxlint-disable-next-line new-cap
  Data.TaggedError('TerrainDensityFailure')<TerrainDensityFailureFields>

export type TerrainDensityFailure = InstanceType<typeof TerrainDensityFailure>

export type TerrainDensitySampler = Readonly<{
  readonly densityAt: (wx: BlockAxisValue, wy: BlockAxisValue, wz: BlockAxisValue) => Result.Result<DensityValueType, TerrainDensityFailure>
  readonly densityAtForGeneration: (wx: BlockAxisValue, wy: BlockAxisValue, wz: BlockAxisValue) => DensityValueType
  readonly surfaceHeightAt: (wx: BlockAxisValue, wz: BlockAxisValue) => Result.Result<BlockAxisValue, TerrainDensityFailure>
}>

const constructionFailure = (error: TypeError | RangeError): TerrainDensityFailure =>
  new TerrainDensityFailure({ message: error.message, stage: 'construction' })

const evaluationFailure = (error: TypeError | RangeError): TerrainDensityFailure =>
  new TerrainDensityFailure({ message: error.message, stage: 'evaluation' })

const createDensityLayer = (
  source: DensityNoiseSource,
  xzWavelength: number,
  yWavelength: number,
  amplitude: number,
): Result.Result<DensityFunction, TypeError | RangeError> =>
  Result.gen(function* buildDensityLayer() {
    const noise = yield* densityNoise(source, {
      xzScale: densityScale(NOISE_FREQUENCY_UNIT / xzWavelength),
      yScale: densityScale(NOISE_FREQUENCY_UNIT / yWavelength),
    })
    const scale = yield* densityConstant(densityValue(amplitude))
    return yield* densityMul(noise, scale)
  })

const buildTerrainDensity = (raw3d: NoiseFn3D): Result.Result<DensityFunction, TypeError | RangeError> => {
  const bounds: DensityBounds = {
    maxValue: densityBound(DENSITY_MAX_BOUND),
    minValue: densityBound(DENSITY_MIN_BOUND),
  }

  return Result.gen(function* buildDensity() {
    const source = yield* createDensityNoiseSource(raw3d, bounds)
    const continentalLayer = yield* createDensityLayer(
      source,
      CONTINENTAL_XZ_WAVELENGTH_BLOCKS,
      CONTINENTAL_Y_WAVELENGTH_BLOCKS,
      CONTINENTAL_AMPLITUDE,
    )
    const regionalLayer = yield* createDensityLayer(
      source,
      REGIONAL_XZ_WAVELENGTH_BLOCKS,
      REGIONAL_Y_WAVELENGTH_BLOCKS,
      REGIONAL_AMPLITUDE,
    )
    const overhangLayer = yield* createDensityLayer(
      source,
      OVERHANG_XZ_WAVELENGTH_BLOCKS,
      OVERHANG_Y_WAVELENGTH_BLOCKS,
      OVERHANG_AMPLITUDE,
    )
    const gradient = yield* densityYClampedGradient(
      blockAxisFromKnownSafeInteger(DENSITY_GRADIENT_START_Y),
      blockAxisFromKnownSafeInteger(DENSITY_GRADIENT_TOP_Y),
      densityValue(DENSITY_BASE_MAGNITUDE),
      densityValue(DENSITY_GRADIENT_END_VALUE),
    )
    const continentalShape = yield* densityAdd(gradient, continentalLayer)
    const regionalShape = yield* densityAdd(continentalShape, regionalLayer)
    return yield* densityAdd(regionalShape, overhangLayer)
  })
}

/**
 * Build one seed's 3D field. The broad field sets continent and ocean depth,
 * the regional field makes mountain-scale relief, and the short vertical field
 * creates ledges and overhangs that a height-only map cannot represent.
 */
export const createTerrainDensitySampler = (seed: NoiseSeed): Result.Result<TerrainDensitySampler, TerrainDensityFailure> => {
  const field = createNoiseField(seed)
  const density = Result.mapError(buildTerrainDensity(field.raw3d), constructionFailure)
  return Result.flatMap(density, (terrainDensity) => {
    const runtime = Result.mapError(createDensityFunctionRuntime(terrainDensity), constructionFailure)
    return Result.map(runtime, (densityRuntime) => {
      const densityAt = (wx: BlockAxisValue, wy: BlockAxisValue, wz: BlockAxisValue): Result.Result<DensityValueType, TerrainDensityFailure> =>
        Result.mapError(
          densityRuntime.compute({ x: positionAxis(wx), y: positionAxis(wy), z: positionAxis(wz) }),
          evaluationFailure,
        )

      // This fuses the same mc-noise density tree as buildTerrainDensity for the hot voxel loop.
      const densityAtForGeneration = (wx: BlockAxisValue, wy: BlockAxisValue, wz: BlockAxisValue): DensityValueType => {
        const gradientRatio = Math.max(
          UNIT_INTERVAL_MIN,
          Math.min(UNIT_INTERVAL_MAX, (wy - DENSITY_GRADIENT_START_Y) / DENSITY_GRADIENT_TOP_Y),
        )
        return densityValue(
          DENSITY_BASE_MAGNITUDE + DENSITY_GRADIENT_VALUE_DELTA * gradientRatio +
          field.raw3d(wx / CONTINENTAL_XZ_WAVELENGTH_BLOCKS, wy / CONTINENTAL_Y_WAVELENGTH_BLOCKS, wz / CONTINENTAL_XZ_WAVELENGTH_BLOCKS) * CONTINENTAL_AMPLITUDE +
          field.raw3d(wx / REGIONAL_XZ_WAVELENGTH_BLOCKS, wy / REGIONAL_Y_WAVELENGTH_BLOCKS, wz / REGIONAL_XZ_WAVELENGTH_BLOCKS) * REGIONAL_AMPLITUDE +
          field.raw3d(wx / OVERHANG_XZ_WAVELENGTH_BLOCKS, wy / OVERHANG_Y_WAVELENGTH_BLOCKS, wz / OVERHANG_XZ_WAVELENGTH_BLOCKS) * OVERHANG_AMPLITUDE,
        )
      }

      const surfaceHeightAt = (wx: BlockAxisValue, wz: BlockAxisValue): Result.Result<BlockAxisValue, TerrainDensityFailure> => {
        for (let wy = SURFACE_SCAN_START; wy >= MIN_SURFACE_Y; wy -= SURFACE_SCAN_STEP) {
          if (densityAtForGeneration(wx, blockAxisFromKnownSafeInteger(wy), wz) > DENSITY_SURFACE_THRESHOLD) {
            return Result.succeed(blockAxisFromKnownSafeInteger(wy))
          }
        }
        return Result.succeed(blockAxisFromKnownSafeInteger(MIN_SURFACE_Y))
      }

      return Object.freeze({ densityAt, densityAtForGeneration, surfaceHeightAt })
    })
  })
}

/** Sample the generated density surface using the same 3D function as chunk generation. */
export const surfaceHeightAtResult = (
  seed: NoiseSeed,
  wx: BlockAxisValue,
  wz: BlockAxisValue,
): Result.Result<BlockAxisValue, TerrainDensityFailure> =>
  Result.flatMap(createTerrainDensitySampler(seed), (sampler) => sampler.surfaceHeightAt(wx, wz))

/** Compatibility helper for callers with validated seed and block coordinates. */
export const surfaceHeightAt = (seed: NoiseSeed, wx: BlockAxisValue, wz: BlockAxisValue): BlockAxisValue =>
  Result.getOrThrow(surfaceHeightAtResult(seed, wx, wz))
