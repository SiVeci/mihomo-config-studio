import { defineConfig } from 'vitest/config';

/**
 * A separate config for tests too slow for the default suite (currently just
 * `import-success-rate.test.ts`, ADR-037/v1.0.0 #3: ~150s for 30 real ~1 MB
 * corpora) — `vitest.config.ts`'s own `exclude` list keeps this file out of
 * `pnpm run test`/`check`/`test:coverage` (a plain `vitest run <path>` still
 * honours `exclude`, even for an explicitly-named file, so exclusion there
 * alone would make the file unrunnable by *any* command). This config's own
 * `include` names it directly and carries no matching `exclude`, so `pnpm
 * run test:import-success-rate`/the dedicated CI step can still reach it.
 */
export default defineConfig({
  test: {
    include: ['packages/validator/src/import-success-rate.test.ts'],
    environment: 'node',
  },
});
