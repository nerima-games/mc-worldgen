import { spawnSync } from 'node:child_process'
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

// Pattern follows the kernel-shape verify-package.mjs (D.10), adapted the way
// every sibling with @nerima-games/* runtime dependencies has to: this
// repository's dependencies (mc-kernel, mc-noise, mc-save) resolve through
// GitHub Packages (see .npmrc), which an ephemeral `npm install <tarball>`
// consumer directory has no credentials for. Importing dist/index.js directly
// from this checkout — instead of packing, reinstalling into a scratch
// directory, and importing from there — proves the same thing (the built
// artifact's exports actually work) without that registry dependency.
const root = process.cwd()
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const temporaryDirectory = mkdtempSync(join(tmpdir(), 'mc-worldgen-package-'))
const DEFAULT_COMMAND_TIMEOUT_MS = 120_000

const run = (command, args) => {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    timeout: DEFAULT_COMMAND_TIMEOUT_MS,
  })
  if (result.error !== undefined || result.status !== 0) {
    const reason = result.error?.message ?? (result.stderr?.trim() || `exit status ${String(result.status)}`)
    throw new Error(`${command} ${args.join(' ')} failed: ${reason}`)
  }
  return result.stdout
}

try {
  const runtime = await import(pathToFileURL(join(root, 'dist/index.js')).href)
  if (Object.keys(runtime).length === 0) {
    throw new Error('dist/index.js has no runtime exports')
  }

  // --- Chunk generation: overworld, nether, end -------------------------------
  if (
    typeof runtime.generateChunk !== 'function' ||
    typeof runtime.generateNetherChunk !== 'function' ||
    typeof runtime.generateEndChunk !== 'function' ||
    typeof runtime.chunkCoord !== 'function'
  ) {
    throw new Error('dist/index.js does not expose the chunk generation API')
  }
  const coord = runtime.chunkCoord(0, 0)
  const expectChunk = (chunk, label) => {
    if (chunk.coord !== coord) {
      throw new Error(`dist/index.js ${label} returned a chunk with the wrong coord`)
    }
    if (chunk.blocks.length !== runtime.CHUNK_VOLUME) {
      throw new Error(`dist/index.js ${label} returned blocks of the wrong length`)
    }
    if (chunk.biomes.length !== runtime.CHUNK_SIZE_XZ * runtime.CHUNK_SIZE_XZ) {
      throw new Error(`dist/index.js ${label} returned biomes of the wrong length`)
    }
    if (!Array.isArray(chunk.naturalStructureIds) || !Array.isArray(chunk.naturalStructureMarkers)) {
      throw new Error(`dist/index.js ${label} did not return natural structure arrays`)
    }
  }
  expectChunk(runtime.generateChunk(1, coord, { decorate: false }), 'generateChunk')
  expectChunk(runtime.generateNetherChunk(1, coord), 'generateNetherChunk')
  expectChunk(runtime.generateEndChunk(1, coord), 'generateEndChunk')

  // --- Persistence format -------------------------------------------------------
  if (typeof runtime.CHUNK_FORMAT !== 'object' || runtime.CHUNK_FORMAT === null) {
    throw new Error('dist/index.js does not expose CHUNK_FORMAT')
  }

  // --- Nether travel & coordinate transforms -------------------------------------
  if (
    typeof runtime.resolveNetherTravel !== 'function' ||
    typeof runtime.overworldToNether !== 'function' ||
    typeof runtime.netherToOverworld !== 'function'
  ) {
    throw new Error('dist/index.js does not expose the Nether travel API')
  }
  const netherPosition = runtime.overworldToNether({ x: -1, y: 64, z: 8 })
  if (netherPosition.x !== -1 || netherPosition.y !== 64 || netherPosition.z !== 1) {
    throw new Error('dist/index.js overworldToNether returned an invalid position')
  }
  const travel = runtime.resolveNetherTravel('overworld', { x: 0, y: 64, z: 0 }, [])
  if (travel.toDimension !== 'nether') {
    throw new Error('dist/index.js resolveNetherTravel returned an invalid result')
  }

  // --- Portal registry service & format --------------------------------------------
  if (runtime.PortalRegistry === undefined || runtime.PORTAL_REGISTRY_FORMAT === undefined) {
    throw new Error('dist/index.js does not expose the portal registry service and format')
  }

  // --- End features: spikes, gateways -----------------------------------------------
  if (
    typeof runtime.endFeaturePlanForSeed !== 'function' ||
    typeof runtime.createEndGatewayPlacement !== 'function' ||
    typeof runtime.resolveEndGatewayExit !== 'function' ||
    typeof runtime.knownEndGatewayExit !== 'function'
  ) {
    throw new Error('dist/index.js does not expose the End feature API')
  }
  const plan = runtime.endFeaturePlanForSeed(1)
  if (plan.spikes.length !== 10) {
    throw new Error('dist/index.js endFeaturePlanForSeed returned an invalid plan')
  }
  const placement = runtime.createEndGatewayPlacement({ x: 0, y: 64, z: 0 })
  if (!placement.blocks.some(({ block }) => block === runtime.END_GATEWAY_BLOCK.GATEWAY)) {
    throw new Error('dist/index.js createEndGatewayPlacement returned no gateway block')
  }

  // --- Nether fortress siting -----------------------------------------------------
  if (
    typeof runtime.planNetherFortressForRegion !== 'function' ||
    typeof runtime.isNearFortressSite !== 'function'
  ) {
    throw new Error('dist/index.js does not expose the Nether fortress siting API')
  }

  run('pnpm', ['pack', '--pack-destination', temporaryDirectory, '--silent'])
  const archiveName = readdirSync(temporaryDirectory).find((name) => name.endsWith('.tgz'))
  if (archiveName === undefined) {
    throw new Error('pnpm pack produced no archive')
  }

  const archive = join(temporaryDirectory, archiveName)
  const entries = new Set(run('tar', ['-tzf', archive]).split('\n').filter(Boolean))
  for (const entry of ['package/dist/index.js', 'package/dist/index.d.ts']) {
    if (!entries.has(entry)) {
      throw new Error(`package archive is missing ${entry}`)
    }
  }
  if ([...entries].some((entry) => entry.startsWith('package/src/') || entry.startsWith('package/test/'))) {
    throw new Error('package archive contains source or test files')
  }
  console.log(`verified ${packageJson.name} archive ${archiveName}`)
} finally {
  rmSync(temporaryDirectory, { force: true, recursive: true })
}
