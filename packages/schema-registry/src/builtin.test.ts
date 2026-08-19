import { describe, expect, it } from 'vitest';

import {
  BUILTIN_BUNDLE,
  BUILTIN_MANIFEST,
  BUILTIN_MODULE,
  BUILTIN_MODULE_PATH,
  BUILTIN_TRUST_ANCHOR_PUBLIC_KEY_HEX,
} from './builtin.js';
import { hexToBytes, sha256Hex, verifyBundle } from './verify.js';

/**
 * The re-issue regression fence (v0.3.0 E5): every module slice (#6-#11)
 * that touches `@mcs/schema-builtin`'s content changes the bytes
 * `BUILTIN_MANIFEST.files[]` promises a hash for, which changes the
 * manifest, which invalidates the signature over it. Whoever forgets to
 * re-sign after editing module content gets caught here, not in
 * production — silently shipping a manifest whose declared hash no longer
 * matches its own module content would be worse than a loud test failure.
 */
describe('built-in bundle re-issue regression (v0.3.0 E5)', () => {
  it('recomputes the SHA-256 of every module file and matches BUILTIN_MANIFEST.files[]', async () => {
    for (const [path, module] of Object.entries(BUILTIN_BUNDLE.modules)) {
      const bytes = new TextEncoder().encode(JSON.stringify(module));
      const actualHash = await sha256Hex(bytes);
      const declared = BUILTIN_MANIFEST.files.find((file) => file.path === path);

      expect(declared, `no BUILTIN_MANIFEST.files[] entry for ${path}`).toBeDefined();
      expect(actualHash, `${path} content hash drifted from BUILTIN_MANIFEST — re-sign it`).toBe(
        declared?.sha256,
      );
    }
  });

  it('has exactly one BUILTIN_MANIFEST.files[] entry per bundle module — neither list has an orphan', () => {
    const modulePaths = Object.keys(BUILTIN_BUNDLE.modules).sort();
    const manifestPaths = BUILTIN_MANIFEST.files.map((file) => file.path).sort();
    expect(manifestPaths).toEqual(modulePaths);
  });

  it('the manifest signature verifies against the current trust anchor public key (full verifyBundle, not just a hash check)', async () => {
    const files = new Map<string, Uint8Array>(
      Object.entries(BUILTIN_BUNDLE.modules).map(([path, module]) => [
        path,
        new TextEncoder().encode(JSON.stringify(module)),
      ]),
    );

    const result = await verifyBundle(BUILTIN_MANIFEST, files, {
      currentAppVersion: BUILTIN_MANIFEST.requiresApp,
      minFormatVersion: BUILTIN_MANIFEST.formatVersion,
      maxFormatVersion: BUILTIN_MANIFEST.formatVersion,
      trustedPublicKeys: [hexToBytes(BUILTIN_TRUST_ANCHOR_PUBLIC_KEY_HEX)],
    });

    expect(result).toEqual({ ok: true, manifest: BUILTIN_MANIFEST });
  });

  it('BUILTIN_MODULE / BUILTIN_MODULE_PATH still point at a module actually present in the bundle', () => {
    expect(BUILTIN_BUNDLE.modules[BUILTIN_MODULE_PATH]).toBe(BUILTIN_MODULE);
  });
});
