import { describe, expect, it } from 'vitest';

import { AutoSaver, DEFAULT_AUTOSAVE_INTERVAL_MS } from './autosave.js';
import { MemoryStorageAdapter } from './memory.js';

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
const decode = (bytes: Uint8Array | null): string | null =>
  bytes === null ? null : new TextDecoder().decode(bytes);

describe('AutoSaver (FR-PROJ-02, NFR-REL-02)', () => {
  it('a crash before the interval elapses loses the unflushed edit: t=0 edit, t=4.9s crash recovers the prior save', async () => {
    const adapter = new MemoryStorageAdapter();
    await adapter.put('doc', encode('before'));
    let current = 'before';
    const saver = new AutoSaver({ adapter, key: 'doc', getContent: () => encode(current) });

    current = 'after-edit';
    await saver.touch(0);
    await saver.touch(4900); // another chance to notice elapsed time, still short of 5s

    // "Crash": read back from storage as a freshly restarted process would.
    expect(decode(await adapter.get('doc'))).toBe('before');
  });

  it('a crash after the interval elapses recovers the latest edit: t=0 edit, t=5.1s crash recovers the new save', async () => {
    const adapter = new MemoryStorageAdapter();
    await adapter.put('doc', encode('before'));
    let current = 'before';
    const saver = new AutoSaver({ adapter, key: 'doc', getContent: () => encode(current) });

    current = 'after-edit';
    await saver.touch(0);
    await saver.touch(5100);

    expect(decode(await adapter.get('doc'))).toBe('after-edit');
  });

  it('treats exactly the interval boundary as due for a flush', async () => {
    const adapter = new MemoryStorageAdapter();
    let current = 'before';
    const saver = new AutoSaver({ adapter, key: 'doc', getContent: () => encode(current) });

    current = 'after-edit';
    await saver.touch(0);
    await saver.touch(DEFAULT_AUTOSAVE_INTERVAL_MS);

    expect(decode(await adapter.get('doc'))).toBe('after-edit');
  });

  it('does not flush on every touch inside the window, only once the interval elapses', async () => {
    const adapter = new MemoryStorageAdapter();
    let putCount = 0;
    const countingAdapter = {
      get: (key: string) => adapter.get(key),
      put: async (key: string, value: Uint8Array) => {
        putCount += 1;
        await adapter.put(key, value);
      },
      delete: (key: string) => adapter.delete(key),
      list: (prefix: string) => adapter.list(prefix),
    };
    let current = 'v0';
    const saver = new AutoSaver({
      adapter: countingAdapter,
      key: 'doc',
      getContent: () => encode(current),
    });

    await saver.touch(0);
    current = 'v1';
    await saver.touch(2000);
    current = 'v2';
    await saver.touch(4000);
    expect(putCount).toBe(0);

    current = 'v3';
    await saver.touch(5000);
    expect(putCount).toBe(1);
    expect(decode(await adapter.get('doc'))).toBe('v3');
  });

  it('starts a fresh interval after a flush, so the next edit needs its own full window', async () => {
    const adapter = new MemoryStorageAdapter();
    let current = 'v0';
    const saver = new AutoSaver({ adapter, key: 'doc', getContent: () => encode(current) });

    await saver.touch(0);
    current = 'v1';
    await saver.touch(5000); // flushes "v1", resets dirtySince

    current = 'v2';
    await saver.touch(5001); // brand new edit; only 1ms into its own window
    expect(decode(await adapter.get('doc'))).toBe('v1');

    await saver.touch(10001); // 5000ms after the v2 edit at 5001
    expect(decode(await adapter.get('doc'))).toBe('v2');
  });

  it('flush() writes unconditionally, even with no prior touch()', async () => {
    const adapter = new MemoryStorageAdapter();
    const saver = new AutoSaver({ adapter, key: 'doc', getContent: () => encode('direct-flush') });

    await saver.flush();

    expect(decode(await adapter.get('doc'))).toBe('direct-flush');
  });

  it('a touch that never reaches the interval never writes anything', async () => {
    const adapter = new MemoryStorageAdapter();
    const saver = new AutoSaver({ adapter, key: 'doc', getContent: () => encode('never-saved') });

    await saver.touch(0);
    await saver.touch(1000);

    expect(await adapter.get('doc')).toBeNull();
  });

  it('propagates an error from the adapter rather than swallowing it', async () => {
    const failing = {
      get: async () => null,
      put: async () => {
        throw new Error('disk full');
      },
      delete: async () => {},
      list: async () => [],
    };
    const saver = new AutoSaver({ adapter: failing, key: 'doc', getContent: () => encode('x') });

    await expect(saver.flush()).rejects.toThrow('disk full');
  });

  it('honours a custom intervalMs', async () => {
    const adapter = new MemoryStorageAdapter();
    let current = 'v0';
    const saver = new AutoSaver({
      adapter,
      key: 'doc',
      getContent: () => encode(current),
      intervalMs: 1000,
    });

    current = 'v1';
    await saver.touch(0);
    await saver.touch(900);
    expect(await adapter.get('doc')).toBeNull();

    await saver.touch(1000);
    expect(decode(await adapter.get('doc'))).toBe('v1');
  });
});
