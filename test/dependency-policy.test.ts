import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { relative, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const projectRoot = fileURLToPath(new URL('../', import.meta.url))
const sourceRoot = fileURLToPath(new URL('../src/', import.meta.url))
const packageJsonPath = fileURLToPath(new URL('../package.json', import.meta.url))
const lockfilePath = fileURLToPath(new URL('../pnpm-lock.yaml', import.meta.url))
const importPattern = /(?:from\s+|import\s*(?:\(\s*)?)['"]three(?:\/[^'"]*)?['"]/u
const forbiddenRuntimeDependencyPattern = /(?:^|\/)(?:mc-meshing|mc-render|mc-sim|three)(?:\/|$)/u
const forbiddenLockfileDependencyPattern = /(?:^|[/'"\s])(?:mc-meshing|mc-render|mc-sim|three)(?=$|[/@:'"])/u

type PackageManifest = Readonly<{
  readonly dependencies?: Readonly<Record<string, string>>
}>

type PnpmDependencyTree = Readonly<{
  readonly dependencies?: Readonly<Record<string, PnpmDependencyTree>>
  readonly optionalDependencies?: Readonly<Record<string, PnpmDependencyTree>>
  readonly peerDependencies?: Readonly<Record<string, PnpmDependencyTree>>
}>

const resolvedProductionDependencyNames = (): ReadonlySet<string> => {
  const roots = JSON.parse(
    execFileSync('pnpm', ['list', '--prod', '--depth', 'Infinity', '--json'], {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }),
  ) as ReadonlyArray<PnpmDependencyTree>
  const names = new Set<string>()
  const visit = (tree: PnpmDependencyTree): void => {
    for (const dependencies of [tree.dependencies, tree.optionalDependencies, tree.peerDependencies]) {
      for (const [name, dependency] of Object.entries(dependencies ?? {})) {
        names.add(name)
        visit(dependency)
      }
    }
  }

  expect(roots.length).toBeGreaterThan(0)
  roots.forEach(visit)
  return names
}

const sourceFilesUnder = (directory: string): ReadonlyArray<string> =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      return sourceFilesUnder(path)
    }
    return entry.isFile() && path.endsWith('.ts') ? [path] : []
  })

describe('dependency policy', () => {
  it('keeps renderer and simulation packages out of runtime dependencies', () => {
    const manifest = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as PackageManifest
    const runtimeDependencies = Object.keys(manifest.dependencies ?? {})
    const offenders = runtimeDependencies.filter((dependency) =>
      forbiddenRuntimeDependencyPattern.test(dependency),
    )

    expect(offenders).toEqual([])
  })

  it('keeps renderer and simulation packages out of the resolved dependency lockfile', () => {
    const lockfile = readFileSync(lockfilePath, 'utf8')

    expect(lockfile.length).toBeGreaterThan(0)
    expect(lockfile).not.toMatch(forbiddenLockfileDependencyPattern)
  })

  it('keeps renderer and simulation packages out of the production dependency graph', () => {
    const names = resolvedProductionDependencyNames()
    const offenders = [...names].filter((name) => forbiddenRuntimeDependencyPattern.test(name)).sort()

    expect(names.size).toBeGreaterThan(0)
    expect(offenders).toEqual([])
  })

  it('keeps three.js out of every source module', () => {
    const sourceFiles = sourceFilesUnder(sourceRoot)
    expect(sourceFiles.length).toBeGreaterThan(0)

    const offenders = sourceFiles
      .filter((path) => importPattern.test(readFileSync(path, 'utf8')))
      .map((path) => relative(sourceRoot, path))
      .sort()

    expect(offenders).toEqual([])
  })
})
