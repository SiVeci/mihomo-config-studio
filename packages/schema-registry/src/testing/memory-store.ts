import type { BundleStore, StoredBundle } from '../store.js';

/** In-memory `BundleStore` for tests. The durable implementation is `@mcs/storage` (v0.2.0). */
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
