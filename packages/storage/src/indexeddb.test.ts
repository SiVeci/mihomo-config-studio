import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { IndexedDbStorageAdapter } from './indexeddb.js';

/** A fresh factory per call keeps tests from sharing IndexedDB state. */
function freshFactory(): IDBFactory {
  return new IDBFactory();
}

describe('IndexedDbStorageAdapter (NFR-REL-01)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns null for a key that was never written', async () => {
    const adapter = new IndexedDbStorageAdapter({ indexedDB: freshFactory() });
    expect(await adapter.get('missing')).toBeNull();
  });

  it('round-trips exact bytes through put/get', async () => {
    const adapter = new IndexedDbStorageAdapter({ indexedDB: freshFactory() });
    const value = new Uint8Array([1, 2, 3, 255, 0]);

    await adapter.put('a', value);

    expect(await adapter.get('a')).toEqual(value);
  });

  it('overwrites an existing key', async () => {
    const adapter = new IndexedDbStorageAdapter({ indexedDB: freshFactory() });
    await adapter.put('a', new Uint8Array([1]));
    await adapter.put('a', new Uint8Array([2, 3]));

    expect(await adapter.get('a')).toEqual(new Uint8Array([2, 3]));
  });

  it('delete removes an entry, and deleting a missing key is a no-op', async () => {
    const adapter = new IndexedDbStorageAdapter({ indexedDB: freshFactory() });
    await adapter.put('a', new Uint8Array([1]));

    await adapter.delete('a');
    await expect(adapter.delete('never-existed')).resolves.toBeUndefined();

    expect(await adapter.get('a')).toBeNull();
  });

  it('list(prefix) returns only matching keys', async () => {
    const adapter = new IndexedDbStorageAdapter({ indexedDB: freshFactory() });
    await adapter.put('bundle/active/manifest.json', new Uint8Array());
    await adapter.put('bundle/active/files/a.json', new Uint8Array());
    await adapter.put('bundle/previous/manifest.json', new Uint8Array());
    await adapter.put('other', new Uint8Array());

    const active = await adapter.list('bundle/active/');

    expect([...active].sort()).toEqual([
      'bundle/active/files/a.json',
      'bundle/active/manifest.json',
    ]);
  });

  it('persists across separate adapter instances that share a factory and database name', async () => {
    const factory = freshFactory();
    const writer = new IndexedDbStorageAdapter({ indexedDB: factory, databaseName: 'shared' });
    await writer.put('a', new Uint8Array([9, 9]));

    const reader = new IndexedDbStorageAdapter({ indexedDB: factory, databaseName: 'shared' });

    expect(await reader.get('a')).toEqual(new Uint8Array([9, 9]));
  });

  it('isolates adapters that use different database names on the same factory', async () => {
    const factory = freshFactory();
    const dbA = new IndexedDbStorageAdapter({ indexedDB: factory, databaseName: 'db-a' });
    const dbB = new IndexedDbStorageAdapter({ indexedDB: factory, databaseName: 'db-b' });

    await dbA.put('key', new Uint8Array([1]));

    expect(await dbB.get('key')).toBeNull();
  });

  it('throws when constructed with no injected factory and no global indexedDB', () => {
    expect(() => new IndexedDbStorageAdapter()).toThrow(/IndexedDB is not available/);
  });

  it('reports null quota when navigator is unavailable', async () => {
    const adapter = new IndexedDbStorageAdapter({ indexedDB: freshFactory() });
    expect(await adapter.estimateQuota()).toBeNull();
  });

  it('reports null quota when navigator.storage.estimate is unavailable', async () => {
    vi.stubGlobal('navigator', {});
    const adapter = new IndexedDbStorageAdapter({ indexedDB: freshFactory() });
    expect(await adapter.estimateQuota()).toBeNull();
  });

  it('reports usage and quota bytes when the Storage API is available', async () => {
    vi.stubGlobal('navigator', {
      storage: { estimate: async () => ({ usage: 1234, quota: 5000 }) },
    });
    const adapter = new IndexedDbStorageAdapter({ indexedDB: freshFactory() });

    expect(await adapter.estimateQuota()).toEqual({ usageBytes: 1234, quotaBytes: 5000 });
  });

  it('falls back to null quotaBytes when the estimate omits it', async () => {
    vi.stubGlobal('navigator', { storage: { estimate: async () => ({ usage: 10 }) } });
    const adapter = new IndexedDbStorageAdapter({ indexedDB: freshFactory() });

    expect(await adapter.estimateQuota()).toEqual({ usageBytes: 10, quotaBytes: null });
  });

  it('falls back to zero usageBytes when the estimate omits it', async () => {
    vi.stubGlobal('navigator', { storage: { estimate: async () => ({ quota: 5000 }) } });
    const adapter = new IndexedDbStorageAdapter({ indexedDB: freshFactory() });

    expect(await adapter.estimateQuota()).toEqual({ usageBytes: 0, quotaBytes: 5000 });
  });
});
