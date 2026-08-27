import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BundleManifest } from './manifest.js';
import { resolveActiveBundle, type BundleStore } from './store.js';
import { generateTestKeyPair, type TestKeyPair } from './testing/keys.js';
import { MemoryBundleStore } from './testing/memory-store.js';
import {
  applyUpdate,
  fetchBundle,
  planUpdate,
  type BundleSource,
  type FetchBundleSuccess,
  type FetchBytes,
} from './updater.js';
import { bytesToHex, canonicalManifestJson, sha256Hex } from './verify.js';

const DEFAULT_OPTIONS = {
  currentAppVersion: '0.1.0',
  minFormatVersion: 1,
  maxFormatVersion: 1,
};

const SOURCE: BundleSource = {
  manifestUrl: 'https://updates.example/stable/manifest.json',
  fileBaseUrl: 'https://updates.example/stable/files',
};

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

/** A fake `FetchBytes` serving a manifest + its files from an in-memory map, keyed by URL. */
function fakeFetchBytesFrom(responses: ReadonlyMap<string, Uint8Array>): FetchBytes {
  return async (url) => {
    const bytes = responses.get(url);
    if (!bytes) throw new Error(`no fake response registered for ${url}`);
    return bytes;
  };
}

function manifestBytes(manifest: BundleManifest): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(manifest));
}

describe('fetchBundle (FR-UPD-03 data side, v0.5.0 #4)', () => {
  it('fetches the manifest and every file it declares', async () => {
    const keyPair = await generateTestKeyPair();
    const { manifest, files } = await buildSignedBundle({ keyPair, bundleId: 'v1' });
    const responses = new Map<string, Uint8Array>([
      [SOURCE.manifestUrl, manifestBytes(manifest)],
      [`${SOURCE.fileBaseUrl}/modules/general.json`, files.get('modules/general.json')!],
    ]);

    const result = await fetchBundle(SOURCE, fakeFetchBytesFrom(responses));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest).toEqual(manifest);
    expect(result.files.get('modules/general.json')).toEqual(files.get('modules/general.json'));
  });

  it('fails with a stable code and no leaked detail when the manifest fetch itself fails', async () => {
    const fetchBytes: FetchBytes = async () => {
      throw new Error('network is down, with a URL and query string an attacker controls');
    };

    const result = await fetchBundle(SOURCE, fetchBytes);

    expect(result).toEqual({ ok: false, code: 'UPDATER_FETCH_FAILED', path: 'manifest' });
  });

  it('fails with UPDATER_FETCH_FAILED when the manifest bytes are not valid JSON', async () => {
    const responses = new Map<string, Uint8Array>([
      [SOURCE.manifestUrl, new TextEncoder().encode('not json at all')],
    ]);

    const result = await fetchBundle(SOURCE, fakeFetchBytesFrom(responses));

    expect(result).toEqual({ ok: false, code: 'UPDATER_FETCH_FAILED', path: 'manifest' });
  });

  it('surfaces the manifest shape issue code/path when the fetched manifest is structurally invalid', async () => {
    const keyPair = await generateTestKeyPair();
    const { manifest } = await buildSignedBundle({ keyPair, bundleId: 'v1' });
    const { mihomo: _mihomo, ...withoutMihomo } = manifest;
    const responses = new Map<string, Uint8Array>([
      [SOURCE.manifestUrl, new TextEncoder().encode(JSON.stringify(withoutMihomo))],
    ]);

    const result = await fetchBundle(SOURCE, fakeFetchBytesFrom(responses));

    expect(result).toEqual({ ok: false, code: 'BUNDLE_MANIFEST_MISSING_FIELD', path: 'mihomo' });
  });

  it('fails with a stable code naming the file path when one file fetch fails', async () => {
    const keyPair = await generateTestKeyPair();
    const { manifest } = await buildSignedBundle({ keyPair, bundleId: 'v1' });
    const responses = new Map<string, Uint8Array>([[SOURCE.manifestUrl, manifestBytes(manifest)]]);
    // The file URL is deliberately not registered, so fakeFetchBytesFrom throws for it.

    const result = await fetchBundle(SOURCE, fakeFetchBytesFrom(responses));

    expect(result).toEqual({
      ok: false,
      code: 'UPDATER_FETCH_FAILED',
      path: 'modules/general.json',
    });
  });

  it('defaults to a real, GET-only, bodyless fetch when no FetchBytes is injected', async () => {
    const keyPair = await generateTestKeyPair();
    const { manifest, files } = await buildSignedBundle({ keyPair, bundleId: 'v1' });
    const generalBytes = files.get('modules/general.json')!;

    const fetchSpy = vi.fn(async (url: string, _init?: { method?: string; body?: unknown }) => {
      const body =
        url === SOURCE.manifestUrl
          ? manifestBytes(manifest)
          : url === `${SOURCE.fileBaseUrl}/modules/general.json`
            ? generalBytes
            : (() => {
                throw new Error(`unexpected URL: ${url}`);
              })();
      return {
        ok: true,
        arrayBuffer: async () =>
          body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
      };
    });
    vi.stubGlobal('fetch', fetchSpy);

    const result = await fetchBundle(SOURCE);

    expect(result.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    for (const call of fetchSpy.mock.calls) {
      const options = call[1] as { method?: string; body?: unknown } | undefined;
      expect(options?.method).toBe('GET');
      expect(options?.body).toBeUndefined();
    }

    vi.unstubAllGlobals();
  });

  it('treats a non-ok response from the default fetch as a fetch failure, not a crash', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false })),
    );

    const result = await fetchBundle(SOURCE);

    expect(result).toEqual({ ok: false, code: 'UPDATER_FETCH_FAILED', path: 'manifest' });

    vi.unstubAllGlobals();
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('planUpdate (FR-UPD-03 data side, v0.5.0 #4)', () => {
  const OPTIONS = { channel: 'stable' as const, minFormatVersion: 1, maxFormatVersion: 1 };

  function manifestWith(overrides: Partial<BundleManifest>): BundleManifest {
    return {
      bundleId: 'x',
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
      ...overrides,
    };
  }

  it('says yes when there is no current bundle at all', () => {
    const result = planUpdate(null, manifestWith({ version: '1.0.0' }), OPTIONS);
    expect(result).toEqual({ shouldUpdate: true });
  });

  it('says yes when the candidate is a newer version, same channel, supported format', () => {
    const current = manifestWith({ version: '1.0.0' });
    const candidate = manifestWith({ version: '1.1.0' });
    expect(planUpdate(current, candidate, OPTIONS)).toEqual({ shouldUpdate: true });
  });

  it('says no (NOT_NEWER) when the candidate is the same or an older version', () => {
    const current = manifestWith({ version: '1.1.0' });
    expect(planUpdate(current, manifestWith({ version: '1.1.0' }), OPTIONS)).toEqual({
      shouldUpdate: false,
      reason: 'NOT_NEWER',
    });
    expect(planUpdate(current, manifestWith({ version: '1.0.0' }), OPTIONS)).toEqual({
      shouldUpdate: false,
      reason: 'NOT_NEWER',
    });
  });

  it('says no (CHANNEL_MISMATCH) when the candidate is for a different channel', () => {
    const current = manifestWith({ version: '1.0.0' });
    const candidate = manifestWith({ version: '2.0.0', channel: 'beta' });
    expect(planUpdate(current, candidate, OPTIONS)).toEqual({
      shouldUpdate: false,
      reason: 'CHANNEL_MISMATCH',
    });
  });

  it('says no (FORMAT_UNSUPPORTED) when the candidate formatVersion is outside the supported range', () => {
    const candidate = manifestWith({ version: '2.0.0', formatVersion: 99 });
    expect(planUpdate(null, candidate, OPTIONS)).toEqual({
      shouldUpdate: false,
      reason: 'FORMAT_UNSUPPORTED',
    });
  });

  it('checks channel before version: a mismatched-channel candidate that is also older still reports CHANNEL_MISMATCH', () => {
    const current = manifestWith({ version: '5.0.0' });
    const candidate = manifestWith({ version: '1.0.0', channel: 'beta' });
    expect(planUpdate(current, candidate, OPTIONS)).toEqual({
      shouldUpdate: false,
      reason: 'CHANNEL_MISMATCH',
    });
  });
});

describe('applyUpdate (FR-UPD-04 data side, NFR-REL-03, v0.5.0 #4)', () => {
  it('installs a valid candidate through the real installBundle path', async () => {
    const store: BundleStore = new MemoryBundleStore();
    const keyPair = await generateTestKeyPair();
    const { manifest, files } = await buildSignedBundle({ keyPair, bundleId: 'v1' });
    const candidate: FetchBundleSuccess = { ok: true, manifest, files };
    const options = { ...DEFAULT_OPTIONS, trustedPublicKeys: [keyPair.publicKeyRaw] };

    const result = await applyUpdate(store, candidate, options);

    expect(result).toEqual({ ok: true });
    const resolved = await resolveActiveBundle(store, options);
    expect(resolved.manifest.bundleId).toBe('v1');
  });

  it('NFR-REL-03: a failed update (bad signature) leaves the previously active bundle byte-for-byte unchanged', async () => {
    const store: BundleStore = new MemoryBundleStore();
    const keyPair = await generateTestKeyPair();
    const impostor = await generateTestKeyPair();
    const options = { ...DEFAULT_OPTIONS, trustedPublicKeys: [keyPair.publicKeyRaw] };

    const { manifest: original, files: originalFiles } = await buildSignedBundle({
      keyPair,
      bundleId: 'v1',
    });
    await applyUpdate(store, { ok: true, manifest: original, files: originalFiles }, options);

    const { manifest: badManifest, files: badFiles } = await buildSignedBundle({
      keyPair: impostor,
      bundleId: 'v2-poisoned',
    });
    const badResult = await applyUpdate(
      store,
      { ok: true, manifest: badManifest, files: badFiles },
      options,
    );

    expect(badResult).toEqual({ ok: false, code: 'BUNDLE_SIGNATURE_INVALID', path: 'signature' });

    const resolved = await resolveActiveBundle(store, options);
    expect(resolved.manifest).toEqual(original);
    expect([...resolved.files.entries()]).toEqual([...originalFiles.entries()]);
  });
});
