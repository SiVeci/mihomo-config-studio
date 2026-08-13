/** Bytes used and, when knowable, the ceiling before writes start failing. */
export interface StorageQuota {
  readonly usageBytes: number;
  /** `null` when the platform cannot report a ceiling (e.g. no real quota concept). */
  readonly quotaBytes: number | null;
}

/**
 * Generic async key-value persistence. Values are raw bytes, never a string:
 * a `.mcsproj` (#6) is a binary ZIP container, and forcing a text encoding at
 * this layer would mean every caller re-derives the same encode/decode step.
 * `list(prefix)` is a plain string-prefix filter, not a hierarchy — callers
 * that want key namespacing (see `@mcs/schema-registry`'s `storage-bridge.ts`)
 * build it out of prefixes themselves.
 *
 * `estimateQuota` is optional: not every adapter has a real quota concept
 * (the in-memory one does not), and #5's space-pressure degradation policy
 * treats a missing or `null`-returning `estimateQuota` the same as "unknown".
 */
export interface StorageAdapter {
  get(key: string): Promise<Uint8Array | null>;
  put(key: string, value: Uint8Array): Promise<void>;
  delete(key: string): Promise<void>;
  list(prefix: string): Promise<readonly string[]>;
  estimateQuota?(): Promise<StorageQuota | null>;
}

/**
 * Extra surface Android needs, defined now so the base port does not need a
 * breaking change when `apps/android` is packaged in v0.6.0 (out of scope
 * until then — TODO(v0.6.0): implement against a Capacitor plugin, informed
 * by the M0 spike at
 * `apps/android/android/app/src/main/java/studio/mihomoconfig/m0spike/SafFilePlugin.kt`).
 * No `@capacitor/*` import belongs here or ever will in `packages/**`
 * (ESLint enforces this) — only the plain-TS interface shape.
 *
 * Two Android storage locations behave differently from a plain key: a
 * Storage Access Framework (SAF) document is addressed by a `content://` URI
 * the user picked through a system file picker, not an app-chosen key, so a
 * real implementation must persist the key-to-URI mapping itself. The app's
 * private directory (`filesDir`) has no such indirection — `StorageAdapter`'s
 * plain string keys already model it directly.
 */
export interface AndroidFileAdapter extends StorageAdapter {
  /** Record that `key` is backed by a user-picked SAF document at `uri`. */
  bindSafDocument(key: string, uri: string): Promise<void>;
}
