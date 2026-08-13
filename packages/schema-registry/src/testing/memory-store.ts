import type { BundleStore, StoredBundle } from '../store.js';

/** In-memory `BundleStore` for tests; `bundleStoreFrom()` in `storage-bridge.ts` gives real durable persistence. */
export class MemoryBundleStore implements BundleStore {
  readonly #slots = new Map<string, StoredBundle>();

  async read(key: string): Promise<StoredBundle | null> {
    return this.#slots.get(key) ?? null;
  }

  async write(key: string, bundle: StoredBundle): Promise<void> {
    this.#slots.set(key, bundle);
  }

  async list(): Promise<readonly string[]> {
    return [...this.#slots.keys()];
  }

  async remove(key: string): Promise<void> {
    this.#slots.delete(key);
  }
}
