// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { OpenDocumentOptions, OpenDocumentOutcome } from '../platform/index.js';
import { t } from '../i18n/index.js';
import type { PreviewProviderResponse, ValidationIssue } from '../worker/protocol.js';
import { ImportPanel } from './ImportPanel.js';
import type { ImportWorkerClient } from './ImportPanel.js';

afterEach(() => {
  cleanup();
});

const VALID_YAML = 'mode: rule\n';

const BLOCKING_ISSUE: ValidationIssue = {
  severity: 'error',
  code: 'yaml.syntax.BAD_INDENT',
  module: 'yaml',
  messageKey: 'yaml.syntax.BAD_INDENT',
  blocking: true,
};

function fakeClient(
  issues: ValidationIssue[] = [],
  preview: PreviewProviderResponse['preview'] = null,
): ImportWorkerClient {
  return {
    parse: async () => ({ type: 'parse', requestId: 'fake', issues, value: {} }),
    previewProvider: async () => ({ type: 'previewProvider', requestId: 'fake', preview }),
  };
}

/** Resolves to `opened` with fixed text/name, ignoring whatever `acceptExtensions` the caller passed — good enough for these UI-wiring tests, which don't assert on that argument. */
function openDocumentReturning(
  text: string,
  name = 'config.yaml',
): (options: OpenDocumentOptions) => Promise<OpenDocumentOutcome> {
  return async () => ({ kind: 'opened', text, name });
}

const openDocumentCancelled = async (): Promise<OpenDocumentOutcome> => ({ kind: 'cancelled' });

describe('ImportPanel / file selection via the platform port (ADR-026)', () => {
  it('imports the contents the port resolves with and shows a success message', async () => {
    const onImport = vi.fn();
    render(
      <ImportPanel
        client={fakeClient()}
        onImport={onImport}
        openDocument={openDocumentReturning(VALID_YAML)}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: t('import.fileButton') }));

    await waitFor(() => expect(onImport).toHaveBeenCalledWith(VALID_YAML));
    expect(screen.getByText(t('import.successMessage'))).toBeDefined();
  });

  it('does nothing when the port reports cancelled — no import, no error message', async () => {
    const onImport = vi.fn();
    render(
      <ImportPanel
        client={fakeClient()}
        onImport={onImport}
        openDocument={openDocumentCancelled}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: t('import.fileButton') }));

    // Macrotask flush — guarantees every pending microtask in
    // handleOpenFileClick's `await openDocument(...)` chain has settled
    // before asserting, regardless of how many `await` hops it takes.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onImport).not.toHaveBeenCalled();
    expect(screen.queryByText(t('import.successMessage'))).toBeNull();
    expect(screen.queryByText(t('import.errorMessage'))).toBeNull();
  });

  it('does not call onImport and shows an error message when the opened file has a blocking syntax issue', async () => {
    const onImport = vi.fn();
    render(
      <ImportPanel
        client={fakeClient([BLOCKING_ISSUE])}
        onImport={onImport}
        openDocument={openDocumentReturning('a: 1\n  b: 2\n', 'bad.yaml')}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: t('import.fileButton') }));

    await screen.findByText(t('import.errorMessage'));
    expect(onImport).not.toHaveBeenCalled();
  });
});

describe('ImportPanel / drag and drop', () => {
  it('imports a dropped .yaml file the same way as a selected one', async () => {
    const onImport = vi.fn();
    render(<ImportPanel client={fakeClient()} onImport={onImport} />);
    const file = new File([VALID_YAML], 'dropped.yaml', { type: 'text/yaml' });

    fireEvent.drop(screen.getByText(t('import.dropHint')).parentElement!, {
      dataTransfer: { files: [file] },
    });

    await waitFor(() => expect(onImport).toHaveBeenCalledWith(VALID_YAML));
  });

  it('does not throw when dragover fires (preventDefault is required to allow a drop at all)', () => {
    render(<ImportPanel client={fakeClient()} onImport={vi.fn()} />);

    expect(() =>
      fireEvent.dragOver(screen.getByText(t('import.dropHint')).parentElement!),
    ).not.toThrow();
  });
});

describe('ImportPanel / paste', () => {
  it('disables the Import button while the paste box is empty', () => {
    render(<ImportPanel client={fakeClient()} onImport={vi.fn()} />);

    const button = screen.getByRole<HTMLButtonElement>('button', { name: t('import.pasteButton') });
    expect(button.disabled).toBe(true);
  });

  it('enables the Import button once text is pasted, and importing succeeds clears the box', async () => {
    const onImport = vi.fn();
    render(<ImportPanel client={fakeClient()} onImport={onImport} />);

    const textarea = screen.getByLabelText<HTMLTextAreaElement>(t('import.pasteLabel'));
    fireEvent.change(textarea, { target: { value: VALID_YAML } });
    const button = screen.getByRole<HTMLButtonElement>('button', { name: t('import.pasteButton') });
    expect(button.disabled).toBe(false);

    fireEvent.click(button);

    await waitFor(() => expect(onImport).toHaveBeenCalledWith(VALID_YAML));
    expect(textarea.value).toBe('');
  });

  it('a whitespace-only paste is treated as empty and keeps the button disabled', () => {
    render(<ImportPanel client={fakeClient()} onImport={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(t('import.pasteLabel')), { target: { value: '   \n' } });

    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: t('import.pasteButton') }).disabled,
    ).toBe(true);
  });

  it('keeps the pasted text on screen (for the user to fix) when it has a blocking issue', async () => {
    const onImport = vi.fn();
    render(<ImportPanel client={fakeClient([BLOCKING_ISSUE])} onImport={onImport} />);
    const textarea = screen.getByLabelText<HTMLTextAreaElement>(t('import.pasteLabel'));
    fireEvent.change(textarea, { target: { value: 'a: 1\n  b: 2\n' } });

    fireEvent.click(screen.getByRole('button', { name: t('import.pasteButton') }));

    await screen.findByText(t('import.errorMessage'));
    expect(onImport).not.toHaveBeenCalled();
    expect(textarea.value).toBe('a: 1\n  b: 2\n');
  });
});

describe('ImportPanel / NFR-REL-04 (never overwrite the imported file)', () => {
  const HERE = dirname(fileURLToPath(import.meta.url));

  it('the source never references a write-capable File System Access API', () => {
    const source = readFileSync(join(HERE, 'ImportPanel.tsx'), 'utf8');
    const writeCapableApis = [
      'showSaveFilePicker',
      'createWritable',
      'FileSystemWritableFileStream',
    ];

    for (const api of writeCapableApis) {
      expect(source, `ImportPanel.tsx must not reference ${api}`).not.toContain(api);
    }
  });
});

describe('ImportPanel / ADR-005 (no client-side subscription fetch)', () => {
  const HERE = dirname(fileURLToPath(import.meta.url));

  it('the source never references fetch or XMLHttpRequest — the Worker parses text this panel already has, never a URL', () => {
    const source = readFileSync(join(HERE, 'ImportPanel.tsx'), 'utf8');
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toContain('XMLHttpRequest');
  });
});

describe('ImportPanel / local Provider file preview (PRD §8.11, v0.3.0 #17)', () => {
  it('shows the node count and each node’s name/type without touching the open project (never calls onImport)', async () => {
    const onImport = vi.fn();
    const client = fakeClient([], {
      proxyCount: 2,
      nodes: [
        { name: 'HK-01', proxyType: 'ss', fieldKeys: ['name', 'type', 'server', 'port'] },
        { name: null, proxyType: null, fieldKeys: ['type'] },
      ],
    });
    render(
      <ImportPanel
        client={client}
        onImport={onImport}
        openDocument={openDocumentReturning(
          'proxies:\n  - name: HK-01\n    type: ss\n',
          'provider.yaml',
        )}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: t('providerPreview.fileButton') }));

    await screen.findByText(t('providerPreview.nodeCount', { count: 2 }));
    expect(screen.getByText('HK-01')).toBeDefined();
    expect(screen.getByText(t('providerPreview.unnamedNode'))).toBeDefined();
    expect(screen.getByText(t('providerPreview.unknownType'))).toBeDefined();
    expect(onImport).not.toHaveBeenCalled();
  });

  it('shows an error message for a file that is not a valid Provider file, without touching the open project', async () => {
    const onImport = vi.fn();
    const client = fakeClient([], null);
    render(
      <ImportPanel
        client={client}
        onImport={onImport}
        openDocument={openDocumentReturning('mode: rule\n', 'not-a-provider.yaml')}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: t('providerPreview.fileButton') }));

    await screen.findByText(t('providerPreview.errorMessage'));
    expect(onImport).not.toHaveBeenCalled();
  });

  it('renders only the field-key shape for a sensitive field, never a value — the response type has no value to render in the first place (NFR-SEC-02/SEC-03)', async () => {
    const client = fakeClient([], {
      proxyCount: 1,
      nodes: [{ name: 'a', proxyType: 'vmess', fieldKeys: ['name', 'type', 'uuid', 'password'] }],
    });
    render(
      <ImportPanel
        client={client}
        onImport={vi.fn()}
        openDocument={openDocumentReturning('proxies:\n  - name: a\n    type: vmess\n')}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: t('providerPreview.fileButton') }));

    const fieldsRow = await screen.findByText(/uuid, password/);
    expect(fieldsRow.textContent).not.toMatch(/[-]{4,}|@|:\/\//); // no value-shaped text sneaked in
  });
});

describe('ImportPanel / incoming share intent (FR-AND-07, v0.6.0 #13)', () => {
  it('imports a pending incoming document through the same attemptImport path as the other entries', async () => {
    const onImport = vi.fn();
    const onIncomingDocumentConsumed = vi.fn();
    const { rerender } = render(
      <ImportPanel client={fakeClient()} onImport={onImport} pendingIncomingDocument={null} />,
    );

    rerender(
      <ImportPanel
        client={fakeClient()}
        onImport={onImport}
        pendingIncomingDocument={{ name: 'shared.yaml', text: VALID_YAML }}
        onIncomingDocumentConsumed={onIncomingDocumentConsumed}
      />,
    );

    await waitFor(() => expect(onImport).toHaveBeenCalledWith(VALID_YAML));
    expect(screen.getByText(t('import.successMessage'))).toBeDefined();
    await waitFor(() => expect(onIncomingDocumentConsumed).toHaveBeenCalledOnce());
  });

  it('reports an error and does not call onImport for an incoming document with a blocking issue', async () => {
    const onImport = vi.fn();
    const client = fakeClient([BLOCKING_ISSUE]);
    const { rerender } = render(
      <ImportPanel client={client} onImport={onImport} pendingIncomingDocument={null} />,
    );

    rerender(
      <ImportPanel
        client={client}
        onImport={onImport}
        pendingIncomingDocument={{ name: 'shared.yaml', text: 'not: [valid' }}
      />,
    );

    await screen.findByText(t('import.errorMessage'));
    expect(onImport).not.toHaveBeenCalled();
  });

  it('does nothing on mount when there is no pending incoming document', () => {
    const onImport = vi.fn();
    render(
      <ImportPanel client={fakeClient()} onImport={onImport} pendingIncomingDocument={null} />,
    );

    expect(onImport).not.toHaveBeenCalled();
  });

  it('does not re-import on an unrelated re-render once the same document has already been consumed', async () => {
    const onImport = vi.fn();
    const doc = { name: 'shared.yaml', text: VALID_YAML };
    const { rerender } = render(
      <ImportPanel client={fakeClient()} onImport={onImport} pendingIncomingDocument={doc} />,
    );
    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));

    rerender(
      <ImportPanel client={fakeClient()} onImport={onImport} pendingIncomingDocument={doc} />,
    );

    expect(onImport).toHaveBeenCalledTimes(1);
  });
});
