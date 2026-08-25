import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { WorkerClient, WorkerRequestError } from './client.js';
import type { WorkerLike, WorkerMessageEvent } from './client.js';
import { createWorkerState, handleWorkerRequest } from './protocol.js';
import type { WorkerRequest } from './protocol.js';

/**
 * Implements exactly the `postMessage` / `onmessage` surface a real Worker
 * has, but resolves messages through the same `handleWorkerRequest` the real
 * `config.worker.ts` bootstrap calls — so these tests exercise real engine
 * behaviour without a real `new Worker()`. Delivery is deferred with
 * `queueMicrotask` because a real postMessage round trip is never
 * synchronous; a client that accidentally relied on synchronous delivery
 * would pass against a naive fake and fail against a real Worker.
 */
class FakeWorker implements WorkerLike {
  onmessage: ((event: WorkerMessageEvent) => void) | null = null;
  readonly sent: WorkerRequest[] = [];
  readonly #state = createWorkerState();

  postMessage(message: WorkerRequest): void {
    this.sent.push(message);
    const response = handleWorkerRequest(this.#state, message);
    queueMicrotask(() => this.onmessage?.({ data: response }));
  }
}

describe('WorkerClient request/response correlation', () => {
  it('resolves parse() with the response matching its own requestId', async () => {
    const worker = new FakeWorker();
    const client = new WorkerClient(worker);

    const response = await client.parse('mode: rule\n');

    expect(response).toEqual({
      type: 'parse',
      requestId: 'req-1',
      issues: [],
      value: { mode: 'rule' },
    });
  });

  it('assigns a distinct requestId to each call and resolves each independently', async () => {
    const worker = new FakeWorker();
    const client = new WorkerClient(worker);

    const [a, b] = await Promise.all([
      client.parse('mode: rule\n'),
      client.parse('mode: direct\n'),
    ]);

    expect(a.requestId).not.toBe(b.requestId);
    expect(worker.sent.map((request) => request.requestId)).toEqual(['req-1', 'req-2']);
  });

  it('round-trips applyPatch / validate / diff / serialize / locate / value against a parsed document', async () => {
    const worker = new FakeWorker();
    const client = new WorkerClient(worker);
    await client.parse('mode: rule\nport: 7890\n');

    const patched = await client.applyPatch({ kind: 'set-scalar', path: ['port'], value: 7891 });
    expect(patched).toMatchObject({ type: 'applyPatch', canUndo: true, canRedo: false });

    const validated = await client.validate();
    expect(validated).toEqual({ type: 'validate', requestId: validated.requestId, issues: [] });

    const diffed = await client.diff('mode: rule\nport: 7890\n');
    expect(diffed.diff.identical).toBe(false);

    const serialized = await client.serialize();
    expect(serialized.text).toContain('port: 7891');

    const located = await client.locate(['port']);
    expect(located.range?.start.line).toBe(2);

    const valued = await client.value();
    expect(valued.value).toMatchObject({ port: 7891 });
  });

  it('round-trips applyBatch as one atomic write (v0.4.0 #10)', async () => {
    const worker = new FakeWorker();
    const client = new WorkerClient(worker);
    await client.parse('mode: rule\nrules:\n  - MATCH,A\n  - MATCH,B\n');

    const batched = await client.applyBatch([
      { kind: 'set', path: ['rules', 0], value: 'MATCH,A2' },
      { kind: 'set', path: ['rules', 1], value: 'MATCH,B2' },
    ]);
    expect(batched).toMatchObject({ type: 'applyBatch', canUndo: true, canRedo: false });

    const serialized = await client.serialize();
    expect(serialized.text).toContain('MATCH,A2');
    expect(serialized.text).toContain('MATCH,B2');

    // One undo reverts the whole batch in a single step, not one step per patch.
    const undone = await client.undo();
    expect(undone.text).toContain('MATCH,A\n');
    expect(undone.text).toContain('MATCH,B\n');
    expect(undone.canUndo).toBe(false);
  });

  it('round-trips undo / redo against a parsed document, real HistoryStack included (v0.3.0 #15)', async () => {
    const worker = new FakeWorker();
    const client = new WorkerClient(worker);
    await client.parse('mode: rule\nport: 7890\n');
    await client.applyPatch({ kind: 'set-scalar', path: ['port'], value: 7891 });

    const undone = await client.undo();
    expect(undone).toMatchObject({
      type: 'undo',
      canUndo: false,
      canRedo: true,
      text: 'mode: rule\nport: 7890\n',
    });

    const redone = await client.redo();
    expect(redone).toMatchObject({
      type: 'redo',
      canUndo: true,
      canRedo: false,
    });
    expect(redone.text).toContain('port: 7891');
  });

  it('previewProvider() never touches the currently open project document (PRD §8.11, v0.3.0 #17)', async () => {
    const worker = new FakeWorker();
    const client = new WorkerClient(worker);
    await client.parse('mode: rule\nport: 7890\n');

    const preview = await client.previewProvider('proxies:\n  - name: a\n    type: ss\n');
    expect(preview.preview).toMatchObject({ proxyCount: 1 });

    // The project document parsed above is untouched by the preview call.
    const valued = await client.value();
    expect(valued.value).toMatchObject({ mode: 'rule', port: 7890 });
  });

  it('forwards serialize() options through to the request when given', async () => {
    const worker = new FakeWorker();
    const client = new WorkerClient(worker);
    await client.parse('mode: rule\nport: 7890\n');
    await client.applyPatch({ kind: 'remove', path: ['port'] }); // force AST mode so indent applies

    await client.serialize({ indent: 4 });

    const request = worker.sent.find((sent) => sent.type === 'serialize');
    expect(request).toMatchObject({ type: 'serialize', options: { indent: 4 } });
  });

  it('rejects with WorkerRequestError when the response is type: error', async () => {
    const worker = new FakeWorker();
    const client = new WorkerClient(worker);
    // No parse() yet, so the Worker has no document.

    await expect(client.validate()).rejects.toThrow(WorkerRequestError);
    await expect(client.validate()).rejects.toMatchObject({
      code: 'NO_DOCUMENT',
      messageKey: 'worker.error.noDocument',
    });
  });

  it('ignores a response whose requestId has no pending entry, rather than throwing', () => {
    const worker = new FakeWorker();
    new WorkerClient(worker); // constructed only for its side effect of wiring worker.onmessage

    expect(() =>
      worker.onmessage?.({
        data: { type: 'validate', requestId: 'never-requested', issues: [] },
      }),
    ).not.toThrow();
  });
});

describe('WorkerClient validate debounce (NFR-PERF-03)', () => {
  it('is not due immediately after a single touch', () => {
    const client = new WorkerClient(new FakeWorker());
    client.touchValidate(0);

    expect(client.isValidateDue(0)).toBe(false);
    expect(client.isValidateDue(299)).toBe(false);
  });

  it('becomes due once VALIDATION_DEBOUNCE_MS has elapsed since the touch', () => {
    const client = new WorkerClient(new FakeWorker());
    client.touchValidate(0);

    expect(client.isValidateDue(300)).toBe(true);
  });

  it('pollValidate sends nothing and returns null while not due', () => {
    const worker = new FakeWorker();
    const client = new WorkerClient(worker);
    client.touchValidate(0);

    expect(client.pollValidate(299)).toBeNull();
    expect(worker.sent).toEqual([]);
  });

  it('a burst of touches within the window collapses into exactly one validate request', async () => {
    const worker = new FakeWorker();
    const client = new WorkerClient(worker);
    await client.parse('mode: rule\n');
    worker.sent.length = 0; // drop the seed parse() from the sent log

    client.touchValidate(0);
    client.touchValidate(100);
    client.touchValidate(200); // last edit of the burst

    expect(client.pollValidate(200)).toBeNull();
    expect(client.pollValidate(499)).toBeNull(); // 499 - 200 = 299ms, still short

    const pending = client.pollValidate(500); // 500 - 200 = 300ms: due
    expect(pending).not.toBeNull();
    await pending;

    expect(worker.sent.filter((request) => request.type === 'validate')).toHaveLength(1);
  });

  it('a later touch resets the window, so an edit just before the naive deadline is not dropped', () => {
    const client = new WorkerClient(new FakeWorker());

    client.touchValidate(0);
    expect(client.pollValidate(250)).toBeNull(); // 250ms since the first touch: not due yet

    client.touchValidate(280); // a fresh edit lands before the first window would have closed
    expect(client.pollValidate(300)).toBeNull(); // only 20ms since the *latest* touch, not 300ms since the first

    const pending = client.pollValidate(580); // 580 - 280 = 300ms since the latest touch
    expect(pending).not.toBeNull();
    // No parse() ever happened on this fresh worker, so the request this sends
    // is expected to reject with NO_DOCUMENT; only the debounce timing above
    // is under test here, so that rejection is deliberately left unasserted.
    pending?.catch(() => {});
  });

  it('consuming a due poll clears it, so an immediate re-poll is not due again', () => {
    const client = new WorkerClient(new FakeWorker());
    client.touchValidate(0);

    client.pollValidate(300)?.catch(() => {}); // fires against a document-less fake worker; timing is what's under test

    expect(client.isValidateDue(300)).toBe(false);
    expect(client.pollValidate(300)).toBeNull();
  });

  it('a second burst after consumption starts its own fresh window', () => {
    const client = new WorkerClient(new FakeWorker());
    client.touchValidate(0);
    client.pollValidate(300)?.catch(() => {}); // fires against a document-less fake worker; timing is what's under test

    client.touchValidate(600);
    expect(client.isValidateDue(600)).toBe(false);
    expect(client.isValidateDue(900)).toBe(true);
  });
});

const WORKER_DIR = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = join(WORKER_DIR, '..');
const ENGINE_AWARE_FILES = new Set([
  join(WORKER_DIR, 'protocol.ts'),
  join(WORKER_DIR, 'config.worker.ts'),
]);
const FORBIDDEN_SPECIFIERS = [
  "'@mcs/yaml-engine'",
  '"@mcs/yaml-engine"',
  "'@mcs/validator'",
  '"@mcs/validator"',
];

function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...collectSourceFiles(full));
      continue;
    }
    if (!/\.tsx?$/.test(name)) continue;
    if (name.endsWith('.test.ts') || name.endsWith('.test.tsx')) continue;
    out.push(full);
  }
  return out;
}

describe('main-thread module boundary (NFR-PERF-05)', () => {
  it('never imports @mcs/yaml-engine or @mcs/validator outside protocol.ts / config.worker.ts', () => {
    const offenders = collectSourceFiles(SRC_ROOT)
      .filter((file) => !ENGINE_AWARE_FILES.has(file))
      .filter((file) => {
        const content = readFileSync(file, 'utf8');
        return FORBIDDEN_SPECIFIERS.some((specifier) => content.includes(specifier));
      })
      .map((file) => relative(SRC_ROOT, file));

    expect(offenders).toEqual([]);
  });

  it('the exempted set only contains files that genuinely still exist, so it cannot rot silently', () => {
    for (const file of ENGINE_AWARE_FILES) {
      expect(statSync(file).isFile()).toBe(true);
    }
  });
});
