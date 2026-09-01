import { BUILTIN_BUNDLE } from './builtin.js';
import { channelSlotKey, DEFAULT_BUNDLE_CHANNEL } from './channel.js';
import type { BundleChannel, BundleManifest } from './manifest.js';
import {
  verifyBundle,
  verifyBundleWithoutSignature,
  type BundleVerifyErrorCode,
  type VerifyBundleOptions,
  type VerifyBundleWithoutSignatureOptions,
} from './verify.js';

const ALL_CHANNELS: readonly BundleChannel[] = ['stable', 'beta'];

/**
 * FR-UPD-09 (v0.9.0 #17): whether this installation's signature was ever
 * checked against a known trust anchor at all. `'builtin'` is the bundle
 * compiled into the app (never written through `installBundle`/
 * `installUntrustedBundle`, so it never occupies a store slot in the first
 * place); `'signed'` passed the full `verifyBundle` pipeline, signature
 * included; `'untrusted'` only ever comes from `installUntrustedBundle` —
 * every other check still ran, but nobody vouched for *who* produced it.
 */
export type BundleTrust = 'builtin' | 'signed' | 'untrusted';

export interface StoredBundle {
  readonly manifest: BundleManifest;
  readonly files: ReadonlyMap<string, Uint8Array>;
  readonly trust: BundleTrust;
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

export type BundleInstallErrorCode = BundleVerifyErrorCode | 'BUNDLE_UNTRUSTED_STABLE_CHANNEL';

/** Never carries a message, and never the hash/signature/key values themselves (NFR-SEC-03). */
export interface BundleInstallFailure {
  readonly ok: false;
  readonly code: BundleInstallErrorCode;
  readonly path: string;
}

export type BundleInstallResult = { readonly ok: true } | BundleInstallFailure;

/**
 * Shared verify-then-switch mechanics for both `installBundle` and
 * `installUntrustedBundle`: never write-then-verify — the manifest is
 * already-verified by the time this runs, so a failed verification never
 * reaches here and `active`/`previous` stay exactly as they were. On
 * success, the old `active` becomes the new `previous`, discarding whatever
 * `previous` held before — the store only ever holds two slots per channel,
 * so a third generation is dropped automatically rather than needing an
 * explicit prune step.
 *
 * The slot-pair written is `manifest.channel`, never a caller-supplied value
 * (FR-UPD-02, v0.5.0 #2): the manifest decides which channel it belongs to,
 * not whoever called this — otherwise a Beta-channelled bundle could be
 * installed into the Stable slot-pair simply because the caller said so,
 * defeating the whole point of separate channels.
 */
async function writeVerifiedBundle(
  store: BundleStore,
  manifest: BundleManifest,
  files: ReadonlyMap<string, Uint8Array>,
  trust: Exclude<BundleTrust, 'builtin'>,
): Promise<BundleInstallResult> {
  const activeSlot = channelSlotKey(manifest.channel, 'active');
  const previousSlot = channelSlotKey(manifest.channel, 'previous');

  const oldActive = await store.read(activeSlot);
  if (oldActive) {
    await store.write(previousSlot, oldActive);
  }
  await store.write(activeSlot, { manifest, files, trust });
  return { ok: true };
}

/**
 * Verify-then-switch, never write-then-verify: `verifyBundle` runs entirely
 * against the in-memory candidate before the store is touched, so a failed
 * install leaves `active` (and `previous`) exactly as they were — this is
 * what "staging" means here, not a literal third slot. Always persists with
 * `trust: 'signed'` — this is the only install path that ever ran the real
 * signature-against-trust-anchor check (see `installUntrustedBundle` for the
 * deliberately-weaker FR-UPD-09 path).
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
  return writeVerifiedBundle(store, result.manifest, files, 'signed');
}

/**
 * FR-UPD-09 (v0.9.0 #17): installs a manually-imported community Bundle that
 * has passed every check `installBundle` runs *except* the signature — shape,
 * format version range, app-version compatibility, and per-file SHA-256 all
 * still apply unchanged (`verifyBundleWithoutSignature`). "Untrusted" here
 * names exactly the one thing that was skipped (nobody vouched for who
 * signed this), not a general safety downgrade.
 *
 * Hard-rejects the Stable channel regardless of what the manifest itself
 * claims (`BUNDLE_UNTRUSTED_STABLE_CHANNEL`): Stable is the one channel
 * PRD §13.5's release-blocker gate holds to the full kernel test matrix, and
 * a community package cannot buy its way in just by setting `channel:
 * "stable"` in its own manifest. This is a second, independent line from
 * #3's own Stable release gate — either one alone would still stop this.
 */
export async function installUntrustedBundle(
  store: BundleStore,
  manifestValue: unknown,
  files: ReadonlyMap<string, Uint8Array>,
  options: VerifyBundleWithoutSignatureOptions,
): Promise<BundleInstallResult> {
  const result = await verifyBundleWithoutSignature(manifestValue, files, options);
  if (!result.ok) {
    return result;
  }
  if (result.manifest.channel === 'stable') {
    return { ok: false, code: 'BUNDLE_UNTRUSTED_STABLE_CHANNEL', path: 'channel' };
  }
  return writeVerifiedBundle(store, result.manifest, files, 'untrusted');
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
 * Re-verifies a slot's stored candidate to the same standard it was
 * originally installed under — never more. An `untrusted` install
 * (`installUntrustedBundle`, FR-UPD-09) never had a signature any trust
 * anchor produced in the first place, so re-demanding one on every read
 * would make it fail "re-verification" unconditionally and silently evict
 * itself to the built-in bundle the moment it is read back, defeating the
 * entire feature. `signed` still gets the full signature check every time,
 * unchanged from before this field existed.
 */
async function reverifyStoredCandidate(
  candidate: StoredBundle,
  options: VerifyBundleOptions,
): Promise<boolean> {
  const result =
    candidate.trust === 'untrusted'
      ? await verifyBundleWithoutSignature(candidate.manifest, candidate.files, options)
      : await verifyBundle(candidate.manifest, candidate.files, options);
  return result.ok;
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
    if (await reverifyStoredCandidate(candidate, options)) return candidate;
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
      if (await reverifyStoredCandidate(candidate, options)) return candidate;
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
  return { manifest: BUILTIN_BUNDLE.manifest, files, trust: 'builtin' };
}
