import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

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
  },
});
