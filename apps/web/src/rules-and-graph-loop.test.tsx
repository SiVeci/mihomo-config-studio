// @vitest-environment jsdom
import { MemoryStorageAdapter } from '@mcs/storage';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { t } from './i18n/index.js';
import { ProjectPage } from './project/ProjectPage.js';
import { WorkerClient } from './worker/client.js';
import type { WorkerLike, WorkerMessageEvent } from './worker/client.js';
import { createWorkerState, handleWorkerRequest } from './worker/protocol.js';
import type { WorkerRequest } from './worker/protocol.js';

// jsdom does not implement `scrollIntoView` (real browsers do) — same gap
// `ProjectPage.test.tsx`/`ModuleFormPage.test.tsx` already stub around for
// the same `jumpToField` codepath, hit here via the graph jump step below.
Element.prototype.scrollIntoView = vi.fn();

afterEach(() => {
  cleanup();
});

/** Same technique as `closed-loop.test.tsx` (v0.2.0) and `alpha-loop.test.tsx` (v0.3.0): real `handleWorkerRequest`, no canned responses. */
class FakeWorker implements WorkerLike {
  onmessage: ((event: WorkerMessageEvent) => void) | null = null;
  readonly #state = createWorkerState();

  postMessage(message: WorkerRequest): void {
    const response = handleWorkerRequest(this.#state, message);
    queueMicrotask(() => this.onmessage?.({ data: response }));
  }
}

const IMPORTED_YAML = [
  'mode: rule',
  'proxy-groups:',
  '  - name: AUTO',
  '    type: url-test',
  '    proxies: [ DIRECT ]',
  'rules:',
  '  - DOMAIN-SUFFIX,a.com,DIRECT',
  '  - DOMAIN-SUFFIX,b.com,DIRECT',
  '  - DOMAIN-SUFFIX,c.com,DIRECT',
  '',
].join('\n');

/** Row 0 (a.com) moved one step down via `Alt+ArrowDown` — nothing else changes. */
const AFTER_REORDER_YAML = [
  'mode: rule',
  'proxy-groups:',
  '  - name: AUTO',
  '    type: url-test',
  '    proxies: [ DIRECT ]',
  'rules:',
  '  - DOMAIN-SUFFIX,b.com,DIRECT',
  '  - DOMAIN-SUFFIX,a.com,DIRECT',
  '  - DOMAIN-SUFFIX,c.com,DIRECT',
  '',
].join('\n');

/**
 * v0.4.0's own closed-loop question, one level past v0.3.0's: with the
 * rules-view (#7-#10) and the relationship graph (#12/#13) both real, can a
 * user reorder rules by keyboard, batch-replace a subset of *those
 * post-reorder* rows, undo the whole batch in one step, jump from the graph
 * straight to a form field, and still export exactly what the editor shows —
 * all in one continuous session? Each piece already has its own isolated
 * tests; this is the thing that has to be green for the release itself to be
 * considered real (same framing as `closed-loop.test.tsx` and
 * `alpha-loop.test.tsx` before it).
 */
describe('v0.4.0 closed loop: import -> reorder -> batch replace -> undo -> graph jump -> export', () => {
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

    // 1. Import a config with both rules and a proxy group (FR-YAML-01) — the
    // relationship graph and rule-order stage both need real entities to work with.
    fireEvent.change(screen.getByLabelText(t('import.pasteLabel')), {
      target: { value: IMPORTED_YAML },
    });
    fireEvent.click(screen.getByRole('button', { name: t('import.pasteButton') }));
    await screen.findByText(t('import.successMessage'));
    const editorTextarea = screen.getByLabelText<HTMLTextAreaElement>(t('editor.title'));
    await waitFor(() => expect(editorTextarea.value).toBe(IMPORTED_YAML));

    // 2. Rules view: reorder row 0 one step down via the keyboard path
    // (v0.4.0 #9, FR-RULE-02, NFR-A11Y — the equivalent of a drag, exercised
    // here since it needs no `dataTransfer` plumbing).
    fireEvent.click(screen.getByRole('tab', { name: t('project.rulesViewTab') }));
    await screen.findByRole('grid', { name: t('ruleList.label') });
    fireEvent.click(screen.getAllByRole('row')[0] as HTMLElement);
    fireEvent.keyDown(screen.getByRole('grid'), { key: 'ArrowDown', altKey: true });
    await waitFor(() => expect(editorTextarea.value).toBe(AFTER_REORDER_YAML));

    // 3. Batch-replace the target of the *current* rows 1 and 3 (b.com and
    // c.com, post-reorder — not the original a.com/c.com positions), leaving
    // row 2 (a.com) untouched (v0.4.0 #10, FR-RULE-03, ADR-023).
    fireEvent.click(
      screen.getByRole('checkbox', { name: t('ruleList.batchCheckboxLabel', { index: 1 }) }),
    );
    fireEvent.click(
      screen.getByRole('checkbox', { name: t('ruleList.batchCheckboxLabel', { index: 3 }) }),
    );
    fireEvent.change(screen.getByLabelText(t('ruleList.batchReplaceTargetLabel')), {
      target: { value: 'AUTO' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: t('ruleList.batchReplaceTargetApplyButton') }),
    );

    await waitFor(() => expect(editorTextarea.value).toContain('DOMAIN-SUFFIX,b.com,AUTO'));
    expect(editorTextarea.value).toContain('DOMAIN-SUFFIX,a.com,DIRECT');
    expect(editorTextarea.value).toContain('DOMAIN-SUFFIX,c.com,AUTO');

    // 4. One undo reverts the whole batch — not the earlier reorder
    // (exit condition 4: a batch is one history entry, not three).
    fireEvent.click(screen.getByRole('button', { name: t('project.undoButton') }));
    await waitFor(() => expect(editorTextarea.value).toBe(AFTER_REORDER_YAML));

    // 5. Relationship graph: jump straight to the AUTO group's form field
    // (v0.4.0 #13, FR-REL-04/06) via the real accessible interaction path —
    // the text-equivalent fallback's own `<button>`, not the opaque SVG
    // (PRD §11.6, mirrors `GraphView.test.tsx`'s "text-equivalent fallback
    // offers the same jump as a real, keyboard/AT-reachable button").
    fireEvent.click(screen.getByRole('tab', { name: t('project.graphViewTab') }));
    await screen.findByRole('img', { name: t('graph.svgLabel') });
    const graphJumpButton = Array.from(
      document.querySelectorAll('.graph-view__text-fallback button'),
    ).find((button) => button.textContent?.trim() === 'AUTO');
    if (!graphJumpButton)
      throw new Error('expected a graph fallback button for the AUTO proxy group');
    fireEvent.click(graphJumpButton);

    await waitFor(() => {
      expect(document.querySelector('[data-module-section="general"]')).not.toBeNull();
    });
    expect(screen.queryByRole('img', { name: t('graph.svgLabel') })).toBeNull();
    await waitFor(() => {
      const field = document.activeElement?.closest('[data-field]');
      expect(field?.getAttribute('data-field')).toBe('/proxy-groups/0/name');
    });
    // The graph jump is pure navigation — it must not have touched the document.
    expect(editorTextarea.value).toBe(AFTER_REORDER_YAML);

    // 6. Export: content matches the post-undo buffer byte for byte
    // (FR-YAML-07/FR-PROJ-06).
    fireEvent.click(screen.getByRole('button', { name: t('export.triggerButton') }));
    await screen.findByText(t('export.title'));
    fireEvent.click(screen.getByRole('button', { name: t('export.yamlDownloadButton') }));

    expect(downloads).toHaveLength(1);
    expect(downloads[0]?.content).toBe(AFTER_REORDER_YAML);
    expect(downloads[0]?.mimeType).toBe('text/yaml');
  });
});
