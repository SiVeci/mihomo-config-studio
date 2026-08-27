import { bytesToHex, canonicalManifestJson, sha256Hex } from '@mcs/schema-registry';
import type { BundleChannel, BundleManifest } from '@mcs/schema-registry';

import { CURRENT_APP_VERSION } from '../bundle/verify-options.js';

/**
 * Test-only Ed25519 signing, mirroring `tools/schema-cli/src/sign.test.ts`'s
 * established pattern (ADR-007: `@mcs/schema-registry`'s own
 * `generateTestKeyPair` lives under `src/testing/`, unexported from the
 * package's public barrel, so cross-package tests cannot import it and each
 * package defines its own copy).
 */
export interface TestKeyPair {
  readonly publicKeyRaw: Uint8Array;
  sign(message: Uint8Array): Promise<Uint8Array>;
}

export async function generateTestKeyPair(): Promise<TestKeyPair> {
  const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  if (!('publicKey' in pair) || !('privateKey' in pair)) {
    throw new Error('Ed25519 key generation did not return a key pair');
  }
  const { publicKey, privateKey } = pair;
  const publicKeyRaw = new Uint8Array(await crypto.subtle.exportKey('raw', publicKey));
  return {
    publicKeyRaw,
    async sign(message: Uint8Array): Promise<Uint8Array> {
      // TS's DOM lib types BufferSource as ArrayBufferView<ArrayBuffer>,
      // narrower than Uint8Array's own generic ArrayBufferLike backing — the
      // runtime call is fine with any typed array, this cast only satisfies
      // the stricter DOM type apps/web's tsconfig pulls in.
      const signature = await crypto.subtle.sign(
        { name: 'Ed25519' },
        privateKey,
        message as BufferSource,
      );
      return new Uint8Array(signature);
    },
  };
}

/** Minimal shape `createRegistry`'s own `isModuleShape` accepts (`registry.ts`) — real `manifest.id`/`version`/`root`, plus non-null `schema`/`ui`. */
export function minimalModule(id: string, version = '1.0.0'): unknown {
  return { manifest: { id, root: [], version }, schema: {}, ui: {} };
}

export interface BuildSignedBundleOptions {
  readonly keyPair: TestKeyPair;
  readonly bundleId: string;
  readonly version: string;
  readonly channel?: BundleChannel;
  /**
   * One `modules/<id>.json` file per entry — defaults to a single minimal
   * module, real enough for `createRegistry` to accept it. Deliberately not
   * one of the ten real P0 module ids (`schema-registry-boundary.test.ts`'s
   * FR-SCHEMA-05 fence forbids hardcoding those anywhere under `apps/web/src`
   * outside a `.test.ts(x)` file itself — this helper is shared, non-test
   * source, so it must stay off that list too).
   */
  readonly modules?: ReadonlyMap<string, unknown>;
  readonly manifestOverrides?: Partial<BundleManifest>;
}

/** A minimal but real signed Bundle (manifest + files), for tests that need `resolveBundleByVersion`/`installBundle` to genuinely verify something rather than a hand-built fixture object. */
export async function buildSignedBundle(
  options: BuildSignedBundleOptions,
): Promise<{ manifest: BundleManifest; files: Map<string, Uint8Array> }> {
  const moduleEntries = options.modules ?? new Map([['test-module', minimalModule('test-module')]]);
  const files = new Map<string, Uint8Array>();
  const fileEntries: { path: string; sha256: string }[] = [];
  for (const [moduleId, content] of moduleEntries) {
    const path = `modules/${moduleId}.json`;
    const bytes = new TextEncoder().encode(JSON.stringify(content));
    files.set(path, bytes);
    fileEntries.push({ path, sha256: await sha256Hex(bytes) });
  }
  fileEntries.sort((a, b) => a.path.localeCompare(b.path));

  const unsigned: BundleManifest = {
    bundleId: options.bundleId,
    version: options.version,
    channel: options.channel ?? 'stable',
    formatVersion: 1,
    requiresApp: CURRENT_APP_VERSION,
    mihomo: {
      minVersion: '1.19.29',
      maxTestedVersion: '1.19.29',
      upstreamCommit: 'e26714a181ac0e2fa803453c0a8e9a9ce94e31cb',
      docsSnapshot: '2026-08-19',
    },
    files: fileEntries,
    signature: '',
    signedAt: '2026-08-27T00:00:00Z',
    ...options.manifestOverrides,
  };
  const message = new TextEncoder().encode(canonicalManifestJson(unsigned));
  const signature = await options.keyPair.sign(message);
  const manifest: BundleManifest = { ...unsigned, signature: bytesToHex(signature) };
  return { manifest, files };
}
