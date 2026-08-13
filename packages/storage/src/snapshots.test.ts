import { describe, expect, it } from 'vitest';

import { MemoryStorageAdapter } from './memory.js';
import {
  DEFAULT_MAX_SNAPSHOTS,
  DEFAULT_MIN_SNAPSHOTS,
  DEFAULT_PRESSURE_THRESHOLD,
  SnapshotManager,
} from './snapshots.js';
import type { StorageAdapter, StorageQuota } from './adapter.js';

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

function quotaExceededError(): Error {
  const error = new Error('quota exceeded');
  error.name = 'QuotaExceededError';
  return error;
}

/** Wraps a real MemoryStorageAdapter so put() and estimateQuota() can be overridden per test. */
function fakeAdapter(
  adapter: MemoryStorageAdapter,
  overrides: {
    put?: (key: string, value: Uint8Array) => Promise<void>;
    quota?: StorageQuota | null;
  },
): StorageAdapter {
  return {
    get: (key) => adapter.get(key),
    put: overrides.put ?? ((key, value) => adapter.put(key, value)),
    delete: (key) => adapter.delete(key),
    list: (prefix) => adapter.list(prefix),
    estimateQuota: async () => overrides.quota ?? null,
  };
}

describe('SnapshotManager (FR-PROJ-05, NFR-REL-05)', () => {
  it('defaults match the plan: retain at least 50, floor of 10, 90% pressure threshold', () => {
    expect(DEFAULT_MAX_SNAPSHOTS).toBe(50);
    expect(DEFAULT_MIN_SNAPSHOTS).toBe(10);
    expect(DEFAULT_PRESSURE_THRESHOLD).toBe(0.9);
  });

  it('records snapshots under the ceiling with a normal-level signal', async () => {
    const adapter = new MemoryStorageAdapter();
    const manager = new SnapshotManager({ adapter, prefix: 'snap/', maxSnapshots: 5 });

    const signal = await manager.record(encode('v1'));

    expect(signal).toEqual({
      level: 'normal',
      messageKey: 'storage.snapshot.normal',
      retainedCount: 5,
    });
    const list = await manager.list();
    expect(list).toHaveLength(1);
    expect(decode(list[0]!.content)).toBe('v1');
  });

  it('list() returns snapshots oldest first', async () => {
    const adapter = new MemoryStorageAdapter();
    const manager = new SnapshotManager({ adapter, prefix: 'snap/', maxSnapshots: 5 });

    await manager.record(encode('v1'));
    await manager.record(encode('v2'));
    await manager.record(encode('v3'));

    const list = await manager.list();
    expect(list.map((s) => decode(s.content))).toEqual(['v1', 'v2', 'v3']);
  });

  it('evicts the oldest snapshots FIFO once the count exceeds maxSnapshots', async () => {
    const adapter = new MemoryStorageAdapter();
    const manager = new SnapshotManager({ adapter, prefix: 'snap/', maxSnapshots: 3 });

    for (const v of ['v1', 'v2', 'v3', 'v4', 'v5']) {
      await manager.record(encode(v));
    }

    const list = await manager.list();
    expect(list.map((s) => decode(s.content))).toEqual(['v3', 'v4', 'v5']);
  });

  it('does not let unrelated adapter keys interfere with the snapshot count', async () => {
    const adapter = new MemoryStorageAdapter();
    await adapter.put('unrelated', encode('not a snapshot'));
    const manager = new SnapshotManager({ adapter, prefix: 'snap/', maxSnapshots: 2 });

    await manager.record(encode('v1'));
    await manager.record(encode('v2'));

    const list = await manager.list();
    expect(list).toHaveLength(2);
    expect(await adapter.get('unrelated')).not.toBeNull();
  });

  it('jumps straight to the reduced ceiling when estimateQuota proactively reports tight space', async () => {
    const adapter = new MemoryStorageAdapter();
    const tight = fakeAdapter(adapter, { quota: { usageBytes: 95, quotaBytes: 100 } });
    const manager = new SnapshotManager({
      adapter: tight,
      prefix: 'snap/',
      maxSnapshots: 50,
      minSnapshots: 2,
    });
    await manager.record(encode('v1'));
    await manager.record(encode('v2'));
    await manager.record(encode('v3')); // would still fit under maxSnapshots=50, but quota is tight

    const list = await manager.list();
    expect(list.map((s) => decode(s.content))).toEqual(['v2', 'v3']);
  });

  it('does not treat usage below the pressure threshold as tight', async () => {
    const adapter = new MemoryStorageAdapter();
    const notTight = fakeAdapter(adapter, { quota: { usageBytes: 50, quotaBytes: 100 } });
    const manager = new SnapshotManager({ adapter: notTight, prefix: 'snap/', maxSnapshots: 5 });

    const signal = await manager.record(encode('v1'));

    expect(signal.level).toBe('normal');
  });

  it('treats a quotaBytes of null as unknown, never tight', async () => {
    const adapter = new MemoryStorageAdapter();
    const unknownQuota = fakeAdapter(adapter, {
      quota: { usageBytes: 1_000_000, quotaBytes: null },
    });
    const manager = new SnapshotManager({
      adapter: unknownQuota,
      prefix: 'snap/',
      maxSnapshots: 5,
    });

    const signal = await manager.record(encode('v1'));

    expect(signal.level).toBe('normal');
  });

  it('reacts to a QuotaExceededError by retrying at the reduced ceiling, without losing the new snapshot', async () => {
    const adapter = new MemoryStorageAdapter();
    let attempts = 0;
    const flaky = fakeAdapter(adapter, {
      put: async (key, value) => {
        attempts += 1;
        if (attempts === 1) throw quotaExceededError();
        await adapter.put(key, value);
      },
    });
    const manager = new SnapshotManager({
      adapter: flaky,
      prefix: 'snap/',
      maxSnapshots: 50,
      minSnapshots: 3,
    });

    const signal = await manager.record(encode('recovered'));

    expect(signal).toEqual({
      level: 'reduced',
      messageKey: 'storage.snapshot.reduced',
      retainedCount: 3,
    });
    const list = await manager.list();
    expect(list.map((s) => decode(s.content))).toEqual(['recovered']);
  });

  it('does not prune existing snapshots just to attempt a write that succeeds without it', async () => {
    const adapter = new MemoryStorageAdapter();
    const manager = new SnapshotManager({ adapter, prefix: 'snap/', maxSnapshots: 50 });
    await manager.record(encode('v1'));
    await manager.record(encode('v2'));

    await manager.record(encode('v3'));

    // All three fit comfortably under maxSnapshots=50; none should have been
    // speculatively pruned just because a later failure was possible.
    expect(await manager.list()).toHaveLength(3);
  });

  it('stops snapshotting when even the reduced ceiling cannot be written, without throwing', async () => {
    const adapter = new MemoryStorageAdapter();
    const alwaysFails = fakeAdapter(adapter, {
      put: async () => {
        throw quotaExceededError();
      },
    });
    const manager = new SnapshotManager({
      adapter: alwaysFails,
      prefix: 'snap/',
      maxSnapshots: 50,
      minSnapshots: 3,
    });

    const signal = await manager.record(encode('never-lands'));

    expect(signal).toEqual({
      level: 'stopped',
      messageKey: 'storage.snapshot.stopped',
      retainedCount: 0,
    });
  });

  it('propagates a non-quota error instead of treating it as a degradation signal', async () => {
    const adapter = new MemoryStorageAdapter();
    const broken = fakeAdapter(adapter, {
      put: async () => {
        throw new Error('disk unplugged');
      },
    });
    const manager = new SnapshotManager({ adapter: broken, prefix: 'snap/' });

    await expect(manager.record(encode('x'))).rejects.toThrow('disk unplugged');
  });
});
