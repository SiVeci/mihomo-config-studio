// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MemoryStorageAdapter } from '@mcs/storage';
import { BASIC_PROXY_TEMPLATE } from '@mcs/templates';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { t } from './i18n/index.js';
import { ProjectPage } from './project/ProjectPage.js';
import { WorkerClient } from './worker/client.js';
import type { WorkerLike, WorkerMessageEvent } from './worker/client.js';
import { createWorkerState, handleWorkerRequest } from './worker/protocol.js';
import type { WorkerRequest } from './worker/protocol.js';

afterEach(() => {
  cleanup();
});

/** Same technique as `closed-loop.test.tsx` (v0.2.0) and `worker/client.test.ts`'s own `FakeWorker`: real `handleWorkerRequest`, no canned responses. */
class FakeWorker implements WorkerLike {
  onmessage: ((event: WorkerMessageEvent) => void) | null = null;
  readonly #state = createWorkerState();

  postMessage(message: WorkerRequest): void {
    const response = handleWorkerRequest(this.#state, message);
    queueMicrotask(() => this.onmessage?.({ data: response }));
  }
}

const TEMPLATES_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'packages',
  'templates',
  'templates',
);

function readTemplateConfig(configPath: string): string {
  return readFileSync(join(TEMPLATES_ROOT, configPath), 'utf8');
}

/**
 * v0.3.0's own closed-loop question, one level past v0.2.0's: "with the six
 * P0 modules and a real built-in template, can a user apply that template,
 * edit a real field through the *form* (not just the raw editor), and have
 * undo/redo/mode-toggle/export all agree with each other?" No dedicated
 * "apply template" UI exists yet (no version doc requirement calls for one) —
 * applying a template today means what it will always minimally mean even
 * once one exists: its `config.yaml` text goes through the same import path
 * as any other YAML a user might paste in.
 */
describe('v0.3.0 closed loop: apply template -> form edit -> undo -> redo -> mode toggle -> export', () => {
  it('walks the whole loop in one pass and exports byte-exact content', async () => {
    const adapter = new MemoryStorageAdapter();
    const client = new WorkerClient(new FakeWorker());
    const downloads: { content: Uint8Array | string; filename: string; mimeType: string }[] = [];

    render(
      <ProjectPage
        client={client}
        adapter={adapter}
        saveDocument={async ({ suggestedName, content, mimeType }) => {
          downloads.push({ content, filename: suggestedName, mimeType });
          return { kind: 'saved', name: suggestedName };
        }}
      />,
    );
    await screen.findByText(t('project.emptyState'));

    fireEvent.click(screen.getByRole('button', { name: t('project.newButton') }));
    await screen.findByLabelText(t('project.nameLabel'));

    // 1. Apply the "basic proxy configuration" template (PRD §8.8) via the
    // existing paste-import path (FR-YAML-01) — its real, on-disk content,
    // not a hand-typed stand-in.
    const templateText = readTemplateConfig(BASIC_PROXY_TEMPLATE.configPath);
    fireEvent.change(screen.getByLabelText(t('import.pasteLabel')), {
      target: { value: templateText },
    });
    fireEvent.click(screen.getByRole('button', { name: t('import.pasteButton') }));
    await screen.findByText(t('import.successMessage'));
    const editorTextarea = screen.getByLabelText<HTMLTextAreaElement>(t('editor.title'));
    await waitFor(() => expect(editorTextarea.value).toBe(templateText));

    // 2. Edit a real `proxies` field *through the form* (v0.3.0's own
    // addition over v0.2.0's raw-editor-only loop) — the first node's port.
    const portInput = await waitFor(() => {
      const input = document.querySelector('[data-field="/proxies/0/port"] input');
      if (!input) throw new Error('proxies[0].port field not yet rendered');
      return input as HTMLInputElement;
    });
    expect(portInput.value).toBe('8388');
    fireEvent.change(portInput, { target: { value: '8389' } });
    const editedText = templateText.replace('port: 8388', 'port: 8389');
    await waitFor(() => expect(editorTextarea.value).toBe(editedText));

    // 3. Undo: back to the freshly-imported text.
    fireEvent.click(screen.getByRole('button', { name: t('project.undoButton') }));
    await waitFor(() => expect(editorTextarea.value).toBe(templateText));

    // 4. Redo: the port edit is back.
    fireEvent.click(screen.getByRole('button', { name: t('project.redoButton') }));
    await waitFor(() => expect(editorTextarea.value).toBe(editedText));

    // 5. Toggle basic -> advanced -> basic: never itself edits the document
    // (exit condition 6, already unit-tested in isolation — reconfirmed here
    // as part of the same real sequence the release itself depends on).
    const modeSelect = screen.getByLabelText<HTMLSelectElement>(t('form.modeLabel'));
    fireEvent.change(modeSelect, { target: { value: 'advanced' } });
    expect(editorTextarea.value).toBe(editedText);
    fireEvent.change(modeSelect, { target: { value: 'basic' } });
    expect(editorTextarea.value).toBe(editedText);

    // 6. Export: content matches the edited buffer byte for byte.
    fireEvent.click(screen.getByRole('button', { name: t('export.triggerButton') }));
    await screen.findByText(t('export.title'));
    fireEvent.click(screen.getByRole('button', { name: t('export.yamlDownloadButton') }));

    expect(downloads).toHaveLength(1);
    expect(downloads[0]?.content).toBe(editedText);
    expect(downloads[0]?.mimeType).toBe('text/yaml');
  });
});
