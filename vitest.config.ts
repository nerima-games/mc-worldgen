import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    pool: 'forks',
    poolOptions: {
      forks: {
        // Keep coverage-time worker RPC responsive on hosts with many cores.
        maxForks: 2,
        minForks: 1,
        isolate: true,
        singleFork: false,
      },
    },
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
      include: ['src/index.ts', 'src/domain/**/*.ts', 'src/application/**/*.ts'],
      exclude: [
        '**/*.d.ts',
        '**/*.config.ts',
        '**/*.test.ts',
        '**/*.spec.ts',
      ],
      all: true,
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
