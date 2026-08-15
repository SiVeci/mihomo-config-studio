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

export type { IssueFix, ValidationIssue } from '@mcs/validator';
export type {
  ConfigPath,
  IssueSeverity,
  MessageParams,
  SerializeOptions,
  TextDiff,
  TextRange,
} from '@mcs/yaml-engine';
export { hasBlockingIssues, VALIDATION_DEBOUNCE_MS } from '@mcs/validator';

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

export type WorkerRequest =
  | ParseRequest
  | ApplyPatchRequest
  | ValidateRequest
  | DiffRequest
  | SerializeRequest
  | LocateRequest;

export interface ParseResponse {
  type: 'parse';
  requestId: string;
  issues: ValidationIssue[];
}
export interface ApplyPatchResponse {
  type: 'applyPatch';
  requestId: string;
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
  | WorkerErrorResponse;

/** The Worker's own state: the document produced by the most recent `parse`. */
export interface WorkerState {
  parseResult: ParseResult | null;
}

export function createWorkerState(): WorkerState {
  return { parseResult: null };
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
  }
}

function handleParse(state: WorkerState, request: ParseRequest): ParseResponse {
  const parseResult = MihomoYamlDocument.parse(request.text);
  state.parseResult = parseResult;
  return {
    type: 'parse',
    requestId: request.requestId,
    issues: runPipeline({ parse: parseResult }),
  };
}

function handleApplyPatch(
  state: WorkerState,
  request: ApplyPatchRequest,
): ApplyPatchResponse | WorkerErrorResponse {
  const document = state.parseResult?.document;
  if (!document) return noDocumentError(request.requestId);
  try {
    applyIssueFix(document, request.patch);
    return { type: 'applyPatch', requestId: request.requestId };
  } catch (error) {
    return errorResponseFrom(request.requestId, error);
  }
}

function handleValidate(
  state: WorkerState,
  request: ValidateRequest,
): ValidateResponse | WorkerErrorResponse {
  if (!state.parseResult) return noDocumentError(request.requestId);
  return {
    type: 'validate',
    requestId: request.requestId,
    issues: runPipeline({ parse: state.parseResult }),
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
