import { VALIDATION_DEBOUNCE_MS } from './protocol.js';
import type {
  AnalyzeImpactResponse,
  ApplyBatchResponse,
  ApplyPatchResponse,
  BuildGraphLayoutOptions,
  ConfigureDisabledRulesResponse,
  ConfigureModulesResponse,
  ConfigPath,
  DiffResponse,
  GraphLayoutResponse,
  IssueFix,
  LocateResponse,
  ParseResponse,
  PreviewProviderResponse,
  RedoResponse,
  SchemaModule,
  SerializeOptions,
  SerializeResponse,
  UndoResponse,
  ValidateResponse,
  ValueResponse,
  WorkerRequest,
  WorkerResponse,
} from './protocol.js';

export interface WorkerMessageEvent {
  data: WorkerResponse;
}

/**
 * Everything `WorkerClient` needs from a Worker. A real `Worker` satisfies
 * this structurally; tests supply a fake object with the same two members
 * instead of constructing a real `new Worker()`.
 */
export interface WorkerLike {
  postMessage(message: WorkerRequest): void;
  onmessage: ((event: WorkerMessageEvent) => void) | null;
}

/** Rejects a request when its matching response comes back as `type: 'error'`. */
export class WorkerRequestError extends Error {
  readonly code: string;
  readonly messageKey: string;

  constructor(code: string, messageKey: string) {
    super(`Worker request failed: ${code}`);
    this.name = 'WorkerRequestError';
    this.code = code;
    this.messageKey = messageKey;
  }
}

interface PendingEntry {
  resolve: (response: WorkerResponse) => void;
  reject: (error: WorkerRequestError) => void;
}

/**
 * Main-thread proxy for the config Worker (NFR-PERF-05). Never imports
 * `@mcs/yaml-engine` or `@mcs/validator` — every operation crosses via
 * `postMessage`; see the boundary test below for the structural guarantee.
 */
export class WorkerClient {
  readonly #worker: WorkerLike;
  #nextRequestId = 0;
  readonly #pending = new Map<string, PendingEntry>();
  /**
   * Timestamp of the most recent `touchValidate`, or `null` once a due
   * validate has been consumed. This is trailing-edge debounce (reset on
   * every touch), not `AutoSaver`'s max-latency batching (fire N ms after the
   * *first* unflushed edit) — NFR-PERF-03 asks for a burst of edits to
   * collapse into one call covering the *last* edit, which needs the timer to
   * restart on every touch rather than being capped from the first one.
   */
  #validateDirtySince: number | null = null;

  constructor(worker: WorkerLike) {
    this.#worker = worker;
    this.#worker.onmessage = (event) => this.#handleMessage(event.data);
  }

  parse(text: string): Promise<ParseResponse> {
    return this.#send({
      type: 'parse',
      requestId: this.#makeRequestId(),
      text,
    }) as Promise<ParseResponse>;
  }

  applyPatch(patch: IssueFix): Promise<ApplyPatchResponse> {
    return this.#send({
      type: 'applyPatch',
      requestId: this.#makeRequestId(),
      patch,
    }) as Promise<ApplyPatchResponse>;
  }

  /** One atomic, single-undo-step edit for the whole batch (v0.4.0 #10, ADR-023) — never partially applied, never merged with an adjacent edit. */
  applyBatch(patches: IssueFix[]): Promise<ApplyBatchResponse> {
    return this.#send({
      type: 'applyBatch',
      requestId: this.#makeRequestId(),
      patches,
    }) as Promise<ApplyBatchResponse>;
  }

  /** Who references the entity at `path`, split into what can be reference-replaced and what must cascade-delete (v0.4.0 #11, FR-REL-03 UI). */
  analyzeImpact(path: ConfigPath): Promise<AnalyzeImpactResponse> {
    return this.#send({
      type: 'analyzeImpact',
      requestId: this.#makeRequestId(),
      path,
    }) as Promise<AnalyzeImpactResponse>;
  }

  /** The whole relationship graph, freshly built from the current document (v0.4.0 #13, FR-REL-04/06). */
  graphLayout(options?: BuildGraphLayoutOptions): Promise<GraphLayoutResponse> {
    return this.#send({
      type: 'graphLayout',
      requestId: this.#makeRequestId(),
      ...(options !== undefined ? { options } : {}),
    }) as Promise<GraphLayoutResponse>;
  }

  validate(): Promise<ValidateResponse> {
    return this.#send({
      type: 'validate',
      requestId: this.#makeRequestId(),
    }) as Promise<ValidateResponse>;
  }

  diff(baseline: string): Promise<DiffResponse> {
    return this.#send({
      type: 'diff',
      requestId: this.#makeRequestId(),
      baseline,
    }) as Promise<DiffResponse>;
  }

  serialize(options?: SerializeOptions): Promise<SerializeResponse> {
    return this.#send({
      type: 'serialize',
      requestId: this.#makeRequestId(),
      ...(options !== undefined ? { options } : {}),
    }) as Promise<SerializeResponse>;
  }

  locate(path: ConfigPath): Promise<LocateResponse> {
    return this.#send({
      type: 'locate',
      requestId: this.#makeRequestId(),
      path,
    }) as Promise<LocateResponse>;
  }

  /** The document's current value as plain JS — #14's form renderer plans against this. */
  value(): Promise<ValueResponse> {
    return this.#send({
      type: 'value',
      requestId: this.#makeRequestId(),
    }) as Promise<ValueResponse>;
  }

  /** No-op (reflected in `canUndo`) when there is nothing to undo, never a rejection (v0.3.0 #15). */
  undo(): Promise<UndoResponse> {
    return this.#send({
      type: 'undo',
      requestId: this.#makeRequestId(),
    }) as Promise<UndoResponse>;
  }

  /** No-op (reflected in `canRedo`) when there is nothing to redo, never a rejection (v0.3.0 #15). */
  redo(): Promise<RedoResponse> {
    return this.#send({
      type: 'redo',
      requestId: this.#makeRequestId(),
    }) as Promise<RedoResponse>;
  }

  /** Structural preview of a local Provider file — unrelated to (never touches) the currently open project (PRD §8.11, v0.3.0 #17). */
  previewProvider(text: string): Promise<PreviewProviderResponse> {
    return this.#send({
      type: 'previewProvider',
      requestId: this.#makeRequestId(),
      text,
    }) as Promise<PreviewProviderResponse>;
  }

  /**
   * Swaps which Bundle's modules `parse`/`validate` run against, going
   * forward — send before `parse` for the project `modules` was resolved for
   * (v0.5.0 #11, decision F14). Never sent, the Worker keeps validating
   * against the built-in bundle.
   */
  configureModules(modules: readonly SchemaModule[]): Promise<ConfigureModulesResponse> {
    return this.#send({
      type: 'configureModules',
      requestId: this.#makeRequestId(),
      modules,
    }) as Promise<ConfigureModulesResponse>;
  }

  /**
   * Swaps which rule ids `runPipeline` mutes, going forward — send before
   * `parse` for the project `ruleIds` was resolved for, same convention as
   * `configureModules` (FR-VAL-06, v0.9.0 #15). Never sent, the Worker mutes
   * nothing.
   */
  configureDisabledRules(ruleIds: readonly string[]): Promise<ConfigureDisabledRulesResponse> {
    return this.#send({
      type: 'configureDisabledRules',
      requestId: this.#makeRequestId(),
      ruleIds,
    }) as Promise<ConfigureDisabledRulesResponse>;
  }

  /**
   * Marks an edit at `now`. The caller re-polls with `pollValidate` (on a
   * periodic tick, wired up once an editor exists to drive this) — nothing
   * here starts a timer of its own, which is what makes the 300ms boundary
   * exactly assertable with a fake clock instead of a real wait, the same
   * testability trade-off `AutoSaver` makes for the 5-second autosave window.
   */
  touchValidate(now: number): void {
    this.#validateDirtySince = now;
  }

  /** True when `VALIDATION_DEBOUNCE_MS` has elapsed since the last `touchValidate` with nothing consumed since. */
  isValidateDue(now: number): boolean {
    return (
      this.#validateDirtySince !== null && now - this.#validateDirtySince >= VALIDATION_DEBOUNCE_MS
    );
  }

  /**
   * Sends the debounced `validate` request if due, otherwise sends nothing
   * and returns `null`. Because the Worker validates whatever document state
   * it currently holds (not a snapshot taken at touch time), the request this
   * sends always covers every edit applied before the call — including the
   * one that made this due — so the last edit in a burst is never swallowed.
   */
  pollValidate(now: number): Promise<ValidateResponse> | null {
    if (!this.isValidateDue(now)) return null;
    this.#validateDirtySince = null;
    return this.validate();
  }

  #makeRequestId(): string {
    this.#nextRequestId += 1;
    return `req-${this.#nextRequestId}`;
  }

  #send(request: WorkerRequest): Promise<WorkerResponse> {
    return new Promise((resolve, reject) => {
      this.#pending.set(request.requestId, { resolve, reject });
      this.#worker.postMessage(request);
    });
  }

  #handleMessage(response: WorkerResponse): void {
    const pending = this.#pending.get(response.requestId);
    if (!pending) return;
    this.#pending.delete(response.requestId);
    if (response.type === 'error') {
      pending.reject(new WorkerRequestError(response.code, response.messageKey));
    } else {
      pending.resolve(response);
    }
  }
}

/**
 * Builds a `WorkerClient` backed by a real `new Worker(...)`, adapting it to
 * `WorkerLike` via a fresh object literal rather than passing the `Worker`
 * instance directly: `Worker.postMessage`/`onmessage` are typed against the
 * DOM lib's broader `any`-based signatures, and forwarding through an
 * explicit adapter sidesteps that variance question entirely instead of
 * relying on it working out. Not unit-testable — `jsdom` has no real Worker
 * implementation — so this is exercised by `vite build` and manual/real
 * browser checks instead (see this slice's verification notes).
 */
export function createConfigWorkerClient(): WorkerClient {
  const worker = new Worker(new URL('./config.worker.ts', import.meta.url), { type: 'module' });
  const adapter: WorkerLike = {
    onmessage: null,
    postMessage: (message) => worker.postMessage(message),
  };
  worker.onmessage = (event) => adapter.onmessage?.({ data: event.data as WorkerResponse });
  return new WorkerClient(adapter);
}
