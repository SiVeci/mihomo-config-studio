import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
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
      },
      output: {
        // The `bootstrap` entry (JS and its CSS) needs names main.tsx can
        // hardcode — it is reached by literal strings, not a rewritten
        // import specifier or an HTML `<link>` Vite generates for us, since
        // nothing in index.html's own graph references it. Every other
        // output keeps Vite's normal content-hashed naming.
        entryFileNames: (chunkInfo) =>
          chunkInfo.name === 'bootstrap' ? 'assets/bootstrap.js' : 'assets/[name]-[hash].js',
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
  },
});
