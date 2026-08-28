import type { McsProjQuarantine, McsProjSchemaLock } from '@mcs/project-format';
import {
  collectUnknownFields,
  type FormMode,
  type RuleTypeSpec,
  type SchemaModule,
} from '@mcs/schema-core';
import { builtinAsStoredBundle, createRegistry } from '@mcs/schema-registry';
import { AutoSaver, DEFAULT_AUTOSAVE_INTERVAL_MS } from '@mcs/storage';
import type { StorageAdapter } from '@mcs/storage';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';

import { DiffPanel } from '../diff/DiffPanel.js';
import type { DiffPanelWorkerClient } from '../diff/DiffPanel.js';
import { YamlEditor } from '../editor/YamlEditor.js';
import type { YamlEditorHandle, YamlEditorWorkerClient } from '../editor/YamlEditor.js';
import { ExportDialog } from '../export/ExportDialog.js';
import type { SaveDocument } from '../export/ExportDialog.js';
import { UpgradeDialog } from '../migration/UpgradeDialog.js';
import type { UpgradeResult } from '../migration/UpgradeDialog.js';
import { ReadOnlyGuard } from './ReadOnlyGuard.js';
import { ModuleFormPage } from '../form/ModuleFormPage.js';
import type { ModuleFormPageHandle } from '../form/ModuleFormPage.js';
import { UnknownFieldTree } from '../form/UnknownFieldTree.js';
import { ImportPanel } from '../import/ImportPanel.js';
import type { ImportWorkerClient } from '../import/ImportPanel.js';
import { t } from '../i18n/index.js';
import { IssuePanel } from '../issues/IssuePanel.js';
import type { IssuePanelWorkerClient } from '../issues/IssuePanel.js';
import { DeleteImpactDialog } from '../graph/DeleteImpactDialog.js';
import { GraphView } from '../graph/GraphView.js';
import { buildCascadeDeletePatches, buildReplacePatches } from '../graph/impact-patches.js';
import { AppShell } from '../layout/AppShell.js';
import { BottomNav } from '../layout/BottomNav.js';
import type { BottomNavPage } from '../layout/BottomNav.js';
import { StatusBar } from '../layout/StatusBar.js';
import { useNarrowViewport } from '../layout/useNarrowViewport.js';
import { registerBackgroundFlush } from '../platform/lifecycle.js';
import { collectRuleEntityNames } from '../rules/entity-names.js';
import { RuleListPage } from '../rules/RuleListPage.js';
import type {
  AnalyzeImpactResponse,
  ApplyBatchResponse,
  ApplyPatchResponse,
  ConfigPath,
  ConfigureModulesResponse,
  Entity,
  EntityKind,
  GraphLayoutResponse,
  IssueFix,
  Reference,
  RedoResponse,
  TextRange,
  UndoResponse,
  ValidationIssue,
  ValueResponse,
} from '../worker/protocol.js';
import {
  deleteProject,
  DEFAULT_PROJECT_CONFIG_TEXT,
  DEFAULT_TARGET_PROFILE,
  getImportBaseline,
  getProjectConfigText,
  getProjectQuarantine,
  listProjects,
  saveImportBaseline,
  saveProjectConfigText,
  saveProjectManifest,
  saveProjectQuarantine,
  saveProjectSchemaLock,
} from './model.js';
import type { ProjectRecord } from './model.js';
import './ProjectPage.css';
import { resolveProjectSchema } from './schema-resolution.js';

type ProjectField = 'name' | 'description' | 'targetProfile';

/** PRD §7.2's middle column: "图形化表单、列表、拖拽排序和关系图" (v0.4.0 #13 adds the third). */
const MAIN_VIEWS = ['form', 'rules', 'graph'] as const;
type MainView = (typeof MAIN_VIEWS)[number];
const MAIN_VIEW_TAB_LABEL_KEYS: Record<
  MainView,
  'project.formViewTab' | 'project.rulesViewTab' | 'project.graphViewTab'
> = {
  form: 'project.formViewTab',
  rules: 'project.rulesViewTab',
  graph: 'project.graphViewTab',
};

/** What `DeleteImpactDialog` needs, gathered from an `analyzeImpact` response plus the path that was originally clicked (v0.4.0 #11). */
interface DeletingEntityState {
  readonly path: ConfigPath;
  readonly entityName: string;
  readonly replaceable: readonly Reference[];
  readonly cascading: readonly Entity[];
  readonly targetOptions: readonly string[];
}

/**
 * Candidate replacement names, chosen by the deleted entity's own kind —
 * `proxy`/`proxy-group`/`builtin` share one outbound-policy namespace
 * (mirrors `entity-names.ts`'s `proxyTargetNames`); `rule-provider` has its
 * own separate namespace. The provider-subscription kind intentionally
 * returns no suggestions: reading its top-level document key needs a
 * quoted module-id literal that `schema-registry-boundary.test.ts`
 * (FR-SCHEMA-05) forbids anywhere under this app — free text still works
 * either way, this only narrows the autocomplete list for that one kind.
 */
function targetOptionsForKind(
  kind: EntityKind,
  names: ReturnType<typeof collectRuleEntityNames>,
): readonly string[] {
  switch (kind) {
    case 'proxy':
    case 'proxy-group':
    case 'builtin':
      return names.proxyTargetNames;
    case 'rule-provider':
      return names.ruleProviderNames;
    default:
      return [];
  }
}

/**
 * Document-editing operations `ProjectPage` itself calls directly rather
 * than through a child component's own props — `ModuleFormPage` takes a
 * plain `onFieldChange` callback, not a Worker client, and undo/redo are
 * document-level (affect the raw editor and the form alike), not owned by
 * either (v0.3.0 #14/#15).
 */
export interface ModuleFormWorkerClient {
  applyPatch(patch: IssueFix): Promise<ApplyPatchResponse>;
  applyBatch(patches: IssueFix[]): Promise<ApplyBatchResponse>;
  analyzeImpact(path: ConfigPath): Promise<AnalyzeImpactResponse>;
  /** Backs `GraphView` (v0.4.0 #13) — `ProjectPage` fetches it directly, same reasoning as `analyzeImpact` above. */
  graphLayout(): Promise<GraphLayoutResponse>;
  value(): Promise<ValueResponse>;
  undo(): Promise<UndoResponse>;
  redo(): Promise<RedoResponse>;
  /** Swaps which Bundle's modules the Worker validates against, per the selected project's own schema-lock (v0.5.0 #11, decision F14). */
  configureModules(modules: readonly SchemaModule[]): Promise<ConfigureModulesResponse>;
}

export interface ProjectPageProps {
  readonly adapter: StorageAdapter;
  /**
   * Required, like `adapter`: a real client is backed by a real Worker,
   * which throws to construct outside a browser, so there is no safe
   * internal default (see `App.tsx`'s `createConfigWorkerClient()` call).
   * An intersection of each child's own minimal interface (`ImportPanel`
   * needs `parse`; `YamlEditor` adds `serialize`; `IssuePanel` adds
   * `locate`) rather than one hand-widened shared interface, so each
   * component's test fakes stay minimal and this type grows automatically
   * as children are added instead of being manually re-widened each time.
   */
  readonly client: ImportWorkerClient &
    YamlEditorWorkerClient &
    IssuePanelWorkerClient &
    DiffPanelWorkerClient &
    ModuleFormWorkerClient;
  /** Injectable clock so autosave timing is exactly assertable in tests. */
  readonly now?: () => number;
  /** Forwarded to `ExportDialog` as-is; test-only override for the platform port (ADR-026) — jsdom has no `URL.createObjectURL`/`showSaveFilePicker` (see `ExportDialog`'s own doc comment). */
  readonly saveDocument?: SaveDocument;
  /** Test-only trust anchor override forwarded to `resolveProjectSchema` (v0.5.0 #11), same escape hatch `BundlePage` exposes; production code leaves this unset. */
  readonly trustedPublicKeys?: readonly Uint8Array[];
}

export function ProjectPage({
  adapter,
  client,
  now = Date.now,
  saveDocument,
  trustedPublicKeys,
}: ProjectPageProps): ReactNode {
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [configText, setConfigText] = useState('');
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [importBaseline, setImportBaseline] = useState('');
  const [savedBaseline, setSavedBaseline] = useState('');
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [showUpgradeDialog, setShowUpgradeDialog] = useState(false);
  // Driven by the Worker's own HistoryStack (v0.3.0 #15) — the one live
  // MihomoYamlDocument lives there (v0.2.0 #10), so this shell never records
  // edits itself, only reflects `canUndo`/`canRedo` back from each response.
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [documentValue, setDocumentValue] = useState<unknown>(null);
  const [formMode, setFormMode] = useState<FormMode>('basic');
  // Component-internal state, not a route (E3, v0.4.0 #7): the main column's
  // three PRD §7.2 views ("图形化表单、列表、拖拽排序和关系图") are cheap to
  // switch between and irrelevant to browser history/deep-linking.
  const [mainView, setMainView] = useState<MainView>('form');
  // `null` until the graph tab has been opened at least once (v0.4.0 #13) —
  // there is no cheap client-side derivation of the graph the way `rules`
  // above reads straight out of `documentValue`; it needs a real
  // `ReferenceIndex`/`detectCycles()` pass, which only the Worker can do.
  const [graphData, setGraphData] = useState<GraphLayoutResponse | null>(null);
  // `null` when no delete-impact dialog is open (v0.4.0 #11). Set only after
  // `client.analyzeImpact` comes back with at least one reference — an
  // unreferenced entity deletes directly, never opening this (exit condition 5).
  const [deletingEntity, setDeletingEntity] = useState<DeletingEntityState | null>(null);
  // Default before any project is selected, and for a Worker call that never
  // gets reconfigured (matches `WorkerState`'s own default) — the effect
  // below replaces this with the selected project's own locked modules
  // (ADR-004, v0.5.0 #11, decision F14) before that project's text is parsed.
  const [modules, setModules] = useState<readonly SchemaModule[]>(() =>
    createRegistry(builtinAsStoredBundle()).modules(),
  );
  const [schemaLock, setSchemaLock] = useState<McsProjSchemaLock | null>(null);
  // ADR-004 point 6 / PRD §9.5 point 3 (v0.5.0 #12): `true` when the locked
  // Bundle version could not be found locally but something else was — the
  // editing surface below is not mounted at all in that case (never merely
  // disabled), so `applyPatch`/`applyBatch`/`undo`/`redo` are structurally
  // unreachable while this is true.
  const [readOnly, setReadOnly] = useState(false);
  const [quarantine, setQuarantine] = useState<McsProjQuarantine>({ fields: [] });
  // `null` (not yet parsed) is not "an empty document" — `collectUnknownFields`
  // would otherwise plan every module against `null` and, same as
  // `ModuleFormPage`, transiently report schema-default values as if they
  // were unknown-field findings about a document that has not loaded yet.
  const unknownFields = useMemo(
    () =>
      documentValue === null
        ? []
        : collectUnknownFields(modules, documentValue, { mode: 'advanced' }),
    [modules, documentValue],
  );

  // `rules:` read directly out of the already-fetched document value — this
  // page never re-parses or re-fetches anything of its own to build the list
  // `RuleListPage` renders (v0.4.0 #7). Filtered defensively rather than
  // trusting the shape: a document mid-edit into something schema-invalid
  // (e.g. `rules: "not-a-list"`) must never crash the view switch itself.
  const rules = useMemo<readonly string[]>(() => {
    if (documentValue === null || typeof documentValue !== 'object') return [];
    const raw = (documentValue as Record<string, unknown>).rules;
    return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === 'string') : [];
  }, [documentValue]);

  // Static alongside `modules` (v0.4.0 #8): the `rules` module's declarative
  // catalog (ADR-021) drives every control `RuleEditor` renders — no rule
  // *type* name is ever hardcoded in that component, only read from here.
  const ruleCatalog: readonly RuleTypeSpec[] = useMemo(
    () => modules.find((module) => module.manifest.id === 'rules')?.ruleTypes ?? [],
    [modules],
  );
  const ruleEntityNames = useMemo(() => collectRuleEntityNames(documentValue), [documentValue]);

  const projectsRef = useRef(projects);
  projectsRef.current = projects;
  const configTextRef = useRef(configText);
  configTextRef.current = configText;
  const manifestAutoSaverRef = useRef<AutoSaver | null>(null);
  const configAutoSaverRef = useRef<AutoSaver | null>(null);
  const editorRef = useRef<YamlEditorHandle>(null);
  const moduleFormRef = useRef<ModuleFormPageHandle>(null);
  const mainViewTabRefs = useRef<Partial<Record<MainView, HTMLButtonElement | null>>>({});
  // StatusBar's save-status display (PRD §7.3, v0.6.0 #6) — a cosmetic
  // mirror of AutoSaver's own flush timing, not a second source of truth
  // for it: `AutoSaver` never calls back on flush, so this just assumes a
  // flush has happened `DEFAULT_AUTOSAVE_INTERVAL_MS` after the most recent
  // edit, the same window AutoSaver itself uses (imported, not
  // re-guessed). Real persistence correctness still rests entirely on the
  // existing AutoSaver wiring above.
  const [saveStatus, setSaveStatus] = useState<'saved' | 'pending'>('saved');
  const savedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [activeMobilePage, setActiveMobilePage] = useState<'main' | 'yaml' | 'issues'>('main');
  const isNarrowViewport = useNarrowViewport();

  useEffect(() => {
    return () => {
      if (savedTimeoutRef.current !== null) clearTimeout(savedTimeoutRef.current);
    };
  }, []);

  // Set only when `handleJumpToField` had to switch `mainView` itself (v0.4.0
  // #13) — see the effect below for why a same-render ref call cannot do this.
  const pendingJumpPathRef = useRef<ConfigPath | null>(null);

  useEffect(() => {
    let cancelled = false;
    void listProjects(adapter).then((records) => {
      if (cancelled) return;
      setProjects(records);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [adapter]);

  // Loads the selected project's config.yaml on demand — unlike manifests
  // (all loaded up front for the sidebar list), config text can be large, so
  // only the currently-open project's is fetched. The same fetch also seeds
  // `savedBaseline` (FR-YAML-06's "most recently saved version" diff
  // reference): a fixed snapshot of what was on disk when this project was
  // opened, not updated again by this session's own autosave flushes —
  // otherwise it would converge to match `configText` a few seconds after
  // every pause in typing and the diff would show nothing.
  useEffect(() => {
    if (!selectedId) {
      setConfigText('');
      setSavedBaseline('');
      setImportBaseline('');
      // Otherwise the form would keep rendering the previous project's
      // fields until this project's own YamlEditor debounce fires.
      setDocumentValue(null);
      setCanUndo(false);
      setCanRedo(false);
      setGraphData(null);
      setReadOnly(false);
      return;
    }
    let cancelled = false;
    const id = selectedId;
    // Fetched together and applied from one callback rather than several
    // independent `.then()`s: the requests can resolve in either order, and
    // the import-baseline fallback below needs *this* project's config text,
    // not whatever `configText` state still holds from the project that was
    // selected before this effect ran.
    void Promise.all([
      getProjectConfigText(adapter, id),
      getImportBaseline(adapter, id),
      resolveProjectSchema(adapter, id, trustedPublicKeys),
      getProjectQuarantine(adapter, id),
    ]).then(async ([savedText, importText, resolvedSchema, resolvedQuarantine]) => {
      if (cancelled) return;
      // Must land before `setConfigText` below: `YamlEditor`'s own effect
      // sends `client.parse(text)` as soon as `configText` changes, and that
      // parse needs this project's own locked modules already configured
      // (ADR-004, v0.5.0 #11, decision F14), not a still-live previous
      // project's or the Worker's built-in default.
      await client.configureModules(resolvedSchema.modules);
      if (cancelled) return;
      setModules(resolvedSchema.modules);
      setSchemaLock(resolvedSchema.schemaLock);
      setReadOnly(resolvedSchema.readOnly);
      setQuarantine(resolvedQuarantine);
      const text = savedText ?? '';
      setConfigText(text);
      setSavedBaseline(text);
      // No recorded baseline (a project created before this existed) — the
      // current text is the closest available stand-in.
      setImportBaseline(importText ?? text);
    });
    return () => {
      cancelled = true;
    };
  }, [adapter, client, selectedId, trustedPublicKeys]);

  // One AutoSaver per selected project, flushed whenever selection moves away
  // from it (or the page unmounts) so a pending metadata edit is never lost
  // to a fresh 5-second window starting on the project the user just left.
  useEffect(() => {
    if (!selectedId) {
      manifestAutoSaverRef.current = null;
      return;
    }
    const id = selectedId;
    const saver = new AutoSaver({
      adapter,
      key: `project/${id}/manifest.json`,
      getContent: () => {
        const record = projectsRef.current.find((project) => project.id === id);
        return new TextEncoder().encode(JSON.stringify(record));
      },
    });
    manifestAutoSaverRef.current = saver;
    return () => {
      // `handleConfirmDelete` clears the ref itself before deleting, so a
      // flush here would otherwise resurrect the manifest it just removed by
      // writing back whatever `getContent()` finds once the record is gone.
      if (manifestAutoSaverRef.current !== saver) return;
      void saver.flush();
      manifestAutoSaverRef.current = null;
    };
  }, [adapter, selectedId]);

  // Mirrors the manifest AutoSaver above, one level down: the raw editor
  // (#13) edits config.yaml continuously, so it gets its own independently
  // debounced/flushed AutoSaver rather than sharing the manifest's.
  useEffect(() => {
    if (!selectedId) {
      configAutoSaverRef.current = null;
      return;
    }
    const id = selectedId;
    const saver = new AutoSaver({
      adapter,
      key: `project/${id}/config.yaml`,
      getContent: () => new TextEncoder().encode(configTextRef.current),
    });
    configAutoSaverRef.current = saver;
    return () => {
      if (configAutoSaverRef.current !== saver) return;
      void saver.flush();
      configAutoSaverRef.current = null;
    };
  }, [adapter, selectedId]);

  useEffect(() => {
    return registerBackgroundFlush(() => {
      void manifestAutoSaverRef.current?.flush();
      void configAutoSaverRef.current?.flush();
    });
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'z') return;
      event.preventDefault();
      if (event.shiftKey) void handleRedo();
      else void handleUndo();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Consumes a jump requested while `mainView` was still `'rules'`/`'graph'`
  // (v0.4.0 #13). `handleJumpToField` cannot call `moduleFormRef.current`
  // straight after `setMainView('form')` in the same handler: `ModuleFormPage`
  // is lazy-mounted (E3, v0.4.0 #7), so on that render the ref is still
  // whatever it was before the switch (`null`, the first time). Waiting for
  // this effect — which runs after the *next* commit, once `mainView === 'form'`
  // has actually mounted the component and attached its ref — is what makes
  // the call land instead of silently no-op-ing.
  useEffect(() => {
    const path = pendingJumpPathRef.current;
    if (mainView !== 'form' || path === null) return;
    pendingJumpPathRef.current = null;
    moduleFormRef.current?.jumpToField(path);
  }, [mainView]);

  // Fetches (and re-fetches on every document change) only while the graph
  // tab is actually the one showing — the same "lazy-mounted view only pays
  // for what it needs" reasoning `rules`'s memo above already follows,
  // extended to a Worker round trip since a graph has no cheap client-side
  // derivation (v0.4.0 #13).
  useEffect(() => {
    if (mainView !== 'graph' || !selectedId) return;
    let cancelled = false;
    void client.graphLayout().then((response) => {
      if (!cancelled) setGraphData(response);
    });
    return () => {
      cancelled = true;
    };
  }, [client, mainView, selectedId, documentValue]);

  async function handleUndo(): Promise<void> {
    const response = await client.undo();
    applyHistoryResponse(response);
  }

  async function handleRedo(): Promise<void> {
    const response = await client.redo();
    applyHistoryResponse(response);
  }

  /** See `saveStatus`'s own declaration comment: a display-only mirror of AutoSaver's flush window, not a second persistence timer. */
  function markSavePending(): void {
    setSaveStatus('pending');
    if (savedTimeoutRef.current !== null) clearTimeout(savedTimeoutRef.current);
    savedTimeoutRef.current = setTimeout(
      () => setSaveStatus('saved'),
      DEFAULT_AUTOSAVE_INTERVAL_MS,
    );
  }

  /**
   * PRD §7.3's four bottom-nav destinations map onto three content areas
   * (`activeMobilePage`) because 配置/关系 share one — the existing `mainView`
   * tablist (v0.4.0 #7) already switches between them, so 关系 just also
   * points `mainView` at `'graph'` rather than getting a fourth,
   * duplicate content area. Both branches must set `mainView` explicitly
   * (not just `activeMobilePage`) — a real bug found on an actual device
   * (v0.6.0 #8): tapping 配置 while already on 关系 left `activeMobilePage`
   * unchanged (already `'main'`) and, without this line, `mainView` too,
   * so the tap was a silent no-op and 配置 became permanently unreachable
   * from the graph view. `BottomNav`'s own `active` indicator is derived
   * from `mainView` for the same reason, so it was silently stuck on 关系
   * too — nothing about it looked broken until an actual tap did nothing.
   */
  function handleBottomNavigate(page: BottomNavPage): void {
    if (page === 'graph') {
      setActiveMobilePage('main');
      setMainView('graph');
      return;
    }
    if (page === 'config') {
      setActiveMobilePage('main');
      setMainView('form');
      return;
    }
    setActiveMobilePage(page);
  }

  /** Shared by `handleUndo`/`handleRedo`: both responses have the identical shape (v0.3.0 #15). */
  function applyHistoryResponse(response: UndoResponse | RedoResponse): void {
    setCanUndo(response.canUndo);
    setCanRedo(response.canRedo);
    setDocumentValue(response.value);
    configTextRef.current = response.text;
    setConfigText(response.text);
    configAutoSaverRef.current?.touch(now());
    markSavePending();
  }

  async function handleCreate(): Promise<void> {
    const nowIso = new Date(now()).toISOString();
    const record: ProjectRecord = {
      id: crypto.randomUUID(),
      name: t('project.untitledName'),
      description: '',
      targetProfile: DEFAULT_TARGET_PROFILE,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    await saveProjectManifest(adapter, record);
    await saveProjectConfigText(adapter, record.id, DEFAULT_PROJECT_CONFIG_TEXT);
    await saveImportBaseline(adapter, record.id, DEFAULT_PROJECT_CONFIG_TEXT);
    setProjects((previous) => [...previous, record]);
    setSelectedId(record.id);
  }

  function handleFieldChange(field: ProjectField, value: string): void {
    // No `!selectedId` guard: the only callers are `ProjectDetail`'s onChange
    // handlers, which exist solely while a project is selected.
    //
    // Updates `projectsRef` synchronously, not just via the render-time sync
    // below: `touch()` can flush synchronously within this same call, and by
    // then React has not yet re-rendered, so the render-time sync would still
    // be pointing at the pre-edit array — `getContent()` would persist the
    // previous value instead of this one.
    const updated = projectsRef.current.map((project) =>
      project.id === selectedId
        ? { ...project, [field]: value, updatedAt: new Date(now()).toISOString() }
        : project,
    );
    projectsRef.current = updated;
    setProjects(updated);
    manifestAutoSaverRef.current?.touch(now());
    markSavePending();
  }

  async function handleImport(id: string, text: string): Promise<void> {
    // A discrete, deliberate action (like create/delete), not a keystroke —
    // saved immediately rather than through the debounced AutoSaver. Also
    // resets the "imported version" diff baseline to this text — a fresh
    // import is a new reference point, not an edit relative to the old one.
    await saveProjectConfigText(adapter, id, text);
    await saveImportBaseline(adapter, id, text);
    configTextRef.current = text;
    setConfigText(text);
    setImportBaseline(text);
    const updated = projectsRef.current.map((project) =>
      project.id === id ? { ...project, updatedAt: new Date(now()).toISOString() } : project,
    );
    projectsRef.current = updated;
    setProjects(updated);
    const record = updated.find((project) => project.id === id);
    if (record) await saveProjectManifest(adapter, record);
  }

  /**
   * `UpgradeDialog` already ran the migration and resolved the new modules;
   * this only persists the result and refreshes local state. `configureModules`
   * must land before `setConfigText` for the same reason as the selectedId
   * effect above — the modules that now describe this project changed too.
   */
  async function handleUpgraded(result: UpgradeResult): Promise<void> {
    if (!selectedId) return;
    const id = selectedId;
    await client.configureModules(result.modules);
    await saveProjectConfigText(adapter, id, result.configText);
    await saveProjectSchemaLock(adapter, id, result.schemaLock);
    await saveProjectQuarantine(adapter, id, result.quarantine);
    setModules(result.modules);
    setSchemaLock(result.schemaLock);
    // The just-upgraded lock names the bundle this project's own modules
    // came from — it is definitionally available locally, so read-only
    // protection (if it was active) no longer applies.
    setReadOnly(false);
    setQuarantine(result.quarantine);
    configTextRef.current = result.configText;
    setConfigText(result.configText);
    setShowUpgradeDialog(false);
  }

  function handleConfigChange(text: string): void {
    // No `!selectedId` guard, same reasoning as `handleFieldChange`: the only
    // caller is `YamlEditor`'s onChange, which only exists while selected.
    configTextRef.current = text;
    setConfigText(text);
    configAutoSaverRef.current?.touch(now());
    markSavePending();
  }

  function handleJumpToIssue(range: TextRange): void {
    editorRef.current?.jumpToRange(range);
  }

  /**
   * Used by `IssuePanel`/`UnknownFieldTree` already, and by `GraphView`'s
   * click-to-jump (v0.4.0 #13) — every caller only ever has a path, never
   * knows or cares which main-column view is currently showing. Switches
   * `mainView` to `'form'` first when needed, since a field only exists in
   * the DOM while that view is the one lazy-mounted (see the effect above).
   */
  function handleJumpToField(path: ConfigPath): void {
    if (mainView === 'form') {
      moduleFormRef.current?.jumpToField(path);
      return;
    }
    pendingJumpPathRef.current = path;
    setMainView('form');
  }

  /**
   * Standard tablist keyboard pattern (WAI-ARIA APG): Left/Right moves
   * *and* activates in one step (no separate Enter/Space needed) — E3/PRD
   * §11.6 asks for arrow-key switching, not just arrow-key focus. Focus is
   * moved synchronously via the ref map rather than waiting a render: the
   * target button already exists in the DOM (both tabs are always mounted,
   * only their *panel* content lazy-mounts), so there is nothing to wait for.
   */
  function handleMainViewTabKeyDown(
    event: ReactKeyboardEvent<HTMLButtonElement>,
    current: MainView,
  ): void {
    const currentIndex = MAIN_VIEWS.indexOf(current);
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % MAIN_VIEWS.length;
    else if (event.key === 'ArrowLeft') {
      nextIndex = (currentIndex - 1 + MAIN_VIEWS.length) % MAIN_VIEWS.length;
    }
    if (nextIndex === null) return;
    event.preventDefault();
    const nextView = MAIN_VIEWS[nextIndex] as MainView;
    setMainView(nextView);
    mainViewTabRefs.current[nextView]?.focus();
  }

  /**
   * Refreshes every piece of state that depends on the document, after any
   * write (`applyPatch` or `applyBatch`). `configText`/`documentValue` both
   * refresh from the Worker rather than being derived locally — the main
   * thread never holds a `MihomoYamlDocument` to serialize or read a value
   * from itself (v0.2.0's Worker boundary, reconfirmed by
   * `schema-registry-boundary.test.ts` and `worker/client.test.ts`'s
   * structural fences).
   */
  async function refreshAfterWrite(canUndo: boolean, canRedo: boolean): Promise<void> {
    setCanUndo(canUndo);
    setCanRedo(canRedo);
    const [valueResponse, serializeResponse] = await Promise.all([
      client.value(),
      client.serialize(),
    ]);
    setDocumentValue(valueResponse.value);
    configTextRef.current = serializeResponse.text;
    setConfigText(serializeResponse.text);
    configAutoSaverRef.current?.touch(now());
    markSavePending();
  }

  async function applyFixAndRefresh(patch: IssueFix): Promise<void> {
    const response = await client.applyPatch(patch);
    await refreshAfterWrite(response.canUndo, response.canRedo);
  }

  /** One atomic, single-undo-step write for a whole batch of patches (v0.4.0 #10, ADR-023) — see `client.applyBatch`'s own doc comment. */
  async function applyBatchAndRefresh(patches: IssueFix[]): Promise<void> {
    const response = await client.applyBatch(patches);
    await refreshAfterWrite(response.canUndo, response.canRedo);
  }

  /**
   * `SchemaArrayForm`'s per-entry delete button lands here (via
   * `ModuleFormPage`'s `onDeleteEntity`) — never a direct delete itself
   * (v0.4.0 #11, FR-REL-03 UI, exit condition 5). An unreferenced entity
   * (`replaceable`/`cascading` both empty) deletes immediately with no
   * dialog; anything else opens `DeleteImpactDialog` and waits for one of
   * its two exits.
   */
  async function handleDeleteEntityRequest(path: ConfigPath): Promise<void> {
    const response = await client.analyzeImpact(path);
    const { replaceable, cascading } = response.result;
    if (replaceable.length === 0 && cascading.length === 0) {
      await applyFixAndRefresh({ kind: 'remove', path });
      return;
    }
    setDeletingEntity({
      path,
      entityName: response.entity.serializedName,
      replaceable,
      cascading,
      targetOptions: targetOptionsForKind(response.entity.kind, ruleEntityNames).filter(
        (name) => name !== response.entity.serializedName,
      ),
    });
  }

  async function handleReplaceAndDelete(newTarget: string): Promise<void> {
    if (!deletingEntity) return;
    const patches = buildReplacePatches(
      documentValue,
      deletingEntity.path,
      deletingEntity.replaceable,
      newTarget,
    );
    await applyBatchAndRefresh(patches);
    setDeletingEntity(null);
  }

  async function handleCascadeDelete(): Promise<void> {
    if (!deletingEntity) return;
    const patches = buildCascadeDeletePatches(
      deletingEntity.path,
      deletingEntity.replaceable,
      deletingEntity.cascading,
    );
    await applyBatchAndRefresh(patches);
    setDeletingEntity(null);
  }

  /**
   * A `ModuleFormPage` field edit — distinct from `handleFieldChange` above,
   * which is project *metadata* (name/description/targetProfile), not
   * document content. Always the `'set'` `IssueFix` kind (v0.3.0 #14):
   * unlike a validator-suggested fix, a form edit's value is never
   * schema-constant-shaped alone (a `tags`/`key-value` control edits an
   * array/object), so `set-scalar` cannot carry every case this needs.
   */
  async function handleDocumentFieldChange(path: ConfigPath, value: unknown): Promise<void> {
    await applyFixAndRefresh({ kind: 'set', path, value });
  }

  async function handleConfirmDelete(id: string): Promise<void> {
    // Cancel any pending autosave for this project *before* deleting it: the
    // effects above flush on cleanup when `selectedId` changes away, which
    // would otherwise resurrect the manifest/config this is about to remove.
    manifestAutoSaverRef.current = null;
    configAutoSaverRef.current = null;
    await deleteProject(adapter, id);
    setProjects((previous) => previous.filter((project) => project.id !== id));
    // The delete button only ever appears for the selected project (see
    // `ProjectDetail`'s render site below), so `id` is always `selectedId`
    // here — no need to compare before clearing it.
    setSelectedId(null);
    setConfirmingDeleteId(null);
  }

  const selected = projects.find((project) => project.id === selectedId) ?? null;

  return (
    <AppShell
      narrowFocus={selected ? 'main' : 'sidebar'}
      sidebar={
        <div className="project-sidebar">
          <h1 className="project-sidebar__title">{t('app.title')}</h1>
          <p className="project-sidebar__tagline">{t('app.tagline')}</p>
          <button
            type="button"
            className="project-sidebar__new-button"
            onClick={() => void handleCreate()}
          >
            {t('project.newButton')}
          </button>
          {loaded && projects.length === 0 && (
            <p className="project-sidebar__empty">{t('project.emptyState')}</p>
          )}
          <ul className="project-sidebar__list">
            {projects.map((project) => (
              <li key={project.id}>
                <button
                  type="button"
                  className="project-sidebar__item"
                  aria-current={project.id === selectedId ? 'true' : undefined}
                  onClick={() => setSelectedId(project.id)}
                >
                  {project.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      }
      aside={
        selected ? (
          <>
            <IssuePanel
              issues={issues}
              client={client}
              onJump={handleJumpToIssue}
              onJumpToField={handleJumpToField}
            />
            <UnknownFieldTree fields={unknownFields} client={client} onJump={handleJumpToIssue} />
          </>
        ) : undefined
      }
    >
      {selected ? (
        <>
          <StatusBar
            projectName={selected.name}
            compatibilityProfile={selected.targetProfile}
            saveStatus={saveStatus}
            onBack={() => setSelectedId(null)}
          />
          {readOnly ? (
            <ReadOnlyGuard
              lockedVersion={schemaLock?.bundleVersion ?? ''}
              onUpgradeClick={() => setShowUpgradeDialog(true)}
            >
              <div className="project-detail project-detail--read-only" aria-label={selected.name}>
                <div className="project-detail__toolbar">
                  <button type="button" onClick={() => setShowExportDialog(true)}>
                    {t('export.triggerButton')}
                  </button>
                </div>
                <label className="project-detail__label" htmlFor="read-only-config-text">
                  {t('editor.title')}
                </label>
                <textarea
                  id="read-only-config-text"
                  className="read-only-guard__textarea"
                  readOnly
                  value={configText}
                />
              </div>
            </ReadOnlyGuard>
          ) : (
            <>
              {/* PRD §7.3 / v0.6.0 #6: on a narrow screen, only the page
              matching `activeMobilePage` is visible (`AppShell.tsx`'s
              media-query-gated `.project-mobile-page`/`--active` classes);
              on a wide screen those classes have no effect and every page
              renders in normal document flow, unchanged from before this
              slice. 配置/关系 (v0.4.0 #7's `mainView` tablist) share this
              first page — see `handleBottomNavigate`. */}
              <div
                className={`project-mobile-page${activeMobilePage === 'main' ? ' project-mobile-page--active' : ''}`}
              >
                <ImportPanel
                  client={client}
                  onImport={(text) => void handleImport(selected.id, text)}
                />
                <div className="project-main-view">
                  <div
                    className="project-main-view__tablist"
                    role="tablist"
                    aria-label={t('project.mainViewTabListLabel')}
                  >
                    {MAIN_VIEWS.map((view) => (
                      <button
                        key={view}
                        ref={(element) => {
                          mainViewTabRefs.current[view] = element;
                        }}
                        type="button"
                        role="tab"
                        id={`main-view-tab-${view}`}
                        aria-selected={mainView === view}
                        aria-controls={`main-view-panel-${view}`}
                        tabIndex={mainView === view ? 0 : -1}
                        className="project-main-view__tab"
                        onClick={() => setMainView(view)}
                        onKeyDown={(event) => handleMainViewTabKeyDown(event, view)}
                      >
                        {t(MAIN_VIEW_TAB_LABEL_KEYS[view])}
                      </button>
                    ))}
                  </div>
                  <div
                    className="project-main-view__panel"
                    role="tabpanel"
                    id={`main-view-panel-${mainView}`}
                    aria-labelledby={`main-view-tab-${mainView}`}
                  >
                    {/* Lazy-mounted (E3): only the selected view's component ever
                    renders — a 10,000-row rule list or a large relationship
                    graph costs nothing while the user is looking at the other
                    one. */}
                    {mainView === 'form' && (
                      <ModuleFormPage
                        ref={moduleFormRef}
                        modules={modules}
                        value={documentValue}
                        mode={formMode}
                        onModeChange={setFormMode}
                        onFieldChange={(path, value) => void handleDocumentFieldChange(path, value)}
                        onDeleteEntity={(path) => void handleDeleteEntityRequest(path)}
                      />
                    )}
                    {mainView === 'rules' && (
                      <RuleListPage
                        rules={rules}
                        catalog={ruleCatalog}
                        proxyTargetNames={ruleEntityNames.proxyTargetNames}
                        ruleProviderNames={ruleEntityNames.ruleProviderNames}
                        subRuleGroupNames={ruleEntityNames.subRuleGroupNames}
                        onApplyFix={applyFixAndRefresh}
                        onApplyBatch={applyBatchAndRefresh}
                      />
                    )}
                    {mainView === 'graph' &&
                      (graphData ? (
                        <GraphView
                          layout={graphData.layout}
                          entities={graphData.entities}
                          cycles={graphData.cycles}
                          onJumpToField={handleJumpToField}
                        />
                      ) : (
                        <p className="project-detail__empty">{t('graph.emptyState')}</p>
                      ))}
                  </div>
                </div>
                <DiffPanel
                  importBaseline={importBaseline}
                  savedBaseline={savedBaseline}
                  client={client}
                  issues={issues}
                />
                <ProjectDetail
                  project={selected}
                  canUndo={canUndo}
                  canRedo={canRedo}
                  onUndo={() => void handleUndo()}
                  onRedo={() => void handleRedo()}
                  onFieldChange={handleFieldChange}
                  onExportClick={() => setShowExportDialog(true)}
                  onUpgradeClick={() => setShowUpgradeDialog(true)}
                  confirmingDelete={confirmingDeleteId === selected.id}
                  onDeleteClick={() => setConfirmingDeleteId(selected.id)}
                  onCancelDelete={() => setConfirmingDeleteId(null)}
                  onConfirmDelete={() => void handleConfirmDelete(selected.id)}
                />
              </div>
              <div
                className={`project-mobile-page${activeMobilePage === 'yaml' ? ' project-mobile-page--active' : ''}`}
              >
                <YamlEditor
                  ref={editorRef}
                  text={configText}
                  onChange={handleConfigChange}
                  client={client}
                  onIssuesChange={setIssues}
                  onValueChange={setDocumentValue}
                />
              </div>
              {/* Duplicates the `aside` prop's IssuePanel/UnknownFieldTree
              below (desktop-only, hidden by `AppShell.css` on a narrow
              screen) rather than relocating them — both are pure,
              props-driven components with no side effects of their own, so
              a second instance is cheap. Its *content* only actually mounts
              when `useNarrowViewport()` agrees a phone-width screen is what
              hid the desktop copy in the first place, AND this is the
              active mobile page: `display: none` alone would still leave
              two mounted instances in the tree, which both breaks
              `getByRole`/`getByText` queries (jsdom does not evaluate
              `@media` conditions) and would confuse real assistive tech
              that does not honor CSS visibility either. Requiring the
              active-page check too avoids mounting this duplicate the
              moment the viewport is narrow, before the user has even
              navigated to the 问题 tab. */}
              <div
                className={`project-mobile-page${activeMobilePage === 'issues' ? ' project-mobile-page--active' : ''}`}
              >
                {isNarrowViewport && activeMobilePage === 'issues' && (
                  <>
                    <IssuePanel
                      issues={issues}
                      client={client}
                      onJump={handleJumpToIssue}
                      onJumpToField={handleJumpToField}
                    />
                    <UnknownFieldTree
                      fields={unknownFields}
                      client={client}
                      onJump={handleJumpToIssue}
                    />
                  </>
                )}
              </div>
              <BottomNav
                active={
                  activeMobilePage === 'main'
                    ? mainView === 'graph'
                      ? 'graph'
                      : 'config'
                    : activeMobilePage
                }
                onNavigate={handleBottomNavigate}
              />
            </>
          )}
          {showExportDialog && schemaLock && (
            <ExportDialog
              project={selected}
              configText={configText}
              issues={issues}
              schemaLock={schemaLock}
              quarantine={quarantine}
              onClose={() => setShowExportDialog(false)}
              {...(saveDocument ? { saveDocument } : {})}
            />
          )}
          {showUpgradeDialog && schemaLock && (
            <UpgradeDialog
              adapter={adapter}
              projectId={selected.id}
              configText={configText}
              schemaLock={schemaLock}
              quarantine={quarantine}
              oldModules={modules}
              onUpgraded={(result) => void handleUpgraded(result)}
              onClose={() => setShowUpgradeDialog(false)}
              {...(trustedPublicKeys ? { trustedPublicKeys } : {})}
            />
          )}
          {deletingEntity && (
            <DeleteImpactDialog
              entityName={deletingEntity.entityName}
              replaceable={deletingEntity.replaceable}
              cascading={deletingEntity.cascading}
              targetOptions={deletingEntity.targetOptions}
              onReplace={(newTarget) => void handleReplaceAndDelete(newTarget)}
              onCascadeDelete={() => void handleCascadeDelete()}
              onCancel={() => setDeletingEntity(null)}
            />
          )}
        </>
      ) : (
        <p className="project-detail__empty">{t('project.noSelection')}</p>
      )}
    </AppShell>
  );
}

interface ProjectDetailProps {
  readonly project: ProjectRecord;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
  readonly onFieldChange: (field: ProjectField, value: string) => void;
  readonly onExportClick: () => void;
  readonly onUpgradeClick: () => void;
  readonly confirmingDelete: boolean;
  readonly onDeleteClick: () => void;
  readonly onCancelDelete: () => void;
  readonly onConfirmDelete: () => void;
}

function ProjectDetail({
  project,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onFieldChange,
  onExportClick,
  onUpgradeClick,
  confirmingDelete,
  onDeleteClick,
  onCancelDelete,
  onConfirmDelete,
}: ProjectDetailProps): ReactNode {
  return (
    <section className="project-detail" aria-label={project.name}>
      <div className="project-detail__toolbar">
        <button type="button" onClick={onExportClick}>
          {t('export.triggerButton')}
        </button>
        <button type="button" onClick={onUpgradeClick}>
          {t('migration.upgradeTriggerButton')}
        </button>
        <button type="button" onClick={onUndo} disabled={!canUndo}>
          {t('project.undoButton')}
        </button>
        <button type="button" onClick={onRedo} disabled={!canRedo}>
          {t('project.redoButton')}
        </button>
      </div>

      <label className="project-detail__label" htmlFor="project-name">
        {t('project.nameLabel')}
      </label>
      <input
        id="project-name"
        type="text"
        value={project.name}
        onChange={(event) => onFieldChange('name', event.target.value)}
      />

      <label className="project-detail__label" htmlFor="project-description">
        {t('project.descriptionLabel')}
      </label>
      <textarea
        id="project-description"
        value={project.description}
        onChange={(event) => onFieldChange('description', event.target.value)}
      />

      <label className="project-detail__label" htmlFor="project-target-profile">
        {t('project.targetProfileLabel')}
      </label>
      <input
        id="project-target-profile"
        type="text"
        value={project.targetProfile}
        onChange={(event) => onFieldChange('targetProfile', event.target.value)}
      />

      <dl className="project-detail__meta">
        <dt>{t('project.createdAtLabel')}</dt>
        <dd>{new Date(project.createdAt).toLocaleString()}</dd>
        <dt>{t('project.updatedAtLabel')}</dt>
        <dd>{new Date(project.updatedAt).toLocaleString()}</dd>
      </dl>

      {confirmingDelete ? (
        <div
          className="project-detail__delete-confirm"
          role="alertdialog"
          aria-label={t('project.deleteButton')}
        >
          <p>{t('project.deleteConfirmMessage')}</p>
          <button type="button" onClick={onConfirmDelete}>
            {t('project.deleteConfirmButton')}
          </button>
          <button type="button" onClick={onCancelDelete}>
            {t('project.deleteCancelButton')}
          </button>
        </div>
      ) : (
        <button type="button" className="project-detail__delete-button" onClick={onDeleteClick}>
          {t('project.deleteButton')}
        </button>
      )}
    </section>
  );
}
