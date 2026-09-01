// @vitest-environment jsdom
import { bundleStoreFrom, channelSlotKey } from '@mcs/schema-registry';
import { MemoryStorageAdapter } from '@mcs/storage';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { t } from '../i18n/index.js';
import type { OpenDocumentOutcome } from '../platform/index.js';
import { buildSignedBundle, generateTestKeyPair, minimalModule } from '../testing/signed-bundle.js';
import { ManualImport } from './ManualImport.js';

afterEach(() => {
  cleanup();
});

function opened(text: string): () => Promise<OpenDocumentOutcome> {
  return async () => ({ kind: 'opened', text, name: 'community-bundle.json' });
}

const cancelled = async (): Promise<OpenDocumentOutcome> => ({ kind: 'cancelled' });

async function containerText(overrides?: {
  channel?: 'stable' | 'beta';
  tamperFile?: boolean;
  moduleContent?: unknown;
}): Promise<string> {
  const keyPair = await generateTestKeyPair();
  const { manifest, files } = await buildSignedBundle({
    keyPair,
    bundleId: 'community-1',
    version: '1.0.0',
    channel: overrides?.channel ?? 'beta',
    modules: new Map([['test-module', overrides?.moduleContent ?? minimalModule('test-module')]]),
  });
  // A manual import never has (or needs) a valid signature — this is the
  // one gap `installUntrustedBundle` deliberately waives.
  const garbageManifest = { ...manifest, signature: '00'.repeat(64) };

  if (overrides?.tamperFile) {
    for (const path of files.keys()) files.set(path, new TextEncoder().encode('{"tampered":true}'));
  }

  const filesRecord: Record<string, string> = {};
  for (const [path, bytes] of files) filesRecord[path] = new TextDecoder().decode(bytes);

  return JSON.stringify({ manifest: garbageManifest, files: filesRecord });
}

describe('ManualImport (FR-UPD-09, v0.9.0 #17)', () => {
  it('does nothing when the file picker is cancelled', async () => {
    const store = bundleStoreFrom(new MemoryStorageAdapter());
    const onImported = vi.fn();
    render(<ManualImport store={store} onImported={onImported} openDocument={cancelled} />);

    fireEvent.click(screen.getByRole('button', { name: t('manualImport.fileButton') }));
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());

    expect(onImported).not.toHaveBeenCalled();
  });

  it('rejects a file that is not valid JSON', async () => {
    const store = bundleStoreFrom(new MemoryStorageAdapter());
    render(<ManualImport store={store} onImported={vi.fn()} openDocument={opened('{not valid')} />);

    fireEvent.click(screen.getByRole('button', { name: t('manualImport.fileButton') }));

    expect(await screen.findByText(t('manualImport.invalidContainer'))).toBeDefined();
  });

  it('rejects valid JSON that is not shaped like a Bundle import container', async () => {
    const store = bundleStoreFrom(new MemoryStorageAdapter());
    render(
      <ManualImport
        store={store}
        onImported={vi.fn()}
        openDocument={opened(JSON.stringify({ hello: 'world' }))}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: t('manualImport.fileButton') }));

    expect(await screen.findByText(t('manualImport.invalidContainer'))).toBeDefined();
  });

  it('imports a well-formed Beta-channel community Bundle with no valid signature, marking it trust: untrusted', async () => {
    const store = bundleStoreFrom(new MemoryStorageAdapter());
    const onImported = vi.fn();
    const text = await containerText({ channel: 'beta' });
    render(<ManualImport store={store} onImported={onImported} openDocument={opened(text)} />);

    fireEvent.click(screen.getByRole('button', { name: t('manualImport.fileButton') }));

    expect(await screen.findByText(t('manualImport.successMessage'))).toBeDefined();
    expect(onImported).toHaveBeenCalledTimes(1);
    const stored = await store.read(channelSlotKey('beta', 'active'));
    expect(stored?.manifest.bundleId).toBe('community-1');
    expect(stored?.trust).toBe('untrusted');
  });

  it('hard-rejects a Stable-channel manifest and never writes to the Stable slot', async () => {
    const store = bundleStoreFrom(new MemoryStorageAdapter());
    const text = await containerText({ channel: 'stable' });
    render(<ManualImport store={store} onImported={vi.fn()} openDocument={opened(text)} />);

    fireEvent.click(screen.getByRole('button', { name: t('manualImport.fileButton') }));

    const message = t('manualImport.error.BUNDLE_UNTRUSTED_STABLE_CHANNEL');
    expect(await screen.findByText((content) => content.startsWith(message))).toBeDefined();
    expect(await store.read(channelSlotKey('stable', 'active'))).toBeNull();
  });

  it('rejects a file containing what looks like executable content, reusing the schema-cli static check', async () => {
    const store = bundleStoreFrom(new MemoryStorageAdapter());
    const text = await containerText({ moduleContent: { hook: '(v) => v.trim()' } });
    render(<ManualImport store={store} onImported={vi.fn()} openDocument={opened(text)} />);

    fireEvent.click(screen.getByRole('button', { name: t('manualImport.fileButton') }));

    const message = t('manualImport.error.SCHEMA_CLI_EXECUTABLE_CONTENT');
    expect(await screen.findByText((content) => content.startsWith(message))).toBeDefined();
  });

  it('rejects a tampered file via the same hash check installBundle uses, reusing its existing message', async () => {
    const store = bundleStoreFrom(new MemoryStorageAdapter());
    const text = await containerText({ tamperFile: true });
    render(<ManualImport store={store} onImported={vi.fn()} openDocument={opened(text)} />);

    fireEvent.click(screen.getByRole('button', { name: t('manualImport.fileButton') }));

    const message = t('bundle.error.BUNDLE_HASH_MISMATCH');
    expect(await screen.findByText((content) => content.startsWith(message))).toBeDefined();
  });
});
