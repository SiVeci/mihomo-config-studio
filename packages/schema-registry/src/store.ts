import { BUILTIN_BUNDLE } from './builtin.js';
import type { BundleManifest } from './manifest.js';
import { verifyBundle, type BundleVerifyFailure, type VerifyBundleOptions } from './verify.js';

export interface StoredBundle {
  readonly manifest: BundleManifest;
  readonly files: ReadonlyMap<string, Uint8Array>;
}

/**
 * Generic async key-value persistence for bundles. `bundleStoreFrom()` in
 * `storage-bridge.ts` adapts this onto `@mcs/storage`'s `StorageAdapter` for
 * real persistence; `testing/memory-store.ts` remains for tests that don't
 * need a real adapter. Keyed generically rather than by a fixed slot enum so
 * a disk-backed implementation isn't forced to model slots it doesn't need
 * to know about.
 */
export interface BundleStore {
  read(key: string): Promise<StoredBundle | null>;
  write(key: string, bundle: StoredBundle): Promise<void>;
  list(): Promise<readonly string[]>;
  remove(key: string): Promise<void>;
}

const ACTIVE_SLOT = 'active';
const PREVIOUS_SLOT = 'previous';

export type BundleInstallResult = { readonly ok: true } | BundleVerifyFailure;

/**
 * Verify-then-switch, never write-then-verify: `verifyBundle` runs entirely
 * against the in-memory candidate before the store is touched, so a failed
 * install leaves `active` (and `previous`) exactly as they were — this is
 * what "staging" means here, not a literal third slot. On success, the old
 * `active` becomes the new `previous`, discarding whatever `previous` held
 * before — the store only ever holds two slots, so a third generation is
 * dropped automatically rather than needing an explicit prune step.
 */
export async function installBundle(
  store: BundleStore,
  manifestValue: unknown,
  files: ReadonlyMap<string, Uint8Array>,
  options: VerifyBundleOptions,
): Promise<BundleInstallResult> {
  const result = await verifyBundle(manifestValue, files, options);
  if (!result.ok) {
    return result;
  }

  const oldActive = await store.read(ACTIVE_SLOT);
  if (oldActive) {
    await store.write(PREVIOUS_SLOT, oldActive);
  }
  await store.write(ACTIVE_SLOT, { manifest: result.manifest, files });
  return { ok: true };
}

export type BundleRollbackResult =
  { readonly ok: true } | { readonly ok: false; readonly code: 'BUNDLE_STORE_NO_PREVIOUS' };

/** Swaps `active` and `previous`. Explicit failure when there is nothing to roll back to — never a silent no-op. */
export async function rollbackBundle(store: BundleStore): Promise<BundleRollbackResult> {
  const previous = await store.read(PREVIOUS_SLOT);
  if (!previous) {
    return { ok: false, code: 'BUNDLE_STORE_NO_PREVIOUS' };
  }

  const active = await store.read(ACTIVE_SLOT);
  await store.write(ACTIVE_SLOT, previous);
  if (active) {
    await store.write(PREVIOUS_SLOT, active);
  } else {
    await store.remove(PREVIOUS_SLOT);
  }
  return { ok: true };
}

/**
 * Resolves the bundle that should actually be used: `active`, falling back
 * to `previous`, falling back to the built-in bundle if both slots are
 * empty or fail re-verification (on-disk corruption, not just a bad
 * install — a bad install never reaches the store in the first place). The
 * built-in bundle is compiled into the app and is never itself re-verified
 * or evicted — it is what makes "works fully offline" (FR-UPD-01) hold even
 * when the store is completely unusable.
 */
export async function resolveActiveBundle(
  store: BundleStore,
  options: VerifyBundleOptions,
): Promise<StoredBundle> {
  for (const slot of [ACTIVE_SLOT, PREVIOUS_SLOT]) {
    const candidate = await store.read(slot);
    if (!candidate) continue;
    const result = await verifyBundle(candidate.manifest, candidate.files, options);
    if (result.ok) return candidate;
  }
  return builtinAsStoredBundle();
}

/**
 * `BUILTIN_BUNDLE`'s live `SchemaModule`s, re-serialised as a `StoredBundle`
 * ready for `createRegistry` — the same conversion `resolveActiveBundle`'s
 * own fallback needs, exported so production code that has no installed
 * override to check (v0.3.0 has no Bundle-install UI yet) can resolve the
 * built-in modules directly instead of going through the full async
 * store-and-verify path for a feature that cannot exist yet (v0.3.0 #14:
 * the web app's form renderer, and the config Worker's own pipeline stages).
 */
export function builtinAsStoredBundle(): StoredBundle {
  const files = new Map<string, Uint8Array>();
  for (const [path, module] of Object.entries(BUILTIN_BUNDLE.modules)) {
    files.set(path, new TextEncoder().encode(JSON.stringify(module)));
  }
  return { manifest: BUILTIN_BUNDLE.manifest, files };
}
