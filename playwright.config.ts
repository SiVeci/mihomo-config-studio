import { defineConfig, devices } from '@playwright/test';

import { BUNDLE_SOURCE_BASE_PATH, loadOrGenerateBundleFixtureSet } from './e2e/bundle-fixtures.js';

const PORT = 4173;

/**
 * v0.9.0 #8: `e2e/update.spec.ts` needs a Bundle candidate real
 * `verifyBundle` will actually accept, which means the app's build has to
 * trust whatever key signed it — `MCS_TRUST_ANCHOR_OVERRIDES_JSON` is a
 * Vite `define` resolved at `vite build` time (`apps/web/vite.config.ts`),
 * so this has to run before `webServer.command` below, not inside a test.
 */
const bundleFixtures = await loadOrGenerateBundleFixtureSet();

/** `NodeJS.ProcessEnv`'s index signature is `string | undefined`; `webServer.env` wants plain `string` — this repo's `exactOptionalPropertyTypes` needs the explicit filter, not just a spread. */
function definedEnvEntries(): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) result[key] = value;
  }
  return result;
}

/**
 * ADR-033: the tested target is the real, built production bundle, never
 * `vite dev`. `apps/web/src/main.tsx` hardcodes `/assets/bootstrap.js` and
 * `/assets/bootstrap.css` (ADR-027's two-entry split, exact filenames
 * `vite.config.ts` pins) — only a real `vite build` output has those,
 * confirmed the hard way in v0.6.0 #6.
 */
export default defineConfig({
  testDir: './e2e',
  // `e2e/tsconfig.json`'s own `outDir` (needed for `tsc -b`'s project-
  // reference graph, since `-b` mode requires real emit) lands compiled
  // specs inside `e2e/dist/` — without this, Playwright's default recursive
  // scan finds and runs each spec twice, once from source and once from
  // that stale build output. Same glob `eslint.config.js` already uses to
  // exclude `dist/` everywhere else in this repo.
  testIgnore: '**/dist/**',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  ...(process.env.CI ? { workers: 1 } : {}),
  reporter: 'list',
  // A cold IndexedDB open in a brand-new browser profile (every test gets
  // one) has been observed to take noticeably longer than Playwright's
  // 5s default on this machine — raised once, globally, rather than
  // sprinkling per-assertion timeouts across the spec file.
  expect: { timeout: 15_000 },
  use: {
    baseURL: `http://localhost:${String(PORT)}`,
    trace: 'on-first-retry',
  },
  // Chromium only (ADR-027's baseline is Chrome 107 / Chromium-family) —
  // no reason to also install and run Firefox/WebKit for an app whose own
  // supported-browser story is Chromium-based WebViews plus desktop Chrome.
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `pnpm run build && pnpm --filter @mcs/web exec vite preview --port ${String(PORT)} --strictPort`,
    url: `http://localhost:${String(PORT)}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      ...definedEnvEntries(),
      MCS_TRUST_ANCHOR_OVERRIDES_JSON: JSON.stringify([bundleFixtures.trustedPublicKeyHex]),
      MCS_BUNDLE_UPDATE_SOURCES_JSON: JSON.stringify({
        stable: {
          manifestUrl: `${BUNDLE_SOURCE_BASE_PATH}/manifest.json`,
          fileBaseUrl: BUNDLE_SOURCE_BASE_PATH,
        },
      }),
    },
  },
});
