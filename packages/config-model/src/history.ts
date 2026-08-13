import type { MihomoYamlDocument } from '@mcs/yaml-engine';

export interface HistoryEntry {
  readonly description: string;
  readonly before: string;
  readonly after: string;
}

export interface HistoryStackOptions {
  /**
   * Consecutive `record()` calls that pass the same `mergeKey` inside this
   * window collapse into a single entry, so typing into one field does not
   * push one history item per keystroke. Edits that omit `mergeKey` (a
   * cascading rename touching several paths, for instance) never merge.
   */
  mergeWindowMs?: number;
  /** Oldest entries are evicted once the stack holds more than this many. */
  maxEntries?: number;
  /** Injected clock so the merge window is testable without real waiting. */
  now?: () => number;
}

const DEFAULT_MERGE_WINDOW_MS = 1000;
const DEFAULT_MAX_ENTRIES = 100;

/**
 * A single undo/redo stack for the whole document (FR-PROJ-04): form edits
 * and reference-cascading renames both go through `record()`, so undo always
 * has one meaning regardless of which UI surface triggered the edit. Building
 * this in `config-model` rather than the UI layer is deliberate — v0.4.0's
 * batch operations need to join the same stack, which would not be possible
 * if each UI surface kept its own.
 *
 * Entries store text snapshots, not an AST diff: `MihomoYamlDocument` is
 * mutated in place and `commit()` returns a new instance, so text is the
 * simplest representation, and it is trivially serialisable (reused directly
 * by #5's autosave snapshots). The memory cost of many large snapshots is a
 * deliberate non-concern here — trimming is a storage policy, handled where
 * the storage policy lives (#5), not pre-optimised in this in-memory stack.
 */
export class HistoryStack {
  #entries: HistoryEntry[] = [];
  #cursor = 0;
  #lastMergeKey: string | null = null;
  #lastEditAt = -Infinity;
  readonly #mergeWindowMs: number;
  readonly #maxEntries: number;
  readonly #now: () => number;

  constructor(options: HistoryStackOptions = {}) {
    this.#mergeWindowMs = options.mergeWindowMs ?? DEFAULT_MERGE_WINDOW_MS;
    this.#maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.#now = options.now ?? Date.now;
  }

  get canUndo(): boolean {
    return this.#cursor > 0;
  }

  get canRedo(): boolean {
    return this.#cursor < this.#entries.length;
  }

  /**
   * Run `mutate` against `document` and record the whole before/after text
   * transition as one entry, no matter how many individual `document.*`
   * calls happen inside it. This is what makes a cascading rename (several
   * `setScalarIn`/`renameKeyIn` calls for one logical rename) a single undo
   * step instead of one per touched line — undoing returns straight to the
   * pre-rename text, never an intermediate state.
   *
   * A no-op `mutate` (text unchanged afterward) records nothing. Starting any
   * new, non-merged edit discards whatever redo branch was ahead of it. If
   * `mutate` throws, the exception propagates and nothing is recorded.
   */
  record(
    document: MihomoYamlDocument,
    description: string,
    mutate: () => void,
    mergeKey?: string,
  ): void {
    const before = document.toText();
    mutate();
    const after = document.toText();
    if (after === before) return;

    const now = this.#now();
    const canMerge =
      this.#cursor > 0 &&
      mergeKey !== undefined &&
      mergeKey === this.#lastMergeKey &&
      now - this.#lastEditAt <= this.#mergeWindowMs;

    if (canMerge) {
      const index = this.#cursor - 1;
      this.#entries[index] = { ...this.#entries[index]!, after };
    } else {
      this.#entries.length = this.#cursor; // Drop any redo branch ahead of us.
      this.#entries.push({ description, before, after });
      this.#cursor = this.#entries.length;
      if (this.#entries.length > this.#maxEntries) {
        this.#entries.shift();
        this.#cursor -= 1;
      }
    }
    this.#lastMergeKey = mergeKey ?? null;
    this.#lastEditAt = now;
  }

  /** Text to restore the document to, or `null` when there is nothing to undo. */
  undo(): string | null {
    if (!this.canUndo) return null;
    this.#cursor -= 1;
    this.#lastMergeKey = null; // An edit right after undo must never merge into a passed entry.
    return this.#entries[this.#cursor]!.before;
  }

  /** Text to restore the document to, or `null` when there is nothing to redo. */
  redo(): string | null {
    if (!this.canRedo) return null;
    const entry = this.#entries[this.#cursor]!;
    this.#cursor += 1;
    this.#lastMergeKey = null;
    return entry.after;
  }
}
