import type { SchemaModule } from '@mcs/schema-core';

import type { BundleManifest } from './manifest.js';

/**
 * A deliberately minimal skeleton so the app has something to render fully
 * offline (FR-UPD-01) before any Bundle is ever downloaded. Real module
 * content — the full set of Mihomo sections — lands in v0.3.0.
 */
export const BUILTIN_MODULE_PATH = 'modules/general.json';

export const BUILTIN_MODULE: SchemaModule = {
  manifest: {
    id: 'general',
    root: ['general'],
    version: '0.0.1',
  },
  schema: {
    type: 'object',
    properties: {
      mode: { type: 'string', enum: ['rule', 'global', 'direct'], default: 'rule' },
      'log-level': {
        type: 'string',
        enum: ['silent', 'error', 'warning', 'info', 'debug'],
        default: 'info',
      },
    },
  },
  ui: {
    fields: {
      mode: { label: 'field.mode' },
      'log-level': { label: 'field.log-level' },
    },
  },
};

/**
 * The file hash below is `sha256(JSON.stringify(BUILTIN_MODULE))`, and the
 * signature below is a real Ed25519 signature (verifiable with
 * `verifyBundle`) over `canonicalManifestJson` of this manifest. Both were
 * computed once offline with a key pair generated solely to bootstrap this
 * built-in bundle — that private key was discarded immediately after
 * signing and is not, and has never been, stored anywhere. This is a
 * bootstrap trust anchor, not the production signing key described in
 * ADR-010 §2/§3 (GitHub Environment secret, `[current, next]` rotation):
 * `tools/schema-cli` (#10) must re-issue this file against the real key
 * custody workflow before any Bundle-update feature ships to users.
 */
export const BUILTIN_TRUST_ANCHOR_PUBLIC_KEY_HEX =
  'ca775982bb6802381ab5ea899becdc94c7c96c0b931dd6d4be6f209d618a0337';

export const BUILTIN_MANIFEST: BundleManifest = {
  bundleId: 'builtin',
  version: '0.0.0',
  channel: 'stable',
  formatVersion: 1,
  requiresApp: '0.1.0',
  files: [
    {
      path: BUILTIN_MODULE_PATH,
      sha256: 'de0acbf300c4a039bb0fb8e499232e120ded5d2148e1528db7d4159526d522d0',
    },
  ],
  signature:
    'e3f00ba63bb1bbea1b28bb5b1f4f1a36cb93bce31a8943c61f83fe436f9364ceea90603fb9c00e19dd1459e228aa1f5c04fcae98a76b2318da273c1988388508',
  signedAt: '2026-08-12T00:00:00Z',
};

export interface BuiltinBundle {
  readonly manifest: BundleManifest;
  readonly modules: Readonly<Record<string, SchemaModule>>;
}

export const BUILTIN_BUNDLE: BuiltinBundle = {
  manifest: BUILTIN_MANIFEST,
  modules: { [BUILTIN_MODULE_PATH]: BUILTIN_MODULE },
};
