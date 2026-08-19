import { BUILTIN_MODULE_FILES, GENERAL_MODULE } from '@mcs/schema-builtin';
import type { SchemaModule } from '@mcs/schema-core';

import type { BundleManifest } from './manifest.js';

/**
 * Real module content lives in `@mcs/schema-builtin`, assembled from the
 * same on-disk JSON layout `schema-cli pack` will eventually sign and ship
 * (ADR-020). This file's only job is turning that content into a *signed*
 * `BundleManifest` — the module source itself is not this package's
 * concern, and `schema-registry` intentionally does not know how a module
 * is built, only how to verify and serve one.
 */
export const BUILTIN_MODULE_PATH = 'modules/general.json';
export const BUILTIN_MODULE: SchemaModule = GENERAL_MODULE;

/**
 * The file hash(es) below are `sha256(JSON.stringify(<module>))` for each
 * entry in `files`, and the signature is a real Ed25519 signature
 * (verifiable with `verifyBundle`) over `canonicalManifestJson` of this
 * manifest. Both were computed once offline with a key pair generated
 * solely to bootstrap this built-in bundle — that private key was
 * discarded immediately after signing and is not, and has never been,
 * stored anywhere. This is a bootstrap trust anchor, not the production
 * signing key described in ADR-010 §2/§3 (GitHub Environment secret,
 * `[current, next]` rotation): `tools/schema-cli` must re-issue this file
 * against the real key custody workflow before any Bundle-update feature
 * ships to users (v0.5.0). v0.3.0 #6 re-issued this bootstrap signature
 * because `general`'s real content replaced the placeholder module from
 * v0.1.0 #8 — every subsequent module slice (#7-#11) must do the same.
 */
export const BUILTIN_TRUST_ANCHOR_PUBLIC_KEY_HEX =
  '84c6f68ca044832402739d1def4a2bfac3810fd005c962668dd413859b0e842c';

export const BUILTIN_MANIFEST: BundleManifest = {
  bundleId: 'builtin',
  version: '0.3.0',
  channel: 'stable',
  formatVersion: 1,
  requiresApp: '0.1.0',
  files: [
    {
      path: BUILTIN_MODULE_PATH,
      sha256: '772f2ac6136e0e5f2c9cbf6e445ea75360e958f536a9f63b28b972ca5bccb45f',
    },
  ],
  signature:
    '8ac06191e9767487cb7bb2dc7d399fecce438266550a679b9179e89882f301f8a0b4f46d04491dcf00e00182464e389f814ccbcc25118b8046dd5b283561af09',
  signedAt: '2026-08-19T00:00:00Z',
};

export interface BuiltinBundle {
  readonly manifest: BundleManifest;
  readonly modules: Readonly<Record<string, SchemaModule>>;
}

export const BUILTIN_BUNDLE: BuiltinBundle = {
  manifest: BUILTIN_MANIFEST,
  modules: BUILTIN_MODULE_FILES,
};
