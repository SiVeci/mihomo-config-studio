import { matchesGlob } from 'node:path';

import { configDefaults, defineConfig } from 'vitest/config';

const include = [
  'packages/*/src/**/*.test.ts',
  'packages/*/src/**/*.test.tsx',
  'tools/*/src/**/*.test.ts',
  'apps/web/src/**/*.test.ts',
  'apps/web/src/**/*.test.tsx',
];

/**
 * `import-success-rate.test.ts` (ADR-037, v1.0.0 #3) generates and fully
 * validates 30 real ~1 MB corpora — real, measured cost is ~150s, unlike
 * every other file `include` above matches. Left in the default suite it
 * would add 150s to every `pnpm run test`/`check`/`test:coverage` invocation
 * a contributor runs locally, not just CI. Excluded here and run instead as
 * its own named `ci.yml` step (same reasoning as v0.9.0 #19's "release
 * blocker" steps: an expensive or release-critical check gets its own named
 * step, not buried inside the 2000+-case default run) — see the
 * `1 MB import success rate` step.
 */
const EXCLUDED_FROM_DEFAULT_SUITE = ['packages/validator/src/import-success-rate.test.ts'];

// ADR-033 (v0.9.0 #7): `e2e/**` is Playwright's own suite, run only via
// `pnpm run e2e`, never through vitest — none of the patterns above can
// reach it today (all five are scoped under `packages|tools|apps/web`'s own
// `src/`), but that's only true as long as nobody loosens one into
// something repo-root-reaching. This runs on every vitest invocation
// (`pnpm run test`/`check`/`test:coverage` all load this file), so a future
// overly-broad pattern fails loudly here instead of quietly running
// browser-driven specs through the wrong runner.
for (const e2ePath of ['e2e/web.spec.ts', 'e2e/fixtures.ts']) {
  if (include.some((pattern) => matchesGlob(e2ePath, pattern))) {
    throw new Error(
      `vitest.config.ts's include patterns must never match e2e/** (matched ${e2ePath}) — Playwright's suite is a separate runner (ADR-033).`,
    );
  }
}

export default defineConfig({
  test: {
    include,
    exclude: [...configDefaults.exclude, ...EXCLUDED_FROM_DEFAULT_SUITE],
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
