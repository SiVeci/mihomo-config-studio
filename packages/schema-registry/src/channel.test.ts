import { MemoryStorageAdapter } from '@mcs/storage';
import { describe, expect, it } from 'vitest';

import {
  channelSlotKey,
  DEFAULT_BUNDLE_CHANNEL,
  readBundleChannelPreference,
  writeBundleChannelPreference,
} from './channel.js';

describe('DEFAULT_BUNDLE_CHANNEL (FR-UPD-02)', () => {
  it('is stable', () => {
    expect(DEFAULT_BUNDLE_CHANNEL).toBe('stable');
  });
});

describe('channelSlotKey', () => {
  it('namespaces a slot by channel', () => {
    expect(channelSlotKey('stable', 'active')).toBe('stable/active');
    expect(channelSlotKey('stable', 'previous')).toBe('stable/previous');
    expect(channelSlotKey('beta', 'active')).toBe('beta/active');
    expect(channelSlotKey('beta', 'previous')).toBe('beta/previous');
  });

  it('produces different keys for the same slot across channels', () => {
    expect(channelSlotKey('stable', 'active')).not.toBe(channelSlotKey('beta', 'active'));
  });
});

describe('readBundleChannelPreference / writeBundleChannelPreference', () => {
  it('defaults to stable when nothing was ever written', async () => {
    const adapter = new MemoryStorageAdapter();

    expect(await readBundleChannelPreference(adapter)).toBe('stable');
  });

  it('round-trips a written beta preference', async () => {
    const adapter = new MemoryStorageAdapter();

    await writeBundleChannelPreference(adapter, 'beta');

    expect(await readBundleChannelPreference(adapter)).toBe('beta');
  });

  it('round-trips a written stable preference (including switching back from beta)', async () => {
    const adapter = new MemoryStorageAdapter();

    await writeBundleChannelPreference(adapter, 'beta');
    await writeBundleChannelPreference(adapter, 'stable');

    expect(await readBundleChannelPreference(adapter)).toBe('stable');
  });

  it('falls back to stable, without throwing, when the stored value is not a known channel', async () => {
    const adapter = new MemoryStorageAdapter();
    await adapter.put('bundle/channel', new TextEncoder().encode('nightly'));

    expect(await readBundleChannelPreference(adapter)).toBe('stable');
  });

  it('falls back to stable, without throwing, when the stored value is empty bytes', async () => {
    const adapter = new MemoryStorageAdapter();
    await adapter.put('bundle/channel', new Uint8Array());

    expect(await readBundleChannelPreference(adapter)).toBe('stable');
  });
});
