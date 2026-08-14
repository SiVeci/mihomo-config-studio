import { HistoryStack } from '@mcs/config-model';
import { AutoSaver } from '@mcs/storage';
import type { StorageAdapter } from '@mcs/storage';
import { useEffect, useReducer, useRef, useState, type ReactNode } from 'react';

import { ImportPanel } from '../import/ImportPanel.js';
import type { ImportWorkerClient } from '../import/ImportPanel.js';
import { t } from '../i18n/index.js';
import { AppShell } from '../layout/AppShell.js';
import {
  deleteProject,
  DEFAULT_PROJECT_CONFIG_TEXT,
  DEFAULT_TARGET_PROFILE,
  listProjects,
  saveProjectConfigText,
  saveProjectManifest,
} from './model.js';
import type { ProjectRecord } from './model.js';
import './ProjectPage.css';

type ProjectField = 'name' | 'description' | 'targetProfile';

export interface ProjectPageProps {
  readonly adapter: StorageAdapter;
  /**
   * Required, like `adapter`: a real client is backed by a real Worker,
   * which throws to construct outside a browser, so there is no safe
   * internal default (see `App.tsx`'s `createConfigWorkerClient()` call).
   */
  readonly client: ImportWorkerClient;
  /**
   * Injectable for tests; production always takes the default (a fresh,
   * always-empty stack). Real document-level recording — the only thing that
   * would ever make `canUndo`/`canRedo` true outside a test — arrives in #13
   * once the Worker protocol grows `undo`/`redo` messages (see the plan's
   * "执行时修正" note for #11: the one live `MihomoYamlDocument` lives inside
   * the Worker per #10, so this shell cannot record real edits yet).
   */
  readonly historyStack?: HistoryStack;
  /** Injectable clock so autosave timing is exactly assertable in tests. */
  readonly now?: () => number;
}

export function ProjectPage({
  adapter,
  client,
  historyStack: historyStackProp,
  now = Date.now,
}: ProjectPageProps): ReactNode {
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [historyStack] = useState(() => historyStackProp ?? new HistoryStack());
  const [, bumpHistoryVersion] = useReducer((count: number) => count + 1, 0);

  const projectsRef = useRef(projects);
  projectsRef.current = projects;
  const autoSaverRef = useRef<AutoSaver | null>(null);

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

  // One AutoSaver per selected project, flushed whenever selection moves away
  // from it (or the page unmounts) so a pending metadata edit is never lost
  // to a fresh 5-second window starting on the project the user just left.
  useEffect(() => {
    if (!selectedId) {
      autoSaverRef.current = null;
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
    autoSaverRef.current = saver;
    return () => {
      // `handleConfirmDelete` clears the ref itself before deleting, so a
      // flush here would otherwise resurrect the manifest it just removed by
      // writing back whatever `getContent()` finds once the record is gone.
      if (autoSaverRef.current !== saver) return;
      void saver.flush();
      autoSaverRef.current = null;
    };
  }, [adapter, selectedId]);

  useEffect(() => {
    function handleVisibilityChange(): void {
      if (document.visibilityState === 'hidden') void autoSaverRef.current?.flush();
    }
    function handleBeforeUnload(): void {
      void autoSaverRef.current?.flush();
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
      if (event.shiftKey) handleRedo();
      else handleUndo();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  function handleUndo(): void {
    if (historyStack.undo() !== null) bumpHistoryVersion();
  }

  function handleRedo(): void {
    if (historyStack.redo() !== null) bumpHistoryVersion();
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
    autoSaverRef.current?.touch(now());
  }

  async function handleImport(id: string, text: string): Promise<void> {
    // A discrete, deliberate action (like create/delete), not a keystroke —
    // saved immediately rather than through the debounced AutoSaver.
    await saveProjectConfigText(adapter, id, text);
    const updated = projectsRef.current.map((project) =>
      project.id === id ? { ...project, updatedAt: new Date(now()).toISOString() } : project,
    );
    projectsRef.current = updated;
    setProjects(updated);
    const record = updated.find((project) => project.id === id);
    if (record) await saveProjectManifest(adapter, record);
  }

  async function handleConfirmDelete(id: string): Promise<void> {
    // Cancel any pending autosave for this project *before* deleting it: the
    // effect above flushes on cleanup when `selectedId` changes away, which
    // would otherwise resurrect the manifest this is about to remove.
    autoSaverRef.current = null;
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
    >
      {selected ? (
        <>
          <ImportPanel client={client} onImport={(text) => void handleImport(selected.id, text)} />
          <ProjectDetail
            project={selected}
            canUndo={historyStack.canUndo}
            canRedo={historyStack.canRedo}
            onUndo={handleUndo}
            onRedo={handleRedo}
            onFieldChange={handleFieldChange}
            confirmingDelete={confirmingDeleteId === selected.id}
            onDeleteClick={() => setConfirmingDeleteId(selected.id)}
            onCancelDelete={() => setConfirmingDeleteId(null)}
            onConfirmDelete={() => void handleConfirmDelete(selected.id)}
          />
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
  confirmingDelete,
  onDeleteClick,
  onCancelDelete,
  onConfirmDelete,
}: ProjectDetailProps): ReactNode {
  return (
    <section className="project-detail" aria-label={project.name}>
      <div className="project-detail__toolbar">
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
