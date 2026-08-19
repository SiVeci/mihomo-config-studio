// @vitest-environment jsdom
import { HistoryStack } from '@mcs/config-model';
import { GENERAL_MODULE } from '@mcs/schema-builtin';
import { MemoryStorageAdapter } from '@mcs/storage';
import { MihomoYamlDocument } from '@mcs/yaml-engine';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DiffPanelWorkerClient } from '../diff/DiffPanel.js';
import { WorkerClient } from '../worker/client.js';
import type { WorkerLike, WorkerMessageEvent } from '../worker/client.js';
import type { YamlEditorWorkerClient } from '../editor/YamlEditor.js';
import { t } from '../i18n/index.js';
import type { ImportWorkerClient } from '../import/ImportPanel.js';
import type { IssuePanelWorkerClient } from '../issues/IssuePanel.js';
import { createWorkerState, handleWorkerRequest } from '../worker/protocol.js';
import type { WorkerRequest } from '../worker/protocol.js';
import {
  DEFAULT_PROJECT_CONFIG_TEXT,
  DEFAULT_TARGET_PROFILE,
  getImportBaseline,
  getProjectConfigText,
  saveProjectConfigText,
  saveProjectManifest,
} from './model.js';
import type { ProjectRecord } from './model.js';
import { ProjectPage } from './ProjectPage.js';
import type { ModuleFormWorkerClient } from './ProjectPage.js';

afterEach(() => {
  cleanup();
});

type FakeClient = ImportWorkerClient &
  YamlEditorWorkerClient &
  IssuePanelWorkerClient &
  DiffPanelWorkerClient &
  ModuleFormWorkerClient;

/** ProjectPage requires a client but most of these tests exercise neither import, the editor, the issue panel, nor the diff panel directly. */
const FAKE_CLIENT: FakeClient = {
  parse: async (_text) => ({ type: 'parse', requestId: 'fake', issues: [], value: {} }),
  serialize: async (_options) => ({ type: 'serialize', requestId: 'fake', text: '' }),
  locate: async (_path) => ({ type: 'locate', requestId: 'fake', range: null }),
  diff: async (_baseline) => ({
    type: 'diff',
    requestId: 'fake',
    diff: { hunks: [], added: 0, removed: 0, identical: true, trailingNewlineChanged: false },
  }),
  applyPatch: async (_patch) => ({ type: 'applyPatch', requestId: 'fake' }),
  value: async () => ({ type: 'value', requestId: 'fake', value: {} }),
};

const decoder = new TextDecoder();

async function readManifest(
  adapter: MemoryStorageAdapter,
  id: string,
): Promise<Record<string, unknown> | null> {
  const bytes = await adapter.get(`project/${id}/manifest.json`);
  return bytes ? (JSON.parse(decoder.decode(bytes)) as Record<string, unknown>) : null;
}

describe('getProjectConfigText', () => {
  it('returns null for a project with no stored config', async () => {
    const adapter = new MemoryStorageAdapter();

    expect(await getProjectConfigText(adapter, 'never-created')).toBeNull();
  });
});

describe('ProjectPage / empty and loading state', () => {
  it('shows the empty-state message once loading finishes with no projects', async () => {
    render(<ProjectPage client={FAKE_CLIENT} adapter={new MemoryStorageAdapter()} />);

    await screen.findByText(t('project.emptyState'));
  });

  it('shows the no-selection message with no project selected', async () => {
    render(<ProjectPage client={FAKE_CLIENT} adapter={new MemoryStorageAdapter()} />);

    expect(screen.getByText(t('project.noSelection'))).toBeDefined();
  });

  it('unmounting before the initial load resolves does not warn about a state update on an unmounted component', () => {
    const { unmount } = render(
      <ProjectPage client={FAKE_CLIENT} adapter={new MemoryStorageAdapter()} />,
    );

    expect(() => unmount()).not.toThrow();
  });
});

describe('ProjectPage / create', () => {
  it('creates a project with the default name and target profile, persists it, and selects it', async () => {
    const adapter = new MemoryStorageAdapter();
    render(<ProjectPage client={FAKE_CLIENT} adapter={adapter} />);
    await screen.findByText(t('project.emptyState'));

    fireEvent.click(screen.getByRole('button', { name: t('project.newButton') }));

    const nameInput = await screen.findByLabelText<HTMLInputElement>(t('project.nameLabel'));
    expect(nameInput.value).toBe(t('project.untitledName'));
    const profileInput = screen.getByLabelText<HTMLInputElement>(t('project.targetProfileLabel'));
    expect(profileInput.value).toBe(DEFAULT_TARGET_PROFILE);

    const keys = await adapter.list('project/');
    expect(keys.some((key) => key.endsWith('/manifest.json'))).toBe(true);
    expect(keys.some((key) => key.endsWith('/config.yaml'))).toBe(true);
    const configKey = keys.find((key) => key.endsWith('/config.yaml'));
    const configBytes = configKey ? await adapter.get(configKey) : null;
    expect(configBytes ? decoder.decode(configBytes) : null).toBe(DEFAULT_PROJECT_CONFIG_TEXT);
  });

  it('lists every created project by name in the sidebar', async () => {
    const adapter = new MemoryStorageAdapter();
    render(<ProjectPage client={FAKE_CLIENT} adapter={adapter} />);
    await screen.findByText(t('project.emptyState'));

    fireEvent.click(screen.getByRole('button', { name: t('project.newButton') }));
    await screen.findByLabelText(t('project.nameLabel'));
    fireEvent.change(screen.getByLabelText(t('project.nameLabel')), {
      target: { value: 'First project' },
    });
    fireEvent.click(screen.getByRole('button', { name: t('project.newButton') }));
    await screen.findByRole('button', { name: 'First project' });

    expect(screen.getByRole('button', { name: t('project.untitledName') })).toBeDefined();
    expect(screen.getByRole('button', { name: 'First project' })).toBeDefined();
  });

  it('editing the selected project leaves every other project untouched', async () => {
    const adapter = new MemoryStorageAdapter();
    render(<ProjectPage client={FAKE_CLIENT} adapter={adapter} />);
    await screen.findByText(t('project.emptyState'));

    fireEvent.click(screen.getByRole('button', { name: t('project.newButton') }));
    await screen.findByLabelText(t('project.nameLabel'));
    fireEvent.change(screen.getByLabelText(t('project.nameLabel')), { target: { value: 'Alpha' } });
    fireEvent.click(screen.getByRole('button', { name: t('project.newButton') }));
    await screen.findByLabelText<HTMLInputElement>(t('project.nameLabel'));

    fireEvent.change(screen.getByLabelText(t('project.nameLabel')), { target: { value: 'Beta' } });

    expect(screen.getByRole('button', { name: 'Alpha' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Beta' })).toBeDefined();
  });
});

describe('ProjectPage / editing description and target profile', () => {
  it('editing the description and target profile fields updates each independently', async () => {
    const adapter = new MemoryStorageAdapter();
    render(<ProjectPage client={FAKE_CLIENT} adapter={adapter} />);
    await screen.findByText(t('project.emptyState'));
    fireEvent.click(screen.getByRole('button', { name: t('project.newButton') }));
    await screen.findByLabelText(t('project.nameLabel'));

    fireEvent.change(screen.getByLabelText(t('project.descriptionLabel')), {
      target: { value: 'A test project' },
    });
    fireEvent.change(screen.getByLabelText(t('project.targetProfileLabel')), {
      target: { value: 'v1.20.0' },
    });

    expect(screen.getByLabelText<HTMLTextAreaElement>(t('project.descriptionLabel')).value).toBe(
      'A test project',
    );
    expect(screen.getByLabelText<HTMLInputElement>(t('project.targetProfileLabel')).value).toBe(
      'v1.20.0',
    );
    // The name field must be untouched by edits to the other two fields.
    expect(screen.getByLabelText<HTMLInputElement>(t('project.nameLabel')).value).toBe(
      t('project.untitledName'),
    );
  });
});

describe('ProjectPage / import (FR-YAML-01 wiring)', () => {
  it('a successful import overwrites the selected project config.yaml and bumps updatedAt', async () => {
    const adapter = new MemoryStorageAdapter();
    let current = 0;
    render(<ProjectPage client={FAKE_CLIENT} adapter={adapter} now={() => current} />);
    await screen.findByText(t('project.emptyState'));
    fireEvent.click(screen.getByRole('button', { name: t('project.newButton') }));
    await screen.findByLabelText(t('project.nameLabel'));
    const id = (await adapter.list('project/'))
      .find((key) => key.endsWith('/manifest.json'))!
      .split('/')[1]!;
    const manifestBefore = await readManifest(adapter, id);

    current = 5000; // distinct from the creation timestamp, to prove updatedAt actually moved
    fireEvent.change(screen.getByLabelText(t('import.pasteLabel')), {
      target: { value: 'mode: direct\n' },
    });
    fireEvent.click(screen.getByRole('button', { name: t('import.pasteButton') }));

    await screen.findByText(t('import.successMessage'));
    const configBytes = await adapter.get(`project/${id}/config.yaml`);
    expect(configBytes ? decoder.decode(configBytes) : null).toBe('mode: direct\n');
    const manifestAfter = await readManifest(adapter, id);
    expect(manifestAfter?.updatedAt).not.toBe(manifestBefore?.updatedAt);
  });

  it('importing into the selected project leaves every other project untouched', async () => {
    const adapter = new MemoryStorageAdapter();
    render(<ProjectPage client={FAKE_CLIENT} adapter={adapter} />);
    await screen.findByText(t('project.emptyState'));

    fireEvent.click(screen.getByRole('button', { name: t('project.newButton') }));
    await screen.findByLabelText(t('project.nameLabel'));
    const otherId = (await adapter.list('project/'))
      .find((key) => key.endsWith('/manifest.json'))!
      .split('/')[1]!;
    fireEvent.click(screen.getByRole('button', { name: t('project.newButton') }));
    await screen.findByLabelText<HTMLInputElement>(t('project.nameLabel'));

    fireEvent.change(screen.getByLabelText(t('import.pasteLabel')), {
      target: { value: 'mode: direct\n' },
    });
    fireEvent.click(screen.getByRole('button', { name: t('import.pasteButton') }));
    await screen.findByText(t('import.successMessage'));

    const otherConfigBytes = await adapter.get(`project/${otherId}/config.yaml`);
    expect(otherConfigBytes ? decoder.decode(otherConfigBytes) : null).toBe(
      DEFAULT_PROJECT_CONFIG_TEXT,
    );
  });

  it('a blocking import does not touch the stored config.yaml', async () => {
    const adapter = new MemoryStorageAdapter();
    const blockingClient: typeof FAKE_CLIENT = {
      ...FAKE_CLIENT,
      parse: async () => ({
        type: 'parse',
        requestId: 'x',
        issues: [
          {
            severity: 'error',
            code: 'yaml.syntax.x',
            module: 'yaml',
            messageKey: 'yaml.syntax.x',
            blocking: true,
          },
        ],
        value: null,
      }),
    };
    render(<ProjectPage client={blockingClient} adapter={adapter} />);
    await screen.findByText(t('project.emptyState'));
    fireEvent.click(screen.getByRole('button', { name: t('project.newButton') }));
    await screen.findByLabelText(t('project.nameLabel'));
    const id = (await adapter.list('project/'))
      .find((key) => key.endsWith('/manifest.json'))!
      .split('/')[1]!;

    fireEvent.change(screen.getByLabelText(t('import.pasteLabel')), {
      target: { value: 'a: 1\n  b: 2\n' },
    });
    fireEvent.click(screen.getByRole('button', { name: t('import.pasteButton') }));

    await screen.findByText(t('import.errorMessage'));
    const configBytes = await adapter.get(`project/${id}/config.yaml`);
    expect(configBytes ? decoder.decode(configBytes) : null).toBe(DEFAULT_PROJECT_CONFIG_TEXT);
  });
});

describe('ProjectPage / select', () => {
  it('selecting a project in the sidebar shows its own field values in the detail pane', async () => {
    const adapter = new MemoryStorageAdapter();
    render(<ProjectPage client={FAKE_CLIENT} adapter={adapter} />);
    await screen.findByText(t('project.emptyState'));

    fireEvent.click(screen.getByRole('button', { name: t('project.newButton') }));
    await screen.findByLabelText(t('project.nameLabel'));
    fireEvent.change(screen.getByLabelText(t('project.nameLabel')), { target: { value: 'Alpha' } });
    fireEvent.click(screen.getByRole('button', { name: t('project.newButton') }));
    await screen.findByLabelText<HTMLInputElement>(t('project.nameLabel'));

    // The second create selects the fresh (untitled) project; switch back to Alpha.
    fireEvent.click(screen.getByRole('button', { name: 'Alpha' }));

    await waitFor(() => {
      expect(screen.getByLabelText<HTMLInputElement>(t('project.nameLabel')).value).toBe('Alpha');
    });
  });
});

describe('ProjectPage / editor wiring (FR-YAML-04/05)', () => {
  it('unmounting while the selected project config text is still loading does not throw', async () => {
    const adapter = new MemoryStorageAdapter();
    const { unmount } = render(<ProjectPage client={FAKE_CLIENT} adapter={adapter} />);
    await screen.findByText(t('project.emptyState'));

    fireEvent.click(screen.getByRole('button', { name: t('project.newButton') }));
    // Unmounts before the config-load effect's own `getProjectConfigText`
    // fetch (triggered by selecting the new project) can have resolved.
    expect(() => unmount()).not.toThrow();
  });

  it('loads the newly-created project default config text into the editor', async () => {
    const adapter = new MemoryStorageAdapter();
    render(<ProjectPage client={FAKE_CLIENT} adapter={adapter} />);
    await screen.findByText(t('project.emptyState'));

    fireEvent.click(screen.getByRole('button', { name: t('project.newButton') }));

    // The textarea appears as soon as a project is selected, but its content
    // loads asynchronously (a separate `getProjectConfigText` fetch) — so the
    // value must be awaited, not just the element's presence.
    await waitFor(() => {
      const editorTextarea = screen.getByLabelText<HTMLTextAreaElement>(t('editor.title'));
      expect(editorTextarea.value).toBe(DEFAULT_PROJECT_CONFIG_TEXT);
    });
  });

  it('editing config text autosaves it once 5 seconds have elapsed, verified with an injected clock', async () => {
    const adapter = new MemoryStorageAdapter();
    let current = 0;
    render(<ProjectPage client={FAKE_CLIENT} adapter={adapter} now={() => current} />);
    await screen.findByText(t('project.emptyState'));

    fireEvent.click(screen.getByRole('button', { name: t('project.newButton') }));
    await screen.findByLabelText(t('project.nameLabel'));
    const projectId = (await adapter.list('project/'))
      .find((key) => key.endsWith('/manifest.json'))!
      .split('/')[1]!;

    // First edit establishes the AutoSaver's dirty-since timestamp; it alone
    // must not flush yet (mirrors the metadata autosave test above).
    fireEvent.change(screen.getByLabelText(t('editor.title')), {
      target: { value: 'mode: direct\n' },
    });
    const stillDefault = await adapter.get(`project/${projectId}/config.yaml`);
    expect(decoder.decode(stillDefault!)).toBe(DEFAULT_PROJECT_CONFIG_TEXT);

    current = 6000;
    fireEvent.change(screen.getByLabelText(t('editor.title')), {
      target: { value: 'mode: direct\nport: 1\n' },
    });

    await waitFor(async () => {
      const bytes = await adapter.get(`project/${projectId}/config.yaml`);
      expect(bytes ? decoder.decode(bytes) : null).toBe('mode: direct\nport: 1\n');
    });
  });
});

describe('ProjectPage / issue panel wiring (FR-VAL-02 UI wiring)', () => {
  it('shows the aside placeholder, not the issue panel, with no project selected', async () => {
    const adapter = new MemoryStorageAdapter();
    render(<ProjectPage client={FAKE_CLIENT} adapter={adapter} />);
    await screen.findByText(t('project.emptyState'));

    expect(screen.getByText(t('appShell.asidePlaceholder'))).toBeDefined();
    expect(screen.queryByText(t('issues.title'))).toBeNull();
  });

  it('reports the issues YamlEditor parsed up through to the IssuePanel in the aside', async () => {
    const adapter = new MemoryStorageAdapter();
    const client: FakeClient = {
      ...FAKE_CLIENT,
      parse: async () => ({
        type: 'parse',
        requestId: 'x',
        issues: [
          {
            severity: 'error',
            code: 'yaml.syntax.x',
            module: 'yaml',
            messageKey: 'yaml.syntax.x',
            blocking: true,
            range: {
              start: { offset: 0, line: 1, column: 1 },
              end: { offset: 1, line: 1, column: 2 },
            },
          },
        ],
        value: null,
      }),
    };
    render(<ProjectPage client={client} adapter={adapter} />);
    await screen.findByText(t('project.emptyState'));
    fireEvent.click(screen.getByRole('button', { name: t('project.newButton') }));
    await screen.findByLabelText(t('editor.title'));

    await screen.findByText('yaml.syntax.x');
    expect(screen.getByText(`${t('issues.severityError')} (1)`, { exact: false })).toBeDefined();
  });

  it('clicking an issue in the aside jumps the editor selection to its range', async () => {
    const adapter = new MemoryStorageAdapter();
    const range = {
      start: { offset: 6, line: 2, column: 1 },
      end: { offset: 10, line: 2, column: 5 },
    };
    const client: FakeClient = {
      ...FAKE_CLIENT,
      parse: async () => ({
        type: 'parse',
        requestId: 'x',
        issues: [
          {
            severity: 'warning',
            code: 'yaml.syntax.y',
            module: 'yaml',
            messageKey: 'yaml.syntax.y',
            blocking: false,
            range,
          },
        ],
        value: null,
      }),
    };
    render(<ProjectPage client={client} adapter={adapter} />);
    await screen.findByText(t('project.emptyState'));
    fireEvent.click(screen.getByRole('button', { name: t('project.newButton') }));
    await screen.findByLabelText(t('editor.title'));
    await screen.findByText('yaml.syntax.y');

    fireEvent.click(
      screen.getByRole('button', { name: `${t('issues.severityWarning')}: yaml.syntax.y` }),
    );

    const editorTextarea = screen.getByLabelText<HTMLTextAreaElement>(t('editor.title'));
    await waitFor(() => {
      expect(editorTextarea.selectionStart).toBe(6);
      expect(editorTextarea.selectionEnd).toBe(10);
    });
  });
});

describe('ProjectPage / metadata autosave (FR-PROJ-02 UI wiring)', () => {
  it('flushes an edit once 5 seconds have elapsed, verified with an injected clock', async () => {
    const adapter = new MemoryStorageAdapter();
    let current = 0;
    const now = (): number => current;
    render(<ProjectPage client={FAKE_CLIENT} adapter={adapter} now={now} />);
    await screen.findByText(t('project.emptyState'));

    fireEvent.click(screen.getByRole('button', { name: t('project.newButton') }));
    const { id } = (await waitFor(async () => {
      const manifest = (await adapter.list('project/')).find((key) =>
        key.endsWith('/manifest.json'),
      );
      if (!manifest) throw new Error('not yet created');
      return { id: manifest.split('/')[1]! };
    })) as { id: string };

    current = 1000;
    fireEvent.change(await screen.findByLabelText(t('project.nameLabel')), {
      target: { value: 'Renamed' },
    });
    // Still short of the 5s window: the persisted manifest must still read the old name.
    expect((await readManifest(adapter, id))?.name).toBe(t('project.untitledName'));

    current = 6000;
    fireEvent.change(screen.getByLabelText(t('project.nameLabel')), {
      target: { value: 'Renamed again' },
    });

    await waitFor(async () => {
      expect((await readManifest(adapter, id))?.name).toBe('Renamed again');
    });
  });

  it('force-flushes the pending edit when the tab becomes hidden', async () => {
    const adapter = new MemoryStorageAdapter();
    render(<ProjectPage client={FAKE_CLIENT} adapter={adapter} now={() => 0} />);
    await screen.findByText(t('project.emptyState'));

    fireEvent.click(screen.getByRole('button', { name: t('project.newButton') }));
    const nameInput = await screen.findByLabelText(t('project.nameLabel'));
    fireEvent.change(nameInput, { target: { value: 'Flushed on hide' } });

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));

    const keys = await adapter.list('project/');
    const manifestKey = keys.find((key) => key.endsWith('/manifest.json'))!;
    const id = manifestKey.split('/')[1]!;
    await waitFor(async () => {
      expect((await readManifest(adapter, id))?.name).toBe('Flushed on hide');
    });

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  });

  it('a visibilitychange event while still visible does not flush', async () => {
    const adapter = new MemoryStorageAdapter();
    render(<ProjectPage client={FAKE_CLIENT} adapter={adapter} now={() => 0} />);
    await screen.findByText(t('project.emptyState'));

    fireEvent.click(screen.getByRole('button', { name: t('project.newButton') }));
    const nameInput = await screen.findByLabelText(t('project.nameLabel'));
    fireEvent.change(nameInput, { target: { value: 'Not flushed' } });

    // document.visibilityState defaults to 'visible' in jsdom; dispatching
    // the event without changing it must not trigger a flush.
    document.dispatchEvent(new Event('visibilitychange'));

    const keys = await adapter.list('project/');
    const id = keys.find((key) => key.endsWith('/manifest.json'))!.split('/')[1]!;
    expect((await readManifest(adapter, id))?.name).toBe(t('project.untitledName'));
  });

  it('force-flushes the pending edit on beforeunload', async () => {
    const adapter = new MemoryStorageAdapter();
    render(<ProjectPage client={FAKE_CLIENT} adapter={adapter} now={() => 0} />);
    await screen.findByText(t('project.emptyState'));

    fireEvent.click(screen.getByRole('button', { name: t('project.newButton') }));
    const nameInput = await screen.findByLabelText(t('project.nameLabel'));
    fireEvent.change(nameInput, { target: { value: 'Flushed on unload' } });

    window.dispatchEvent(new Event('beforeunload'));

    const keys = await adapter.list('project/');
    const manifestKey = keys.find((key) => key.endsWith('/manifest.json'))!;
    const id = manifestKey.split('/')[1]!;
    await waitFor(async () => {
      expect((await readManifest(adapter, id))?.name).toBe('Flushed on unload');
    });
  });

  it('force-flushes the outgoing project before selection moves to a different one', async () => {
    const adapter = new MemoryStorageAdapter();
    render(<ProjectPage client={FAKE_CLIENT} adapter={adapter} now={() => 0} />);
    await screen.findByText(t('project.emptyState'));

    fireEvent.click(screen.getByRole('button', { name: t('project.newButton') }));
    await screen.findByLabelText(t('project.nameLabel'));
    fireEvent.change(screen.getByLabelText(t('project.nameLabel')), { target: { value: 'Alpha' } });
    const alphaId = (await adapter.list('project/'))
      .find((key) => key.endsWith('/manifest.json'))!
      .split('/')[1]!;

    fireEvent.click(screen.getByRole('button', { name: t('project.newButton') }));
    await screen.findByLabelText<HTMLInputElement>(t('project.nameLabel'));

    await waitFor(async () => {
      expect((await readManifest(adapter, alphaId))?.name).toBe('Alpha');
    });
  });
});

describe('ProjectPage / delete (FR-PROJ-03)', () => {
  it('shows a confirmation mentioning export before deleting, and cancelling keeps the project', async () => {
    const adapter = new MemoryStorageAdapter();
    render(<ProjectPage client={FAKE_CLIENT} adapter={adapter} />);
    await screen.findByText(t('project.emptyState'));
    fireEvent.click(screen.getByRole('button', { name: t('project.newButton') }));
    await screen.findByLabelText(t('project.nameLabel'));

    fireEvent.click(screen.getByRole('button', { name: t('project.deleteButton') }));

    const dialog = screen.getByRole('alertdialog');
    expect(dialog.textContent).toContain(t('project.deleteConfirmMessage'));

    fireEvent.click(screen.getByRole('button', { name: t('project.deleteCancelButton') }));

    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByRole('button', { name: t('project.untitledName') })).toBeDefined();
  });

  it('deletes both the manifest and config from storage, and clears the selection', async () => {
    const adapter = new MemoryStorageAdapter();
    render(<ProjectPage client={FAKE_CLIENT} adapter={adapter} />);
    await screen.findByText(t('project.emptyState'));
    fireEvent.click(screen.getByRole('button', { name: t('project.newButton') }));
    await screen.findByLabelText(t('project.nameLabel'));
    const id = (await adapter.list('project/'))
      .find((key) => key.endsWith('/manifest.json'))!
      .split('/')[1]!;

    fireEvent.click(screen.getByRole('button', { name: t('project.deleteButton') }));
    fireEvent.click(screen.getByRole('button', { name: t('project.deleteConfirmButton') }));

    await screen.findByText(t('project.emptyState'));
    expect(await adapter.get(`project/${id}/manifest.json`)).toBeNull();
    expect(await adapter.get(`project/${id}/config.yaml`)).toBeNull();
    expect(await adapter.get(`project/${id}/import-baseline.yaml`)).toBeNull();
    expect(screen.getByText(t('project.noSelection'))).toBeDefined();
  });
});

describe('ProjectPage / undo-redo shell (FR-PROJ-04 UI wiring; see plan #11 deviation note)', () => {
  it('renders Undo and Redo disabled while the injected history stack is empty', async () => {
    const adapter = new MemoryStorageAdapter();
    render(<ProjectPage client={FAKE_CLIENT} adapter={adapter} />);
    await screen.findByText(t('project.emptyState'));
    fireEvent.click(screen.getByRole('button', { name: t('project.newButton') }));
    await screen.findByLabelText(t('project.nameLabel'));

    const undoButton = screen.getByRole<HTMLButtonElement>('button', {
      name: t('project.undoButton'),
    });
    const redoButton = screen.getByRole<HTMLButtonElement>('button', {
      name: t('project.redoButton'),
    });
    expect(undoButton.disabled).toBe(true);
    expect(redoButton.disabled).toBe(true);
  });

  it('enables Undo once the injected stack has a recorded entry, and the button calls undo()', async () => {
    const adapter = new MemoryStorageAdapter();
    const historyStack = new HistoryStack();
    const { document: doc } = MihomoYamlDocument.parse('mode: rule\n');
    historyStack.record(doc!, 'test edit', () => doc!.setScalarIn(['mode'], 'direct'));
    expect(historyStack.canUndo).toBe(true);

    render(<ProjectPage client={FAKE_CLIENT} adapter={adapter} historyStack={historyStack} />);
    await screen.findByText(t('project.emptyState'));
    fireEvent.click(screen.getByRole('button', { name: t('project.newButton') }));
    await screen.findByLabelText(t('project.nameLabel'));

    const undoButton = screen.getByRole<HTMLButtonElement>('button', {
      name: t('project.undoButton'),
    });
    expect(undoButton.disabled).toBe(false);

    fireEvent.click(undoButton);

    expect(historyStack.canUndo).toBe(false);
    expect(historyStack.canRedo).toBe(true);
    await waitFor(() => {
      const redoButton = screen.getByRole<HTMLButtonElement>('button', {
        name: t('project.redoButton'),
      });
      expect(redoButton.disabled).toBe(false);
    });
  });

  it('Ctrl+Z triggers undo and Ctrl+Shift+Z triggers redo via the keyboard', async () => {
    const adapter = new MemoryStorageAdapter();
    const historyStack = new HistoryStack();
    const { document: doc } = MihomoYamlDocument.parse('mode: rule\n');
    historyStack.record(doc!, 'test edit', () => doc!.setScalarIn(['mode'], 'direct'));

    render(<ProjectPage client={FAKE_CLIENT} adapter={adapter} historyStack={historyStack} />);
    await screen.findByText(t('project.emptyState'));
    fireEvent.click(screen.getByRole('button', { name: t('project.newButton') }));
    await screen.findByLabelText(t('project.nameLabel'));

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(historyStack.canUndo).toBe(false);
    expect(historyStack.canRedo).toBe(true);

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true, shiftKey: true });
    expect(historyStack.canUndo).toBe(true);
    expect(historyStack.canRedo).toBe(false);
  });

  it('a keyboard shortcut without a document to redo/undo is a no-op, not a crash', async () => {
    const adapter = new MemoryStorageAdapter();
    render(<ProjectPage client={FAKE_CLIENT} adapter={adapter} />);
    await screen.findByText(t('project.emptyState'));

    expect(() => fireEvent.keyDown(window, { key: 'z', ctrlKey: true })).not.toThrow();
  });

  it('a key combo other than Ctrl/Cmd+Z does not touch the history stack', async () => {
    const adapter = new MemoryStorageAdapter();
    const historyStack = new HistoryStack();
    const { document: doc } = MihomoYamlDocument.parse('mode: rule\n');
    historyStack.record(doc!, 'test edit', () => doc!.setScalarIn(['mode'], 'direct'));

    render(<ProjectPage client={FAKE_CLIENT} adapter={adapter} historyStack={historyStack} />);
    await screen.findByText(t('project.emptyState'));

    fireEvent.keyDown(window, { key: 'a', ctrlKey: true });
    fireEvent.keyDown(window, { key: 'z' }); // no modifier key held

    expect(historyStack.canUndo).toBe(true);
    expect(historyStack.canRedo).toBe(false);
  });
});

describe('ProjectPage / diff panel wiring (FR-YAML-06 UI wiring)', () => {
  it('creating a project seeds the import baseline with the default template', async () => {
    const adapter = new MemoryStorageAdapter();
    render(<ProjectPage client={FAKE_CLIENT} adapter={adapter} />);
    await screen.findByText(t('project.emptyState'));

    fireEvent.click(screen.getByRole('button', { name: t('project.newButton') }));
    await screen.findByLabelText(t('project.nameLabel'));
    const id = (await adapter.list('project/'))
      .find((key) => key.endsWith('/manifest.json'))!
      .split('/')[1]!;

    expect(await getImportBaseline(adapter, id)).toBe(DEFAULT_PROJECT_CONFIG_TEXT);
  });

  it('importing resets the import baseline to the newly imported text', async () => {
    const adapter = new MemoryStorageAdapter();
    render(<ProjectPage client={FAKE_CLIENT} adapter={adapter} />);
    await screen.findByText(t('project.emptyState'));
    fireEvent.click(screen.getByRole('button', { name: t('project.newButton') }));
    await screen.findByLabelText(t('project.nameLabel'));
    const id = (await adapter.list('project/'))
      .find((key) => key.endsWith('/manifest.json'))!
      .split('/')[1]!;

    fireEvent.change(screen.getByLabelText(t('import.pasteLabel')), {
      target: { value: 'mode: direct\n' },
    });
    fireEvent.click(screen.getByRole('button', { name: t('import.pasteButton') }));
    await screen.findByText(t('import.successMessage'));

    expect(await getImportBaseline(adapter, id)).toBe('mode: direct\n');
  });

  it('renders the diff panel once a project is selected, wired to the shared client', async () => {
    const adapter = new MemoryStorageAdapter();
    render(<ProjectPage client={FAKE_CLIENT} adapter={adapter} />);
    await screen.findByText(t('project.emptyState'));

    fireEvent.click(screen.getByRole('button', { name: t('project.newButton') }));

    await screen.findByText(t('diff.title'));
  });

  it('falls back to the current config text as the import baseline for a project that predates this tracking', async () => {
    const adapter = new MemoryStorageAdapter();
    // Simulates a project persisted by an earlier release, before
    // saveImportBaseline existed — manifest and config.yaml only.
    const legacy: ProjectRecord = {
      id: 'legacy',
      name: 'Legacy project',
      description: '',
      targetProfile: DEFAULT_TARGET_PROFILE,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    await saveProjectManifest(adapter, legacy);
    await saveProjectConfigText(adapter, legacy.id, 'mode: rule\nport: 1234\n');
    const diffSpy = vi.fn(async (_baseline: string) => ({
      type: 'diff' as const,
      requestId: 'x',
      diff: { hunks: [], added: 0, removed: 0, identical: true, trailingNewlineChanged: false },
    }));

    render(<ProjectPage client={{ ...FAKE_CLIENT, diff: diffSpy }} adapter={adapter} />);
    await screen.findByRole('button', { name: 'Legacy project' });
    fireEvent.click(screen.getByRole('button', { name: 'Legacy project' }));

    await waitFor(() => expect(diffSpy).toHaveBeenCalledWith('mode: rule\nport: 1234\n'));
  });

  it('does not crash and shows an empty editor for a manifest with no corresponding config.yaml', async () => {
    const adapter = new MemoryStorageAdapter();
    // A manifest with no config.yaml at all — a corrupted/incomplete
    // storage state ("should not happen past creation", per
    // getProjectConfigText's own doc comment) rather than a realistic
    // legacy project, but still worth confirming this degrades safely.
    const orphaned: ProjectRecord = {
      id: 'orphaned',
      name: 'Orphaned project',
      description: '',
      targetProfile: DEFAULT_TARGET_PROFILE,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    await saveProjectManifest(adapter, orphaned);

    render(<ProjectPage client={FAKE_CLIENT} adapter={adapter} />);
    await screen.findByRole('button', { name: 'Orphaned project' });

    expect(() =>
      fireEvent.click(screen.getByRole('button', { name: 'Orphaned project' })),
    ).not.toThrow();
    const editorTextarea = await screen.findByLabelText<HTMLTextAreaElement>(t('editor.title'));
    expect(editorTextarea.value).toBe('');
  });
});

describe('ProjectPage / export dialog wiring (FR-PROJ-06 / FR-YAML-07 UI wiring)', () => {
  it('the export button opens the dialog, and its close button closes it', async () => {
    const adapter = new MemoryStorageAdapter();
    render(<ProjectPage client={FAKE_CLIENT} adapter={adapter} />);
    await screen.findByText(t('project.emptyState'));
    fireEvent.click(screen.getByRole('button', { name: t('project.newButton') }));
    await screen.findByLabelText(t('project.nameLabel'));

    expect(screen.queryByText(t('export.title'))).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: t('export.triggerButton') }));
    await screen.findByText(t('export.title'));

    fireEvent.click(screen.getByRole('button', { name: t('export.closeButton') }));
    expect(screen.queryByText(t('export.title'))).toBeNull();
  });
});

/**
 * Mirrors `closed-loop.test.tsx`'s own `FakeWorker` exactly: resolves every
 * message through the real `handleWorkerRequest` (real `MihomoYamlDocument`,
 * real Schema modules resolved via v0.3.0 #14's `RESOLVED_MODULES`) rather
 * than canned responses — needed here because `ModuleFormPage`'s field edits
 * must round-trip through a real document, not just prove component wiring.
 */
class RealWorker implements WorkerLike {
  onmessage: ((event: WorkerMessageEvent) => void) | null = null;
  readonly #state = createWorkerState();

  postMessage(message: WorkerRequest): void {
    const response = handleWorkerRequest(this.#state, message);
    queueMicrotask(() => this.onmessage?.({ data: response }));
  }
}

describe('ProjectPage / module form wiring (FR-SCHEMA-01, PRD §7.4, v0.3.0 #14)', () => {
  async function setUpWithRealDocument(yaml: string) {
    const adapter = new MemoryStorageAdapter();
    const client = new WorkerClient(new RealWorker());
    render(<ProjectPage client={client} adapter={adapter} />);
    await screen.findByText(t('project.emptyState'));

    fireEvent.click(screen.getByRole('button', { name: t('project.newButton') }));
    await screen.findByLabelText(t('project.nameLabel'));
    const editorTextarea = screen.getByLabelText<HTMLTextAreaElement>(t('editor.title'));
    // The default config text loads asynchronously (a separate fetch, see
    // "loads the newly-created project default config text into the editor"
    // above) — must be awaited before overwriting it, otherwise that load
    // can resolve after this edit and clobber it back to the default.
    await waitFor(() => expect(editorTextarea.value).toBe(DEFAULT_PROJECT_CONFIG_TEXT));
    fireEvent.change(editorTextarea, { target: { value: yaml } });

    // Real modules are only known once YamlEditor's own debounced parse
    // resolves and reports the value upward — the same 300ms window every
    // other real-document ProjectPage test in this file waits through.
    await waitFor(
      () => {
        expect(document.querySelector('[data-module-section="general"]')).not.toBeNull();
      },
      { timeout: 2000 },
    );
    return { adapter, editorTextarea };
  }

  it('editing a real field through the form round-trips through the Worker and updates the raw editor', async () => {
    const { editorTextarea } = await setUpWithRealDocument('mode: rule\nport: 7890\n');

    const modeLabel = GENERAL_MODULE.i18n?.['zh-CN']?.['field.mode'];
    if (!modeLabel) throw new Error('GENERAL_MODULE has no zh-CN field.mode label');
    fireEvent.change(screen.getByLabelText(modeLabel), { target: { value: 'global' } });

    await waitFor(() => expect(editorTextarea.value).toContain('mode: global'));
  });

  it('toggling basic -> advanced -> basic never itself edits the document (exit condition 6)', async () => {
    const { editorTextarea } = await setUpWithRealDocument('mode: rule\nport: 7890\n');
    const before = editorTextarea.value;

    fireEvent.change(screen.getByLabelText(t('form.modeLabel')), { target: { value: 'advanced' } });
    await waitFor(() =>
      expect(screen.getByLabelText<HTMLSelectElement>(t('form.modeLabel')).value).toBe('advanced'),
    );
    fireEvent.change(screen.getByLabelText(t('form.modeLabel')), { target: { value: 'basic' } });
    await waitFor(() =>
      expect(screen.getByLabelText<HTMLSelectElement>(t('form.modeLabel')).value).toBe('basic'),
    );

    expect(editorTextarea.value).toBe(before);
  });

  it('an advanced-only field is absent from the DOM in basic mode but its value survives in the document (exit condition 6)', async () => {
    const { editorTextarea } = await setUpWithRealDocument(
      'mode: rule\nport: 7890\ntun:\n  enable: true\n',
    );

    fireEvent.change(screen.getByLabelText(t('form.modeLabel')), { target: { value: 'basic' } });
    await waitFor(() =>
      expect(screen.getByLabelText<HTMLSelectElement>(t('form.modeLabel')).value).toBe('basic'),
    );
    expect(document.querySelector('[data-field="/tun/enable"]')).toBeNull();
    // Never edited via the form in this test — toggling mode alone must not
    // have touched the document.
    expect(editorTextarea.value).toContain('enable: true');

    fireEvent.change(screen.getByLabelText(t('form.modeLabel')), { target: { value: 'advanced' } });
    await waitFor(() => {
      expect(document.querySelector('[data-field="/tun/enable"]')).not.toBeNull();
    });
    expect(editorTextarea.value).toContain('enable: true');
  });
});
