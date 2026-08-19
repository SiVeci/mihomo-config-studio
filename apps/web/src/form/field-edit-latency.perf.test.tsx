// @vitest-environment jsdom
import { GENERAL_MODULE } from '@mcs/schema-builtin';
import { MemoryStorageAdapter } from '@mcs/storage';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { t } from '../i18n/index.js';
import { ProjectPage } from '../project/ProjectPage.js';
import { WorkerClient } from '../worker/client.js';
import type { WorkerLike, WorkerMessageEvent } from '../worker/client.js';
import { createWorkerState, handleWorkerRequest } from '../worker/protocol.js';
import type { WorkerRequest } from '../worker/protocol.js';

afterEach(() => {
  cleanup();
});

class RealWorker implements WorkerLike {
  onmessage: ((event: WorkerMessageEvent) => void) | null = null;
  readonly #state = createWorkerState();

  postMessage(message: WorkerRequest): void {
    const response = handleWorkerRequest(this.#state, message);
    queueMicrotask(() => this.onmessage?.({ data: response }));
  }
}

const SAMPLE_COUNT = 30;

/**
 * NFR-PERF-03: "ordinary field edit < 100ms" — the *main-thread* span from a
 * field control's DOM event through the `onChange` callback chain to the
 * `applyPatch` request actually being dispatched (`WorkerClient#send`'s
 * synchronous `postMessage` call), never the Worker's async round trip back
 * (that is the separate, already-tested `VALIDATION_DEBOUNCE_MS` window).
 * `fireEvent.change` is synchronous end to end in jsdom/React Testing
 * Library — React's synchronous event dispatch runs the whole `onChange`
 * chain (`SchemaForm` → `ModuleFormPage` → `ProjectPage`'s
 * `handleDocumentFieldChange`) up to its first `await`, which is exactly
 * the boundary this NFR is about, before `fireEvent.change` itself returns.
 * `performance.now()` around that call is a real wall-clock measurement, not
 * an injected fake clock: a fake clock has no relationship to actual CPU
 * time and cannot answer "how long did this really take."
 *
 * Numbers from a real run of this file are recorded in
 * `docs/releases/plans/v0.3.0-perf-baseline.md` (reproduce with
 * `pnpm vitest run apps/web/src/form/field-edit-latency.perf.test.tsx`).
 */
describe('field edit main-thread latency (NFR-PERF-03)', () => {
  it(`stays well under 100ms across ${SAMPLE_COUNT} consecutive real field edits`, async () => {
    const adapter = new MemoryStorageAdapter();
    const client = new WorkerClient(new RealWorker());
    render(<ProjectPage client={client} adapter={adapter} />);
    await screen.findByText(t('project.emptyState'));

    fireEvent.click(screen.getByRole('button', { name: t('project.newButton') }));
    await screen.findByLabelText(t('project.nameLabel'));
    await waitFor(() => {
      expect(document.querySelector('[data-module-section="general"]')).not.toBeNull();
    });

    const modeLabel = GENERAL_MODULE.i18n?.['zh-CN']?.['field.mode'];
    if (!modeLabel) throw new Error('GENERAL_MODULE has no zh-CN field.mode label');
    const select = screen.getByLabelText<HTMLSelectElement>(modeLabel);

    const durationsMs: number[] = [];
    for (let i = 0; i < SAMPLE_COUNT; i += 1) {
      const value = i % 2 === 0 ? 'global' : 'rule';
      const start = performance.now();
      fireEvent.change(select, { target: { value } });
      durationsMs.push(performance.now() - start);
    }

    const sorted = [...durationsMs].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)]!;
    const max = sorted.at(-1)!;
    // How a maintainer reproduces the numbers recorded in the baseline doc.
    console.warn(`field edit latency (ms) — median: ${median.toFixed(3)}, max: ${max.toFixed(3)}`);

    expect(median).toBeLessThan(100);
    expect(max).toBeLessThan(100);
  });
});
