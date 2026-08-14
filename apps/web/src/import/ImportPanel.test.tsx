// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { t } from '../i18n/index.js';
import type { ValidationIssue } from '../worker/protocol.js';
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

function fakeClient(issues: ValidationIssue[] = []): ImportWorkerClient {
  return {
    parse: async () => ({ type: 'parse', requestId: 'fake', issues }),
  };
}

describe('ImportPanel / file selection', () => {
  it('imports the contents of a selected .yaml file and shows a success message', async () => {
    const onImport = vi.fn();
    render(<ImportPanel client={fakeClient()} onImport={onImport} />);
    const file = new File([VALID_YAML], 'config.yaml', { type: 'text/yaml' });

    fireEvent.change(screen.getByLabelText<HTMLInputElement>(t('import.fileButton')), {
      target: { files: [file] },
    });

    await waitFor(() => expect(onImport).toHaveBeenCalledWith(VALID_YAML));
    expect(screen.getByText(t('import.successMessage'))).toBeDefined();
  });

  it('resets the file input value after a selection, so picking the same file again still fires change', () => {
    render(<ImportPanel client={fakeClient()} onImport={vi.fn()} />);
    const file = new File([VALID_YAML], 'config.yaml', { type: 'text/yaml' });
    const input = screen.getByLabelText<HTMLInputElement>(t('import.fileButton'));

    fireEvent.change(input, { target: { files: [file] } });

    expect(input.value).toBe('');
  });

  it('does not call onImport and shows an error message when the file has a blocking syntax issue', async () => {
    const onImport = vi.fn();
    render(<ImportPanel client={fakeClient([BLOCKING_ISSUE])} onImport={onImport} />);
    const file = new File(['a: 1\n  b: 2\n'], 'bad.yaml', { type: 'text/yaml' });

    fireEvent.change(screen.getByLabelText<HTMLInputElement>(t('import.fileButton')), {
      target: { files: [file] },
    });

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
