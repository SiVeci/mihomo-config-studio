// @vitest-environment jsdom
import { GENERAL_MODULE } from '@mcs/schema-builtin';
import {
  BUILTIN_BUNDLE,
  bundleStoreFrom,
  installBundle,
  installUntrustedBundle,
} from '@mcs/schema-registry';
import { MemoryStorageAdapter } from '@mcs/storage';
import type { StorageAdapter, StorageQuota } from '@mcs/storage';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CURRENT_APP_VERSION, defaultVerifyOptions } from '../bundle/verify-options.js';
import type { DiffPanelWorkerClient } from '../diff/DiffPanel.js';
import { WorkerClient } from '../worker/client.js';
import type { WorkerLike, WorkerMessageEvent } from '../worker/client.js';
import type { YamlEditorWorkerClient } from '../editor/YamlEditor.js';
import { t } from '../i18n/index.js';
import type { ImportWorkerClient } from '../import/ImportPanel.js';
import type { IssuePanelWorkerClient } from '../issues/IssuePanel.js';
import type { RuleListWorkerClient } from '../rules/RuleListPage.js';
import { buildSignedBundle, generateTestKeyPair, minimalModule } from '../testing/signed-bundle.js';
import {
  createWorkerState,
  handleWorkerRequest,
  VALIDATION_DEBOUNCE_MS,
} from '../worker/protocol.js';
import type { WorkerRequest } from '../worker/protocol.js';
import {
  DEFAULT_PROJECT_CONFIG_TEXT,
  DEFAULT_TARGET_PROFILE,
  getImportBaseline,
  getProjectConfigText,
  getProjectDisabledRules,
  getProjectQuarantine,
  getProjectSchemaLock,
  listProjects,
  saveProjectConfigText,
  saveProjectManifest,
  saveProjectSchemaLock,
} from './model.js';
import type { ProjectRecord } from './model.js';
import { ProjectPage } from './ProjectPage.js';
import type { ModuleFormWorkerClient } from './ProjectPage.js';

// jsdom does not implement `scrollIntoView` at all (real browsers do) — the
// same test-environment gap `ModuleFormPage.test.tsx` already stubs around
// for `jumpToField`, hit here too now that a jump can be triggered through
// the real ProjectPage (v0.4.0 #13).
Element.prototype.scrollIntoView = vi.fn();

// FR-AND-07 (v0.6.0 #13): mocked at the `@capacitor/*` package boundary,
// not `../platform/capacitor.js`, so `capacitor.ts`'s real bridging logic
// (base64 decode, retainUntilConsumed-shaped event forwarding) still runs —
// this proves the real chain (native event -> capacitor.ts ->
// incoming-document.ts -> ProjectPage -> ImportPanel) works, not just that
// two mocks were wired to each other. `isNativePlatformMock` defaults to
// `false`, matching the real `Capacitor.isNativePlatform()` result in
// jsdom, so every other test in this file is unaffected unless it opts in.
const { isNativePlatformMock, safFileAddListener } = vi.hoisted(() => ({
  isNativePlatformMock: vi.fn(() => false),
  safFileAddListener: vi.fn(),
}));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => isNativePlatformMock() },
  registerPlugin: () => ({
    openDocument: vi.fn(),
    createDocument: vi.fn(),
    shareText: vi.fn(),
    addListener: safFileAddListener,
  }),
}));
// `addListener` must resolve to a real handle, not the bare `vi.fn()`
// default of `undefined` — `registerBackgroundFlush` (already wired into
// every ProjectPage render since v0.6.0 #8) unconditionally calls
// `onAppStateChange` whenever `isNativePlatform()` is true, and its cleanup
// does `handle.then(...)`; an unresolved `undefined` there throws on
// unmount, which then aborts this file's own `afterEach` mid-body and
// leaks `isNativePlatformMock`'s value into later, unrelated tests.
vi.mock('@capacitor/app', () => ({
  App: { addListener: vi.fn(() => Promise.resolve({ remove: vi.fn() })) },
}));

afterEach(() => {
  try {
    cleanup();
  } finally {
    isNativePlatformMock.mockReturnValue(false);
    safFileAddListener.mockReset();
  }
});

type FakeClient = ImportWorkerClient &
  YamlEditorWorkerClient &
  IssuePanelWorkerClient &
  DiffPanelWorkerClient &
  ModuleFormWorkerClient &
  RuleListWorkerClient;

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
  applyPatch: async (_patch) => ({
    type: 'applyPatch',
    requestId: 'fake',
    canUndo: false,
    canRedo: false,
  }),
  applyBatch: async (_patches) => ({
    type: 'applyBatch',
    requestId: 'fake',
    canUndo: false,
    canRedo: false,
  }),
  analyzeImpact: async (_path) => ({
    type: 'analyzeImpact',
    requestId: 'fake',
    entity: { id: 'fake:0', kind: 'proxy-group', serializedName: 'fake', sourcePath: [] },
    result: { replaceable: [], cascading: [] },
  }),
  graphLayout: async () => ({
    type: 'graphLayout',
    requestId: 'fake',
    layout: { nodes: [], edges: [] },
    entities: [],
    cycles: [],
  }),
  value: async () => ({ type: 'value', requestId: 'fake', value: {} }),
  undo: async () => ({
    type: 'undo',
    requestId: 'fake',
    canUndo: false,
    canRedo: false,
    text: '',
    value: {},
  }),
  redo: async () => ({
    type: 'redo',
    requestId: 'fake',
    canUndo: false,
    canRedo: false,
    text: '',
    value: {},
  }),
  previewProvider: async (_text) => ({ type: 'previewProvider', requestId: 'fake', preview: null }),
  configureModules: async (_modules) => ({
    type: 'configureModules',
    requestId: 'fake',
    toggleableRules: [],
  }),
  configureDisabledRules: async (_ruleIds) => ({
    type: 'configureDisabledRules',
    requestId: 'fake',
  }),
  validate: async () => ({ type: 'validate', requestId: 'fake', issues: [] }),
  explainRule: async (_catalog, _ruleText) => ({
    type: 'explainRule',
    requestId: 'fake',
    explanation: { kind: 'raw' },
  }),
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

describe('ProjectPage / tags and filtering (FR-PROJ-07, v0.9.0 #14)', () => {
  it('editing the tags textarea splits it into one tag per non-blank line, independent of the other fields', async () => {
    const adapter = new MemoryStorageAdapter();
    render(<ProjectPage client={FAKE_CLIENT} adapter={adapter} />);
    await screen.findByText(t('project.emptyState'));
    fireEvent.click(screen.getByRole('button', { name: t('project.newButton') }));
    await screen.findByLabelText(t('project.nameLabel'));

    fireEvent.change(screen.getByLabelText(t('project.tagsLabel')), {
      target: { value: 'home\n\nwork\n' },
    });

    // Blank lines are dropped, same convention as `form-renderer`'s own
    // `TagsControl`. Persistence to storage goes through the same debounced
    // `manifestAutoSaverRef` as name/description/targetProfile (real-clock
    // `touch()`, not a fake timer) — covered at the DOM level here, same as
    // the sibling "editing description and target profile" test above.
    expect(screen.getByLabelText<HTMLTextAreaElement>(t('project.tagsLabel')).value).toBe(
      'home\nwork',
    );
    expect(screen.getByLabelText<HTMLInputElement>(t('project.nameLabel')).value).toBe(
      t('project.untitledName'),
    );
  });

  it('the sidebar search box hides projects whose name does not match, in the real component tree', async () => {
    const adapter = new MemoryStorageAdapter();
    render(<ProjectPage client={FAKE_CLIENT} adapter={adapter} />);
    await screen.findByText(t('project.emptyState'));

    fireEvent.click(screen.getByRole('button', { name: t('project.newButton') }));
    await screen.findByLabelText(t('project.nameLabel'));
    fireEvent.change(screen.getByLabelText(t('project.nameLabel')), {
      target: { value: 'Home Router' },
    });
    fireEvent.click(screen.getByRole('button', { name: t('project.newButton') }));
    await screen.findByLabelText<HTMLInputElement>(t('project.nameLabel'));
    fireEvent.change(screen.getByLabelText(t('project.nameLabel')), {
      target: { value: 'Office VPN' },
    });

    fireEvent.change(screen.getByLabelText(t('projectFilter.searchLabel')), {
      target: { value: 'router' },
    });

    expect(screen.getByRole('button', { name: 'Home Router' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Office VPN' })).toBeNull();
  });

  it('shows a distinct empty state when the filter matches nothing, without claiming there are no projects at all', async () => {
    const adapter = new MemoryStorageAdapter();
    render(<ProjectPage client={FAKE_CLIENT} adapter={adapter} />);
    await screen.findByText(t('project.emptyState'));
    fireEvent.click(screen.getByRole('button', { name: t('project.newButton') }));
    await screen.findByLabelText(t('project.nameLabel'));

    fireEvent.change(screen.getByLabelText(t('projectFilter.searchLabel')), {
      target: { value: 'no such project' },
    });

    expect(screen.getByText(t('projectFilter.noResults'))).toBeDefined();
    expect(screen.queryByText(t('project.emptyState'))).toBeNull();
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

describe('ProjectPage / incoming share intent (FR-AND-07, v0.6.0 #13)', () => {
  it('a document received via the native share sheet imports into the selected project, through the real capacitor.ts -> incoming-document.ts -> ImportPanel chain', async () => {
    isNativePlatformMock.mockReturnValue(true);
    let nativeCallback: ((result: { name: string; contentBase64: string }) => void) | undefined;
    safFileAddListener.mockImplementation((_eventName: string, callback: typeof nativeCallback) => {
      nativeCallback = callback;
      return Promise.resolve({ remove: vi.fn() });
    });
    const adapter = new MemoryStorageAdapter();
    render(<ProjectPage client={FAKE_CLIENT} adapter={adapter} />);
    await screen.findByText(t('project.emptyState'));
    fireEvent.click(screen.getByRole('button', { name: t('project.newButton') }));
    await screen.findByLabelText(t('project.nameLabel'));
    const id = (await adapter.list('project/'))
      .find((key) => key.endsWith('/manifest.json'))!
      .split('/')[1]!;

    expect(nativeCallback).toBeDefined();
    nativeCallback?.({ name: 'shared.yaml', contentBase64: btoa('mode: direct\n') });

    await screen.findByText(t('import.successMessage'));
    const configBytes = await adapter.get(`project/${id}/config.yaml`);
    expect(configBytes ? decoder.decode(configBytes) : null).toBe('mode: direct\n');
  });

  it('does not subscribe to the native event at all on a non-native platform (the jsdom/desktop default)', async () => {
    const adapter = new MemoryStorageAdapter();
    render(<ProjectPage client={FAKE_CLIENT} adapter={adapter} />);
    await screen.findByText(t('project.emptyState'));

    expect(safFileAddListener).not.toHaveBeenCalled();
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
      screen.getByRole('button', {
        name: `${t('issues.severityWarning')}: yaml.syntax.y — ${t('issues.jumpToLineLabel')}`,
      }),
    );

    const editorTextarea = screen.getByLabelText<HTMLTextAreaElement>(t('editor.title'));
    await waitFor(() => {
      expect(editorTextarea.selectionStart).toBe(6);
      expect(editorTextarea.selectionEnd).toBe(10);
    });
  });
});

describe('ProjectPage / rule toggles (FR-VAL-06, v0.9.0 #15)', () => {
  it('unchecking a rule toggle hides its warning immediately (real re-validate, not the next debounced parse) and persists the preference to storage', async () => {
    const adapter = new MemoryStorageAdapter();
    const client = new WorkerClient(new RealWorker());
    render(<ProjectPage client={client} adapter={adapter} />);
    await screen.findByText(t('project.emptyState'));
    fireEvent.click(screen.getByRole('button', { name: t('project.newButton') }));
    const editorTextarea = await screen.findByLabelText<HTMLTextAreaElement>(t('editor.title'));
    // Same wait `setUpSelectedProject` (narrow-screen-layout suite) uses:
    // the real Worker's initial parse is async, and editing before it
    // settles can lose the edit to React re-rendering the controlled
    // textarea back to the still-old `configText` state.
    await waitFor(() => {
      expect(document.querySelector('[data-module-section="general"]')).not.toBeNull();
    });

    // No trailing MATCH rule — real content that reliably triggers
    // ruleOrderStage's `ruleOrder.noMatch` warning (rule-order.ts).
    fireEvent.change(editorTextarea, {
      target: { value: 'mode: rule\nrules:\n  - DOMAIN,a.example.com,DIRECT\n' },
    });
    await screen.findByText(t('ruleOrder.noMatch'));

    const toggle = await screen.findByLabelText<HTMLInputElement>(
      t('ruleOrder.noMatch.description'),
    );
    expect(toggle.checked).toBe(true);

    fireEvent.click(toggle);

    await waitFor(() => expect(screen.queryByText(t('ruleOrder.noMatch'))).toBeNull());
    expect(
      (await screen.findByLabelText<HTMLInputElement>(t('ruleOrder.noMatch.description'))).checked,
    ).toBe(false);

    const id = (await adapter.list('project/'))
      .find((key) => key.endsWith('/manifest.json'))!
      .split('/')[1]!;
    const disabledRules = await getProjectDisabledRules(adapter, id);
    expect(disabledRules.ruleIds).toContain('ruleOrder.noMatch');
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

describe('ProjectPage / undo-redo (FR-PROJ-04, v0.3.0 #15)', () => {
  // Real `WorkerClient` + real `handleWorkerRequest`, matching the "module
  // form wiring" tests below: undo/redo now lives entirely in the Worker's
  // own `HistoryStack` (v0.3.0 #15), so a canned-response fake could not
  // exercise any of this — there would be nothing real to undo.
  async function setUpWithRealDocument(yaml: string) {
    const adapter = new MemoryStorageAdapter();
    const client = new WorkerClient(new RealWorker());
    render(<ProjectPage client={client} adapter={adapter} />);
    await screen.findByText(t('project.emptyState'));

    fireEvent.click(screen.getByRole('button', { name: t('project.newButton') }));
    await screen.findByLabelText(t('project.nameLabel'));
    const editorTextarea = screen.getByLabelText<HTMLTextAreaElement>(t('editor.title'));
    await waitFor(() => expect(editorTextarea.value).toBe(DEFAULT_PROJECT_CONFIG_TEXT));
    fireEvent.change(editorTextarea, { target: { value: yaml } });
    await waitFor(() => {
      expect(document.querySelector('[data-module-section="general"]')).not.toBeNull();
    });
    return { editorTextarea };
  }

  function undoButton(): HTMLButtonElement {
    return screen.getByRole<HTMLButtonElement>('button', { name: t('project.undoButton') });
  }
  function redoButton(): HTMLButtonElement {
    return screen.getByRole<HTMLButtonElement>('button', { name: t('project.redoButton') });
  }

  it('renders Undo and Redo disabled for a freshly parsed document with no edits yet', async () => {
    await setUpWithRealDocument('mode: rule\n');
    expect(undoButton().disabled).toBe(true);
    expect(redoButton().disabled).toBe(true);
  });

  it('a real field edit enables Undo; clicking it restores the export text byte-exact and enables Redo', async () => {
    const { editorTextarea } = await setUpWithRealDocument('mode: rule\n');
    const before = editorTextarea.value;

    const modeLabel = GENERAL_MODULE.i18n?.['zh-CN']?.['field.mode'];
    if (!modeLabel) throw new Error('GENERAL_MODULE has no zh-CN field.mode label');
    fireEvent.change(screen.getByLabelText(modeLabel), { target: { value: 'global' } });
    await waitFor(() => expect(editorTextarea.value).toContain('mode: global'));
    await waitFor(() => expect(undoButton().disabled).toBe(false));

    fireEvent.click(undoButton());

    await waitFor(() => expect(editorTextarea.value).toBe(before));
    expect(undoButton().disabled).toBe(true);
    expect(redoButton().disabled).toBe(false);
  });

  it('Redo restores the edited text byte-exact after an undo', async () => {
    const { editorTextarea } = await setUpWithRealDocument('mode: rule\n');
    const modeLabel = GENERAL_MODULE.i18n?.['zh-CN']?.['field.mode'];
    if (!modeLabel) throw new Error('GENERAL_MODULE has no zh-CN field.mode label');
    fireEvent.change(screen.getByLabelText(modeLabel), { target: { value: 'global' } });
    await waitFor(() => expect(editorTextarea.value).toContain('mode: global'));
    const afterEdit = editorTextarea.value;
    fireEvent.click(undoButton());
    await waitFor(() => expect(redoButton().disabled).toBe(false));

    fireEvent.click(redoButton());

    await waitFor(() => expect(editorTextarea.value).toBe(afterEdit));
    expect(undoButton().disabled).toBe(false);
    expect(redoButton().disabled).toBe(true);
  });

  it('Ctrl+Z triggers undo and Ctrl+Shift+Z triggers redo via the keyboard', async () => {
    const { editorTextarea } = await setUpWithRealDocument('mode: rule\n');
    const before = editorTextarea.value;
    const modeLabel = GENERAL_MODULE.i18n?.['zh-CN']?.['field.mode'];
    if (!modeLabel) throw new Error('GENERAL_MODULE has no zh-CN field.mode label');
    fireEvent.change(screen.getByLabelText(modeLabel), { target: { value: 'global' } });
    await waitFor(() => expect(editorTextarea.value).toContain('mode: global'));
    const afterEdit = editorTextarea.value;

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    await waitFor(() => expect(editorTextarea.value).toBe(before));

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(editorTextarea.value).toBe(afterEdit));
  });

  it('a new edit after undo truncates the redo branch (engine behaviour, reconfirmed through the protocol)', async () => {
    const { editorTextarea } = await setUpWithRealDocument('mode: rule\nport: 7890\n');
    const modeLabel = GENERAL_MODULE.i18n?.['zh-CN']?.['field.mode'];
    if (!modeLabel) throw new Error('GENERAL_MODULE has no zh-CN field.mode label');
    fireEvent.change(screen.getByLabelText(modeLabel), { target: { value: 'global' } });
    await waitFor(() => expect(editorTextarea.value).toContain('mode: global'));
    fireEvent.click(undoButton());
    await waitFor(() => expect(redoButton().disabled).toBe(false));

    fireEvent.change(screen.getByLabelText(modeLabel), { target: { value: 'direct' } });

    await waitFor(() => expect(editorTextarea.value).toContain('mode: direct'));
    expect(redoButton().disabled).toBe(true);
  });

  it('an undo/redo keyboard shortcut with nothing to undo/redo is a no-op, not a crash', async () => {
    await setUpWithRealDocument('mode: rule\n');

    expect(() => fireEvent.keyDown(window, { key: 'z', ctrlKey: true })).not.toThrow();
    expect(() =>
      fireEvent.keyDown(window, { key: 'z', ctrlKey: true, shiftKey: true }),
    ).not.toThrow();
    expect(undoButton().disabled).toBe(true);
    expect(redoButton().disabled).toBe(true);
  });

  it('a key combo other than Ctrl/Cmd+Z does not trigger undo or redo', async () => {
    const { editorTextarea } = await setUpWithRealDocument('mode: rule\n');
    const modeLabel = GENERAL_MODULE.i18n?.['zh-CN']?.['field.mode'];
    if (!modeLabel) throw new Error('GENERAL_MODULE has no zh-CN field.mode label');
    fireEvent.change(screen.getByLabelText(modeLabel), { target: { value: 'global' } });
    await waitFor(() => expect(editorTextarea.value).toContain('mode: global'));
    const afterEdit = editorTextarea.value;

    fireEvent.keyDown(window, { key: 'a', ctrlKey: true });
    fireEvent.keyDown(window, { key: 'z' }); // no modifier key held

    expect(editorTextarea.value).toBe(afterEdit);
    expect(undoButton().disabled).toBe(false);
    expect(redoButton().disabled).toBe(true);
  });

  it('undo still works after waiting past YamlEditor’s own debounce window (regression: a real user, unlike a fast synchronous test, always waits this long)', async () => {
    const { editorTextarea } = await setUpWithRealDocument('mode: rule\n');
    const before = editorTextarea.value;
    const modeLabel = GENERAL_MODULE.i18n?.['zh-CN']?.['field.mode'];
    if (!modeLabel) throw new Error('GENERAL_MODULE has no zh-CN field.mode label');
    fireEvent.change(screen.getByLabelText(modeLabel), { target: { value: 'global' } });
    await waitFor(() => expect(editorTextarea.value).toContain('mode: global'));

    // YamlEditor's own debounced re-parse of this exact (unchanged-since)
    // text fires in here — the earlier undo/redo tests above all click
    // Undo well before this window elapses, which is exactly how the
    // original bug (parse() unconditionally resetting history) stayed
    // invisible to every one of them.
    await new Promise((resolve) => setTimeout(resolve, VALIDATION_DEBOUNCE_MS + 100));

    expect(undoButton().disabled).toBe(false);
    fireEvent.click(undoButton());

    await waitFor(() => expect(editorTextarea.value).toBe(before));
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
      tags: [],
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
      tags: [],
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

/** Same real behavior as `RealWorker`, plus counters for the four document-mutating messages (v0.5.0 #12: read-only must be structural — these must never be *sent*, not merely have their buttons disabled). */
class CountingWorker implements WorkerLike {
  onmessage: ((event: WorkerMessageEvent) => void) | null = null;
  readonly #state = createWorkerState();
  readonly counts: Record<'applyPatch' | 'applyBatch' | 'undo' | 'redo', number> = {
    applyPatch: 0,
    applyBatch: 0,
    undo: 0,
    redo: 0,
  };

  postMessage(message: WorkerRequest): void {
    if (message.type in this.counts) {
      this.counts[message.type as keyof CountingWorker['counts']] += 1;
    }
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

describe('ProjectPage / main view switching (E3, v0.4.0 #7)', () => {
  async function setUpWithRealDocument(yaml: string) {
    const adapter = new MemoryStorageAdapter();
    const client = new WorkerClient(new RealWorker());
    render(<ProjectPage client={client} adapter={adapter} />);
    await screen.findByText(t('project.emptyState'));

    fireEvent.click(screen.getByRole('button', { name: t('project.newButton') }));
    await screen.findByLabelText(t('project.nameLabel'));
    const editorTextarea = screen.getByLabelText<HTMLTextAreaElement>(t('editor.title'));
    await waitFor(() => expect(editorTextarea.value).toBe(DEFAULT_PROJECT_CONFIG_TEXT));
    fireEvent.change(editorTextarea, { target: { value: yaml } });
    await waitFor(
      () => {
        expect(document.querySelector('[data-module-section="general"]')).not.toBeNull();
      },
      { timeout: 2000 },
    );
    return { adapter, editorTextarea };
  }

  it('defaults to the form view, with the rules view not mounted at all', async () => {
    await setUpWithRealDocument('mode: rule\nrules:\n  - MATCH,DIRECT\n');

    expect(document.querySelector('[data-module-section="general"]')).not.toBeNull();
    expect(screen.queryByRole('grid', { name: t('ruleList.label') })).toBeNull();

    const formTab = screen.getByRole('tab', { name: t('project.formViewTab') });
    const rulesTab = screen.getByRole('tab', { name: t('project.rulesViewTab') });
    expect(formTab.getAttribute('aria-selected')).toBe('true');
    expect(rulesTab.getAttribute('aria-selected')).toBe('false');
  });

  it('clicking the rules tab shows the real rules from the document and lazily unmounts the form (E3)', async () => {
    await setUpWithRealDocument(
      ['mode: rule', 'rules:', '  - DOMAIN-SUFFIX,example.com,DIRECT', '  - MATCH,PROXY'].join(
        '\n',
      ),
    );

    fireEvent.click(screen.getByRole('tab', { name: t('project.rulesViewTab') }));

    const grid = await screen.findByRole('grid', { name: t('ruleList.label') });
    expect(grid.getAttribute('aria-rowcount')).toBe('2');
    const rows = screen.getAllByRole('row');
    expect(rows[0]?.textContent).toContain('DOMAIN-SUFFIX,example.com,DIRECT');
    expect(rows[1]?.textContent).toContain('MATCH,PROXY');

    // Lazy-mounted (E3): switching away unmounts the form view's own DOM,
    // not just hides it.
    expect(document.querySelector('[data-module-section="general"]')).toBeNull();

    const formTab = screen.getByRole('tab', { name: t('project.formViewTab') });
    const rulesTab = screen.getByRole('tab', { name: t('project.rulesViewTab') });
    expect(rulesTab.getAttribute('aria-selected')).toBe('true');
    expect(formTab.getAttribute('aria-selected')).toBe('false');
  });

  it('switching back to the form view remounts it and unmounts the rules view', async () => {
    await setUpWithRealDocument('mode: rule\nrules:\n  - MATCH,DIRECT\n');

    fireEvent.click(screen.getByRole('tab', { name: t('project.rulesViewTab') }));
    await screen.findByRole('grid', { name: t('ruleList.label') });

    fireEvent.click(screen.getByRole('tab', { name: t('project.formViewTab') }));
    await waitFor(() => {
      expect(document.querySelector('[data-module-section="general"]')).not.toBeNull();
    });
    expect(screen.queryByRole('grid', { name: t('ruleList.label') })).toBeNull();
  });

  it('clicking the graph tab shows the real relationship graph, built through the real Worker, and unmounts the form (v0.4.0 #13)', async () => {
    await setUpWithRealDocument(
      [
        'mode: rule',
        'proxy-groups:',
        '  - name: AUTO',
        '    type: url-test',
        '    proxies: [DIRECT]',
        'rules:',
        '  - MATCH,AUTO',
        '',
      ].join('\n'),
    );

    fireEvent.click(screen.getByRole('tab', { name: t('project.graphViewTab') }));

    const svg = await screen.findByRole('img', { name: t('graph.svgLabel') });
    expect(svg.tagName.toLowerCase()).toBe('svg');
    expect(document.querySelectorAll('.graph-view__node').length).toBeGreaterThan(0);
    expect(document.querySelector('[data-module-section="general"]')).toBeNull();
  });

  it('jumping to a field from the issues panel while on a different view switches back to the form and focuses the field (bug fix, v0.4.0 #13)', async () => {
    await setUpWithRealDocument(
      'mode: rule\nport: 7890\nsocks-port: 7890\nrules:\n  - MATCH,DIRECT\n',
    );

    fireEvent.click(screen.getByRole('tab', { name: t('project.rulesViewTab') }));
    await screen.findByRole('grid', { name: t('ruleList.label') });
    expect(document.querySelector('[data-module-section="general"]')).toBeNull();

    // Validation is debounced (NFR-PERF-03) — the port-conflict issues this
    // fixture triggers do not appear in the aside immediately after render.
    // `getByRole`'s own `name` option has no `exact` flag (unlike
    // `getByText`) — a plain string is always an exact match against the
    // whole accessible name, so a regexp is what actually gets a substring
    // match against the fuller "<severity>: <message> — 跳到表单字段" label.
    const jumpButtons = await screen.findAllByRole('button', {
      name: new RegExp(t('issues.jumpToFieldLabel')),
    });
    fireEvent.click(jumpButtons[0]!);

    await waitFor(() => {
      expect(document.querySelector('[data-module-section="general"]')).not.toBeNull();
    });
    expect(screen.queryByRole('grid', { name: t('ruleList.label') })).toBeNull();
    await waitFor(() => {
      const field = document.activeElement?.closest('[data-field]');
      expect(field?.getAttribute('data-field')).toMatch(/^\/(port|socks-port)$/);
    });
  });

  it('ArrowRight/ArrowLeft on the tablist moves focus and switches the active view in one step (PRD §11.6)', async () => {
    await setUpWithRealDocument('mode: rule\nrules:\n  - MATCH,DIRECT\n');

    const formTab = screen.getByRole('tab', { name: t('project.formViewTab') });
    const rulesTab = screen.getByRole('tab', { name: t('project.rulesViewTab') });
    formTab.focus();

    fireEvent.keyDown(formTab, { key: 'ArrowRight' });
    await screen.findByRole('grid', { name: t('ruleList.label') });
    expect(rulesTab.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(rulesTab);

    fireEvent.keyDown(rulesTab, { key: 'ArrowLeft' });
    await waitFor(() => expect(formTab.getAttribute('aria-selected')).toBe('true'));
    expect(document.activeElement).toBe(formTab);
  });

  it('wraps from the last tab back to the first on ArrowRight', async () => {
    await setUpWithRealDocument('mode: rule\nrules:\n  - MATCH,DIRECT\n');

    const formTab = screen.getByRole('tab', { name: t('project.formViewTab') });
    const graphTab = screen.getByRole('tab', { name: t('project.graphViewTab') });
    graphTab.focus();

    fireEvent.keyDown(graphTab, { key: 'ArrowRight' });
    await waitFor(() => expect(formTab.getAttribute('aria-selected')).toBe('true'));
    expect(document.activeElement).toBe(formTab);
  });

  it('a key other than ArrowLeft/ArrowRight does not switch views', async () => {
    await setUpWithRealDocument('mode: rule\nrules:\n  - MATCH,DIRECT\n');

    const formTab = screen.getByRole('tab', { name: t('project.formViewTab') });
    fireEvent.keyDown(formTab, { key: 'Enter' });

    expect(formTab.getAttribute('aria-selected')).toBe('true');
    expect(document.querySelector('[data-module-section="general"]')).not.toBeNull();
  });
});

describe('ProjectPage / narrow-screen layout (PRD §7.3, v0.6.0 #6)', () => {
  async function setUpSelectedProject() {
    const adapter = new MemoryStorageAdapter();
    const client = new WorkerClient(new RealWorker());
    render(<ProjectPage client={client} adapter={adapter} />);
    await screen.findByText(t('project.emptyState'));

    fireEvent.click(screen.getByRole('button', { name: t('project.newButton') }));
    await screen.findByLabelText(t('project.nameLabel'));
    const editorTextarea = screen.getByLabelText<HTMLTextAreaElement>(t('editor.title'));
    await waitFor(() => expect(editorTextarea.value).toBe(DEFAULT_PROJECT_CONFIG_TEXT));
    // Same wait `setUpWithRealDocument` (main-view-switching suite) uses:
    // the real Worker's parse is async, and interacting before it settles
    // (e.g. a bottom-nav click that reads `documentValue`) can race a
    // `NO_DOCUMENT` rejection out of the Worker.
    await waitFor(() => {
      expect(document.querySelector('[data-module-section="general"]')).not.toBeNull();
    });
    return { adapter, editorTextarea };
  }

  it('StatusBar shows the selected project’s name and target profile', async () => {
    await setUpSelectedProject();

    // Scoped to `.status-bar`: the sidebar's own project-list item (always
    // mounted, `ProjectPage.tsx`'s `project-sidebar__item` button) renders
    // the same project name text, so an unscoped `getByText` is ambiguous.
    const statusBar = within(document.querySelector('.status-bar') as HTMLElement);
    expect(statusBar.getByText(t('project.untitledName'))).toBeDefined();
    expect(statusBar.getByText(DEFAULT_TARGET_PROFILE)).toBeDefined();
  });

  it('StatusBar shows pending right after an edit — a display-only mirror of the AutoSaver window, not a new persistence timer', async () => {
    await setUpSelectedProject();
    expect(screen.getByText(t('statusBar.saved'))).toBeDefined();

    const editorTextarea = screen.getByLabelText<HTMLTextAreaElement>(t('editor.title'));
    fireEvent.change(editorTextarea, { target: { value: 'mode: rule\nport: 7891\n' } });

    await waitFor(() => expect(screen.getByText(t('statusBar.pending'))).toBeDefined());
  });

  it('clicking StatusBar’s back button deselects the project — the only way back to the project list once AppShell hides the sidebar narrow (v0.6.0 #6 usability fix, PRD §7.3)', async () => {
    await setUpSelectedProject();

    fireEvent.click(screen.getByRole('button', { name: t('statusBar.backButton') }));

    expect(await screen.findByText(t('project.noSelection'))).toBeDefined();
    expect(screen.queryByRole('group', { name: t('statusBar.label') })).toBeNull();
  });

  it('BottomNav defaults to 配置 active, matching the tablist’s own default (form view)', async () => {
    await setUpSelectedProject();

    expect(
      screen.getByRole('button', { name: t('bottomNav.configTab') }).getAttribute('aria-current'),
    ).toBe('page');
    expect(
      screen.getByRole('button', { name: t('bottomNav.graphTab') }).getAttribute('aria-current'),
    ).toBeNull();
  });

  it('clicking 关系 in BottomNav switches the existing tablist to the graph view', async () => {
    await setUpSelectedProject();

    fireEvent.click(screen.getByRole('button', { name: t('bottomNav.graphTab') }));

    await waitFor(() =>
      expect(
        screen.getByRole('tab', { name: t('project.graphViewTab') }).getAttribute('aria-selected'),
      ).toBe('true'),
    );
    expect(
      screen.getByRole('button', { name: t('bottomNav.graphTab') }).getAttribute('aria-current'),
    ).toBe('page');
  });

  it('clicking 配置 after 关系 switches back to the form view — real-device regression (v0.6.0 #8): the tap was a silent no-op when mainView was never reset, only found by an actual tap doing nothing on an emulator', async () => {
    await setUpSelectedProject();
    fireEvent.click(screen.getByRole('button', { name: t('bottomNav.graphTab') }));
    await waitFor(() =>
      expect(
        screen.getByRole('tab', { name: t('project.graphViewTab') }).getAttribute('aria-selected'),
      ).toBe('true'),
    );

    fireEvent.click(screen.getByRole('button', { name: t('bottomNav.configTab') }));

    await waitFor(() =>
      expect(
        screen.getByRole('tab', { name: t('project.formViewTab') }).getAttribute('aria-selected'),
      ).toBe('true'),
    );
    expect(
      screen.getByRole('button', { name: t('bottomNav.configTab') }).getAttribute('aria-current'),
    ).toBe('page');
    expect(
      screen.getByRole('button', { name: t('bottomNav.graphTab') }).getAttribute('aria-current'),
    ).toBeNull();
  });

  it('clicking 问题 in BottomNav mounts the issue panel only on a narrow viewport (jsdom has no matchMedia by default, so this needs it mocked)', async () => {
    (window as unknown as { matchMedia: (query: string) => object }).matchMedia = (
      query: string,
    ) => ({
      matches: true,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    });
    try {
      await setUpSelectedProject();
      // One match already exists — the desktop `aside` copy, always
      // rendered (CSS decides whether it is *shown*, not whether it
      // mounts). The mobile "问题" page only mounts its own duplicate once
      // navigated to (see `useNarrowViewport` gating it in `ProjectPage`).
      expect(screen.getAllByRole('region', { name: t('issues.title') })).toHaveLength(1);

      fireEvent.click(screen.getByRole('button', { name: t('bottomNav.issuesTab') }));

      await waitFor(() =>
        expect(screen.getAllByRole('region', { name: t('issues.title') })).toHaveLength(2),
      );
    } finally {
      Reflect.deleteProperty(window, 'matchMedia');
    }
  });
});

describe('ProjectPage / rule editor wiring (v0.4.0 #8, FR-RULE-01/05)', () => {
  async function setUpWithRealDocument(yaml: string) {
    const adapter = new MemoryStorageAdapter();
    const client = new WorkerClient(new RealWorker());
    render(<ProjectPage client={client} adapter={adapter} />);
    await screen.findByText(t('project.emptyState'));

    fireEvent.click(screen.getByRole('button', { name: t('project.newButton') }));
    await screen.findByLabelText(t('project.nameLabel'));
    const editorTextarea = screen.getByLabelText<HTMLTextAreaElement>(t('editor.title'));
    await waitFor(() => expect(editorTextarea.value).toBe(DEFAULT_PROJECT_CONFIG_TEXT));
    fireEvent.change(editorTextarea, { target: { value: yaml } });
    await waitFor(
      () => {
        expect(document.querySelector('[data-module-section="general"]')).not.toBeNull();
      },
      { timeout: 2000 },
    );
    fireEvent.click(screen.getByRole('tab', { name: t('project.rulesViewTab') }));
    await screen.findByRole('button', { name: t('ruleList.addButton') });
    return { editorTextarea };
  }

  it('creating a rule through the dialog round-trips through the real Worker into the raw YAML text', async () => {
    const { editorTextarea } = await setUpWithRealDocument(
      'mode: rule\nrules:\n  - MATCH,DIRECT\n',
    );

    fireEvent.click(screen.getByRole('button', { name: t('ruleList.addButton') }));
    // The real catalog's default-selected (first) entry is not
    // DOMAIN-SUFFIX — select it explicitly rather than relying on catalog
    // order, the same way a real user picks a type from the dropdown.
    fireEvent.change(screen.getByLabelText(t('ruleEditor.typeLabel')), {
      target: { value: 'DOMAIN-SUFFIX' },
    });
    fireEvent.change(screen.getByLabelText(t('ruleEditor.payloadLabel')), {
      target: { value: 'example.com' },
    });
    fireEvent.change(screen.getByLabelText(t('ruleEditor.targetLabel')), {
      target: { value: 'PROXY' },
    });
    fireEvent.click(screen.getByRole('button', { name: t('ruleEditor.saveButton') }));

    await waitFor(() => {
      expect(editorTextarea.value).toContain('DOMAIN-SUFFIX,example.com,PROXY');
    });
    // The dialog closes and the new row is visible with its real sequence number.
    expect(screen.queryByRole('dialog')).toBeNull();
    const rows = screen.getAllByRole('row');
    expect(rows[rows.length - 1]?.textContent).toContain('DOMAIN-SUFFIX,example.com,PROXY');
  });

  it('creating the first rule when rules: is absent writes a new one-item array through the real Worker', async () => {
    const { editorTextarea } = await setUpWithRealDocument('mode: rule\n');

    fireEvent.click(screen.getByRole('button', { name: t('ruleList.addButton') }));
    fireEvent.change(screen.getByLabelText(t('ruleEditor.typeLabel')), {
      target: { value: 'MATCH' },
    });
    fireEvent.change(screen.getByLabelText(t('ruleEditor.targetLabel')), {
      target: { value: 'DIRECT' },
    });
    fireEvent.click(screen.getByRole('button', { name: t('ruleEditor.saveButton') }));

    await waitFor(() => {
      expect(editorTextarea.value).toContain('MATCH,DIRECT');
    });
  });

  it('editing an existing rule through the dialog replaces that line, byte-exact, through the real Worker', async () => {
    const { editorTextarea } = await setUpWithRealDocument(
      ['mode: rule', 'rules:', '  - DOMAIN-SUFFIX,old.example.com,DIRECT', '  - MATCH,PROXY'].join(
        '\n',
      ),
    );

    fireEvent.click(screen.getByRole('button', { name: t('ruleList.editButton', { index: 1 }) }));
    fireEvent.change(screen.getByLabelText(t('ruleEditor.payloadLabel')), {
      target: { value: 'new.example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: t('ruleEditor.saveButton') }));

    await waitFor(() => {
      expect(editorTextarea.value).toContain('DOMAIN-SUFFIX,new.example.com,DIRECT');
    });
    expect(editorTextarea.value).not.toContain('old.example.com');
    expect(editorTextarea.value).toContain('MATCH,PROXY');
  });
});

describe('ProjectPage / drag and keyboard reorder (v0.4.0 #9, FR-RULE-02, NFR-A11Y)', () => {
  const REORDER_YAML = ['mode: rule', 'rules:', '  - MATCH,A', '  - MATCH,B', '  - MATCH,C'].join(
    '\n',
  );

  async function setUpOnRulesTab(yaml: string) {
    const adapter = new MemoryStorageAdapter();
    const client = new WorkerClient(new RealWorker());
    render(<ProjectPage client={client} adapter={adapter} />);
    await screen.findByText(t('project.emptyState'));

    fireEvent.click(screen.getByRole('button', { name: t('project.newButton') }));
    await screen.findByLabelText(t('project.nameLabel'));
    const editorTextarea = screen.getByLabelText<HTMLTextAreaElement>(t('editor.title'));
    await waitFor(() => expect(editorTextarea.value).toBe(DEFAULT_PROJECT_CONFIG_TEXT));
    fireEvent.change(editorTextarea, { target: { value: yaml } });
    fireEvent.click(await screen.findByRole('tab', { name: t('project.rulesViewTab') }));
    await screen.findByRole('grid', { name: t('ruleList.label') });
    return { editorTextarea };
  }

  it('keyboard and drag reorder produce byte-identical document text for the same move', async () => {
    const { editorTextarea: keyboardEditor } = await setUpOnRulesTab(REORDER_YAML);
    fireEvent.click(screen.getAllByRole('row')[0] as HTMLElement);
    fireEvent.keyDown(screen.getByRole('grid'), { key: 'End', altKey: true });
    await waitFor(() => {
      expect(keyboardEditor.value).toContain('MATCH,B\n  - MATCH,C\n  - MATCH,A');
    });
    const keyboardResultText = keyboardEditor.value;
    cleanup();

    const { editorTextarea: dragEditor } = await setUpOnRulesTab(REORDER_YAML);
    const rows = screen.getAllByRole('row');
    const dataTransfer = { effectAllowed: '' };
    fireEvent.dragStart(rows[0] as HTMLElement, { dataTransfer });
    fireEvent.dragOver(rows[2] as HTMLElement, { dataTransfer });
    fireEvent.drop(rows[2] as HTMLElement, { dataTransfer });
    await waitFor(() => {
      expect(dragEditor.value).toContain('MATCH,B\n  - MATCH,C\n  - MATCH,A');
    });

    expect(dragEditor.value).toBe(keyboardResultText);
  });

  it('a completed keyboard move is announced through the aria-live region in the real app', async () => {
    await setUpOnRulesTab(REORDER_YAML);
    fireEvent.click(screen.getAllByRole('row')[0] as HTMLElement);
    fireEvent.keyDown(screen.getByRole('grid'), { key: 'ArrowDown', altKey: true });

    const status = await screen.findByRole('status');
    await waitFor(() => {
      expect(status.textContent).toBe(t('ruleList.movedAnnouncement', { index: 2 }));
    });
  });
});

describe('ProjectPage / batch actions (v0.4.0 #10, FR-RULE-03, ADR-023, exit condition 4)', () => {
  const BATCH_YAML = [
    'mode: rule',
    'rules:',
    '  - DOMAIN-SUFFIX,a.com,DIRECT',
    '  - DOMAIN-SUFFIX,b.com,DIRECT',
    '  - DOMAIN-SUFFIX,c.com,DIRECT',
  ].join('\n');

  async function setUpOnRulesTab(yaml: string) {
    const adapter = new MemoryStorageAdapter();
    const client = new WorkerClient(new RealWorker());
    render(<ProjectPage client={client} adapter={adapter} />);
    await screen.findByText(t('project.emptyState'));

    fireEvent.click(screen.getByRole('button', { name: t('project.newButton') }));
    await screen.findByLabelText(t('project.nameLabel'));
    const editorTextarea = screen.getByLabelText<HTMLTextAreaElement>(t('editor.title'));
    await waitFor(() => expect(editorTextarea.value).toBe(DEFAULT_PROJECT_CONFIG_TEXT));
    fireEvent.change(editorTextarea, { target: { value: yaml } });
    fireEvent.click(await screen.findByRole('tab', { name: t('project.rulesViewTab') }));
    await screen.findByRole('grid', { name: t('ruleList.label') });
    return { editorTextarea };
  }

  it('selecting 3 rules, batch-replacing their target, one undo restores the pre-batch text byte-exact, and redo reapplies it byte-exact', async () => {
    const { editorTextarea } = await setUpOnRulesTab(BATCH_YAML);
    const beforeText = editorTextarea.value;

    fireEvent.click(
      screen.getByRole('checkbox', { name: t('ruleList.batchCheckboxLabel', { index: 1 }) }),
    );
    fireEvent.click(
      screen.getByRole('checkbox', { name: t('ruleList.batchCheckboxLabel', { index: 2 }) }),
    );
    fireEvent.click(
      screen.getByRole('checkbox', { name: t('ruleList.batchCheckboxLabel', { index: 3 }) }),
    );
    fireEvent.change(screen.getByLabelText(t('ruleList.batchReplaceTargetLabel')), {
      target: { value: 'PROXY' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: t('ruleList.batchReplaceTargetApplyButton') }),
    );

    await waitFor(() => {
      expect(editorTextarea.value).toContain('DOMAIN-SUFFIX,a.com,PROXY');
    });
    const afterText = editorTextarea.value;
    expect(afterText).toContain('DOMAIN-SUFFIX,b.com,PROXY');
    expect(afterText).toContain('DOMAIN-SUFFIX,c.com,PROXY');
    expect(afterText).not.toBe(beforeText);

    // One undo — not three — reverts the whole batch.
    fireEvent.click(screen.getByRole('button', { name: t('project.undoButton') }));
    await waitFor(() => {
      expect(editorTextarea.value).toBe(beforeText);
    });

    fireEvent.click(screen.getByRole('button', { name: t('project.redoButton') }));
    await waitFor(() => {
      expect(editorTextarea.value).toBe(afterText);
    });
  });

  it('batch-deleting 2 of 3 rows through the real UI removes both in one step, and one undo restores all three byte-exact', async () => {
    const { editorTextarea } = await setUpOnRulesTab(BATCH_YAML);
    const beforeText = editorTextarea.value;

    fireEvent.click(
      screen.getByRole('checkbox', { name: t('ruleList.batchCheckboxLabel', { index: 1 }) }),
    );
    fireEvent.click(
      screen.getByRole('checkbox', { name: t('ruleList.batchCheckboxLabel', { index: 3 }) }),
    );
    fireEvent.click(screen.getByRole('button', { name: t('ruleList.batchDeleteButton') }));

    await waitFor(() => {
      expect(editorTextarea.value).not.toContain('a.com');
    });
    expect(editorTextarea.value).not.toContain('c.com');
    expect(editorTextarea.value).toContain('b.com');

    fireEvent.click(screen.getByRole('button', { name: t('project.undoButton') }));
    await waitFor(() => {
      expect(editorTextarea.value).toBe(beforeText);
    });
  });
});

describe('ProjectPage / delete impact analysis (v0.4.0 #11, FR-REL-03 UI, exit condition 5)', () => {
  const IMPACT_YAML = [
    'mode: rule',
    'proxy-groups:',
    '  - name: AUTO',
    '    type: url-test',
    '    proxies: [DIRECT]',
    '  - name: PROXY',
    '    type: select',
    '    proxies: [AUTO, DIRECT]',
    '  - name: UNUSED',
    '    type: select',
    '    proxies: [DIRECT]',
    '  - name: SOLO',
    '    type: select',
    '    proxies: [AUTO]',
  ].join('\n');

  async function setUpOnFormView(yaml: string) {
    const adapter = new MemoryStorageAdapter();
    const client = new WorkerClient(new RealWorker());
    render(<ProjectPage client={client} adapter={adapter} />);
    await screen.findByText(t('project.emptyState'));

    fireEvent.click(screen.getByRole('button', { name: t('project.newButton') }));
    await screen.findByLabelText(t('project.nameLabel'));
    const editorTextarea = screen.getByLabelText<HTMLTextAreaElement>(t('editor.title'));
    await waitFor(() => expect(editorTextarea.value).toBe(DEFAULT_PROJECT_CONFIG_TEXT));
    fireEvent.change(editorTextarea, { target: { value: yaml } });
    await waitFor(() => {
      expect(document.querySelector('[data-module-section="proxy-groups"]')).not.toBeNull();
    });
    return { editorTextarea };
  }

  function deleteButtonFor(groupName: string): HTMLElement {
    const section = document.querySelector('[data-module-section="proxy-groups"]') as HTMLElement;
    const fieldsets = Array.from(section.querySelectorAll('[data-array-index]'));
    // The group's name lives in an <input>'s `value`, not in textContent —
    // an <input> exposes no text children at all.
    const fieldset = fieldsets.find((el) => {
      const nameField = el.querySelector('[data-field$="/name"] input') as HTMLInputElement | null;
      return nameField?.value === groupName;
    }) as HTMLElement;
    return within(fieldset).getByRole('button', { name: t('arrayForm.deleteEntryButton') });
  }

  it('deletes an unreferenced entity directly, with no dialog', async () => {
    const { editorTextarea } = await setUpOnFormView(IMPACT_YAML);

    fireEvent.click(deleteButtonFor('UNUSED'));

    await waitFor(() => {
      expect(editorTextarea.value).not.toContain('UNUSED');
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens the replace exit for a referenced entity with no cascading owner, and rewrites the reference through the real Worker', async () => {
    const { editorTextarea } = await setUpOnFormView(IMPACT_YAML);
    // Remove SOLO first so AUTO has no cascading owner, isolating the replace path.
    fireEvent.click(deleteButtonFor('SOLO'));
    await waitFor(() => expect(editorTextarea.value).not.toContain('SOLO'));

    fireEvent.click(deleteButtonFor('AUTO'));
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).queryByRole('button', { name: t('deleteImpact.confirmCascadeButton') }),
    ).toBeNull();

    fireEvent.change(within(dialog).getByLabelText(t('deleteImpact.targetLabel')), {
      target: { value: 'DIRECT' },
    });
    fireEvent.click(
      within(dialog).getByRole('button', { name: t('deleteImpact.confirmReplaceButton') }),
    );

    await waitFor(() => {
      expect(editorTextarea.value).not.toContain('name: AUTO');
    });
    // AUTO (and its own `proxies: [DIRECT]`) is gone entirely; UNUSED still
    // has one DIRECT, and PROXY's `[AUTO, DIRECT]` becomes `[DIRECT, DIRECT]`
    // once AUTO is replaced — three DIRECT occurrences total. Checked by
    // count rather than exact array formatting (flow vs. block), which this
    // app's AST-mode serialisation is free to choose once any structural
    // edit has happened (this test already made one, deleting SOLO, before
    // ever reaching this assertion).
    expect(editorTextarea.value.match(/DIRECT/g)).toHaveLength(3);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens the cascade exit when deleting would leave an owner empty, and deletes both through one applyBatch', async () => {
    const { editorTextarea } = await setUpOnFormView(IMPACT_YAML);
    // Remove PROXY's other member first so deleting AUTO would leave SOLO as
    // the only thing left referencing it (PROXY itself still references
    // AUTO too, but keeps DIRECT — this isolates SOLO as the sole cascade).
    fireEvent.click(deleteButtonFor('AUTO'));
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByRole('button', { name: t('deleteImpact.confirmCascadeButton') }),
    ).not.toBeNull();
    expect(within(dialog).getByText('SOLO')).not.toBeNull();

    fireEvent.click(
      within(dialog).getByRole('button', { name: t('deleteImpact.confirmCascadeButton') }),
    );

    await waitFor(() => {
      expect(editorTextarea.value).not.toContain('name: AUTO');
    });
    expect(editorTextarea.value).not.toContain('name: SOLO');
    expect(editorTextarea.value).toContain('name: PROXY');
    expect(screen.queryByRole('dialog')).toBeNull();

    // One undo reverts the whole cascade (entity + cascading owner + the
    // dangling reference cleanup) in a single step (ADR-023).
    fireEvent.click(screen.getByRole('button', { name: t('project.undoButton') }));
    await waitFor(() => {
      expect(editorTextarea.value).toContain('name: AUTO');
    });
    expect(editorTextarea.value).toContain('name: SOLO');
  });

  it('cancelling the dialog leaves the document untouched', async () => {
    const { editorTextarea } = await setUpOnFormView(IMPACT_YAML);
    const beforeText = editorTextarea.value;

    fireEvent.click(deleteButtonFor('AUTO'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: t('deleteImpact.cancelButton') }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(editorTextarea.value).toBe(beforeText);
  });
});

describe('ProjectPage / schema-lock (ADR-004, v0.5.0 #11, decision F14/F15)', () => {
  it('creating a project persists a real schema-lock pointing at the currently active bundle, not the old "none" placeholder', async () => {
    const adapter = new MemoryStorageAdapter();
    const client = new WorkerClient(new RealWorker());
    render(<ProjectPage client={client} adapter={adapter} />);
    await screen.findByText(t('project.emptyState'));

    fireEvent.click(screen.getByRole('button', { name: t('project.newButton') }));
    await screen.findByLabelText(t('project.nameLabel'));

    const [record] = await listProjects(adapter);
    if (!record) throw new Error('project was not persisted');
    await waitFor(async () => {
      expect(await getProjectSchemaLock(adapter, record.id)).toEqual({
        bundleVersion: BUILTIN_BUNDLE.manifest.version,
        compatibilityProfile: BUILTIN_BUNDLE.manifest.mihomo.minVersion,
      });
    });
  });

  it('installing a newer Bundle leaves an existing, un-upgraded project’s config text and validation issues byte-for-byte and issue-for-issue unchanged after reopening it (exit condition 3)', async () => {
    const adapter = new MemoryStorageAdapter();
    const store = bundleStoreFrom(adapter);
    const keyPair = await generateTestKeyPair();
    const trustedPublicKeys = [keyPair.publicKeyRaw];
    const options = await defaultVerifyOptions(trustedPublicKeys);

    // v1 has both `general` and `rules` modules — same as the real built-in
    // bundle, `rules` claims its root but does not validate each list item's
    // shape, so a `rules:` entry is flagged `unknown-field` (the same signal
    // `protocol.test.ts` already relies on for the real built-in bundle).
    const v1 = await buildSignedBundle({
      keyPair,
      bundleId: 'v1',
      version: '1.0.0',
      modules: new Map([
        ['general', minimalModule('general')],
        ['rules', minimalModule('rules')],
      ]),
    });
    expect((await installBundle(store, v1.manifest, v1.files, options)).ok).toBe(true);

    const client = new WorkerClient(new RealWorker());
    const { unmount } = render(
      <ProjectPage client={client} adapter={adapter} trustedPublicKeys={trustedPublicKeys} />,
    );
    await screen.findByText(t('project.emptyState'));
    fireEvent.click(screen.getByRole('button', { name: t('project.newButton') }));
    await screen.findByLabelText(t('project.nameLabel'));
    const editorTextarea = screen.getByLabelText<HTMLTextAreaElement>(t('editor.title'));
    await waitFor(() => expect(editorTextarea.value).toBe(DEFAULT_PROJECT_CONFIG_TEXT));

    const yaml = 'mode: rule\nrules:\n  - DOMAIN,example.com,DIRECT\n';
    fireEvent.change(editorTextarea, { target: { value: yaml } });
    await waitFor(
      () => {
        expect(document.querySelector('[data-module-section="general"]')).not.toBeNull();
      },
      { timeout: 2000 },
    );
    const issuesRegion = screen.getByRole('region', { name: t('issues.title') });
    await waitFor(() => expect(issuesRegion.textContent).toContain('unknown-field'));
    const beforeConfigText = editorTextarea.value;
    const beforeIssuesText = issuesRegion.textContent;

    // v2 deliberately drops the `rules` module — if the still-open project
    // ever picked this up, the `unknown-field` issue above would vanish.
    const v2 = await buildSignedBundle({
      keyPair,
      bundleId: 'v2',
      version: '2.0.0',
      modules: new Map([['general', minimalModule('general')]]),
    });
    expect((await installBundle(store, v2.manifest, v2.files, options)).ok).toBe(true);

    // Simulate leaving the project (e.g. to the Bundle page) and coming back:
    // unmount entirely and remount with a *fresh* Worker, so a stale
    // in-memory `WorkerState` cannot accidentally make this pass.
    unmount();
    const freshClient = new WorkerClient(new RealWorker());
    render(
      <ProjectPage client={freshClient} adapter={adapter} trustedPublicKeys={trustedPublicKeys} />,
    );
    fireEvent.click(await screen.findByRole('button', { name: t('project.untitledName') }));
    const reopenedTextarea = await screen.findByLabelText<HTMLTextAreaElement>(t('editor.title'));
    await waitFor(() => expect(reopenedTextarea.value).toBe(beforeConfigText));

    const reopenedIssuesRegion = screen.getByRole('region', { name: t('issues.title') });
    await waitFor(() => expect(reopenedIssuesRegion.textContent).toBe(beforeIssuesText));
  });

  it('clicking "Upgrade project" through the real UI applies the migration and persists the new config text, schema-lock and quarantine (FR-UPD-06)', async () => {
    const adapter = new MemoryStorageAdapter();
    const store = bundleStoreFrom(adapter);
    const keyPair = await generateTestKeyPair();
    const trustedPublicKeys = [keyPair.publicKeyRaw];
    const options = await defaultVerifyOptions(trustedPublicKeys);

    const v1 = await buildSignedBundle({
      keyPair,
      bundleId: 'v1',
      version: '1.0.0',
      modules: new Map([
        ['general', minimalModule('general')],
        ['rules', minimalModule('rules')],
      ]),
    });
    expect((await installBundle(store, v1.manifest, v1.files, options)).ok).toBe(true);

    const client = new WorkerClient(new RealWorker());
    render(<ProjectPage client={client} adapter={adapter} trustedPublicKeys={trustedPublicKeys} />);
    await screen.findByText(t('project.emptyState'));
    fireEvent.click(screen.getByRole('button', { name: t('project.newButton') }));
    await screen.findByLabelText(t('project.nameLabel'));
    const editorTextarea = screen.getByLabelText<HTMLTextAreaElement>(t('editor.title'));
    await waitFor(() => expect(editorTextarea.value).toBe(DEFAULT_PROJECT_CONFIG_TEXT));
    fireEvent.change(editorTextarea, {
      target: { value: 'mode: rule\nlegacy-secret: hunter2\n' },
    });
    await waitFor(
      () => {
        expect(document.querySelector('[data-module-section="general"]')).not.toBeNull();
      },
      { timeout: 2000 },
    );

    const [record] = await listProjects(adapter);
    if (!record) throw new Error('project was not persisted');

    // v2: adds a migration that quarantines the legacy field (not lossy —
    // the value survives) and drops the `rules` module entirely.
    const v2 = await buildSignedBundle({
      keyPair,
      bundleId: 'v2',
      version: '2.0.0',
      modules: new Map([
        [
          'general',
          {
            manifest: { id: 'general', root: [], version: '2.0.0' },
            schema: {},
            ui: {},
            migrations: [
              {
                from: '1.0.0',
                to: '2.0.0',
                operations: [{ op: 'quarantine-field', path: 'legacy-secret' }],
              },
            ],
          },
        ],
      ]),
    });
    expect((await installBundle(store, v2.manifest, v2.files, options)).ok).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: t('migration.upgradeTriggerButton') }));
    const confirmButton = await screen.findByRole<HTMLButtonElement>('button', {
      name: t('migration.upgradeDialog.confirmButton'),
    });
    expect(confirmButton.disabled).toBe(false); // quarantine-field is not lossy
    fireEvent.click(confirmButton);

    await waitFor(() => expect(editorTextarea.value).toBe('mode: rule\n'));
    expect(screen.queryByRole('dialog')).toBeNull(); // the dialog closes itself on success

    expect(await getProjectConfigText(adapter, record.id)).toBe('mode: rule\n');
    expect(await getProjectSchemaLock(adapter, record.id)).toEqual({
      bundleVersion: '2.0.0',
      compatibilityProfile: '1.19.29',
    });
    const quarantine = await getProjectQuarantine(adapter, record.id);
    expect(quarantine.fields).toHaveLength(1);
    expect(quarantine.fields[0]).toMatchObject({
      path: 'legacy-secret',
      value: 'hunter2',
      moduleId: 'general',
    });
  });

  it('shows a persistent untrusted-Bundle warning for a project locked to a manually-imported community Bundle version, and not for a normal project (FR-UPD-09, v0.9.0 #17)', async () => {
    const adapter = new MemoryStorageAdapter();
    const store = bundleStoreFrom(adapter);
    const keyPair = await generateTestKeyPair();
    const trustedPublicKeys = [keyPair.publicKeyRaw];
    const { manifest, files } = await buildSignedBundle({
      keyPair,
      bundleId: 'community-1',
      version: '1.5.0',
      channel: 'beta',
      manifestOverrides: { signature: '00'.repeat(64) },
    });
    expect(
      (
        await installUntrustedBundle(store, manifest, files, {
          currentAppVersion: CURRENT_APP_VERSION,
          minFormatVersion: 1,
          maxFormatVersion: 1,
        })
      ).ok,
    ).toBe(true);

    const client = new WorkerClient(new RealWorker());
    render(<ProjectPage client={client} adapter={adapter} trustedPublicKeys={trustedPublicKeys} />);
    await screen.findByText(t('project.emptyState'));
    fireEvent.click(screen.getByRole('button', { name: t('project.newButton') }));
    await screen.findByLabelText(t('project.nameLabel'));
    expect(screen.queryByText(t('bundle.trust.untrustedWarning'))).toBeNull();

    const [record] = await listProjects(adapter);
    if (!record) throw new Error('project was not persisted');
    await saveProjectSchemaLock(adapter, record.id, {
      bundleVersion: '1.5.0',
      compatibilityProfile: 'v1.19.29',
    });

    // Simulate reopening the project so the effect that resolves its schema
    // re-runs against the lock just written directly (mirrors the existing
    // "installing a newer Bundle..." test's unmount/remount technique above).
    fireEvent.click(screen.getByRole('button', { name: t('statusBar.backButton') }));
    fireEvent.click(await screen.findByRole('button', { name: t('project.untitledName') }));

    expect(await screen.findByText(t('bundle.trust.untrustedWarning'))).toBeDefined();
  });
});

describe('ProjectPage / read-only protection (ADR-004 point 6, PRD §9.5 point 3, v0.5.0 #12)', () => {
  /**
   * Locks a fresh project to v1, then evicts v1 from both store slots by
   * installing v2 then v3 (the store only ever keeps two per channel,
   * FR-UPD-04) — a genuine "locked version gone, but the store is not
   * empty" state 2, not a contrived one.
   */
  async function setUpReadOnlyProject(): Promise<{
    adapter: MemoryStorageAdapter;
    trustedPublicKeys: Uint8Array[];
    projectId: string;
  }> {
    const adapter = new MemoryStorageAdapter();
    const store = bundleStoreFrom(adapter);
    const keyPair = await generateTestKeyPair();
    const trustedPublicKeys = [keyPair.publicKeyRaw];
    const options = await defaultVerifyOptions(trustedPublicKeys);

    const v1 = await buildSignedBundle({ keyPair, bundleId: 'v1', version: '1.0.0' });
    expect((await installBundle(store, v1.manifest, v1.files, options)).ok).toBe(true);

    const client = new WorkerClient(new RealWorker());
    render(<ProjectPage client={client} adapter={adapter} trustedPublicKeys={trustedPublicKeys} />);
    await screen.findByText(t('project.emptyState'));
    fireEvent.click(screen.getByRole('button', { name: t('project.newButton') }));
    await screen.findByLabelText(t('project.nameLabel'));
    const [record] = await listProjects(adapter);
    if (!record) throw new Error('project was not persisted');
    // The schema-lock backfill happens inside the selected-project loading
    // effect (async, separate from `handleCreate`'s own writes) — wait for
    // it rather than assuming it has landed the instant the name label appears.
    await waitFor(async () => {
      expect(await getProjectSchemaLock(adapter, record.id)).toEqual({
        bundleVersion: '1.0.0',
        compatibilityProfile: '1.19.29',
      });
    });
    cleanup();

    const v2 = await buildSignedBundle({ keyPair, bundleId: 'v2', version: '2.0.0' });
    expect((await installBundle(store, v2.manifest, v2.files, options)).ok).toBe(true);
    const v3 = await buildSignedBundle({ keyPair, bundleId: 'v3', version: '3.0.0' });
    expect((await installBundle(store, v3.manifest, v3.files, options)).ok).toBe(true);

    return { adapter, trustedPublicKeys, projectId: record.id };
  }

  it('shows the read-only guard with the raw text, and hides the mutable editing surface entirely (not merely disabled)', async () => {
    const { adapter, trustedPublicKeys, projectId } = await setUpReadOnlyProject();
    const client = new WorkerClient(new RealWorker());
    render(<ProjectPage client={client} adapter={adapter} trustedPublicKeys={trustedPublicKeys} />);
    fireEvent.click(await screen.findByRole('button', { name: t('project.untitledName') }));

    await screen.findByText(t('readonly.banner', { version: '1.0.0' }));
    const rawText = screen.getByLabelText<HTMLTextAreaElement>(t('editor.title'));
    expect(rawText.readOnly).toBe(true);
    expect(rawText.value).toBe(DEFAULT_PROJECT_CONFIG_TEXT);

    // The mutable editing surface never mounts at all while read-only.
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByRole('button', { name: t('project.undoButton') })).toBeNull();
    expect(screen.queryByRole('button', { name: t('project.redoButton') })).toBeNull();

    // Not silently rewritten to whatever is now active (v3) — falling back
    // to serve a read-only view must not itself change what is locked.
    expect(await getProjectSchemaLock(adapter, projectId)).toEqual({
      bundleVersion: '1.0.0',
      compatibilityProfile: '1.19.29',
    });
  });

  it('never sends applyPatch/applyBatch/undo/redo while read-only — zero messages, not just disabled buttons', async () => {
    const { adapter, trustedPublicKeys } = await setUpReadOnlyProject();
    const freshWorker = new CountingWorker();
    const client = new WorkerClient(freshWorker);
    render(<ProjectPage client={client} adapter={adapter} trustedPublicKeys={trustedPublicKeys} />);
    fireEvent.click(await screen.findByRole('button', { name: t('project.untitledName') }));
    await screen.findByText(t('readonly.banner', { version: '1.0.0' }));

    expect(freshWorker.counts).toEqual({ applyPatch: 0, applyBatch: 0, undo: 0, redo: 0 });
  });

  it('export still works from the read-only view (viewing/exporting is not what read-only protects against)', async () => {
    const { adapter, trustedPublicKeys } = await setUpReadOnlyProject();
    const client = new WorkerClient(new RealWorker());
    render(<ProjectPage client={client} adapter={adapter} trustedPublicKeys={trustedPublicKeys} />);
    fireEvent.click(await screen.findByRole('button', { name: t('project.untitledName') }));
    await screen.findByText(t('readonly.banner', { version: '1.0.0' }));

    fireEvent.click(screen.getByRole('button', { name: t('export.triggerButton') }));

    expect(await screen.findByRole('dialog', { name: t('export.title') })).toBeDefined();
  });

  it('upgrading from the read-only guard applies the upgrade and leaves read-only mode', async () => {
    const { adapter, trustedPublicKeys } = await setUpReadOnlyProject();
    const client = new WorkerClient(new RealWorker());
    render(<ProjectPage client={client} adapter={adapter} trustedPublicKeys={trustedPublicKeys} />);
    fireEvent.click(await screen.findByRole('button', { name: t('project.untitledName') }));
    await screen.findByText(t('readonly.banner', { version: '1.0.0' }));

    fireEvent.click(screen.getByRole('button', { name: t('readonly.upgradeButton') }));
    const confirmButton = await screen.findByRole<HTMLButtonElement>('button', {
      name: t('migration.upgradeDialog.confirmButton'),
    });
    fireEvent.click(confirmButton);

    await waitFor(() => expect(screen.queryByText(t('readonly.upgradeButton'))).toBeNull());
    // Back to the normal, writable editing surface.
    await screen.findByRole('tablist');
  });
});

describe('ProjectPage / storage pressure notice (NFR-REL-05, v0.6.0 #9)', () => {
  /**
   * Wraps a real `MemoryStorageAdapter` but reports quota as tight — that
   * adapter's own `estimateQuota()` always returns `quotaBytes: null`
   * (nothing to be tight relative to), which is why `SnapshotManager` never
   * naturally degrades against it. `failWrites` additionally makes `put`
   * throw `QuotaExceededError`, needed to reach the `stopped` level (`reduced`
   * only needs quota reported tight; `stopped` needs the write to actually
   * fail even after pruning).
   */
  class QuotaPressureAdapter implements StorageAdapter {
    readonly #inner = new MemoryStorageAdapter();
    readonly #failWrites: boolean;
    constructor(failWrites: boolean) {
      this.#failWrites = failWrites;
    }
    async get(key: string): ReturnType<StorageAdapter['get']> {
      return this.#inner.get(key);
    }
    async put(key: string, value: Uint8Array): ReturnType<StorageAdapter['put']> {
      if (this.#failWrites && key.includes('/snapshots/')) {
        throw Object.assign(new Error('quota exceeded'), { name: 'QuotaExceededError' });
      }
      return this.#inner.put(key, value);
    }
    async delete(key: string): ReturnType<StorageAdapter['delete']> {
      return this.#inner.delete(key);
    }
    async list(prefix: string): ReturnType<StorageAdapter['list']> {
      return this.#inner.list(prefix);
    }
    async estimateQuota(): Promise<StorageQuota | null> {
      return { usageBytes: 95, quotaBytes: 100 };
    }
  }

  async function setUpSelectedProject(adapter: StorageAdapter) {
    const client = new WorkerClient(new RealWorker());
    render(<ProjectPage client={client} adapter={adapter} />);
    await screen.findByText(t('project.emptyState'));

    fireEvent.click(screen.getByRole('button', { name: t('project.newButton') }));
    await screen.findByLabelText(t('project.nameLabel'));
    const editorTextarea = screen.getByLabelText<HTMLTextAreaElement>(t('editor.title'));
    await waitFor(() => expect(editorTextarea.value).toBe(DEFAULT_PROJECT_CONFIG_TEXT));
    await waitFor(() => {
      expect(document.querySelector('[data-module-section="general"]')).not.toBeNull();
    });
    return editorTextarea;
  }

  it('shows no notice while storage has plenty of room (the real MemoryStorageAdapter default)', async () => {
    const editorTextarea = await setUpSelectedProject(new MemoryStorageAdapter());

    fireEvent.change(editorTextarea, { target: { value: 'mode: rule\nport: 7891\n' } });

    await waitFor(() => expect(editorTextarea.value).toBe('mode: rule\nport: 7891\n'));
    expect(screen.queryByText(t('storage.snapshot.reduced'))).toBeNull();
    expect(screen.queryByText(t('storage.snapshot.stopped'))).toBeNull();
  });

  it('shows the low-key reduced notice once an edit records a snapshot under tight-but-writable quota', async () => {
    const editorTextarea = await setUpSelectedProject(new QuotaPressureAdapter(false));

    fireEvent.change(editorTextarea, { target: { value: 'mode: rule\nport: 7891\n' } });

    await waitFor(() => expect(screen.getByText(t('storage.snapshot.reduced'))).toBeDefined());
    expect(
      screen.queryByRole('button', { name: t('storage.snapshot.exportNowButton') }),
    ).toBeNull();
  });

  it('shows the prominent stopped notice with a direct export entry once snapshotting genuinely cannot write', async () => {
    const editorTextarea = await setUpSelectedProject(new QuotaPressureAdapter(true));

    fireEvent.change(editorTextarea, { target: { value: 'mode: rule\nport: 7891\n' } });

    await waitFor(() => expect(screen.getByText(t('storage.snapshot.stopped'))).toBeDefined());
    fireEvent.click(screen.getByRole('button', { name: t('storage.snapshot.exportNowButton') }));
    expect(await screen.findByRole('dialog', { name: t('export.title') })).toBeDefined();
  });
});
