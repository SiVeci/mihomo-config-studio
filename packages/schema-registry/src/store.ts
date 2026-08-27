import { BUILTIN_BUNDLE } from './builtin.js';
import { channelSlotKey, DEFAULT_BUNDLE_CHANNEL } from './channel.js';
import type { BundleChannel, BundleManifest } from './manifest.js';
import { verifyBundle, type BundleVerifyFailure, type VerifyBundleOptions } from './verify.js';

const ALL_CHANNELS: readonly BundleChannel[] = ['stable', 'beta'];

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

export type BundleInstallResult = { readonly ok: true } | BundleVerifyFailure;

/**
 * Verify-then-switch, never write-then-verify: `verifyBundle` runs entirely
 * against the in-memory candidate before the store is touched, so a failed
 * install leaves `active` (and `previous`) exactly as they were — this is
 * what "staging" means here, not a literal third slot. On success, the old
 * `active` becomes the new `previous`, discarding whatever `previous` held
 * before — the store only ever holds two slots per channel, so a third
 * generation is dropped automatically rather than needing an explicit prune
 * step.
 *
 * The slot-pair written is `result.manifest.channel`, never a
 * caller-supplied value (FR-UPD-02, v0.5.0 #2): the manifest decides which
 * channel it belongs to, not whoever called `installBundle` — otherwise a
 * Beta-channelled bundle could be installed into the Stable slot-pair simply
 * because the caller said so, defeating the whole point of separate
 * channels.
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

  const activeSlot = channelSlotKey(result.manifest.channel, 'active');
  const previousSlot = channelSlotKey(result.manifest.channel, 'previous');

  const oldActive = await store.read(activeSlot);
  if (oldActive) {
    await store.write(previousSlot, oldActive);
  }
  await store.write(activeSlot, { manifest: result.manifest, files });
  return { ok: true };
}

export type BundleRollbackResult =
  { readonly ok: true } | { readonly ok: false; readonly code: 'BUNDLE_STORE_NO_PREVIOUS' };

/**
 * Swaps `active` and `previous` within one channel's slot-pair (defaults to
 * Stable). Explicit failure when there is nothing to roll back to — never a
 * silent no-op. Never crosses channels: rolling back Stable can never
 * surface a Beta install, and vice versa.
 */
export async function rollbackBundle(
  store: BundleStore,
  channel: BundleChannel = DEFAULT_BUNDLE_CHANNEL,
): Promise<BundleRollbackResult> {
  const activeSlot = channelSlotKey(channel, 'active');
  const previousSlot = channelSlotKey(channel, 'previous');

  const previous = await store.read(previousSlot);
  if (!previous) {
    return { ok: false, code: 'BUNDLE_STORE_NO_PREVIOUS' };
  }

  const active = await store.read(activeSlot);
  await store.write(activeSlot, previous);
  if (active) {
    await store.write(previousSlot, active);
  } else {
    await store.remove(previousSlot);
  }
  return { ok: true };
}

/**
 * Resolves the bundle that should actually be used for one channel
 * (defaults to Stable, FR-UPD-02): that channel's `active`, falling back to
 * its `previous`, falling back to the built-in bundle if both slots are
 * empty or fail re-verification (on-disk corruption, not just a bad
 * install — a bad install never reaches the store in the first place). The
 * built-in bundle is compiled into the app and is never itself re-verified
 * or evicted — it is what makes "works fully offline" (FR-UPD-01) hold even
 * when the store is completely unusable.
 */
export async function resolveActiveBundle(
  store: BundleStore,
  options: VerifyBundleOptions,
  channel: BundleChannel = DEFAULT_BUNDLE_CHANNEL,
): Promise<StoredBundle> {
  for (const slot of [channelSlotKey(channel, 'active'), channelSlotKey(channel, 'previous')]) {
    const candidate = await store.read(slot);
    if (!candidate) continue;
    const result = await verifyBundle(candidate.manifest, candidate.files, options);
    if (result.ok) return candidate;
  }
  return builtinAsStoredBundle();
}

/**
 * Finds the specific Bundle version a project's `schema-lock` names (ADR-004),
 * not "whatever is active right now" — installing an update must never change
 * what an existing, un-upgraded project resolves to (v0.5.0 #11). Searches
 * every slot across both channels (a project's lock does not record which
 * channel it was authored under, and versions are unique across channels), so
 * a project can keep validating against a Beta bundle after the user switches
 * their own preference back to Stable, or vice versa. The built-in bundle is
 * checked first since it never occupies a store slot and comparing its
 * version is free. `null` means the locked version is not available from any
 * local source — the caller's job (v0.5.0 #12: read-only protection), not
 * this function's.
 */
export async function resolveBundleByVersion(
  store: BundleStore,
  version: string,
  options: VerifyBundleOptions,
): Promise<StoredBundle | null> {
  const builtin = builtinAsStoredBundle();
  if (builtin.manifest.version === version) return builtin;

  for (const channel of ALL_CHANNELS) {
    for (const slot of [channelSlotKey(channel, 'active'), channelSlotKey(channel, 'previous')]) {
      const candidate = await store.read(slot);
      if (!candidate || candidate.manifest.version !== version) continue;
      const result = await verifyBundle(candidate.manifest, candidate.files, options);
      if (result.ok) return candidate;
    }
  }
  return null;
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
