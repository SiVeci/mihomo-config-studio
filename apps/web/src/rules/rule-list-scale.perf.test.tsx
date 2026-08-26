// @vitest-environment jsdom
import { builtinAsStoredBundle, createRegistry } from '@mcs/schema-registry';
import { generateScaleCorpus } from '@mcs/test-fixtures';
import { MihomoYamlDocument } from '@mcs/yaml-engine';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { t } from '../i18n/index.js';
import { WorkerClient } from '../worker/client.js';
import type { WorkerLike, WorkerMessageEvent } from '../worker/client.js';
import { createWorkerState, handleWorkerRequest } from '../worker/protocol.js';
import type { WorkerRequest, WorkerState } from '../worker/protocol.js';
import { RuleListPage } from './RuleListPage.js';

afterEach(() => {
  cleanup();
});

/**
 * Seeds the document directly into `WorkerState` rather than through a
 * `'parse'` message — going through `client.parse()` would run the real
 * `schemaStage`, measured at ~40s on this exact corpus shape
 * (`v0.4.0-perf-baseline.md`, v0.4.0 #14) for a reason unrelated to what
 * this file measures: `handleApplyPatch`/`handleMove`'s underlying
 * `document.moveSeqItem`/`setIn` never call `runPipeline` themselves
 * (validation is the separate, already-300ms-debounced `'validate'`
 * message).
 *
 * Unlike `field-edit-latency.perf.test.tsx`'s otherwise-identical fake
 * Worker, `postMessage` here defers *processing* the request, not just
 * delivering the response. That distinction is invisible for a cheap
 * scalar-field patch (sub-millisecond either way, which is why the v0.3.0
 * fake never needed it), but `handleApplyPatch`'s real cost at this file's
 * 10,000-row scale is dominated by `HistoryStack.record()`'s before/after
 * `document.toText()` snapshot (~7–13ms each, confirmed in isolation) —
 * work a *real* `Worker.postMessage` runs on the worker thread, never
 * blocking the caller. Running it synchronously inside `postMessage` would
 * fold genuine worker-thread cost into what this file measures as
 * "main-thread dispatch only", exactly the span NFR-PERF-03 defines as
 * excluding ("不含 Worker 异步往返"). Confirmed empirically, not just in
 * theory: processing synchronously made the measured latency jump from
 * ~0.02ms to 80–130ms and fail this file's own 100ms assertion under
 * `pnpm run check`'s parallel load — the fix is fidelity to the real async
 * boundary, not a looser assertion.
 */
class SeededWorker implements WorkerLike {
  onmessage: ((event: WorkerMessageEvent) => void) | null = null;
  readonly state: WorkerState;

  constructor(seedText: string) {
    this.state = createWorkerState();
    this.state.parseResult = MihomoYamlDocument.parse(seedText);
  }

  postMessage(message: WorkerRequest): void {
    queueMicrotask(() => {
      const response = handleWorkerRequest(this.state, message);
      queueMicrotask(() => this.onmessage?.({ data: response }));
    });
  }
}

const RULE_COUNT = 10_000;
const SAMPLE_COUNT = 30;
const ROW_HEIGHT = 32;
const CONTAINER_HEIGHT = 320;

/**
 * NFR-PERF-04 (virtualization + scale) and NFR-PERF-03 (re-verified at
 * v0.4.0 scale) — the version document's own "1,000 entities + 10,000
 * rules" scenario (v0.4.0 #15). The corpus is `generateScaleCorpus()`'s
 * default, the exact shape `scale.bench.ts` measures, so these two results
 * are directly comparable to that baseline.
 */
describe('rule list at v0.4.0 scale — 1,000 entities + 10,000 rules (NFR-PERF-04/03)', () => {
  function setUp() {
    const seedText = generateScaleCorpus({ entityCount: 1000, ruleCount: RULE_COUNT });
    const worker = new SeededWorker(seedText);
    const client = new WorkerClient(worker);
    const rules = (worker.state.parseResult!.document!.toJS() as { rules: string[] }).rules;
    expect(rules).toHaveLength(RULE_COUNT); // sanity: the seed actually has what this test assumes

    const modules = createRegistry(builtinAsStoredBundle()).modules();
    const catalog = modules.find((module) => module.manifest.id === 'rules')?.ruleTypes ?? [];

    render(
      <RuleListPage
        rules={rules}
        rowHeight={ROW_HEIGHT}
        containerHeight={CONTAINER_HEIGHT}
        catalog={catalog}
        proxyTargetNames={[]}
        ruleProviderNames={[]}
        subRuleGroupNames={[]}
        onApplyFix={(patch) => client.applyPatch(patch).then(() => undefined)}
        onApplyBatch={(patches) => client.applyBatch(patches).then(() => undefined)}
      />,
    );
    return { grid: screen.getByRole('grid', { name: t('ruleList.label') }) };
  }

  it('renders far fewer DOM rows than 10,000 (virtualization is active at real v0.4.0 scale)', () => {
    setUp();
    const rows = screen.getAllByRole('row');
    expect(rows.length).toBeLessThan(100);
    expect(rows.length).toBeGreaterThan(0);
  });

  it(`keyboard reorder dispatch stays well under 100ms across ${SAMPLE_COUNT} consecutive moves at 10,000-row scale`, () => {
    const { grid } = setUp();
    // Selects row 0 — `handleGridKeyDown` requires a selection before Alt+↓ does anything.
    fireEvent.click(screen.getAllByRole('row')[0]!);

    const durationsMs: number[] = [];
    for (let i = 0; i < SAMPLE_COUNT; i += 1) {
      const start = performance.now();
      fireEvent.keyDown(grid, { key: 'ArrowDown', altKey: true });
      durationsMs.push(performance.now() - start);
    }

    const sorted = [...durationsMs].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)]!;
    const max = sorted.at(-1)!;
    console.warn(
      `rule reorder dispatch latency at 10,000-row scale (ms) — median: ${median.toFixed(3)}, max: ${max.toFixed(3)}`,
    );

    expect(median).toBeLessThan(100);
    expect(max).toBeLessThan(100);
  });
});
