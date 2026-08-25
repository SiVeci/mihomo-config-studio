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
 * protocols; #11 fixed a latent `proxies` masking gap (`obfs-password` was
 * `sensitive: true` without `control: 'secret'` — `sensitive` alone does not
 * drive control selection, see #11's plan notes) and added
 * `modules/proxy-providers.json`, the sixth P0 module; #17 changed
 * `proxy-providers`' `url` field from the generic `secret` control to a
 * dedicated `subscription-url` control (PRD §8.11, ADR-005). v0.4.0 #1
 * added `modules/proxy-groups.json`, the seventh module, and bumped
 * `version` to `0.4.0` (the bundle-content version tracks the release arc
 * it ships with, not the individual slice).
 */
export const BUILTIN_TRUST_ANCHOR_PUBLIC_KEY_HEX =
  'f5c7cc629af7fbdcbd1b1599819cbff05d69ee852353e68ddf8dddf414493a7b';

export const BUILTIN_MANIFEST: BundleManifest = {
  bundleId: 'builtin',
  version: '0.4.0',
  channel: 'stable',
  formatVersion: 1,
  requiresApp: '0.1.0',
  files: [
    {
      path: BUILTIN_MODULE_PATH,
      sha256: '1ad10dd3d229d69053d5f7ac80c311b5a84a238bedb51c9ff57d1779e74d9418',
    },
    {
      path: 'modules/dns.json',
      sha256: '8eb6a713fab06359f7ad3760f107fdc3106f54022725fcc2ac8273d839f4740b',
    },
    {
      path: 'modules/sniffer.json',
      sha256: '9baf3d27faadc058f96b7569303ba8175a25bf47eccc196d0417fcdc533e692c',
    },
    {
      path: 'modules/inbound.json',
      sha256: '529d1b156059ee610b1aef6afe3787dabec325662e6ed3bffec29a3977d57672',
    },
    {
      path: 'modules/proxies.json',
      sha256: 'e1e00f95cf6c020e229e7787b1cf141a4075da11806ced491affb50e60022680',
    },
    {
      path: 'modules/proxy-providers.json',
      sha256: '614e59a5ee51f069441c7d716a916b43a02347df4f1cf2573d82118fc0289f76',
    },
    {
      path: 'modules/proxy-groups.json',
      sha256: 'ed6d113b18f9da2e5b453c2d0549477efe8667225f04d671a70f7ad86ac320b0',
    },
  ],
  signature:
    'cf18af4753d8e084a3ffd7d93b2bd83453ecc80e802a00658fa89b588faa3eb4f4802a8555aa3ee0b90d227371bf20099f4736cc950861b6424a45aa3cfa010b',
  signedAt: '2026-08-26T00:00:00Z',
};

export interface BuiltinBundle {
  readonly manifest: BundleManifest;
  readonly modules: Readonly<Record<string, SchemaModule>>;
}

export const BUILTIN_BUNDLE: BuiltinBundle = {
  manifest: BUILTIN_MANIFEST,
  modules: BUILTIN_MODULE_FILES,
};
