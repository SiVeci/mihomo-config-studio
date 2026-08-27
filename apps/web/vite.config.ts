import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
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
  },
});
