import {
  collectUnknownFields,
  type FormMode,
  type RuleTypeSpec,
  type SchemaModule,
} from '@mcs/schema-core';
import { builtinAsStoredBundle, createRegistry } from '@mcs/schema-registry';
import { AutoSaver } from '@mcs/storage';
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
import type { DownloadFile } from '../export/ExportDialog.js';
import { ModuleFormPage } from '../form/ModuleFormPage.js';
import type { ModuleFormPageHandle } from '../form/ModuleFormPage.js';
import { UnknownFieldTree } from '../form/UnknownFieldTree.js';
import { ImportPanel } from '../import/ImportPanel.js';
import type { ImportWorkerClient } from '../import/ImportPanel.js';
import { t } from '../i18n/index.js';
import { IssuePanel } from '../issues/IssuePanel.js';
import type { IssuePanelWorkerClient } from '../issues/IssuePanel.js';
import { AppShell } from '../layout/AppShell.js';
import { collectRuleEntityNames } from '../rules/entity-names.js';
import { RuleListPage } from '../rules/RuleListPage.js';
import type {
  ApplyPatchResponse,
  ConfigPath,
  IssueFix,
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
  listProjects,
  saveImportBaseline,
  saveProjectConfigText,
  saveProjectManifest,
} from './model.js';
import type { ProjectRecord } from './model.js';
import './ProjectPage.css';

type ProjectField = 'name' | 'description' | 'targetProfile';

/**
 * PRD §7.2's middle column: "图形化表单、列表、拖拽排序和关系图". `graph`
 * joins this list once #13 builds `GraphView` — deliberately not stubbed in
 * here ahead of that, since a tab with no real content behind it would just
 * be dead UI between now and then (E3, v0.4.0 #7).
 */
const MAIN_VIEWS = ['form', 'rules'] as const;
type MainView = (typeof MAIN_VIEWS)[number];
const MAIN_VIEW_TAB_LABEL_KEYS: Record<MainView, 'project.formViewTab' | 'project.rulesViewTab'> = {
  form: 'project.formViewTab',
  rules: 'project.rulesViewTab',
};

/**
 * Document-editing operations `ProjectPage` itself calls directly rather
 * than through a child component's own props — `ModuleFormPage` takes a
 * plain `onFieldChange` callback, not a Worker client, and undo/redo are
 * document-level (affect the raw editor and the form alike), not owned by
 * either (v0.3.0 #14/#15).
 */
export interface ModuleFormWorkerClient {
  applyPatch(patch: IssueFix): Promise<ApplyPatchResponse>;
  value(): Promise<ValueResponse>;
  undo(): Promise<UndoResponse>;
  redo(): Promise<RedoResponse>;
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
  /** Forwarded to `ExportDialog` as-is; injectable because jsdom has no `URL.createObjectURL` (see `ExportDialog`'s own doc comment). */
  readonly downloadFile?: DownloadFile;
}

export function ProjectPage({
  adapter,
  client,
  now = Date.now,
  downloadFile,
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
  // Static for the process lifetime: v0.3.0 has no Bundle-install UI yet, so
  // the built-in bundle is the only one that can ever be active (see
  // `builtinAsStoredBundle`'s own doc comment).
  const [modules] = useState<readonly SchemaModule[]>(() =>
    createRegistry(builtinAsStoredBundle()).modules(),
  );
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
      return;
    }
    let cancelled = false;
    // Fetched together and applied from one callback rather than two
    // independent `.then()`s: the two requests can resolve in either order,
    // and the import-baseline fallback below needs *this* project's config
    // text, not whatever `configText` state still holds from the project
    // that was selected before this effect ran.
    void Promise.all([
      getProjectConfigText(adapter, selectedId),
      getImportBaseline(adapter, selectedId),
    ]).then(([savedText, importText]) => {
      if (cancelled) return;
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
  }, [adapter, selectedId]);

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
    function handleVisibilityChange(): void {
      if (document.visibilityState !== 'hidden') return;
      void manifestAutoSaverRef.current?.flush();
      void configAutoSaverRef.current?.flush();
    }
    function handleBeforeUnload(): void {
      void manifestAutoSaverRef.current?.flush();
      void configAutoSaverRef.current?.flush();
    }
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
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

  async function handleUndo(): Promise<void> {
    const response = await client.undo();
    applyHistoryResponse(response);
  }

  async function handleRedo(): Promise<void> {
    const response = await client.redo();
    applyHistoryResponse(response);
  }

  /** Shared by `handleUndo`/`handleRedo`: both responses have the identical shape (v0.3.0 #15). */
  function applyHistoryResponse(response: UndoResponse | RedoResponse): void {
    setCanUndo(response.canUndo);
    setCanRedo(response.canRedo);
    setDocumentValue(response.value);
    configTextRef.current = response.text;
    setConfigText(response.text);
    configAutoSaverRef.current?.touch(now());
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

  function handleConfigChange(text: string): void {
    // No `!selectedId` guard, same reasoning as `handleFieldChange`: the only
    // caller is `YamlEditor`'s onChange, which only exists while selected.
    configTextRef.current = text;
    setConfigText(text);
    configAutoSaverRef.current?.touch(now());
  }

  function handleJumpToIssue(range: TextRange): void {
    editorRef.current?.jumpToRange(range);
  }

  function handleJumpToField(path: ConfigPath): void {
    moduleFormRef.current?.jumpToField(path);
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
   * Applies any `IssueFix` and refreshes every piece of state that depends
   * on the document afterward. `configText`/`documentValue` both refresh
   * from the Worker rather than being derived locally — the main thread
   * never holds a `MihomoYamlDocument` to serialize or read a value from
   * itself (v0.2.0's Worker boundary, reconfirmed by
   * `schema-registry-boundary.test.ts` and `worker/client.test.ts`'s
   * structural fences).
   */
  async function applyFixAndRefresh(patch: IssueFix): Promise<void> {
    const patchResponse = await client.applyPatch(patch);
    setCanUndo(patchResponse.canUndo);
    setCanRedo(patchResponse.canRedo);
    const [valueResponse, serializeResponse] = await Promise.all([
      client.value(),
      client.serialize(),
    ]);
    setDocumentValue(valueResponse.value);
    configTextRef.current = serializeResponse.text;
    setConfigText(serializeResponse.text);
    configAutoSaverRef.current?.touch(now());
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
          <ImportPanel client={client} onImport={(text) => void handleImport(selected.id, text)} />
          <YamlEditor
            ref={editorRef}
            text={configText}
            onChange={handleConfigChange}
            client={client}
            onIssuesChange={setIssues}
            onValueChange={setDocumentValue}
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
                  renders — a 10,000-row rule list or a future relationship
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
                />
              )}
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
            confirmingDelete={confirmingDeleteId === selected.id}
            onDeleteClick={() => setConfirmingDeleteId(selected.id)}
            onCancelDelete={() => setConfirmingDeleteId(null)}
            onConfirmDelete={() => void handleConfirmDelete(selected.id)}
          />
          {showExportDialog && (
            <ExportDialog
              project={selected}
              configText={configText}
              issues={issues}
              onClose={() => setShowExportDialog(false)}
              {...(downloadFile ? { downloadFile } : {})}
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
