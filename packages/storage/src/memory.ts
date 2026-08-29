import type { StorageAdapter, StorageQuota } from './adapter.ts';

/**
 * In-memory `StorageAdapter`: for tests, and as the fallback when no durable
 * backend is available. Nothing here persists past the instance's lifetime —
 * two instances never share state, even with the same keys.
 */
export class MemoryStorageAdapter implements StorageAdapter {
  readonly #entries = new Map<string, Uint8Array>();

  async get(key: string): Promise<Uint8Array | null> {
    return this.#entries.get(key) ?? null;
  }

  async put(key: string, value: Uint8Array): Promise<void> {
    this.#entries.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.#entries.delete(key);
  }

  async list(prefix: string): Promise<readonly string[]> {
    return [...this.#entries.keys()].filter((key) => key.startsWith(prefix));
  }

  /**
   * A stub, as planned: an in-memory `Map` has no real quota ceiling to
   * report, so `quotaBytes` is always `null`. #5's degradation-policy tests
   * inject their own adapters to simulate quota pressure rather than relying
   * on this one to model it.
   */
  async estimateQuota(): Promise<StorageQuota | null> {
    let usageBytes = 0;
    for (const value of this.#entries.values()) usageBytes += value.byteLength;
    return { usageBytes, quotaBytes: null };
  }
}
