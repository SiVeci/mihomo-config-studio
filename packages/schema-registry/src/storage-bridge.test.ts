import { MemoryStorageAdapter } from '@mcs/storage';
import { describe, expect, it } from 'vitest';

import { channelSlotKey } from './channel.js';
import type { BundleManifest } from './manifest.js';
import { installBundle, rollbackBundle } from './store.js';
import type { StoredBundle } from './store.js';
import { generateTestKeyPair, type TestKeyPair } from './testing/keys.js';
import { bundleStoreFrom } from './storage-bridge.js';
import { bytesToHex, canonicalManifestJson, sha256Hex } from './verify.js';

const STABLE_ACTIVE = channelSlotKey('stable', 'active');
const STABLE_PREVIOUS = channelSlotKey('stable', 'previous');

function manifestFixture(bundleId: string): BundleManifest {
  return {
    bundleId,
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
    files: [],
    signature: '',
    signedAt: '2026-08-12T00:00:00Z',
  };
}

async function buildSignedBundle(
  keyPair: TestKeyPair,
  bundleId: string,
): Promise<{ manifest: BundleManifest; files: Map<string, Uint8Array> }> {
  const path = 'modules/general.json';
  const fileContent = new TextEncoder().encode(`{"id":"${bundleId}"}`);
  const sha256 = await sha256Hex(fileContent);
  const unsigned: BundleManifest = {
    ...manifestFixture(bundleId),
    files: [{ path, sha256 }],
  };
  const message = new TextEncoder().encode(canonicalManifestJson(unsigned));
  const signature = await keyPair.sign(message);
  const manifest: BundleManifest = { ...unsigned, signature: bytesToHex(signature) };
  return { manifest, files: new Map([[path, fileContent]]) };
}

describe('bundleStoreFrom (NFR-REL-01)', () => {
  it('returns null for a key that was never written', async () => {
    const store = bundleStoreFrom(new MemoryStorageAdapter());
    expect(await store.read('active')).toBeNull();
  });

  it('round-trips a manifest and its files exactly', async () => {
    const store = bundleStoreFrom(new MemoryStorageAdapter());
    const manifest = manifestFixture('v1');
    const files = new Map([
      ['modules/general.json', new TextEncoder().encode('{"a":1}')],
      ['modules/dns.json', new TextEncoder().encode('{"b":2}')],
    ]);

    await store.write('active', { manifest, files, trust: 'signed' });
    const read = await store.read('active');

    expect(read?.manifest).toEqual(manifest);
    expect(read?.files.size).toBe(2);
    expect(read?.files.get('modules/general.json')).toEqual(files.get('modules/general.json'));
    expect(read?.files.get('modules/dns.json')).toEqual(files.get('modules/dns.json'));
  });

  it('round-trips trust (FR-UPD-09, v0.9.0 #17), independently of manifest/files content', async () => {
    const store = bundleStoreFrom(new MemoryStorageAdapter());

    await store.write('active', {
      manifest: manifestFixture('v1'),
      files: new Map(),
      trust: 'untrusted',
    });

    expect((await store.read('active'))?.trust).toBe('untrusted');
  });

  it("defaults a bundle written before trust.json existed to 'signed' (backward compatibility)", async () => {
    const adapter = new MemoryStorageAdapter();
    const store = bundleStoreFrom(adapter);
    await store.write('active', {
      manifest: manifestFixture('v1'),
      files: new Map(),
      trust: 'untrusted',
    });
    // Simulates a pre-#17 write: no trust.json key at all.
    await adapter.delete('active/trust.json');

    expect((await store.read('active'))?.trust).toBe('signed');
  });

  it('replaces the whole file set on a second write, leaving no stale files behind', async () => {
    const adapter = new MemoryStorageAdapter();
    const store = bundleStoreFrom(adapter);
    await store.write('active', {
      manifest: manifestFixture('v1'),
      files: new Map([['modules/a.json', new TextEncoder().encode('a')]]),
      trust: 'signed',
    });

    await store.write('active', {
      manifest: manifestFixture('v2'),
      files: new Map([['modules/b.json', new TextEncoder().encode('b')]]),
      trust: 'signed',
    });

    const read = await store.read('active');
    expect([...(read?.files.keys() ?? [])]).toEqual(['modules/b.json']);
    // The old file's bytes are gone from the underlying adapter too, not just hidden.
    expect(await adapter.get('active/files/modules/a.json')).toBeNull();
  });

  it('list() returns every written bundle key and nothing else', async () => {
    const adapter = new MemoryStorageAdapter();
    const store = bundleStoreFrom(adapter);
    await store.write('active', {
      manifest: manifestFixture('v1'),
      files: new Map(),
      trust: 'signed',
    });
    await store.write('previous', {
      manifest: manifestFixture('v0'),
      files: new Map(),
      trust: 'signed',
    });
    // An unrelated key that happens to share a prefix must not be mistaken for a bundle.
    await adapter.put('active/files/decoy', new TextEncoder().encode('not a bundle'));

    expect([...(await store.list())].sort()).toEqual(['active', 'previous']);
  });

  it('remove() deletes the manifest, trust marker and every file, and list() forgets the key', async () => {
    const adapter = new MemoryStorageAdapter();
    const store = bundleStoreFrom(adapter);
    await store.write('active', {
      manifest: manifestFixture('v1'),
      files: new Map([['modules/a.json', new TextEncoder().encode('a')]]),
      trust: 'signed',
    });

    await store.remove('active');

    expect(await store.read('active')).toBeNull();
    expect(await store.list()).toEqual([]);
    expect(await adapter.get('active/trust.json')).toBeNull();
  });

  it('is a faithful BundleStore: installBundle and rollbackBundle work against it unmodified', async () => {
    const store = bundleStoreFrom(new MemoryStorageAdapter());
    const keyPair = await generateTestKeyPair();
    const options = {
      currentAppVersion: '0.1.0',
      minFormatVersion: 1,
      maxFormatVersion: 1,
      trustedPublicKeys: [keyPair.publicKeyRaw],
    };

    const { manifest: v1, files: v1Files } = await buildSignedBundle(keyPair, 'v1');
    expect((await installBundle(store, v1, v1Files, options)).ok).toBe(true);
    const { manifest: v2, files: v2Files } = await buildSignedBundle(keyPair, 'v2');
    expect((await installBundle(store, v2, v2Files, options)).ok).toBe(true);

    expect(((await store.read(STABLE_ACTIVE)) as StoredBundle).manifest.bundleId).toBe('v2');
    expect(((await store.read(STABLE_PREVIOUS)) as StoredBundle).manifest.bundleId).toBe('v1');

    const rollback = await rollbackBundle(store);

    expect(rollback).toEqual({ ok: true });
    expect(((await store.read(STABLE_ACTIVE)) as StoredBundle).manifest.bundleId).toBe('v1');
  });
});
