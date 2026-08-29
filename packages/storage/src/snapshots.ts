import type { StorageAdapter } from './adapter.ts';

/** FR-PROJ-05: at least this many snapshots are retained under normal conditions. */
export const DEFAULT_MAX_SNAPSHOTS = 50;
/** The floor snapshot count kept once space is under pressure (level 2). */
export const DEFAULT_MIN_SNAPSHOTS = 10;
/** `estimateQuota` usage/quota ratio at or above which space counts as "tight". */
export const DEFAULT_PRESSURE_THRESHOLD = 0.9;

export type SnapshotDegradationLevel = 'normal' | 'reduced' | 'stopped';

/**
 * Reports what `record()` actually did, for a UI to surface (#11+). Never
 * carries a literal message or any snapshot content — only an i18n key and
 * structured, config-value-free data (NFR-SEC-03).
 */
export interface SnapshotDegradationSignal {
  readonly level: SnapshotDegradationLevel;
  readonly messageKey: string;
  /** How many snapshots are retained after this call (0 at the `stopped` level). */
  readonly retainedCount: number;
}

export interface Snapshot {
  readonly key: string;
  readonly content: Uint8Array;
}

export interface SnapshotManagerOptions {
  adapter: StorageAdapter;
  /** Key prefix snapshots are stored under; must not collide with other adapter keys. */
  prefix: string;
  maxSnapshots?: number;
  minSnapshots?: number;
  pressureThreshold?: number;
}

/**
 * Bounded, degradable snapshot retention (FR-PROJ-05, NFR-REL-05). Storage is
 * generic here — `record()` takes raw bytes, not a `HistoryEntry`; a caller
 * that wants to persist `@mcs/config-model`'s history stack encodes its
 * entries before calling `record()`. `storage` staying agnostic of what a
 * "history entry" is keeps this package free of a dependency on
 * `@mcs/config-model` it would otherwise never need.
 */
export class SnapshotManager {
  readonly #adapter: StorageAdapter;
  readonly #prefix: string;
  readonly #maxSnapshots: number;
  readonly #minSnapshots: number;
  readonly #pressureThreshold: number;

  constructor(options: SnapshotManagerOptions) {
    this.#adapter = options.adapter;
    this.#prefix = options.prefix;
    this.#maxSnapshots = options.maxSnapshots ?? DEFAULT_MAX_SNAPSHOTS;
    this.#minSnapshots = options.minSnapshots ?? DEFAULT_MIN_SNAPSHOTS;
    this.#pressureThreshold = options.pressureThreshold ?? DEFAULT_PRESSURE_THRESHOLD;
  }

  /** Every retained snapshot, oldest first. */
  async list(): Promise<readonly Snapshot[]> {
    const keys = [...(await this.#adapter.list(this.#prefix))].sort();
    const out: Snapshot[] = [];
    for (const key of keys) {
      const content = await this.#adapter.get(key);
      if (content) out.push({ key, content });
    }
    return out;
  }

  /**
   * Records a new snapshot, pruning older ones per the three-level policy:
   * 1. Under `maxSnapshots` (50) and space is not (proactively) tight: try
   *    the write with no pruning first — the common case should not destroy
   *    old snapshots just in case a write might fail that in fact succeeds.
   * 2. Space is tight (proactively, via `estimateQuota`, or reactively, via
   *    a `QuotaExceededError` from `put`): prune down to `minSnapshots` (10)
   *    to free room, then retry.
   * 3. Still fails at the floor: stop snapshotting. Whatever pruning already
   *    happened while trying to make room stands — at this point the policy
   *    has genuinely given up on retention, not just deferred it — but
   *    nothing already stored is corrupted, and `autosave.ts`'s single-key
   *    write still protects the current document.
   */
  async record(content: Uint8Array): Promise<SnapshotDegradationSignal> {
    const tight = await this.#isQuotaTight();
    if (!tight && (await this.#attempt(content, this.#maxSnapshots, false))) {
      return {
        level: 'normal',
        messageKey: 'storage.snapshot.normal',
        retainedCount: this.#maxSnapshots,
      };
    }

    if (await this.#attempt(content, this.#minSnapshots, true)) {
      return {
        level: 'reduced',
        messageKey: 'storage.snapshot.reduced',
        retainedCount: this.#minSnapshots,
      };
    }

    return { level: 'stopped', messageKey: 'storage.snapshot.stopped', retainedCount: 0 };
  }

  /**
   * Writes one snapshot at `key`, pruning to `ceiling - 1` first only when
   * `pruneFirst` is set (freeing room before a write we already expect might
   * not fit) and always pruning to `ceiling` after a successful write.
   * Returns `false` only for a quota failure; anything else propagates.
   */
  async #attempt(content: Uint8Array, ceiling: number, pruneFirst: boolean): Promise<boolean> {
    if (pruneFirst) await this.#pruneToCount(Math.max(ceiling - 1, 0));
    const key = await this.#nextKey();
    try {
      await this.#adapter.put(key, content);
    } catch (error) {
      if (!isQuotaExceeded(error)) throw error;
      return false;
    }
    await this.#pruneToCount(ceiling);
    return true;
  }

  async #pruneToCount(n: number): Promise<void> {
    const keys = [...(await this.#adapter.list(this.#prefix))].sort();
    const excess = keys.length - n;
    if (excess <= 0) return;
    for (const key of keys.slice(0, excess)) {
      await this.#adapter.delete(key);
    }
  }

  async #nextKey(): Promise<string> {
    const keys = await this.#adapter.list(this.#prefix);
    let max = -1;
    for (const key of keys) {
      const sequence = Number(key.slice(this.#prefix.length));
      if (Number.isFinite(sequence) && sequence > max) max = sequence;
    }
    return `${this.#prefix}${String(max + 1).padStart(12, '0')}`;
  }

  async #isQuotaTight(): Promise<boolean> {
    const quota = await this.#adapter.estimateQuota?.();
    if (!quota || quota.quotaBytes === null || quota.quotaBytes === 0) return false;
    return quota.usageBytes / quota.quotaBytes >= this.#pressureThreshold;
  }
}

function isQuotaExceeded(error: unknown): boolean {
  return error instanceof Error && error.name === 'QuotaExceededError';
}
