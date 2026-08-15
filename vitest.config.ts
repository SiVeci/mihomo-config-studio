import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/*/src/**/*.test.ts',
      'packages/*/src/**/*.test.tsx',
      'tools/*/src/**/*.test.ts',
      'apps/web/src/**/*.test.ts',
      'apps/web/src/**/*.test.tsx',
    ],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'lcov'],
      include: [
        'packages/*/src/**/*.ts',
        'packages/*/src/**/*.tsx',
        'tools/*/src/**/*.ts',
        'apps/web/src/**/*.ts',
        'apps/web/src/**/*.tsx',
      ],
      exclude: [
        'packages/*/src/**/*.test.ts',
        'packages/*/src/**/*.test.tsx',
        'packages/*/src/**/*.bench.ts',
        'packages/*/src/testing/**',
        'packages/test-fixtures/**',
        'tools/*/src/**/*.test.ts',
        'apps/web/src/**/*.test.ts',
        'apps/web/src/**/*.test.tsx',
        // Bootstrap entry points: no logic of their own to cover (the real
        // logic behind config.worker.ts lives in protocol.ts, which is
        // covered directly since it needs no Worker global to run).
        'apps/web/src/main.tsx',
        'apps/web/src/worker/config.worker.ts',
      ],
      // NFR-MAINT: core packages (and, from #10 on, tools/**) target >= 85% line coverage.
      thresholds: {
        lines: 85,
        functions: 85,
        branches: 80,
        statements: 85,
      },
    },
  },
});
