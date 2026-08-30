import { defineConfig } from 'vitest/config'

// isolatedDeclarations (tsconfig.base.json) requires an explicit type
// annotation on every exported symbol, including a default export built from
// an expression — `defineConfig(...)`'s inferred return type does not count.
const config: ReturnType<typeof defineConfig> = defineConfig({
  test: {
    environment: 'node',
    globals: false,
    pool: 'forks',
    // vitest 4 flattened the old poolOptions.forks.{maxForks,minForks,isolate,
    // singleFork} shape to top-level fields (poolOptions no longer exists on
    // InlineConfig). `maxWorkers` keeps coverage-time worker RPC responsive on
    // hosts with many cores; `isolate` is unchanged from before.
    isolate: true,
    maxWorkers: 2,
    include: ['test/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/coverage/**', '**/.git/**'],
    // 60s, not 10s: several property-based / golden-fixture tests
    // (test/ore.test.ts O-5, test/chunk-golden.test.ts I-8, test/carver.test.ts)
    // run real terrain generation many times over and take 15-25s under plain
    // `pnpm test`, but multiple times longer under v8 coverage instrumentation
    // (`pnpm test:coverage`). At the previous 10s value they timed out under
    // coverage even though nothing was actually wrong — this is headroom for
    // instrumentation overhead, not a change to what the tests assert.
    testTimeout: 60000,
    hookTimeout: 60000,
    teardownTimeout: 5000,
    slowTestThreshold: 300,
    fileParallelism: true,
    sequence: {
      seed: 0,
      hooks: 'stack',
    },
    reporters: ['default'],
    coverage: {
      provider: 'v8',
      enabled: false,
      include: ['src/**/*.ts'],
      exclude: [
        '**/*.d.ts',
        '**/*.config.ts',
        '**/*.test.ts',
        '**/*.spec.ts',
      ],
      reporter: ['text', 'json', 'html', 'lcov'],
      reportsDirectory: './coverage',
      // TEST_STANDARD.md §3: 4-metric 100% gate, enabled org-wide, no phase-in.
      thresholds: { branches: 100, functions: 100, lines: 100, statements: 100 },
    },
  },
  esbuild: {
    target: 'node24',
    format: 'esm',
    platform: 'node',
  },
})

export default config
