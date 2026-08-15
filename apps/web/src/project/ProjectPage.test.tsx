// @vitest-environment jsdom
import { HistoryStack } from '@mcs/config-model';
import { MemoryStorageAdapter } from '@mcs/storage';
import { MihomoYamlDocument } from '@mcs/yaml-engine';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { YamlEditorWorkerClient } from '../editor/YamlEditor.js';
import { t } from '../i18n/index.js';
import {
  DEFAULT_PROJECT_CONFIG_TEXT,
  DEFAULT_TARGET_PROFILE,
  getProjectConfigText,
} from './model.js';
import { ProjectPage } from './ProjectPage.js';

afterEach(() => {
  cleanup();
});

/** ProjectPage requires a client but most of these tests exercise neither import nor the editor directly. */
const FAKE_CLIENT: YamlEditorWorkerClient = {
  parse: async (_text) => ({ type: 'parse', requestId: 'fake', issues: [] }),
  serialize: async (_options) => ({ type: 'serialize', requestId: 'fake', text: '' }),
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
