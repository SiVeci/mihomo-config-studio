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
 * it ships with, not the individual slice); #2 added
 * `modules/rule-providers.json`, the eighth module; #3 added
 * `modules/rules.json` and `modules/sub-rules.json`, the ninth and tenth
 * (and last — PRD §8.3 names ten P0 modules total). v0.5.0 #0 turned the
 * single bootstrap key into a `[current, next]` shaped array (ADR-010 §3)
 * — still the same bootstrap keypair, only its declared shape changed.
 * v0.5.0 #1 added the required `mihomo` block to `BundleManifest` (PRD
 * §8.9, ADR-012) and `upstreamCommit`/`docsSnapshot` to every module's own
 * `module.manifest.json` (ADR-012's landing table) — both changes touch
 * every module's serialized bytes and the manifest's signed content, so
 * this re-issue regenerated a fresh bootstrap keypair (the v0.5.0 #0 one
 * was itself only ever a placeholder single-entry array) and bumped
 * `version` to `0.5.0` (the release arc this content now ships with).
 * `tools/schema-cli` must re-issue this file against the real key custody
 * workflow before any Bundle-update feature ships to users. v0.5.0 #14
 * delivered that workflow (`.github/workflows/schema-release.yml`, ADR-024)
 * but this array is still the bootstrap keypair described above — the
 * actual re-signing needs the production public key (ADR-010 §2's
 * `schema-release` environment secret), which is the user's own GitHub-side
 * step (#14's plan notes list it as a prerequisite the assistant never
 * performs) and had not happened as of #14's own commit. Swap this array's
 * only entry for the real public key and re-run `tools/schema-cli`'s `pack`
 * (via the workflow, never locally) once that step is done. v0.9.0 #13 found
 * and fixed a real NFR-SEC-02 gap in `general`'s content (`authentication`
 * was unmasked — see that slice's plan notes) — the first module-content
 * change since v0.5.0 #1, so this re-issued a fresh bootstrap keypair (same
 * discard-after-signing process as every prior re-issue) and bumped
 * `version` to `0.9.0`, the release arc this content now ships with.
 */
export const BUILTIN_TRUST_ANCHORS_HEX: readonly string[] = [
  '4b3d44beffdd48c67d3ed0a831bb3ceed02ebad14f3bdc2c063e9cae8f13b590',
];

export const BUILTIN_MANIFEST: BundleManifest = {
  bundleId: 'builtin',
  version: '0.9.0',
  channel: 'stable',
  formatVersion: 1,
  requiresApp: '0.1.0',
  mihomo: {
    minVersion: '1.19.29',
    maxTestedVersion: '1.19.29',
    upstreamCommit: 'e26714a181ac0e2fa803453c0a8e9a9ce94e31cb',
    docsSnapshot: '2026-08-19',
  },
  // Path-sorted (localeCompare), matching what `tools/schema-cli`'s
  // `packDirectory` produces for a real Bundle — canonicalManifestJson signs
  // array order as-is, so this array's order is part of the signed content.
  files: [
    {
      path: 'modules/dns.json',
      sha256: 'a3f5ccca64bcfb38c24f1ec227d043cdb3138b6da23c5c77f90713c15bbf3885',
    },
    {
      path: BUILTIN_MODULE_PATH,
      sha256: '7421a4c128e832d82d8f5e60a552f9d318c653c93a6113daa007e19c3819a250',
    },
    {
      path: 'modules/inbound.json',
      sha256: 'de2d81b1bd50b94df9d540fb29a6aff8c2ef5dc84fab81e5b3d0a1d8480c936d',
    },
    {
      path: 'modules/proxies.json',
      sha256: 'e72e326de71be73a831dd920e4c3d218b4e4f952872f648a32f2122217aca153',
    },
    {
      path: 'modules/proxy-groups.json',
      sha256: 'c0c1815beddc3c0bbdb410c9a52588762dff714c7ed7b2b6e3a73d981d06ce2b',
    },
    {
      path: 'modules/proxy-providers.json',
      sha256: 'c9dfdcb5af14952d9423b062e09734b723f1840887e9a8f0256a2e5bbf91a130',
    },
    {
      path: 'modules/rule-providers.json',
      sha256: '94488f3b9b762e4e06c2a5aedc3695f0b4d274db10f9937d87fd51fd2727d171',
    },
    {
      path: 'modules/rules.json',
      sha256: 'b32339d90cc0a82f38ed3b9798c80e9428de609e0ad971767adbd5e1b38ac44c',
    },
    {
      path: 'modules/sniffer.json',
      sha256: 'c5389be68b6da004778ebb7b9b2e24e69f9a931107552b435b249f0d9ff7871e',
    },
    {
      path: 'modules/sub-rules.json',
      sha256: 'bc1a1dec598b97e7ee2cc1f8ffa0e112421cd404d34f312f654f1cd35ba89595',
    },
  ],
  signature:
    '9976fcf202a262db63cc94494b4489854e063b112b1b58fd9ba49f5ca6015df274b0844e662191162f5a9c89dd2593f3873a12d874f0f2f2673257f0162e990f',
  signedAt: '2026-09-02T00:00:00Z',
};

export interface BuiltinBundle {
  readonly manifest: BundleManifest;
  readonly modules: Readonly<Record<string, SchemaModule>>;
}

export const BUILTIN_BUNDLE: BuiltinBundle = {
  manifest: BUILTIN_MANIFEST,
  modules: BUILTIN_MODULE_FILES,
};
