import type { StorageAdapter, StorageQuota } from './adapter.js';

const DEFAULT_DATABASE_NAME = 'mcs-storage';
const STORE_NAME = 'entries';
const DB_VERSION = 1;

export interface IndexedDbStorageAdapterOptions {
  /** Overrides the database name; mainly for isolating tests from each other. */
  databaseName?: string;
  /** Injectable factory, defaulting to the global `indexedDB` (real browser or `fake-indexeddb`). */
  indexedDB?: IDBFactory;
}

/**
 * `StorageAdapter` backed by IndexedDB. This lives in `@mcs/storage`, not
 * `apps/web`: IndexedDB is a browser API, not `node:fs`, so it does not
 * trip the `packages/**` filesystem-import ban, and every other domain
 * package can depend on `@mcs/storage` the same way regardless of platform.
 */
export class IndexedDbStorageAdapter implements StorageAdapter {
  readonly #dbName: string;
  readonly #factory: IDBFactory;
  #dbPromise: Promise<IDBDatabase> | null = null;

  constructor(options: IndexedDbStorageAdapterOptions = {}) {
    this.#dbName = options.databaseName ?? DEFAULT_DATABASE_NAME;
    const factory = options.indexedDB ?? globalThis.indexedDB;
    if (!factory) {
      throw new Error('IndexedDB is not available in this environment.');
    }
    this.#factory = factory;
  }

  async get(key: string): Promise<Uint8Array | null> {
    const db = await this.#open();
    return new Promise((resolve, reject) => {
      const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(key);
      request.onsuccess = () => resolve((request.result as Uint8Array | undefined) ?? null);
      request.onerror = () => reject(request.error as Error);
    });
  }

  async put(key: string, value: Uint8Array): Promise<void> {
    const db = await this.#open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error as Error);
    });
  }

  async delete(key: string): Promise<void> {
    const db = await this.#open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error as Error);
    });
  }

  async list(prefix: string): Promise<readonly string[]> {
    const db = await this.#open();
    return new Promise((resolve, reject) => {
      const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAllKeys();
      request.onsuccess = () => {
        const keys = (request.result as string[]).filter((key) => key.startsWith(prefix));
        resolve(keys);
      };
      request.onerror = () => reject(request.error as Error);
    });
  }

  /** `null` outside a browser context, or when the Storage API is unavailable. */
  async estimateQuota(): Promise<StorageQuota | null> {
    if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null;
    const estimate = await navigator.storage.estimate();
    return { usageBytes: estimate.usage ?? 0, quotaBytes: estimate.quota ?? null };
  }

  #open(): Promise<IDBDatabase> {
    if (!this.#dbPromise) {
      this.#dbPromise = new Promise((resolve, reject) => {
        const request = this.#factory.open(this.#dbName, DB_VERSION);
        request.onupgradeneeded = () => {
          request.result.createObjectStore(STORE_NAME);
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error as Error);
      });
    }
    return this.#dbPromise;
  }
}
