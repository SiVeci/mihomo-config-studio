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
 * Not a real signature or content hash: the signing key pair and the
 * canonical serialisation both belong to the signing/verification
 * infrastructure built in #8 and `tools/schema-cli` (#10). Anything that
 * actually checks a signature must treat this bundle like any other
 * unsigned input — never special-cased to bypass verification — and
 * `builtin.ts` must be re-issued with a real hash and signature once that
 * infrastructure exists.
 */
const UNSIGNED_PLACEHOLDER = 'UNSIGNED-PLACEHOLDER';

export const BUILTIN_MANIFEST: BundleManifest = {
  bundleId: 'builtin',
  version: '0.0.0',
  channel: 'stable',
  formatVersion: 1,
  requiresApp: '0.1.0',
  files: [{ path: BUILTIN_MODULE_PATH, sha256: UNSIGNED_PLACEHOLDER }],
  signature: UNSIGNED_PLACEHOLDER,
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
