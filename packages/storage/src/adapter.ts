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
