import { describe, expect, it } from 'vitest';

import { BUILTIN_BUNDLE } from './builtin.js';
import { channelSlotKey } from './channel.js';
import type { BundleManifest } from './manifest.js';
import { createRegistry } from './registry.js';
import {
  builtinAsStoredBundle,
  installBundle,
  resolveActiveBundle,
  rollbackBundle,
  type BundleStore,
  type StoredBundle,
} from './store.js';
import { MemoryBundleStore } from './testing/memory-store.js';
import { generateTestKeyPair, type TestKeyPair } from './testing/keys.js';
import { bytesToHex, canonicalManifestJson, sha256Hex } from './verify.js';

const DEFAULT_OPTIONS = {
  currentAppVersion: '0.1.0',
  minFormatVersion: 1,
  maxFormatVersion: 1,
};

const STABLE_ACTIVE = channelSlotKey('stable', 'active');
const STABLE_PREVIOUS = channelSlotKey('stable', 'previous');
const BETA_ACTIVE = channelSlotKey('beta', 'active');
const BETA_PREVIOUS = channelSlotKey('beta', 'previous');

async function buildSignedBundle(options: {
  keyPair: TestKeyPair;
  bundleId: string;
  manifestOverrides?: Partial<BundleManifest>;
}): Promise<{ manifest: BundleManifest; files: Map<string, Uint8Array> }> {
  const path = 'modules/general.json';
  const fileContent = new TextEncoder().encode(`{"id":"${options.bundleId}"}`);
  const sha256 = await sha256Hex(fileContent);
  const unsigned: BundleManifest = {
    bundleId: options.bundleId,
    version: '1.0.0',
    channel: 'stable',
    formatVersion: 1,
    requiresApp: '0.1.0',
    mihomo: {
      minVersion: '1.19.29',
      maxTestedVersion: '1.19.29',
      upstreamCommit: 'e26714a181ac0e2fa803453c0a8e9a9ce94e31cb',
      docsSnapshot: '2026-08-19',
    },
    files: [{ path, sha256 }],
    signature: '',
    signedAt: '2026-08-12T00:00:00Z',
    ...options.manifestOverrides,
  };
  const message = new TextEncoder().encode(canonicalManifestJson(unsigned));
  const signature = await options.keyPair.sign(message);
  const manifest: BundleManifest = { ...unsigned, signature: bytesToHex(signature) };
  const files = new Map([[path, fileContent]]);
  return { manifest, files };
}

async function installedBundleId(store: BundleStore, slot: string): Promise<string | undefined> {
  const stored = await store.read(slot);
  return stored?.manifest.bundleId;
}

describe('installBundle (FR-UPD-04, NFR-REL-03)', () => {
  it('leaves active untouched when a tampered file fails hash verification', async () => {
    const store = new MemoryBundleStore();
    const keyPair = await generateTestKeyPair();
    const options = { ...DEFAULT_OPTIONS, trustedPublicKeys: [keyPair.publicKeyRaw] };
    const { manifest: original, files: originalFiles } = await buildSignedBundle({
      keyPair,
      bundleId: 'v1',
    });
    expect((await installBundle(store, original, originalFiles, options)).ok).toBe(true);

    const { manifest: bad, files: badFiles } = await buildSignedBundle({ keyPair, bundleId: 'v2' });
    badFiles.set('modules/general.json', new TextEncoder().encode('{"tampered":true}'));

    const result = await installBundle(store, bad, badFiles, options);

    expect(result).toEqual({
      ok: false,
      code: 'BUNDLE_HASH_MISMATCH',
      path: 'modules/general.json',
    });
    expect(await installedBundleId(store, STABLE_ACTIVE)).toBe('v1');
    expect(await store.read(STABLE_PREVIOUS)).toBeNull();
  });

  it('leaves active untouched when re-signed with a different private key', async () => {
    const store = new MemoryBundleStore();
    const keyPair = await generateTestKeyPair();
    const impostor = await generateTestKeyPair();
    const options = { ...DEFAULT_OPTIONS, trustedPublicKeys: [keyPair.publicKeyRaw] };
    const { manifest: original, files: originalFiles } = await buildSignedBundle({
      keyPair,
      bundleId: 'v1',
    });
    expect((await installBundle(store, original, originalFiles, options)).ok).toBe(true);

    const { manifest: bad, files: badFiles } = await buildSignedBundle({
      keyPair: impostor,
      bundleId: 'v2',
    });

    const result = await installBundle(store, bad, badFiles, options);

    expect(result).toEqual({ ok: false, code: 'BUNDLE_SIGNATURE_INVALID', path: 'signature' });
    expect(await installedBundleId(store, STABLE_ACTIVE)).toBe('v1');
  });

  it('leaves active untouched when formatVersion is outside the supported range', async () => {
    const store = new MemoryBundleStore();
    const keyPair = await generateTestKeyPair();
    const options = { ...DEFAULT_OPTIONS, trustedPublicKeys: [keyPair.publicKeyRaw] };
    const { manifest: original, files: originalFiles } = await buildSignedBundle({
      keyPair,
      bundleId: 'v1',
    });
    expect((await installBundle(store, original, originalFiles, options)).ok).toBe(true);

    const { manifest: bad, files: badFiles } = await buildSignedBundle({
      keyPair,
      bundleId: 'v2',
      manifestOverrides: { formatVersion: 99 },
    });

    const result = await installBundle(store, bad, badFiles, options);

    expect(result).toEqual({ ok: false, code: 'BUNDLE_FORMAT_UNSUPPORTED', path: 'formatVersion' });
    expect(await installedBundleId(store, STABLE_ACTIVE)).toBe('v1');
  });

  it('keeps only the two most recent bundles after three installs', async () => {
    const store = new MemoryBundleStore();
    const keyPair = await generateTestKeyPair();
    const options = { ...DEFAULT_OPTIONS, trustedPublicKeys: [keyPair.publicKeyRaw] };

    for (const bundleId of ['v1', 'v2', 'v3']) {
      const { manifest, files } = await buildSignedBundle({ keyPair, bundleId });
      expect((await installBundle(store, manifest, files, options)).ok).toBe(true);
    }

    expect([...(await store.list())].sort()).toEqual([STABLE_ACTIVE, STABLE_PREVIOUS]);
    expect(await installedBundleId(store, STABLE_ACTIVE)).toBe('v3');
    expect(await installedBundleId(store, STABLE_PREVIOUS)).toBe('v2');
  });
});

describe('channel separation (FR-UPD-02, v0.5.0 #2)', () => {
  it('installing a beta-channelled bundle never touches the stable slot-pair', async () => {
    const store = new MemoryBundleStore();
    const keyPair = await generateTestKeyPair();
    const options = { ...DEFAULT_OPTIONS, trustedPublicKeys: [keyPair.publicKeyRaw] };
    const { manifest: stableManifest, files: stableFiles } = await buildSignedBundle({
      keyPair,
      bundleId: 'stable-v1',
    });
    await installBundle(store, stableManifest, stableFiles, options);

    const { manifest: betaManifest, files: betaFiles } = await buildSignedBundle({
      keyPair,
      bundleId: 'beta-v1',
      manifestOverrides: { channel: 'beta' },
    });
    const result = await installBundle(store, betaManifest, betaFiles, options);

    expect(result.ok).toBe(true);
    expect(await installedBundleId(store, STABLE_ACTIVE)).toBe('stable-v1');
    expect(await store.read(STABLE_PREVIOUS)).toBeNull();
    expect(await installedBundleId(store, BETA_ACTIVE)).toBe('beta-v1');
  });

  it('the slot-pair written follows the verified manifest.channel, not whatever the caller assumed', async () => {
    const store = new MemoryBundleStore();
    const keyPair = await generateTestKeyPair();
    const options = { ...DEFAULT_OPTIONS, trustedPublicKeys: [keyPair.publicKeyRaw] };
    const { manifest, files } = await buildSignedBundle({
      keyPair,
      bundleId: 'beta-only',
      manifestOverrides: { channel: 'beta' },
    });

    await installBundle(store, manifest, files, options);

    // A bundle whose signed content declares `channel: 'beta'` can never end
    // up in the stable slot-pair, regardless of how the caller found it.
    expect(await store.read(STABLE_ACTIVE)).toBeNull();
    expect(await installedBundleId(store, BETA_ACTIVE)).toBe('beta-only');
  });

  it('resolveActiveBundle defaults to the stable channel', async () => {
    const store = new MemoryBundleStore();
    const keyPair = await generateTestKeyPair();
    const options = { ...DEFAULT_OPTIONS, trustedPublicKeys: [keyPair.publicKeyRaw] };
    const { manifest, files } = await buildSignedBundle({
      keyPair,
      bundleId: 'beta-only',
      manifestOverrides: { channel: 'beta' },
    });
    await installBundle(store, manifest, files, options);

    // Only a beta bundle is installed, so the default (stable) resolution
    // must fall all the way back to the built-in bundle, not surface beta.
    const resolved = await resolveActiveBundle(store, options);

    expect(resolved.manifest.bundleId).toBe(BUILTIN_BUNDLE.manifest.bundleId);
  });

  it('resolveActiveBundle honors an explicit beta channel', async () => {
    const store = new MemoryBundleStore();
    const keyPair = await generateTestKeyPair();
    const options = { ...DEFAULT_OPTIONS, trustedPublicKeys: [keyPair.publicKeyRaw] };
    const { manifest, files } = await buildSignedBundle({
      keyPair,
      bundleId: 'beta-only',
      manifestOverrides: { channel: 'beta' },
    });
    await installBundle(store, manifest, files, options);

    const resolved = await resolveActiveBundle(store, options, 'beta');

    expect(resolved.manifest.bundleId).toBe('beta-only');
  });

  it('switching to beta and back to stable returns the original stable bundle untouched', async () => {
    const store = new MemoryBundleStore();
    const keyPair = await generateTestKeyPair();
    const options = { ...DEFAULT_OPTIONS, trustedPublicKeys: [keyPair.publicKeyRaw] };
    const { manifest: stableManifest, files: stableFiles } = await buildSignedBundle({
      keyPair,
      bundleId: 'stable-v1',
    });
    await installBundle(store, stableManifest, stableFiles, options);

    const { manifest: betaManifest, files: betaFiles } = await buildSignedBundle({
      keyPair,
      bundleId: 'beta-v1',
      manifestOverrides: { channel: 'beta' },
    });
    await installBundle(store, betaManifest, betaFiles, options);

    const resolvedStable = await resolveActiveBundle(store, options, 'stable');

    expect(resolvedStable.manifest.bundleId).toBe('stable-v1');
  });

  it('rollbackBundle only swaps within one channel — rolling back beta never touches stable', async () => {
    const store = new MemoryBundleStore();
    const keyPair = await generateTestKeyPair();
    const options = { ...DEFAULT_OPTIONS, trustedPublicKeys: [keyPair.publicKeyRaw] };
    const { manifest: stableManifest, files: stableFiles } = await buildSignedBundle({
      keyPair,
      bundleId: 'stable-v1',
    });
    await installBundle(store, stableManifest, stableFiles, options);

    for (const bundleId of ['beta-v1', 'beta-v2']) {
      const { manifest, files } = await buildSignedBundle({
        keyPair,
        bundleId,
        manifestOverrides: { channel: 'beta' },
      });
      await installBundle(store, manifest, files, options);
    }

    const result = await rollbackBundle(store, 'beta');

    expect(result).toEqual({ ok: true });
    expect(await installedBundleId(store, BETA_ACTIVE)).toBe('beta-v1');
    expect(await installedBundleId(store, BETA_PREVIOUS)).toBe('beta-v2');
    expect(await installedBundleId(store, STABLE_ACTIVE)).toBe('stable-v1');
    expect(await store.read(STABLE_PREVIOUS)).toBeNull();
  });
});

describe('rollbackBundle (FR-UPD-04)', () => {
  it('rolls back to the second-most-recent bundle after three installs', async () => {
    const store = new MemoryBundleStore();
    const keyPair = await generateTestKeyPair();
    const options = { ...DEFAULT_OPTIONS, trustedPublicKeys: [keyPair.publicKeyRaw] };
    for (const bundleId of ['v1', 'v2', 'v3']) {
      const { manifest, files } = await buildSignedBundle({ keyPair, bundleId });
      await installBundle(store, manifest, files, options);
    }

    const result = await rollbackBundle(store);

    expect(result).toEqual({ ok: true });
    expect(await installedBundleId(store, STABLE_ACTIVE)).toBe('v2');
    expect(await installedBundleId(store, STABLE_PREVIOUS)).toBe('v3');
  });

  it('is reversible: rolling back twice returns to the original active bundle', async () => {
    const store = new MemoryBundleStore();
    const keyPair = await generateTestKeyPair();
    const options = { ...DEFAULT_OPTIONS, trustedPublicKeys: [keyPair.publicKeyRaw] };
    for (const bundleId of ['v1', 'v2']) {
      const { manifest, files } = await buildSignedBundle({ keyPair, bundleId });
      await installBundle(store, manifest, files, options);
    }

    await rollbackBundle(store);
    await rollbackBundle(store);

    expect(await installedBundleId(store, STABLE_ACTIVE)).toBe('v2');
    expect(await installedBundleId(store, STABLE_PREVIOUS)).toBe('v1');
  });

  it('refuses to roll back when there is no previous bundle, without touching active', async () => {
    const store = new MemoryBundleStore();
    const keyPair = await generateTestKeyPair();
    const options = { ...DEFAULT_OPTIONS, trustedPublicKeys: [keyPair.publicKeyRaw] };
    const { manifest, files } = await buildSignedBundle({ keyPair, bundleId: 'only' });
    await installBundle(store, manifest, files, options);

    const result = await rollbackBundle(store);

    expect(result).toEqual({ ok: false, code: 'BUNDLE_STORE_NO_PREVIOUS' });
    expect(await installedBundleId(store, STABLE_ACTIVE)).toBe('only');
  });

  it('refuses to roll back on a completely empty store', async () => {
    const store = new MemoryBundleStore();

    const result = await rollbackBundle(store);

    expect(result).toEqual({ ok: false, code: 'BUNDLE_STORE_NO_PREVIOUS' });
  });

  it('clears the stale previous slot rather than duplicating it when active was empty', async () => {
    const store = new MemoryBundleStore();
    const keyPair = await generateTestKeyPair();
    const { manifest, files } = await buildSignedBundle({ keyPair, bundleId: 'only-previous' });
    // Populate `previous` directly, bypassing installBundle, so `active` stays empty.
    await store.write(STABLE_PREVIOUS, { manifest, files });

    const result = await rollbackBundle(store);

    expect(result).toEqual({ ok: true });
    expect(await installedBundleId(store, STABLE_ACTIVE)).toBe('only-previous');
    expect(await store.read(STABLE_PREVIOUS)).toBeNull();
  });
});

describe('resolveActiveBundle (FR-UPD-01, FR-UPD-04)', () => {
  it('resolves the active bundle directly when it verifies', async () => {
    const store = new MemoryBundleStore();
    const keyPair = await generateTestKeyPair();
    const options = { ...DEFAULT_OPTIONS, trustedPublicKeys: [keyPair.publicKeyRaw] };
    const { manifest, files } = await buildSignedBundle({ keyPair, bundleId: 'v1' });
    await installBundle(store, manifest, files, options);

    const resolved = await resolveActiveBundle(store, options);

    expect(resolved.manifest.bundleId).toBe('v1');
  });

  it('falls back to previous when active is damaged but previous still verifies', async () => {
    const store = new MemoryBundleStore();
    const keyPair = await generateTestKeyPair();
    const options = { ...DEFAULT_OPTIONS, trustedPublicKeys: [keyPair.publicKeyRaw] };
    const { manifest: v1, files: v1Files } = await buildSignedBundle({ keyPair, bundleId: 'v1' });
    await installBundle(store, v1, v1Files, options);
    const { manifest: v2, files: v2Files } = await buildSignedBundle({ keyPair, bundleId: 'v2' });
    await installBundle(store, v2, v2Files, options);

    // Simulate on-disk corruption directly, bypassing installBundle's own verification gate.
    await store.write(STABLE_ACTIVE, {
      manifest: v2,
      files: new Map([['modules/general.json', new TextEncoder().encode('{"corrupted":true}')]]),
    });

    const resolved = await resolveActiveBundle(store, options);

    expect(resolved.manifest.bundleId).toBe('v1');
  });

  it('falls back to the built-in bundle when both slots are damaged', async () => {
    const store = new MemoryBundleStore();
    const keyPair = await generateTestKeyPair();
    const options = { ...DEFAULT_OPTIONS, trustedPublicKeys: [keyPair.publicKeyRaw] };

    const shapeInvalid: StoredBundle = {
      manifest: {} as unknown as BundleManifest,
      files: new Map(),
    };
    const { manifest: badlySigned } = await buildSignedBundle({ keyPair, bundleId: 'previous' });
    await store.write(STABLE_ACTIVE, shapeInvalid);
    await store.write(STABLE_PREVIOUS, {
      manifest: { ...badlySigned, signature: bytesToHex(new Uint8Array(64)) },
      files: new Map(),
    });

    const resolved = await resolveActiveBundle(store, options);

    expect(resolved.manifest.bundleId).toBe(BUILTIN_BUNDLE.manifest.bundleId);
  });

  it('falls back to the built-in bundle when the store is entirely empty', async () => {
    const store = new MemoryBundleStore();
    const keyPair = await generateTestKeyPair();

    const resolved = await resolveActiveBundle(store, {
      ...DEFAULT_OPTIONS,
      trustedPublicKeys: [keyPair.publicKeyRaw],
    });

    expect(resolved.manifest.bundleId).toBe(BUILTIN_BUNDLE.manifest.bundleId);
  });
});

describe('builtinAsStoredBundle (v0.3.0 #14)', () => {
  it('resolves directly through createRegistry into all ten real P0 modules, with no registry issues', () => {
    const registry = createRegistry(builtinAsStoredBundle());
    const ids = registry.modules().map((module) => module.manifest.id);

    expect(ids.sort()).toEqual(
      [
        'dns',
        'general',
        'inbound',
        'proxies',
        'proxy-groups',
        'proxy-providers',
        'rule-providers',
        'rules',
        'sniffer',
        'sub-rules',
      ].sort(),
    );
    expect(registry.issues()).toEqual([]);
  });

  it('matches the conversion resolveActiveBundle itself falls back to, given an empty store', async () => {
    const store = new MemoryBundleStore();
    const keyPair = await generateTestKeyPair();
    const resolved = await resolveActiveBundle(store, {
      ...DEFAULT_OPTIONS,
      trustedPublicKeys: [keyPair.publicKeyRaw],
    });

    const direct = builtinAsStoredBundle();
    expect(direct.manifest).toEqual(resolved.manifest);
    expect([...direct.files.keys()].sort()).toEqual([...resolved.files.keys()].sort());
  });
});
