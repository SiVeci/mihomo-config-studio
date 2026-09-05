import { defineConfig } from 'vitest/config';

/**
 * A separate config for `schema-release.yml`'s own pack/sign steps
 * (v1.0.0 #10) — same reasoning as `vitest.slow.config.ts`: `vitest.
 * config.ts`'s own `exclude` list keeps these files out of `pnpm run test`/
 * `check`/`test:coverage` (a plain `vitest run <path>` still honours
 * `exclude`, even for an explicitly-named file, so exclusion there alone
 * would make the files unrunnable by *any* command). This config's own
 * `include` names them directly and carries no matching `exclude`, so
 * `pnpm run schema-release:pack`/`schema-release:sign` — and the workflow
 * steps that call them — can still reach them.
 */
export default defineConfig({
  test: {
    include: [
      'tools/schema-cli/src/ci-pack-builtin.test.ts',
      'tools/schema-cli/src/ci-sign-manifest.test.ts',
    ],
    environment: 'node',
  },
});
