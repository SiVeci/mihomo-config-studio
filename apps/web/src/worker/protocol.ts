import { EntityRegistry, HistoryStack } from '@mcs/config-model';
import type { Entity } from '@mcs/config-model';
import { analyzeImpact, buildGraphLayout, detectCycles, ReferenceIndex } from '@mcs/graph';
import type {
  BuildGraphLayoutOptions,
  Cycle,
  GraphLayout,
  ImpactResult,
  RelevantIssue,
} from '@mcs/graph';
import type { RuleTypeSpec, SchemaModule } from '@mcs/schema-core';
import { builtinAsStoredBundle, createRegistry } from '@mcs/schema-registry';
import type { IssueFix, RuleExplanation, ToggleableRule, ValidationIssue } from '@mcs/validator';
import { explainRule, listToggleableRules, runPipeline } from '@mcs/validator';
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
 * `WorkerState.modules`'s default until `configureModules` (v0.5.0 #11) says
 * otherwise — every `runPipeline` call below reads `state.modules`, never
 * this directly. Without some default, `schemaStage`/`securityStage`
 * (v0.3.0 #12/#13) would never fire for a caller that never sends
 * `configureModules` (every test predating v0.5.0 #11, and any project whose
 * schema-lock resolves back to the built-in bundle anyway).
 */
const DEFAULT_MODULES: readonly SchemaModule[] = createRegistry(builtinAsStoredBundle()).modules();

export type { IssueFix, RuleExplanation, ToggleableRule, ValidationIssue } from '@mcs/validator';
export type {
  ConfigPath,
  DiffOp,
  IssueSeverity,
  MessageParams,
  SerializeOptions,
  TextDiff,
  TextRange,
} from '@mcs/yaml-engine';
export type { Entity, EntityKind } from '@mcs/config-model';
export type { SchemaModule } from '@mcs/schema-core';
export type {
  AggregateGraphNode,
  BuildGraphLayoutOptions,
  Cycle,
  EdgeStatus,
  GraphEdge,
  GraphLayerIndex,
  GraphLayout,
  GraphNode,
  ImpactResult,
  LayoutNode,
  Reference,
  ReferenceType,
} from '@mcs/graph';
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
/**
 * A batch of patches applied as one atomic, single-undo-step edit (v0.4.0
 * #10, ADR-023) — never merged with an adjacent edit (`historyStack.record`
 * gets no `mergeKey`) and never partially applied (a failing patch restores
 * the document to its pre-batch text before the error surfaces).
 */
export interface ApplyBatchRequest {
  type: 'applyBatch';
  requestId: string;
  patches: IssueFix[];
}
/**
 * Who references the entity at `path` before it is deleted (v0.4.0 #11,
 * FR-REL-03 UI). `path` rather than an `entityId`: `EntityRegistry`'s ids
 * are a Worker-internal concept (rebuilt fresh from the current document on
 * every request, same as every other read here) — the main thread only
 * ever has a `sourcePath` to point at, the same address scheme
 * `Entity.sourcePath` already uses.
 */
export interface AnalyzeImpactRequest {
  type: 'analyzeImpact';
  requestId: string;
  path: ConfigPath;
}
/** The relationship graph's data (v0.4.0 #13, FR-REL-04/06) — layout, `entities` for click-to-jump path resolution, and the raw cycle name-sequences for the required text-equivalent list (PRD §11.6: never colour-only). */
export interface GraphLayoutRequest {
  type: 'graphLayout';
  requestId: string;
  options?: BuildGraphLayoutOptions;
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

/**
 * FR-RULE-06 (v0.9.0 #16): explains one rule line's own composition — never
 * a match simulator (`explainRule`'s own doc comment, `@mcs/validator`).
 * Stateless, same as `previewProvider` above: `catalog` arrives already
 * resolved on the main thread (`RuleListPage`'s own `catalog` prop), so the
 * Worker only exists here as the one place allowed to import
 * `@mcs/validator` at all (`client.test.ts`'s "main-thread module
 * boundary", NFR-PERF-05) — not because this computation needs a document
 * or any other Worker-owned state.
 */
export interface ExplainRuleRequest {
  type: 'explainRule';
  requestId: string;
  catalog: readonly RuleTypeSpec[];
  ruleText: string;
}

/**
 * Swaps which Bundle's modules `parse`/`validate` run against (v0.5.0 #11,
 * decision F14). `modules` is plain, structured-clone-safe declarative data
 * (ADR-002) resolved on the main thread — the Worker only stores it, no
 * async work happens here. Never sent, the Worker keeps using its default
 * (the built-in bundle), so every caller that predates this message is
 * unaffected.
 */
export interface ConfigureModulesRequest {
  type: 'configureModules';
  requestId: string;
  modules: readonly SchemaModule[];
}

/**
 * Swaps which rule ids `runPipeline` mutes for every `parse`/`validate`/
 * `graphLayout` call going forward (FR-VAL-06, v0.9.0 #15) — same
 * "sticky Worker state, set once per open project" shape as
 * `ConfigureModulesRequest`, and deliberately a separate message rather than
 * a field bolted onto that one: which Schema modules apply and which
 * warning rules a user has muted are independent per-project settings, and
 * `configureModules` already has its own well-tested surface not worth
 * risking a regression in for an unrelated concern. `ruleIds` matches
 * `ValidationIssue.code` (`@mcs/validator`'s `listToggleableRules`), plain
 * strings so this stays structured-clone-safe like every other request.
 */
export interface ConfigureDisabledRulesRequest {
  type: 'configureDisabledRules';
  requestId: string;
  ruleIds: readonly string[];
}

export type WorkerRequest =
  | ParseRequest
  | ApplyPatchRequest
  | ApplyBatchRequest
  | AnalyzeImpactRequest
  | GraphLayoutRequest
  | ValidateRequest
  | DiffRequest
  | SerializeRequest
  | LocateRequest
  | ValueRequest
  | UndoRequest
  | RedoRequest
  | PreviewProviderRequest
  | ConfigureModulesRequest
  | ConfigureDisabledRulesRequest
  | ExplainRuleRequest;

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
/** Same shape as `ApplyPatchResponse` — one document-write response either way, batch or single (v0.4.0 #10). */
export interface ApplyBatchResponse {
  type: 'applyBatch';
  requestId: string;
  canUndo: boolean;
  canRedo: boolean;
}
export interface AnalyzeImpactResponse {
  type: 'analyzeImpact';
  requestId: string;
  /** The entity `path` resolved to — the caller only ever sent a path, never an id/kind/name; the dialog needs those to render (v0.4.0 #11). */
  entity: Entity;
  result: ImpactResult;
}
/**
 * `entities` rides along because `GraphNode` deliberately excludes
 * `sourcePath` (NFR-SEC-03's minimal-fields design, v0.4.0 #12) — the UI
 * resolves a clicked node's id back to a jump-to-field path by looking it up
 * here, the same `sourcePath` shape `identifiesEntity()` above already
 * understands. `cycles` is `detectCycles()`'s own name-sequences: an edge's
 * `status: 'cycle'` alone cannot reconstruct a full cycle path, and the
 * required text-equivalent list (PRD §11.6 — never colour-only) needs one.
 */
export interface GraphLayoutResponse {
  type: 'graphLayout';
  requestId: string;
  layout: GraphLayout;
  entities: readonly Entity[];
  cycles: readonly Cycle[];
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
export interface ExplainRuleResponse {
  type: 'explainRule';
  requestId: string;
  explanation: RuleExplanation;
}
export interface ConfigureModulesResponse {
  type: 'configureModules';
  requestId: string;
  /**
   * Every rule id this Bundle's modules make disableable (FR-VAL-06,
   * v0.9.0 #15), computed here rather than by the main thread: the
   * main-thread bundle boundary (NFR-PERF-05, `client.test.ts`'s "main-
   * thread module boundary") forbids importing `@mcs/validator` outside
   * this file, and `listToggleableRules` lives there.
   */
  toggleableRules: readonly ToggleableRule[];
}
export interface ConfigureDisabledRulesResponse {
  type: 'configureDisabledRules';
  requestId: string;
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
  | ApplyBatchResponse
  | AnalyzeImpactResponse
  | GraphLayoutResponse
  | ValidateResponse
  | DiffResponse
  | SerializeResponse
  | LocateResponse
  | ValueResponse
  | UndoResponse
  | RedoResponse
  | PreviewProviderResponse
  | ConfigureModulesResponse
  | ConfigureDisabledRulesResponse
  | ExplainRuleResponse
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
  /** Defaults to the built-in bundle's modules; `configureModules` (v0.5.0 #11) swaps it per open project. */
  modules: readonly SchemaModule[];
  /** Defaults to none muted; `configureDisabledRules` (v0.9.0 #15) swaps it per open project. */
  disabledRuleIds: ReadonlySet<string>;
}

export function createWorkerState(): WorkerState {
  return {
    parseResult: null,
    historyStack: new HistoryStack(),
    modules: DEFAULT_MODULES,
    disabledRuleIds: new Set(),
  };
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
    case 'applyBatch':
      return handleApplyBatch(state, request);
    case 'analyzeImpact':
      return handleAnalyzeImpact(state, request);
    case 'graphLayout':
      return handleGraphLayout(state, request);
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
    case 'configureModules':
      return handleConfigureModules(state, request);
    case 'configureDisabledRules':
      return handleConfigureDisabledRules(state, request);
    case 'explainRule':
      return handleExplainRule(request);
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
  //
  // v0.9.0 #1: comparing against the current text *alone* was not enough, and
  // the repo's first real CI run proved it. That debounced re-parse is
  // scheduled from a React effect keyed on the text prop; an undo/redo can
  // land in the gap between the timer firing and React committing the new
  // prop (so the effect cleanup has not cancelled the timer yet). The parse
  // then arrives carrying the *pre-undo* text, which no longer matches the
  // document — and the history got wiped, which is precisely the disaster the
  // paragraph above is about, just reached from the other direction. Asking
  // the history stack whether it knows the text closes that gap: any state
  // reachable by undo/redo is by definition still "this document".
  // Regression: protocol.test.ts "a stale debounced re-parse arriving after
  // an undo does not wipe the undo history".
  const isEchoOfCurrentDocument =
    state.parseResult?.document?.toText() === request.text ||
    state.historyStack.knowsText(request.text);
  const parseResult = MihomoYamlDocument.parse(request.text);
  state.parseResult = parseResult;
  if (!isEchoOfCurrentDocument) state.historyStack = new HistoryStack();
  return {
    type: 'parse',
    requestId: request.requestId,
    issues: runPipeline({
      parse: parseResult,
      modules: state.modules,
      disabledRuleIds: state.disabledRuleIds,
    }),
    value: parseResult.document?.toJS() ?? null,
  };
}

/**
 * Purely synchronous — `modules` arrives already resolved (main thread did
 * whatever async store lookup was needed). Does not itself re-run `validate`;
 * the caller sends this before `parse`/`validate` for the project it applies
 * to, same as every other request that expects `state.parseResult` already set.
 */
function handleConfigureModules(
  state: WorkerState,
  request: ConfigureModulesRequest,
): ConfigureModulesResponse {
  state.modules = request.modules;
  return {
    type: 'configureModules',
    requestId: request.requestId,
    toggleableRules: listToggleableRules(request.modules),
  };
}

/** Same shape as `handleConfigureModules` — purely synchronous, sets state the next `runPipeline` call reads. */
function handleConfigureDisabledRules(
  state: WorkerState,
  request: ConfigureDisabledRulesRequest,
): ConfigureDisabledRulesResponse {
  state.disabledRuleIds = new Set(request.ruleIds);
  return { type: 'configureDisabledRules', requestId: request.requestId };
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

/**
 * All-or-nothing (ADR-023): if any patch in the batch throws, the live
 * document must not keep whatever prefix of the batch already applied —
 * `historyStack.record()` on its own only guarantees no *history entry* gets
 * recorded on a throw (see its own doc comment), it does not undo partial
 * mutation of the `MihomoYamlDocument` instance itself. The inner
 * try/catch here restores `state.parseResult` to a fresh re-parse of the
 * pre-batch text — the same "restore by re-parsing a known-good text
 * snapshot" approach `handleUndo`/`handleRedo` already use — before
 * re-throwing, so `record()` still sees the exception (and correctly
 * records nothing) while the live document ends up untouched either way.
 *
 * No `mergeKey` is passed to `record()`: a batch must never merge with an
 * adjacent edit, or "one undo reverts the whole batch" would stop being true.
 */
function handleApplyBatch(
  state: WorkerState,
  request: ApplyBatchRequest,
): ApplyBatchResponse | WorkerErrorResponse {
  const document = state.parseResult?.document;
  if (!document) return noDocumentError(request.requestId);
  const beforeText = document.toText();
  try {
    state.historyStack.record(
      document,
      `batch:${request.patches.map((patch) => patch.kind).join(',')}`,
      () => {
        try {
          for (const patch of request.patches) applyIssueFix(document, patch);
        } catch (error) {
          state.parseResult = MihomoYamlDocument.parse(beforeText);
          throw error;
        }
      },
    );
    return {
      type: 'applyBatch',
      requestId: request.requestId,
      canUndo: state.historyStack.canUndo,
      canRedo: state.historyStack.canRedo,
    };
  } catch (error) {
    return errorResponseFrom(request.requestId, error);
  }
}

/**
 * `EntityRegistry`/`ReferenceIndex` are rebuilt fresh here, the same way
 * every other handler reads `state.parseResult.document` fresh rather than
 * caching derived state across requests — the document can have changed
 * (any edit, undo/redo) between when the caller last saw an entity list and
 * this request, so a stale index would silently answer against an outdated
 * document (v0.4.0 #11, FR-REL-03 UI).
 */
function handleAnalyzeImpact(
  state: WorkerState,
  request: AnalyzeImpactRequest,
): AnalyzeImpactResponse | WorkerErrorResponse {
  const document = state.parseResult?.document;
  if (!document) return noDocumentError(request.requestId);
  const entities = new EntityRegistry().extract(document);
  const target = entities.find((entity) => identifiesEntity(entity.sourcePath, request.path));
  if (!target) {
    return {
      type: 'error',
      requestId: request.requestId,
      code: 'GRAPH_ENTITY_NOT_FOUND',
      messageKey: 'worker.error.GRAPH_ENTITY_NOT_FOUND',
      path: request.path,
    };
  }
  const index = new ReferenceIndex();
  index.rebuild(document, entities);
  return {
    type: 'analyzeImpact',
    requestId: request.requestId,
    entity: target,
    result: analyzeImpact(document, index, target.id),
  };
}

/**
 * A caller only ever has an *item's* own path — for a keyed-map entity
 * (`rule-provider`/`proxy-provider`, `Entity.sourcePath` is `[key, name]`)
 * that already *is* the entity's `sourcePath`, but for a named-array entity
 * (`proxy`/`proxy-group`, `sourcePath` is `[key, index, 'name']` —
 * `config-model/entity.ts`'s `extractNamedArray`) the item's own path is
 * one segment shorter, the `name` field's *parent*. Accepting either shape
 * here means every caller (`SchemaArrayForm`'s per-entry delete button,
 * either array- or map-shaped) can send the one path it naturally has,
 * without needing to know which of the two `EntityRegistry` internally
 * used.
 */
function identifiesEntity(entitySourcePath: ConfigPath, requestPath: ConfigPath): boolean {
  if (pathsEqual(entitySourcePath, requestPath)) return true;
  return pathsEqual(entitySourcePath.slice(0, -1), requestPath);
}

function pathsEqual(a: ConfigPath, b: ConfigPath): boolean {
  return a.length === b.length && a.every((segment, i) => segment === b[i]);
}

/**
 * Builds the whole relationship graph fresh from the current document —
 * same reasoning as `handleAnalyzeImpact`'s own `ReferenceIndex`: the graph
 * can go stale between requests, so nothing here is cached across calls
 * (v0.4.0 #13, FR-REL-04/06).
 */
function handleGraphLayout(
  state: WorkerState,
  request: GraphLayoutRequest,
): GraphLayoutResponse | WorkerErrorResponse {
  const document = state.parseResult?.document;
  if (!document) return noDocumentError(request.requestId);
  const entities = new EntityRegistry().extract(document);
  const index = new ReferenceIndex();
  index.rebuild(document, entities);
  const issues = runPipeline({
    parse: state.parseResult!,
    modules: state.modules,
    disabledRuleIds: state.disabledRuleIds,
  });
  return {
    type: 'graphLayout',
    requestId: request.requestId,
    layout: buildGraphLayout(
      entities,
      index.allReferences(),
      toRelevantIssues(issues),
      request.options ?? {},
    ),
    entities,
    cycles: detectCycles(document),
  };
}

/**
 * `@mcs/graph` cannot import `ValidationIssue` itself (would cycle back
 * through `@mcs/validator`'s own `import { detectCycles } from '@mcs/graph'`
 * — see `layout.ts`'s `RelevantIssue` doc comment), so the Worker adapts
 * here instead. `messageParams.cycle` is typed as the general
 * `MessageParamValue` union at its source (nothing in `@mcs/yaml-engine`
 * ties a specific `messageParams` key to a narrower type) even though
 * `referenceStage`'s cycle check only ever puts a `Cycle` (a `string[]`)
 * there — the runtime check below is what actually establishes that,
 * `Array.isArray` plus an element check rather than a blind cast.
 */
function toRelevantIssues(issues: readonly ValidationIssue[]): RelevantIssue[] {
  return issues.map((issue) => {
    const cycle = issue.messageParams?.cycle;
    const isCycle = Array.isArray(cycle) && cycle.every((name) => typeof name === 'string');
    return {
      code: issue.code,
      ...(issue.path !== undefined ? { path: issue.path } : {}),
      ...(isCycle ? { messageParams: { cycle: cycle as readonly string[] } } : {}),
    };
  });
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
    issues: runPipeline({
      parse: state.parseResult,
      modules: state.modules,
      disabledRuleIds: state.disabledRuleIds,
    }),
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

function handleExplainRule(request: ExplainRuleRequest): ExplainRuleResponse {
  return {
    type: 'explainRule',
    requestId: request.requestId,
    explanation: explainRule(request.catalog, request.ruleText),
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
