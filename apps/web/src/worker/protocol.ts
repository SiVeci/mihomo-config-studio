import { HistoryStack } from '@mcs/config-model';
import type { SchemaModule } from '@mcs/schema-core';
import { builtinAsStoredBundle, createRegistry } from '@mcs/schema-registry';
import type { IssueFix, ValidationIssue } from '@mcs/validator';
import { runPipeline } from '@mcs/validator';
import type {
  ConfigPath,
  ParseResult,
  SerializeOptions,
  TextDiff,
  TextRange,
} from '@mcs/yaml-engine';
import { diffLines, MihomoYamlDocument, YamlEngineError } from '@mcs/yaml-engine';

/**
 * Message protocol for the config Worker (NFR-PERF-05). This file is the one
 * place both sides of the boundary may import the engine: `client.ts` (main
 * thread) only ever pulls `import type` names from here, so none of the
 * runtime imports above reach the main-thread bundle — see the structural
 * test in `client.test.ts`.
 */

/**
 * Resolved once per Worker instance (v0.3.0 has no Bundle-install UI, so the
 * built-in bundle is the only one that can ever be active — see
 * `builtinAsStoredBundle`'s own doc comment) and fed into every
 * `runPipeline` call below. Without this, `schemaStage`/`securityStage`
 * (v0.3.0 #12/#13) never fire outside their own package's tests: the
 * pipeline needs `PipelineContext.modules` to do anything beyond the syntax
 * stage.
 */
const RESOLVED_MODULES: readonly SchemaModule[] = createRegistry(builtinAsStoredBundle()).modules();

export type { IssueFix, ValidationIssue } from '@mcs/validator';
export type {
  ConfigPath,
  DiffOp,
  IssueSeverity,
  MessageParams,
  SerializeOptions,
  TextDiff,
  TextRange,
} from '@mcs/yaml-engine';
export { hasBlockingIssues, VALIDATION_DEBOUNCE_MS } from '@mcs/validator';
export { toPointer } from '@mcs/yaml-engine';

export interface ParseRequest {
  type: 'parse';
  requestId: string;
  text: string;
}
export interface ApplyPatchRequest {
  type: 'applyPatch';
  requestId: string;
  patch: IssueFix;
}
export interface ValidateRequest {
  type: 'validate';
  requestId: string;
}
export interface DiffRequest {
  type: 'diff';
  requestId: string;
  baseline: string;
}
export interface SerializeRequest {
  type: 'serialize';
  requestId: string;
  options?: SerializeOptions;
}
export interface LocateRequest {
  type: 'locate';
  requestId: string;
  path: ConfigPath;
}
/** The document's current value as plain JS, for #14's form renderer — the main thread never parses YAML itself. */
export interface ValueRequest {
  type: 'value';
  requestId: string;
}
export interface UndoRequest {
  type: 'undo';
  requestId: string;
}
export interface RedoRequest {
  type: 'redo';
  requestId: string;
}
/**
 * A standalone structural preview of a local Provider file (PRD §8.11,
 * ADR-005) — unrelated to the currently open project, so unlike every other
 * request here this never reads or writes `WorkerState`.
 */
export interface PreviewProviderRequest {
  type: 'previewProvider';
  requestId: string;
  text: string;
}

export type WorkerRequest =
  | ParseRequest
  | ApplyPatchRequest
  | ValidateRequest
  | DiffRequest
  | SerializeRequest
  | LocateRequest
  | ValueRequest
  | UndoRequest
  | RedoRequest
  | PreviewProviderRequest;

export interface ParseResponse {
  type: 'parse';
  requestId: string;
  issues: ValidationIssue[];
  /** The freshly parsed document as plain JS — #14's form renderer stays in sync with every text edit without a second round trip. */
  value: unknown;
}
export interface ApplyPatchResponse {
  type: 'applyPatch';
  requestId: string;
  /** So the caller can drive undo/redo button disabled state without a separate round trip (v0.3.0 #15). */
  canUndo: boolean;
  canRedo: boolean;
}
export interface ValidateResponse {
  type: 'validate';
  requestId: string;
  issues: ValidationIssue[];
}
export interface DiffResponse {
  type: 'diff';
  requestId: string;
  diff: TextDiff;
}
export interface SerializeResponse {
  type: 'serialize';
  requestId: string;
  text: string;
}
/** `range` is `null` when `path` does not resolve to any node in the current document. */
export interface LocateResponse {
  type: 'locate';
  requestId: string;
  range: TextRange | null;
}
export interface ValueResponse {
  type: 'value';
  requestId: string;
  value: unknown;
}
/**
 * `text`/`value` are the document's state *after* the undo/redo (unchanged
 * from before it when there was nothing to undo/redo) — bundled so the
 * caller can refresh the raw editor and the form in one round trip, the same
 * reasoning `ParseResponse.value` already applies.
 */
export interface UndoResponse {
  type: 'undo';
  requestId: string;
  canUndo: boolean;
  canRedo: boolean;
  text: string;
  value: unknown;
}
export interface RedoResponse {
  type: 'redo';
  requestId: string;
  canUndo: boolean;
  canRedo: boolean;
  text: string;
  value: unknown;
}
/**
 * One entry of a Provider file's `proxies:` list. Deliberately an allowlist,
 * not a denylist: `name`/`proxyType` are the only two values ever read out
 * of the entry and surfaced, so there is no sensitive-key pattern to keep in
 * sync — everything else about the entry is exposed only as a key name in
 * `fieldKeys`, never a value (NFR-SEC-02/SEC-03 — a node's `password`/`uuid`
 * must never appear in the preview, and this is true by construction rather
 * than by a regex staying complete).
 */
export interface ProviderPreviewNode {
  name: string | null;
  proxyType: string | null;
  fieldKeys: readonly string[];
}
export interface ProviderPreview {
  proxyCount: number;
  nodes: readonly ProviderPreviewNode[];
}
/** `preview` is `null` for a syntax error or a document with no top-level `proxies:` list — the UI shows one generic message either way. */
export interface PreviewProviderResponse {
  type: 'previewProvider';
  requestId: string;
  preview: ProviderPreview | null;
}
/** NFR-SEC-03: never carries configuration values — only a stable code, an i18n key, and a path. */
export interface WorkerErrorResponse {
  type: 'error';
  requestId: string;
  code: string;
  messageKey: string;
  path?: ConfigPath;
}

export type WorkerResponse =
  | ParseResponse
  | ApplyPatchResponse
  | ValidateResponse
  | DiffResponse
  | SerializeResponse
  | LocateResponse
  | ValueResponse
  | UndoResponse
  | RedoResponse
  | PreviewProviderResponse
  | WorkerErrorResponse;

/**
 * The Worker's own state: the document produced by the most recent `parse`,
 * and (v0.3.0 #15) the undo/redo stack for edits made since — living here
 * alongside the document it describes is deliberate (v0.2.0 #11's own
 * "执行时修正" already called this out): the main thread holding it would
 * break the same Worker-ownership boundary `MihomoYamlDocument` itself
 * already respects.
 */
export interface WorkerState {
  parseResult: ParseResult | null;
  historyStack: HistoryStack;
}

export function createWorkerState(): WorkerState {
  return { parseResult: null, historyStack: new HistoryStack() };
}

/**
 * Pure request handler — no `self`/`postMessage` reference anywhere, so it is
 * importable (and fully unit-testable) from both `config.worker.ts` (the real
 * Worker entry) and a fake-Worker test harness alike.
 */
export function handleWorkerRequest(state: WorkerState, request: WorkerRequest): WorkerResponse {
  switch (request.type) {
    case 'parse':
      return handleParse(state, request);
    case 'applyPatch':
      return handleApplyPatch(state, request);
    case 'validate':
      return handleValidate(state, request);
    case 'diff':
      return handleDiff(state, request);
    case 'serialize':
      return handleSerialize(state, request);
    case 'locate':
      return handleLocate(state, request);
    case 'value':
      return handleValue(state, request);
    case 'undo':
      return handleUndo(state, request);
    case 'redo':
      return handleRedo(state, request);
    case 'previewProvider':
      return handlePreviewProvider(request);
  }
}

function handleParse(state: WorkerState, request: ParseRequest): ParseResponse {
  // `ProjectPage` feeds every `applyPatch`/`undo`/`redo` response's `text`
  // straight back into `configText`, which is `YamlEditor`'s `text` prop —
  // so its own debounced effect re-parses that *exact same* text ~300ms
  // after every one of those, no user action involved. Comparing against
  // the document already held is what tells "the Worker's own echo of an
  // edit it just made" apart from "a genuinely new document" (project
  // switch/import) or "a real raw-text edit" (both change the text) — only
  // the latter two are a fresh undo scope. Getting this wrong the other way
  // silently wipes undo history a fraction of a second after every single
  // edit, which is invisible to a fast synchronous test but real for an
  // actual user (caught manually in a real browser, v0.3.0 #15).
  const isEchoOfCurrentDocument = state.parseResult?.document?.toText() === request.text;
  const parseResult = MihomoYamlDocument.parse(request.text);
  state.parseResult = parseResult;
  if (!isEchoOfCurrentDocument) state.historyStack = new HistoryStack();
  return {
    type: 'parse',
    requestId: request.requestId,
    issues: runPipeline({ parse: parseResult, modules: RESOLVED_MODULES }),
    value: parseResult.document?.toJS() ?? null,
  };
}

function handleApplyPatch(
  state: WorkerState,
  request: ApplyPatchRequest,
): ApplyPatchResponse | WorkerErrorResponse {
  const document = state.parseResult?.document;
  if (!document) return noDocumentError(request.requestId);
  try {
    const { patch } = request;
    // Same path within the merge window collapses into one undo step — this
    // is what keeps typing into one text field from pushing one history
    // entry per keystroke; a merge is still one document-text transition
    // either way, `HistoryStack.record()` handles both uniformly.
    state.historyStack.record(
      document,
      `${patch.kind}:${JSON.stringify(patch.path)}`,
      () => applyIssueFix(document, patch),
      JSON.stringify(patch.path),
    );
    return {
      type: 'applyPatch',
      requestId: request.requestId,
      canUndo: state.historyStack.canUndo,
      canRedo: state.historyStack.canRedo,
    };
  } catch (error) {
    return errorResponseFrom(request.requestId, error);
  }
}

function handleUndo(state: WorkerState, request: UndoRequest): UndoResponse | WorkerErrorResponse {
  const document = state.parseResult?.document;
  if (!document) return noDocumentError(request.requestId);
  const restoredText = state.historyStack.undo();
  if (restoredText !== null) state.parseResult = MihomoYamlDocument.parse(restoredText);
  // Non-null either way: `restoredText === null` leaves `state.parseResult`
  // as the already-confirmed-non-null value from above; a non-null
  // `restoredText` is itself a `document.toText()` snapshot recorded from a
  // document that composed successfully, and M0-1's round-trip guarantee
  // means re-parsing that exact text composes again.
  const current = state.parseResult!.document!;
  return {
    type: 'undo',
    requestId: request.requestId,
    canUndo: state.historyStack.canUndo,
    canRedo: state.historyStack.canRedo,
    text: current.toText(),
    value: current.toJS(),
  };
}

function handleRedo(state: WorkerState, request: RedoRequest): RedoResponse | WorkerErrorResponse {
  const document = state.parseResult?.document;
  if (!document) return noDocumentError(request.requestId);
  const restoredText = state.historyStack.redo();
  if (restoredText !== null) state.parseResult = MihomoYamlDocument.parse(restoredText);
  const current = state.parseResult!.document!;
  return {
    type: 'redo',
    requestId: request.requestId,
    canUndo: state.historyStack.canUndo,
    canRedo: state.historyStack.canRedo,
    text: current.toText(),
    value: current.toJS(),
  };
}

function handleValidate(
  state: WorkerState,
  request: ValidateRequest,
): ValidateResponse | WorkerErrorResponse {
  if (!state.parseResult) return noDocumentError(request.requestId);
  return {
    type: 'validate',
    requestId: request.requestId,
    issues: runPipeline({ parse: state.parseResult, modules: RESOLVED_MODULES }),
  };
}

function handleDiff(state: WorkerState, request: DiffRequest): DiffResponse | WorkerErrorResponse {
  const document = state.parseResult?.document;
  if (!document) return noDocumentError(request.requestId);
  return {
    type: 'diff',
    requestId: request.requestId,
    diff: diffLines(request.baseline, document.toText()),
  };
}

function handleSerialize(
  state: WorkerState,
  request: SerializeRequest,
): SerializeResponse | WorkerErrorResponse {
  const document = state.parseResult?.document;
  if (!document) return noDocumentError(request.requestId);
  return {
    type: 'serialize',
    requestId: request.requestId,
    text: document.toText(request.options),
  };
}

function handleLocate(
  state: WorkerState,
  request: LocateRequest,
): LocateResponse | WorkerErrorResponse {
  const document = state.parseResult?.document;
  if (!document) return noDocumentError(request.requestId);
  return { type: 'locate', requestId: request.requestId, range: document.locate(request.path) };
}

function handleValue(
  state: WorkerState,
  request: ValueRequest,
): ValueResponse | WorkerErrorResponse {
  const document = state.parseResult?.document;
  if (!document) return noDocumentError(request.requestId);
  return { type: 'value', requestId: request.requestId, value: document.toJS() };
}

function handlePreviewProvider(request: PreviewProviderRequest): PreviewProviderResponse {
  // Reuses the same parser (limits, security posture) `handleParse` does,
  // but never touches `state`: a Provider file is unrelated to whichever
  // project document is currently open (PRD §8.11 — structural preview
  // only, never merged in).
  const parseResult = MihomoYamlDocument.parse(request.text);
  return {
    type: 'previewProvider',
    requestId: request.requestId,
    preview: summarizeProviderFile(parseResult.document?.toJS() ?? null),
  };
}

function summarizeProviderFile(value: unknown): ProviderPreview | null {
  if (!isPlainObject(value) || !Array.isArray(value.proxies)) return null;
  const nodes: ProviderPreviewNode[] = value.proxies.map((entry) => {
    if (!isPlainObject(entry)) return { name: null, proxyType: null, fieldKeys: [] };
    return {
      name: typeof entry.name === 'string' ? entry.name : null,
      proxyType: typeof entry.type === 'string' ? entry.type : null,
      fieldKeys: Object.keys(entry),
    };
  });
  return { proxyCount: nodes.length, nodes };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function applyIssueFix(document: MihomoYamlDocument, patch: IssueFix): void {
  switch (patch.kind) {
    case 'set-scalar':
      if (patch.value === undefined) {
        throw new YamlEngineError(
          'YAML_INVALID_OPERATION',
          'A set-scalar patch requires a value.',
          patch.path,
        );
      }
      document.setScalarIn(patch.path, patch.value);
      return;
    case 'remove':
      document.deleteIn(patch.path);
      return;
    case 'rename': {
      if (typeof patch.value !== 'string') {
        throw new YamlEngineError(
          'YAML_INVALID_OPERATION',
          'A rename patch requires a string value.',
          patch.path,
        );
      }
      const oldKey = patch.path[patch.path.length - 1];
      if (typeof oldKey !== 'string') {
        throw new YamlEngineError(
          'YAML_INVALID_OPERATION',
          'A rename patch path must end in a string key.',
          patch.path,
        );
      }
      document.renameKeyIn(patch.path.slice(0, -1), oldKey, patch.value);
      return;
    }
    case 'append':
      document.appendIn(patch.path, patch.value);
      return;
    case 'set':
      if (patch.value === undefined) {
        throw new YamlEngineError(
          'YAML_INVALID_OPERATION',
          'A set patch requires a value.',
          patch.path,
        );
      }
      document.setIn(patch.path, patch.value);
      return;
    case 'move':
      document.moveSeqItem(patch.path, patch.from, patch.to);
      return;
  }
}

function noDocumentError(requestId: string): WorkerErrorResponse {
  return { type: 'error', requestId, code: 'NO_DOCUMENT', messageKey: 'worker.error.noDocument' };
}

/**
 * Never surfaces `error.message`: `YamlEngineError` messages are safe to log
 * (see `errors.ts`) but are ad-hoc English text, not an i18n key, so we
 * derive a stable key from `code` instead and carry the path separately
 * (NFR-SEC-03 — path and code are restricted params, not configuration values).
 */
function errorResponseFrom(requestId: string, error: unknown): WorkerErrorResponse {
  if (error instanceof YamlEngineError) {
    return {
      type: 'error',
      requestId,
      code: error.code,
      messageKey: `worker.error.${error.code}`,
      ...(error.path !== undefined ? { path: error.path } : {}),
    };
  }
  return {
    type: 'error',
    requestId,
    code: 'WORKER_UNKNOWN_ERROR',
    messageKey: 'worker.error.unknown',
  };
}
