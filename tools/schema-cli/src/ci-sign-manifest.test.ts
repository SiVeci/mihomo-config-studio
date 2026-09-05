import { readFileSync, writeFileSync } from 'node:fs';

import type { BundleManifest } from '@mcs/schema-registry';
import { describe, expect, it } from 'vitest';

import { decodePrivateKeyBase64, signManifest } from './sign.js';

/**
 * CI-only glue (v1.0.0 #10) — same module-resolution reasoning as
 * `ci-pack-builtin.test.ts`. Runs only inside `schema-release.yml`'s
 * `environment: schema-release`-gated `sign-and-release` job, the only place
 * `SCHEMA_SIGNING_KEY_B64` is ever available (ADR-010 §4: the key is read
 * from `process.env`, never a command-line argument or a shell-interpolated
 * string).
 */
describe('CI: sign the unsigned manifest with the production key', () => {
  it('reads, signs, and writes the signed manifest', async () => {
    const manifestIn = process.env.CI_SIGN_MANIFEST_IN;
    if (!manifestIn) {
      // Not a CI invocation. No-op rather than fail; excluded from the
      // default suite (`vitest.config.ts`) so it should never get here.
      return;
    }

    const manifestOut = requireEnv('CI_SIGN_MANIFEST_OUT');
    const privateKeyBase64 = requireEnv('SCHEMA_SIGNING_KEY_B64');

    const manifest = JSON.parse(readFileSync(manifestIn, 'utf8')) as BundleManifest;
    const privateKeyPkcs8 = decodePrivateKeyBase64(privateKeyBase64);
    const signature = await signManifest(manifest, privateKeyPkcs8);

    writeFileSync(manifestOut, JSON.stringify({ ...manifest, signature }, null, 2));
    expect(signature).toHaveLength(128);
  });
});

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}
