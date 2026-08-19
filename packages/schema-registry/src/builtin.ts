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
 * v0.1.0 #8; #7 re-issued it again to add `modules/dns.json` and to cover
 * `general`'s own `hosts` field addition — every subsequent module slice
 * (#8-#11) must do the same.
 */
export const BUILTIN_TRUST_ANCHOR_PUBLIC_KEY_HEX =
  '40818f26c8ec42d6c90d23d42af7faa61d450639f847dd4ceab700f348b1bf6e';

export const BUILTIN_MANIFEST: BundleManifest = {
  bundleId: 'builtin',
  version: '0.3.0',
  channel: 'stable',
  formatVersion: 1,
  requiresApp: '0.1.0',
  files: [
    {
      path: 'modules/dns.json',
      sha256: '8eb6a713fab06359f7ad3760f107fdc3106f54022725fcc2ac8273d839f4740b',
    },
    {
      path: BUILTIN_MODULE_PATH,
      sha256: '1ad10dd3d229d69053d5f7ac80c311b5a84a238bedb51c9ff57d1779e74d9418',
    },
  ],
  signature:
    '9d37368dbdf6c8c41fb84195ea517046500797051e1bd5b36cbd85b9f21ed86acbc05132a87b79b225f1dc18ac11982dc7f8876e77a585d550e57ee1076f4002',
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
