import { describe, expect, it } from 'vitest';

import { MemoryStorageAdapter } from './memory.js';

describe('MemoryStorageAdapter (NFR-REL-01)', () => {
  it('returns null for a key that was never written', async () => {
    const adapter = new MemoryStorageAdapter();
    expect(await adapter.get('missing')).toBeNull();
  });

  it('round-trips exact bytes through put/get', async () => {
    const adapter = new MemoryStorageAdapter();
    const value = new Uint8Array([1, 2, 3, 255, 0]);

    await adapter.put('a', value);

    expect(await adapter.get('a')).toEqual(value);
  });

  it('overwrites an existing key', async () => {
    const adapter = new MemoryStorageAdapter();
    await adapter.put('a', new Uint8Array([1]));
    await adapter.put('a', new Uint8Array([2, 3]));

    expect(await adapter.get('a')).toEqual(new Uint8Array([2, 3]));
  });

  it('delete removes an entry, and deleting a missing key is a no-op', async () => {
    const adapter = new MemoryStorageAdapter();
    await adapter.put('a', new Uint8Array([1]));

    await adapter.delete('a');
    await expect(adapter.delete('never-existed')).resolves.toBeUndefined();

    expect(await adapter.get('a')).toBeNull();
  });

  it('list(prefix) returns only matching keys', async () => {
    const adapter = new MemoryStorageAdapter();
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

  it('list("") returns every key', async () => {
    const adapter = new MemoryStorageAdapter();
    await adapter.put('a', new Uint8Array());
    await adapter.put('b', new Uint8Array());

    expect([...(await adapter.list(''))].sort()).toEqual(['a', 'b']);
  });

  it('estimateQuota sums stored byte lengths and reports an unbounded quota', async () => {
    const adapter = new MemoryStorageAdapter();
    await adapter.put('a', new Uint8Array(10));
    await adapter.put('b', new Uint8Array(5));

    expect(await adapter.estimateQuota()).toEqual({ usageBytes: 15, quotaBytes: null });
  });

  it('reports zero usage for an empty adapter', async () => {
    const adapter = new MemoryStorageAdapter();
    expect(await adapter.estimateQuota()).toEqual({ usageBytes: 0, quotaBytes: null });
  });

  it('keeps separate instances fully isolated from each other', async () => {
    const a = new MemoryStorageAdapter();
    const b = new MemoryStorageAdapter();

    await a.put('shared-key', new Uint8Array([1]));

    expect(await b.get('shared-key')).toBeNull();
  });
});
