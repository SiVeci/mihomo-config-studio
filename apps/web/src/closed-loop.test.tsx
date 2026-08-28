// @vitest-environment jsdom
import { MemoryStorageAdapter } from '@mcs/storage';
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

/**
 * Mirrors `worker/client.test.ts`'s own `FakeWorker` exactly: resolves every
 * message through the real `handleWorkerRequest` (real `MihomoYamlDocument`,
 * real `runPipeline`, real `diffLines`) instead of canned responses — jsdom
 * has no real `Worker`, but the request handler is a pure function with no
 * `self`/`postMessage` reference, so this is the actual production logic
 * running synchronously-but-delivered-asynchronously. Without this, the test
 * below would only prove component wiring, not that the v0.2.0 loop's real
 * engine pieces (parse/validate/diff/serialize) work together.
 */
class FakeWorker implements WorkerLike {
  onmessage: ((event: WorkerMessageEvent) => void) | null = null;
  readonly #state = createWorkerState();

  postMessage(message: WorkerRequest): void {
    const response = handleWorkerRequest(this.#state, message);
    queueMicrotask(() => this.onmessage?.({ data: response }));
  }
}

/**
 * The v0.2.0 release document opens with one question: "with no Schema
 * module installed, can a user complete a full import -> raw edit -> diff ->
 * export loop?" This is that question as a test, walking the whole sequence
 * in one pass rather than each step in isolation (every step already has
 * its own component-level tests) — this is the thing that has to be green
 * for the release itself to be considered real.
 */
describe('v0.2.0 closed loop: import -> edit -> diff -> export, no Schema module installed', () => {
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
    // `YamlEditor`'s own structured-view fieldset (distinct from
    // `ModuleFormPage`, rendered as its own section below it since v0.3.0
    // #14) is not wired to any real module and keeps its permanent
    // "not available yet" placeholder throughout this loop.
    expect(screen.getByText(t('editor.structuredViewPlaceholder'))).toBeDefined();
    // The new project's schema-resolution effect (`ProjectPage.tsx`,
    // `resolveProjectSchema`) is still in flight here — v0.6.0 #10 added an
    // extra await to it (`resolveEd25519Verifier`'s startup capability
    // probe), which was enough to let that effect's own `setConfigText`
    // land *after* the import below instead of before, silently reverting
    // it back to the pre-import default. Waiting for the module section it
    // populates guarantees its `setConfigText` call (earlier in the same
    // `.then()`) has already happened before the import fires.
    await waitFor(() => {
      expect(document.querySelector('[data-module-section="general"]')).not.toBeNull();
    });

    // 1. Import: paste YAML text (FR-YAML-01).
    const importedYaml = 'mode: rule\nport: 7890\nlog-level: info\n';
    fireEvent.change(screen.getByLabelText(t('import.pasteLabel')), {
      target: { value: importedYaml },
    });
    fireEvent.click(screen.getByRole('button', { name: t('import.pasteButton') }));
    await screen.findByText(t('import.successMessage'));
    const editorTextarea = screen.getByLabelText<HTMLTextAreaElement>(t('editor.title'));
    await waitFor(() => expect(editorTextarea.value).toBe(importedYaml));

    // 2. Raw edit: change one value (FR-YAML-04/05 — still no Schema module needed).
    const editedYaml = 'mode: rule\nport: 7891\nlog-level: info\n';
    fireEvent.change(editorTextarea, { target: { value: editedYaml } });
    await waitFor(() => expect(editorTextarea.value).toBe(editedYaml));
    await screen.findByText(t('issues.emptyState'));

    // 3. Diff: reflects exactly the one edited line against the imported baseline (FR-YAML-06).
    await screen.findByText(t('diff.summary', { added: 1, removed: 1 }));
    expect(screen.getByText('port: 7890').previousSibling?.textContent).toBe('-');
    expect(screen.getByText('port: 7891').previousSibling?.textContent).toBe('+');

    // 4. Export: content matches the edited buffer byte for byte, never re-serialised (FR-YAML-07/FR-PROJ-06).
    fireEvent.click(screen.getByRole('button', { name: t('export.triggerButton') }));
    await screen.findByText(t('export.title'));
    fireEvent.click(screen.getByRole('button', { name: t('export.yamlDownloadButton') }));

    expect(downloads).toHaveLength(1);
    expect(downloads[0]?.content).toBe(editedYaml);
    expect(downloads[0]?.mimeType).toBe('text/yaml');
  });
});
