import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';

import type { PrecacheManifest } from './src/pwa/precache-manifest.js';

// Fresh on every build, shared by `define.__SW_BUILD_ID__` below and the
// `precacheManifestPlugin`'s own `buildId` field — the one thing `sw.ts`
// needs to guarantee its bundled bytes differ from the previous build's
// `sw.js`, which is what makes the browser's own byte-comparison update
// check ever notice a new version exists (ADR-029).
const SW_BUILD_ID = String(Date.now());

/**
 * ADR-029: `sw.ts` fetches this file at `install` time rather than having
 * the asset list baked into its own bundle — baking it in would need the
 * *other* entries' hashed output names before `sw.ts` itself builds, which
 * `rollupOptions.input` has no ordering hook for. `writeBundle` runs after
 * Rollup has written every other output file, so `bundle` already has each
 * one's final hashed `fileName`.
 */
function precacheManifestPlugin(): Plugin {
  return {
    name: 'mcs-precache-manifest',
    apply: 'build',
    writeBundle(options, bundle) {
      // `index.html` comes from Rollup's own `bundle` (it is the `main`
      // input); `manifest.webmanifest` and `icon.svg` do not — both live in
      // `public/` so their URLs stay stable and unhashed for
      // `manifest.webmanifest`'s own `icons` field to reference, which
      // means Vite copies them straight through without ever telling
      // Rollup about them.
      const bundledFiles = Object.values(bundle)
        .map((entry) => entry.fileName)
        .filter((fileName) => fileName !== 'sw.js')
        .map((fileName) => `/${fileName}`);
      const files = [...new Set([...bundledFiles, '/manifest.webmanifest', '/icon.svg'])];
      const manifest: PrecacheManifest = { buildId: SW_BUILD_ID, files };
      writeFileSync(
        join(options.dir ?? 'dist', 'precache-manifest.json'),
        JSON.stringify(manifest),
      );
    },
  };
}

export default defineConfig({
  plugins: [react(), precacheManifestPlugin()],
  build: {
    // Explicit syntax baseline (ADR-027), replacing Vite's implicit
    // `'modules'` default: Vite 6's own "baseline widely available" set.
    // Syntax only — esbuild never polyfills runtime methods (`replaceAll`,
    // `indexedDB`, ...), which is why `platform/capabilities.ts` exists as
    // a separate runtime gate.
    target: ['chrome107', 'edge107', 'firefox104', 'safari16'],
    // Vite's modulepreload polyfill (ADR-027): unrelated to the rollupOptions
    // below, but same motivation — no reason to inject an extra IIFE this
    // app doesn't need.
    modulePreload: false,
    rollupOptions: {
      // Two independent entries, not one entry plus a dynamic import
      // (ADR-027): Vite's `import()` transform *always* wraps a dynamic
      // import in its `__vitePreload` runtime helper, and that helper's own
      // code uses `?.` — confirmed empirically on a real Chrome 74 AVD to
      // break parsing of main.tsx's entire chunk, no config flag turns it
      // off. Declaring `bootstrap.tsx` as its own Rollup input instead makes
      // it a fully separate chunk that main.tsx reaches via a plain
      // `document.createElement('script')` (see main.tsx) — vanilla DOM,
      // invisible to Vite's import-analysis plugin, so nothing gets wrapped.
      input: {
        main: 'index.html',
        bootstrap: 'src/bootstrap.tsx',
        // A third stable-named entry, same reasoning as `bootstrap` below:
        // `register.ts` reaches it by the literal `/sw.js`, and a Service
        // Worker's default scope is everything *at or below* its own URL
        // path — `assets/sw.js` would only ever be able to control
        // `assets/*`, not the whole origin (ADR-029).
        sw: 'src/pwa/sw.ts',
      },
      output: {
        // The `bootstrap` entry (JS and its CSS) needs names main.tsx can
        // hardcode — it is reached by literal strings, not a rewritten
        // import specifier or an HTML `<link>` Vite generates for us, since
        // nothing in index.html's own graph references it. Every other
        // output keeps Vite's normal content-hashed naming. `sw` needs the
        // same treatment, for the scope reason above.
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === 'bootstrap') return 'assets/bootstrap.js';
          if (chunkInfo.name === 'sw') return 'sw.js';
          return 'assets/[name]-[hash].js';
        },
        assetFileNames: (assetInfo) =>
          assetInfo.name === 'bootstrap.css'
            ? 'assets/bootstrap.css'
            : 'assets/[name]-[hash][extname]',
      },
    },
  },
  define: {
    // Build-time trust anchor override (ADR-010 §3, v0.5.0 decision F4):
    // read by apps/web/src/bundle/trust-anchors.ts. `JSON.stringify` runs
    // here, in Node, at config-eval time — it always receives a defined
    // value (the env var's string, or `null`), so the inlined code is
    // always an unambiguous string literal or the literal `null`, never
    // the bare JS value `undefined` (which would still work by accident,
    // but is not worth relying on). Unset until #14 has a real production
    // public key to inject.
    __TRUST_ANCHOR_OVERRIDES__: JSON.stringify(process.env.MCS_TRUST_ANCHOR_OVERRIDES_JSON ?? null),
    // Build-time Bundle update source override (v0.6.0 #0): read by
    // apps/web/src/bundle/update-sources.ts. Same `JSON.stringify`-at-config-eval
    // reasoning as __TRUST_ANCHOR_OVERRIDES__ above. Unset in production until
    // #12 decides whether a remote source is configured for Beta.
    __BUNDLE_UPDATE_SOURCES__: JSON.stringify(process.env.MCS_BUNDLE_UPDATE_SOURCES_JSON ?? null),
    // ADR-029: read only by `src/pwa/sw.ts`, see `SW_BUILD_ID` above.
    __SW_BUILD_ID__: JSON.stringify(SW_BUILD_ID),
  },
});
