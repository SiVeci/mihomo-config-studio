import type { StorageAdapter } from '@mcs/storage';

import type { BundleManifest } from './manifest.js';
import type { BundleStore } from './store.js';

const MANIFEST_KEY_SUFFIX = '/manifest.json';
const FILE_KEY_PREFIX = '/files/';

/**
 * Adapts a generic `StorageAdapter` (`@mcs/storage`) into the `BundleStore`
 * this package's install/rollback/resolve logic needs. A bundle is stored as
 * several adapter keys rather than one serialised blob — the manifest as
 * JSON bytes at `<key>/manifest.json`, each file at `<key>/files/<path>` —
 * reusing `StorageAdapter.list(prefix)` instead of inventing a bespoke
 * container format for something the port already addresses.
 */
export function bundleStoreFrom(adapter: StorageAdapter): BundleStore {
  return {
    async read(key) {
      const manifestBytes = await adapter.get(manifestKey(key));
      if (!manifestBytes) return null;
      const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as BundleManifest;
      const files = await readFiles(adapter, key);
      return { manifest, files };
    },

    async write(key, bundle) {
      // A full replace, not a merge: a file present in the old write but
      // absent from the new one must not linger as a stale leftover.
      await clearFiles(adapter, key);
      await adapter.put(manifestKey(key), encodeManifest(bundle.manifest));
      for (const [path, bytes] of bundle.files) {
        await adapter.put(fileKey(key, path), bytes);
      }
    },

    async list() {
      const allKeys = await adapter.list('');
      const bundleKeys = new Set<string>();
      for (const storedKey of allKeys) {
        if (storedKey.endsWith(MANIFEST_KEY_SUFFIX)) {
          bundleKeys.add(storedKey.slice(0, -MANIFEST_KEY_SUFFIX.length));
        }
      }
      return [...bundleKeys];
    },

    async remove(key) {
      await adapter.delete(manifestKey(key));
      await clearFiles(adapter, key);
    },
  };
}

async function readFiles(adapter: StorageAdapter, key: string): Promise<Map<string, Uint8Array>> {
  const prefix = filePrefix(key);
  const fileKeys = await adapter.list(prefix);
  const files = new Map<string, Uint8Array>();
  for (const storedKey of fileKeys) {
    const bytes = await adapter.get(storedKey);
    if (bytes) files.set(storedKey.slice(prefix.length), bytes);
  }
  return files;
}

async function clearFiles(adapter: StorageAdapter, key: string): Promise<void> {
  const existing = await adapter.list(filePrefix(key));
  for (const storedKey of existing) await adapter.delete(storedKey);
}

function manifestKey(key: string): string {
  return `${key}${MANIFEST_KEY_SUFFIX}`;
}

function filePrefix(key: string): string {
  return `${key}${FILE_KEY_PREFIX}`;
}

function fileKey(key: string, path: string): string {
  return `${filePrefix(key)}${path}`;
}

function encodeManifest(manifest: BundleManifest): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(manifest));
}
