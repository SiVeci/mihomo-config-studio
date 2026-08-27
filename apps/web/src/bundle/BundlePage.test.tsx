// @vitest-environment jsdom
import {
  bundleStoreFrom,
  bytesToHex,
  canonicalManifestJson,
  channelSlotKey,
  resolveActiveBundle,
  sha256Hex,
  type BundleChannel,
  type BundleManifest,
  type BundleSource,
  type FetchBytes,
} from '@mcs/schema-registry';
import { MemoryStorageAdapter } from '@mcs/storage';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { t } from '../i18n/index.js';
import { BundlePage } from './BundlePage.js';

afterEach(() => {
  cleanup();
});

const STABLE_SOURCE: BundleSource = {
  manifestUrl: 'https://updates.example/stable/manifest.json',
  fileBaseUrl: 'https://updates.example/stable/files',
};

const CURRENT_APP_VERSION = '0.1.0';

/**
 * `@mcs/schema-registry`'s own `generateTestKeyPair` lives under
 * `src/testing/`, excluded from the package's public `exports` map (ADR-007
 * only exposes `.`) — same reason `tools/schema-cli/src/sign.test.ts` and
 * `index.test.ts` each define this exact helper locally instead of
 * reaching across a package boundary for it.
 */
interface KeyPair {
  readonly publicKeyRaw: Uint8Array;
  sign(message: Uint8Array): Promise<Uint8Array>;
}

async function generateKeyPair(): Promise<KeyPair> {
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
      // narrower than Uint8Array's own generic ArrayBufferLike backing —
      // the runtime call is fine with any typed array, this cast only
      // satisfies the stricter DOM type apps/web's tsconfig pulls in
      // (packages/schema-registry's own Node-only tsconfig never hits this).
      const signature = await crypto.subtle.sign(
        { name: 'Ed25519' },
        privateKey,
        message as BufferSource,
      );
      return new Uint8Array(signature);
    },
  };
}

async function buildSignedBundle(options: {
  keyPair: KeyPair;
  bundleId: string;
  version: string;
  channel?: BundleChannel;
  manifestOverrides?: Partial<BundleManifest>;
}): Promise<{ manifest: BundleManifest; files: Map<string, Uint8Array> }> {
  const path = 'modules/general.json';
  const fileContent = new TextEncoder().encode(`{"id":"${options.bundleId}"}`);
  const sha256 = await sha256Hex(fileContent);
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
    files: [{ path, sha256 }],
    signature: '',
    signedAt: '2026-08-27T00:00:00Z',
    ...options.manifestOverrides,
  };
  const message = new TextEncoder().encode(canonicalManifestJson(unsigned));
  const signature = await options.keyPair.sign(message);
  const manifest: BundleManifest = { ...unsigned, signature: bytesToHex(signature) };
  const files = new Map([[path, fileContent]]);
  return { manifest, files };
}

/** A fake `FetchBytes` serving whatever (manifest, files) pairs were registered by URL, for a fixed source. */
function fetchBytesServing(
  source: BundleSource,
  entries: { manifest: BundleManifest; files: ReadonlyMap<string, Uint8Array> },
): FetchBytes {
  const responses = new Map<string, Uint8Array>();
  responses.set(source.manifestUrl, new TextEncoder().encode(JSON.stringify(entries.manifest)));
  for (const [path, bytes] of entries.files) {
    responses.set(`${source.fileBaseUrl}/${path}`, bytes);
  }
  return async (url) => {
    const bytes = responses.get(url);
    if (!bytes) throw new Error(`no fake response registered for ${url}`);
    return bytes;
  };
}

describe('BundlePage — active bundle display and channel switching', () => {
  it('shows the built-in bundle as active before anything has ever been installed', async () => {
    render(<BundlePage adapter={new MemoryStorageAdapter()} />);

    await screen.findByText(t('bundle.active.bundleIdLabel'));
    expect(screen.getByText('builtin')).toBeDefined();
  });

  it('defaults to the Stable channel and switching to Beta does not touch the Stable slot', async () => {
    const adapter = new MemoryStorageAdapter();
    const keyPair = await generateKeyPair();
    const { manifest, files } = await buildSignedBundle({
      keyPair,
      bundleId: 'stable-v1',
      version: '99.0.0',
    });

    render(
      <BundlePage
        adapter={adapter}
        updateSources={{ stable: STABLE_SOURCE }}
        fetchBytes={fetchBytesServing(STABLE_SOURCE, { manifest, files })}
        trustedPublicKeys={[keyPair.publicKeyRaw]}
      />,
    );
    await screen.findByText(t('bundle.active.bundleIdLabel'));
    fireEvent.click(screen.getByRole('button', { name: t('bundle.install.checkButton') }));
    await waitFor(() => screen.getByText(t('bundle.install.success')));

    expect(
      screen.getByRole('button', { name: t('bundle.channel.stable') }).getAttribute('aria-pressed'),
    ).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: t('bundle.channel.beta') }));
    // Beta has never had anything installed, so it falls all the way back
    // to the built-in bundle — the Stable install above must not leak here.
    // Waits for the slower-settling active-bundle refresh, not the
    // synchronous aria-pressed flip, for the same reason as the install/
    // rollback flows above.
    await waitFor(() => screen.getByText('builtin'));
    expect(
      screen.getByRole('button', { name: t('bundle.channel.beta') }).getAttribute('aria-pressed'),
    ).toBe('true');

    // And switching back to Stable must still show the real installed one.
    fireEvent.click(screen.getByRole('button', { name: t('bundle.channel.stable') }));
    await waitFor(() => expect(screen.getByText('stable-v1')).toBeDefined());
  });

  it('shows "not configured" for a channel with no updateSources entry, instead of a button', async () => {
    render(<BundlePage adapter={new MemoryStorageAdapter()} />);

    await screen.findByText(t('bundle.active.bundleIdLabel'));
    expect(
      screen.getByText(
        t('bundle.install.sourceUnavailable', { channel: t('bundle.channel.stable') }),
      ),
    ).toBeDefined();
    expect(screen.queryByRole('button', { name: t('bundle.install.checkButton') })).toBeNull();
  });
});

describe('BundlePage — a successful install', () => {
  it('installs a valid, newer candidate and shows the new bundle as active', async () => {
    const adapter = new MemoryStorageAdapter();
    const keyPair = await generateKeyPair();
    const { manifest, files } = await buildSignedBundle({
      keyPair,
      bundleId: 'stable-v1',
      version: '99.0.0',
    });

    render(
      <BundlePage
        adapter={adapter}
        updateSources={{ stable: STABLE_SOURCE }}
        fetchBytes={fetchBytesServing(STABLE_SOURCE, { manifest, files })}
        trustedPublicKeys={[keyPair.publicKeyRaw]}
      />,
    );
    await screen.findByText(t('bundle.active.bundleIdLabel'));

    fireEvent.click(screen.getByRole('button', { name: t('bundle.install.checkButton') }));

    // The outcome message and the active-bundle refresh land in two
    // separate state updates (the refresh awaits its own store read) —
    // wait for the slower-settling one; by then the message has landed too.
    await waitFor(() => screen.getByText('stable-v1'));
    expect(screen.getByText(t('bundle.install.success'))).toBeDefined();
    expect(screen.getByText('99.0.0')).toBeDefined();
  });

  it('reports up to date without touching the store when the candidate is not newer', async () => {
    const adapter = new MemoryStorageAdapter();
    const keyPair = await generateKeyPair();
    // The built-in bundle's own version is well above 0.0.1, so this
    // candidate is real, well-formed, and correctly signed — just not newer.
    const { manifest, files } = await buildSignedBundle({
      keyPair,
      bundleId: 'stale-candidate',
      version: '0.0.1',
    });

    render(
      <BundlePage
        adapter={adapter}
        updateSources={{ stable: STABLE_SOURCE }}
        fetchBytes={fetchBytesServing(STABLE_SOURCE, { manifest, files })}
        trustedPublicKeys={[keyPair.publicKeyRaw]}
      />,
    );
    await screen.findByText(t('bundle.active.bundleIdLabel'));
    fireEvent.click(screen.getByRole('button', { name: t('bundle.install.checkButton') }));

    await waitFor(() => screen.getByText(t('bundle.install.upToDate')));
    expect(screen.getByText('builtin')).toBeDefined();
  });

  it('surfaces a fetch failure as UPDATER_FETCH_FAILED without touching the store', async () => {
    const adapter = new MemoryStorageAdapter();
    const alwaysFails: FetchBytes = async () => {
      throw new Error('network is down');
    };

    render(
      <BundlePage
        adapter={adapter}
        updateSources={{ stable: STABLE_SOURCE }}
        fetchBytes={alwaysFails}
      />,
    );
    await screen.findByText(t('bundle.active.bundleIdLabel'));
    fireEvent.click(screen.getByRole('button', { name: t('bundle.install.checkButton') }));

    await waitFor(() =>
      screen.getByText(
        `${t('bundle.error.UPDATER_FETCH_FAILED')} ${t('bundle.error.path', { path: 'manifest' })}`,
      ),
    );
    expect(screen.getByText('builtin')).toBeDefined();
  });
});

describe('BundlePage — the three real negative cases (retour condition 2)', () => {
  async function installBaseline(adapter: MemoryStorageAdapter, keyPair: KeyPair) {
    const { manifest, files } = await buildSignedBundle({
      keyPair,
      bundleId: 'baseline-v1',
      version: '99.0.0',
    });
    render(
      <BundlePage
        adapter={adapter}
        updateSources={{ stable: STABLE_SOURCE }}
        fetchBytes={fetchBytesServing(STABLE_SOURCE, { manifest, files })}
        trustedPublicKeys={[keyPair.publicKeyRaw]}
      />,
    );
    await screen.findByText(t('bundle.active.bundleIdLabel'));
    fireEvent.click(screen.getByRole('button', { name: t('bundle.install.checkButton') }));
    await waitFor(() => screen.getByText(t('bundle.install.success')));
    cleanup();
    return manifest;
  }

  it('rejects a tampered file with BUNDLE_HASH_MISMATCH and leaves the baseline bundle active', async () => {
    const adapter = new MemoryStorageAdapter();
    const keyPair = await generateKeyPair();
    const baseline = await installBaseline(adapter, keyPair);

    const { manifest, files } = await buildSignedBundle({
      keyPair,
      bundleId: 'tampered-v2',
      version: '99.0.1',
    });
    // Tamper after signing: the signature and declared hash both still
    // describe the original bytes, but the served bytes no longer match.
    files.set('modules/general.json', new TextEncoder().encode('{"tampered":true}'));

    render(
      <BundlePage
        adapter={adapter}
        updateSources={{ stable: STABLE_SOURCE }}
        fetchBytes={fetchBytesServing(STABLE_SOURCE, { manifest, files })}
        trustedPublicKeys={[keyPair.publicKeyRaw]}
      />,
    );
    await screen.findByText(t('bundle.active.bundleIdLabel'));
    fireEvent.click(screen.getByRole('button', { name: t('bundle.install.checkButton') }));

    await waitFor(() =>
      screen.getByText(
        `${t('bundle.error.BUNDLE_HASH_MISMATCH')} ${t('bundle.error.path', { path: 'modules/general.json' })}`,
      ),
    );
    expect(screen.getByText('baseline-v1')).toBeDefined();

    // The fact — not just the UI text — must also hold: resolveActiveBundle
    // (called directly, bypassing the page entirely) still returns the
    // pre-attempt manifest, field for field.
    const store = bundleStoreFrom(adapter);
    const resolved = await resolveActiveBundle(store, {
      currentAppVersion: CURRENT_APP_VERSION,
      minFormatVersion: 1,
      maxFormatVersion: 1,
      trustedPublicKeys: [keyPair.publicKeyRaw],
    });
    expect(resolved.manifest).toEqual(baseline);
  });

  it('rejects a bundle re-signed with a different key with BUNDLE_SIGNATURE_INVALID and leaves the baseline bundle active', async () => {
    const adapter = new MemoryStorageAdapter();
    const keyPair = await generateKeyPair();
    const impostor = await generateKeyPair();
    const baseline = await installBaseline(adapter, keyPair);

    const { manifest, files } = await buildSignedBundle({
      keyPair: impostor,
      bundleId: 'impostor-v2',
      version: '99.0.1',
    });

    render(
      <BundlePage
        adapter={adapter}
        updateSources={{ stable: STABLE_SOURCE }}
        fetchBytes={fetchBytesServing(STABLE_SOURCE, { manifest, files })}
        trustedPublicKeys={[keyPair.publicKeyRaw]}
      />,
    );
    await screen.findByText(t('bundle.active.bundleIdLabel'));
    fireEvent.click(screen.getByRole('button', { name: t('bundle.install.checkButton') }));

    await waitFor(() =>
      screen.getByText(
        `${t('bundle.error.BUNDLE_SIGNATURE_INVALID')} ${t('bundle.error.path', { path: 'signature' })}`,
      ),
    );
    expect(screen.getByText('baseline-v1')).toBeDefined();

    const store = bundleStoreFrom(adapter);
    const resolved = await resolveActiveBundle(store, {
      currentAppVersion: CURRENT_APP_VERSION,
      minFormatVersion: 1,
      maxFormatVersion: 1,
      trustedPublicKeys: [keyPair.publicKeyRaw],
    });
    expect(resolved.manifest).toEqual(baseline);
  });

  it('rejects an out-of-range formatVersion and leaves the baseline bundle active — caught by the real planUpdate pre-check, still never installed', async () => {
    // planUpdate() and verifyBundle() both compare formatVersion against the
    // exact same [min, max] bound, so an out-of-range candidate is always
    // caught by planUpdate before applyUpdate/verifyBundle ever runs for it
    // — there is no candidate that fails one check and passes the other.
    // This is still real, unfaked logic (not a UI-only error state); it is
    // simply the earlier of two real gates that both exist for this exact
    // condition, the first one purely to avoid downloading every file for a
    // manifest that was already knowably unusable.
    const adapter = new MemoryStorageAdapter();
    const keyPair = await generateKeyPair();
    const baseline = await installBaseline(adapter, keyPair);

    const { manifest, files } = await buildSignedBundle({
      keyPair,
      bundleId: 'bad-format-v2',
      version: '99.0.1',
      manifestOverrides: { formatVersion: 99 },
    });

    render(
      <BundlePage
        adapter={adapter}
        updateSources={{ stable: STABLE_SOURCE }}
        fetchBytes={fetchBytesServing(STABLE_SOURCE, { manifest, files })}
        trustedPublicKeys={[keyPair.publicKeyRaw]}
      />,
    );
    await screen.findByText(t('bundle.active.bundleIdLabel'));
    fireEvent.click(screen.getByRole('button', { name: t('bundle.install.checkButton') }));

    await waitFor(() => screen.getByText(t('bundle.install.reason.FORMAT_UNSUPPORTED')));
    expect(screen.getByText('baseline-v1')).toBeDefined();

    const store = bundleStoreFrom(adapter);
    const resolved = await resolveActiveBundle(store, {
      currentAppVersion: CURRENT_APP_VERSION,
      minFormatVersion: 1,
      maxFormatVersion: 1,
      trustedPublicKeys: [keyPair.publicKeyRaw],
    });
    expect(resolved.manifest).toEqual(baseline);
  });
});

describe('BundlePage — rollback', () => {
  it('disables the rollback button and explains why when there is nothing to roll back to', async () => {
    render(<BundlePage adapter={new MemoryStorageAdapter()} />);

    await screen.findByText(t('bundle.active.bundleIdLabel'));
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: t('bundle.rollback.button') }).disabled,
    ).toBe(true);
    expect(screen.getByText(t('bundle.rollback.unavailable'))).toBeDefined();
  });

  it('rolls back to the previous version after two installs, verified by a real resolveActiveBundle call too', async () => {
    const adapter = new MemoryStorageAdapter();
    const keyPair = await generateKeyPair();
    const v1 = await installBaselineFor(adapter, keyPair, 'v1', '99.0.0');
    const v2 = await installBaselineFor(adapter, keyPair, 'v2', '99.0.1');
    expect(v1.bundleId).toBe('v1');
    expect(v2.bundleId).toBe('v2');

    render(<BundlePage adapter={adapter} trustedPublicKeys={[keyPair.publicKeyRaw]} />);
    await screen.findByText(t('bundle.active.bundleIdLabel'));
    expect(screen.getByText('v2')).toBeDefined();

    const rollbackButton = screen.getByRole<HTMLButtonElement>('button', {
      name: t('bundle.rollback.button'),
    });
    expect(rollbackButton.disabled).toBe(false);
    fireEvent.click(rollbackButton);

    // Same two-state-updates ordering as the install flow: wait for the
    // slower-settling active-bundle refresh, not the outcome message.
    await waitFor(() => screen.getByText('v1'));
    expect(screen.getByText(t('bundle.rollback.success'))).toBeDefined();

    const store = bundleStoreFrom(adapter);
    const resolved = await resolveActiveBundle(store, {
      currentAppVersion: CURRENT_APP_VERSION,
      minFormatVersion: 1,
      maxFormatVersion: 1,
      trustedPublicKeys: [keyPair.publicKeyRaw],
    });
    expect(resolved.manifest.bundleId).toBe('v1');
    expect(await store.read(channelSlotKey('stable', 'previous'))).not.toBeNull();
  });
});

async function installBaselineFor(
  adapter: MemoryStorageAdapter,
  keyPair: KeyPair,
  bundleId: string,
  version: string,
): Promise<BundleManifest> {
  const { manifest, files } = await buildSignedBundle({ keyPair, bundleId, version });
  render(
    <BundlePage
      adapter={adapter}
      updateSources={{ stable: STABLE_SOURCE }}
      fetchBytes={fetchBytesServing(STABLE_SOURCE, { manifest, files })}
      trustedPublicKeys={[keyPair.publicKeyRaw]}
    />,
  );
  await screen.findByText(t('bundle.active.bundleIdLabel'));
  fireEvent.click(screen.getByRole('button', { name: t('bundle.install.checkButton') }));
  await waitFor(() => screen.getByText(t('bundle.install.success')));
  cleanup();
  return manifest;
}
