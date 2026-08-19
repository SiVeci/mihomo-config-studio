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
 * v0.1.0 #8; #7 added `modules/dns.json` and a `general` `hosts` field;
 * #8 added `modules/sniffer.json` and `modules/inbound.json`; #9 added
 * `modules/proxies.json` (four protocols); #10 grew it to all nine P0
 * protocols — every subsequent module slice (#11) must do the same.
 */
export const BUILTIN_TRUST_ANCHOR_PUBLIC_KEY_HEX =
  'd8b6c8c4e8f41f1037b47d412ef11ca783bd5a5b6e7c86eb984d6faf00d525c4';

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
    {
      path: 'modules/inbound.json',
      sha256: '529d1b156059ee610b1aef6afe3787dabec325662e6ed3bffec29a3977d57672',
    },
    {
      path: 'modules/proxies.json',
      sha256: '54ab86c30b1d9da7f35e2511c0f024bae486fbf2bab13f057ec6a1f7895a36c8',
    },
    {
      path: 'modules/sniffer.json',
      sha256: '9baf3d27faadc058f96b7569303ba8175a25bf47eccc196d0417fcdc533e692c',
    },
  ],
  signature:
    'a63b4ce1071ad7a5875a96fc70bd0afd7edd46ce4b5f19abda1f2bab1c97c7551a19ed504e610c134fde642832120ed7da0bffb68563eebfdbad9f528f525700',
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
