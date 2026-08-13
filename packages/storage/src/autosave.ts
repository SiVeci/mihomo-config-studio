import type { StorageAdapter } from './adapter.js';

/** FR-PROJ-02 / NFR-REL-02: an unflushed edit must reach durable storage within this window. */
export const DEFAULT_AUTOSAVE_INTERVAL_MS = 5000;

export interface AutoSaverOptions {
  adapter: StorageAdapter;
  key: string;
  /** Returns the current content to persist; called only when a flush actually happens. */
  getContent: () => Uint8Array;
  intervalMs?: number;
}

/**
 * A pure scheduler, not a timer owner: `touch(now)` never calls `setTimeout`
 * itself, the caller feeds it the current time on every edit (and, in
 * `apps/web`, on a periodic tick — #11 wires that up). This is what makes the
 * 5-second boundary exactly assertable with a fake clock instead of a real
 * wait (NFR-REL-02).
 */
export class AutoSaver {
  readonly #adapter: StorageAdapter;
  readonly #key: string;
  readonly #getContent: () => Uint8Array;
  readonly #intervalMs: number;
  #dirtySince: number | null = null;

  constructor(options: AutoSaverOptions) {
    this.#adapter = options.adapter;
    this.#key = options.key;
    this.#getContent = options.getContent;
    this.#intervalMs = options.intervalMs ?? DEFAULT_AUTOSAVE_INTERVAL_MS;
  }

  /**
   * Marks content dirty as of `now`. If `intervalMs` has elapsed since the
   * oldest unflushed edit, flushes immediately as a side effect — so during
   * continuous editing, a burst of edits batches into one flush right at the
   * interval boundary rather than one write per edit.
   */
  async touch(now: number): Promise<void> {
    if (this.#dirtySince === null) this.#dirtySince = now;
    if (now - this.#dirtySince >= this.#intervalMs) {
      await this.flush();
    }
  }

  /**
   * Unconditionally persists the current content right now, regardless of
   * elapsed time or dirty state. This is the whole surface `apps/web` needs
   * for `beforeunload`/`visibilitychange` forced saves (#11) — the interval
   * logic in `touch` is irrelevant to "the page might close right now".
   */
  async flush(): Promise<void> {
    await this.#adapter.put(this.#key, this.#getContent());
    this.#dirtySince = null;
  }
}
