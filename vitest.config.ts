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
        // bootstrap.tsx (v0.6.0 #1, ADR-027) is main.tsx's former body,
        // relocated behind a dynamic import for WebView syntax isolation —
        // same "just wiring" rationale, not new logic to cover.
        'apps/web/src/main.tsx',
        'apps/web/src/bootstrap.tsx',
        'apps/web/src/worker/config.worker.ts',
        // Same "just wiring" rationale (ADR-029, v0.6.0 #7): sw.ts's only
        // real logic is isPrecacheManifest, covered directly in
        // precache-manifest.test.ts. The rest is ServiceWorkerGlobalScope
        // API orchestration (install/activate/fetch event wiring, Cache
        // Storage calls) that a jsdom mock would test against an
        // approximation of the real API surface, not the real one — the
        // two genuine bugs this slice found (a `load`-event race, and
        // `vite preview`'s `Vary: Origin` header causing default
        // vary-sensitive cache matching to miss) were both invisible to
        // any mock and only surfaced by loading a real build in a real
        // browser and going properly offline.
        'apps/web/src/pwa/sw.ts',
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
