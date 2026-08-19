import { describe, expect, it } from 'vitest';

import { createWorkerState, handleWorkerRequest } from './protocol.js';
import type { IssueFix, WorkerState } from './protocol.js';

const SAMPLE = `mode: rule
port: 7890
hosts:
  example.com: 1.2.3.4
rules:
  - DOMAIN,example.com,DIRECT
`;

function parsed(text: string = SAMPLE): WorkerState {
  const state = createWorkerState();
  handleWorkerRequest(state, { type: 'parse', requestId: 'seed', text });
  return state;
}

describe('handleWorkerRequest / parse', () => {
  it('returns no syntax issues and the freshly parsed value for syntactically valid input', () => {
    const state = createWorkerState();
    const response = handleWorkerRequest(state, { type: 'parse', requestId: 'r1', text: SAMPLE });

    if (response.type !== 'parse') throw new Error('unreachable');
    // Not `issues: []`: real Schema modules are resolved into every pipeline
    // call now (v0.3.0 #14), and `rules` belongs to no P0 module's schema —
    // `schemaStage` correctly flags it `unknown-field` (info, non-blocking).
    // This test's own job is syntax cleanliness; the dedicated test below
    // covers the real-module wiring this response now reflects.
    expect(response.issues.some((issue) => issue.module === 'yaml')).toBe(false);
    expect(response.value).toEqual({
      mode: 'rule',
      port: 7890,
      hosts: { 'example.com': '1.2.3.4' },
      rules: ['DOMAIN,example.com,DIRECT'],
    });
  });

  it('flags a field no installed P0 module describes as an info-severity unknown-field (FR-VAL-05, v0.3.0 #14)', () => {
    const state = createWorkerState();
    const response = handleWorkerRequest(state, { type: 'parse', requestId: 'r1', text: SAMPLE });

    if (response.type !== 'parse') throw new Error('unreachable');
    expect(response.issues).toContainEqual(
      expect.objectContaining({
        severity: 'info',
        code: 'unknown-field',
        module: 'schema',
        blocking: false,
        path: ['rules', 0],
      }),
    );
    expect(response.issues.every((issue) => issue.blocking === false)).toBe(true);
  });

  it('surfaces a blocking syntax issue for invalid input', () => {
    const state = createWorkerState();
    const response = handleWorkerRequest(state, {
      type: 'parse',
      requestId: 'r1',
      text: 'a: 1\n  b: 2\n',
    });

    expect(response.type).toBe('parse');
    if (response.type !== 'parse') throw new Error('unreachable');
    expect(response.issues.length).toBeGreaterThan(0);
    expect(response.issues[0]?.blocking).toBe(true);
    expect(response.issues[0]?.module).toBe('yaml');
  });

  it('replaces the previously held document, not merges with it', () => {
    const state = parsed();
    handleWorkerRequest(state, { type: 'parse', requestId: 'r2', text: 'mode: direct\n' });

    const response = handleWorkerRequest(state, { type: 'serialize', requestId: 'r3' });
    expect(response).toEqual({ type: 'serialize', requestId: 'r3', text: 'mode: direct\n' });
  });
});

describe('handleWorkerRequest / validate', () => {
  it('reports NO_DOCUMENT before any successful parse', () => {
    const state = createWorkerState();
    const response = handleWorkerRequest(state, { type: 'validate', requestId: 'r1' });

    expect(response).toEqual({
      type: 'error',
      requestId: 'r1',
      code: 'NO_DOCUMENT',
      messageKey: 'worker.error.noDocument',
    });
  });

  it('re-runs the pipeline against the currently held document, real modules included', () => {
    const state = parsed();
    const response = handleWorkerRequest(state, { type: 'validate', requestId: 'r1' });

    // Same `rules` unknown-field as the parse test above — `validate` re-runs
    // the identical pipeline against the document `parse` already composed.
    if (response.type !== 'validate') throw new Error('unreachable');
    expect(response.issues).toContainEqual(
      expect.objectContaining({ code: 'unknown-field', module: 'schema', path: ['rules', 0] }),
    );
  });
});

describe('handleWorkerRequest / applyPatch', () => {
  it('reports NO_DOCUMENT before any successful parse', () => {
    const state = createWorkerState();
    const patch: IssueFix = { kind: 'set-scalar', path: ['port'], value: 7891 };
    const response = handleWorkerRequest(state, { type: 'applyPatch', requestId: 'r1', patch });

    expect(response).toEqual({
      type: 'error',
      requestId: 'r1',
      code: 'NO_DOCUMENT',
      messageKey: 'worker.error.noDocument',
    });
  });

  it('set-scalar overwrites a scalar value, verified via a follow-up serialize', () => {
    const state = parsed();
    const patch: IssueFix = { kind: 'set-scalar', path: ['port'], value: 7891 };

    const response = handleWorkerRequest(state, { type: 'applyPatch', requestId: 'r1', patch });
    expect(response).toEqual({ type: 'applyPatch', requestId: 'r1' });

    const serialized = handleWorkerRequest(state, { type: 'serialize', requestId: 'r2' });
    expect(serialized.type).toBe('serialize');
    if (serialized.type !== 'serialize') throw new Error('unreachable');
    expect(serialized.text).toContain('port: 7891');
  });

  it('set-scalar without a value is rejected rather than silently ignored', () => {
    const state = parsed();
    const patch: IssueFix = { kind: 'set-scalar', path: ['port'] };

    const response = handleWorkerRequest(state, { type: 'applyPatch', requestId: 'r1', patch });

    expect(response).toEqual({
      type: 'error',
      requestId: 'r1',
      code: 'YAML_INVALID_OPERATION',
      messageKey: 'worker.error.YAML_INVALID_OPERATION',
      path: ['port'],
    });
  });

  it('remove deletes a map entry', () => {
    const state = parsed();
    const patch: IssueFix = { kind: 'remove', path: ['hosts', 'example.com'] };

    handleWorkerRequest(state, { type: 'applyPatch', requestId: 'r1', patch });

    const serialized = handleWorkerRequest(state, { type: 'serialize', requestId: 'r2' });
    if (serialized.type !== 'serialize') throw new Error('unreachable');
    expect(serialized.text).not.toContain('example.com: 1.2.3.4');
  });

  it('rename renames a map key while preserving its value', () => {
    const state = parsed();
    const patch: IssueFix = {
      kind: 'rename',
      path: ['hosts', 'example.com'],
      value: 'example.org',
    };

    handleWorkerRequest(state, { type: 'applyPatch', requestId: 'r1', patch });

    const serialized = handleWorkerRequest(state, { type: 'serialize', requestId: 'r2' });
    if (serialized.type !== 'serialize') throw new Error('unreachable');
    expect(serialized.text).toContain('example.org: 1.2.3.4');
    // The unrelated `rules` line still legitimately mentions example.com; only
    // the renamed hosts entry itself must be gone.
    expect(serialized.text).not.toContain('example.com: 1.2.3.4');
  });

  it('rename without a string value is rejected', () => {
    const state = parsed();
    const patch: IssueFix = { kind: 'rename', path: ['hosts', 'example.com'], value: 42 };

    const response = handleWorkerRequest(state, { type: 'applyPatch', requestId: 'r1', patch });

    expect(response).toMatchObject({ type: 'error', code: 'YAML_INVALID_OPERATION' });
  });

  it('rename with a path that does not end in a string key is rejected', () => {
    const state = parsed();
    // `rules[0]` ends in a numeric index, never a valid map key to rename.
    const patch: IssueFix = { kind: 'rename', path: ['rules', 0], value: 'renamed' };

    const response = handleWorkerRequest(state, { type: 'applyPatch', requestId: 'r1', patch });

    expect(response).toMatchObject({ type: 'error', code: 'YAML_INVALID_OPERATION' });
  });

  it('append adds an item to a sequence', () => {
    const state = parsed();
    const patch: IssueFix = { kind: 'append', path: ['rules'], value: 'DOMAIN,foo.com,DIRECT' };

    handleWorkerRequest(state, { type: 'applyPatch', requestId: 'r1', patch });

    const serialized = handleWorkerRequest(state, { type: 'serialize', requestId: 'r2' });
    if (serialized.type !== 'serialize') throw new Error('unreachable');
    expect(serialized.text).toContain('DOMAIN,foo.com,DIRECT');
  });

  it('surfaces a path-not-found failure as a structured error, not a thrown exception', () => {
    const state = parsed();
    const patch: IssueFix = { kind: 'set-scalar', path: ['does', 'not', 'exist'], value: 1 };

    const response = handleWorkerRequest(state, { type: 'applyPatch', requestId: 'r1', patch });

    expect(response).toMatchObject({
      type: 'error',
      code: 'YAML_PATH_NOT_FOUND',
      messageKey: 'worker.error.YAML_PATH_NOT_FOUND',
    });
  });

  it('set writes a non-scalar value — an array — unlike set-scalar (v0.3.0 #14 form editing)', () => {
    const state = parsed();
    const patch: IssueFix = { kind: 'set', path: ['hosts'], value: { 'b.example.com': '5.6.7.8' } };

    const response = handleWorkerRequest(state, { type: 'applyPatch', requestId: 'r1', patch });
    expect(response).toEqual({ type: 'applyPatch', requestId: 'r1' });

    const serialized = handleWorkerRequest(state, { type: 'serialize', requestId: 'r2' });
    if (serialized.type !== 'serialize') throw new Error('unreachable');
    expect(serialized.text).toContain('b.example.com: 5.6.7.8');
    expect(serialized.text).not.toContain('example.com: 1.2.3.4');
  });

  it('set without a value is rejected rather than silently ignored', () => {
    const state = parsed();
    const patch: IssueFix = { kind: 'set', path: ['hosts'] };

    const response = handleWorkerRequest(state, { type: 'applyPatch', requestId: 'r1', patch });

    expect(response).toEqual({
      type: 'error',
      requestId: 'r1',
      code: 'YAML_INVALID_OPERATION',
      messageKey: 'worker.error.YAML_INVALID_OPERATION',
      path: ['hosts'],
    });
  });
});

describe('handleWorkerRequest / value', () => {
  it('reports NO_DOCUMENT before any successful parse', () => {
    const state = createWorkerState();
    const response = handleWorkerRequest(state, { type: 'value', requestId: 'r1' });

    expect(response).toEqual({
      type: 'error',
      requestId: 'r1',
      code: 'NO_DOCUMENT',
      messageKey: 'worker.error.noDocument',
    });
  });

  it('returns the currently held document as plain JS', () => {
    const state = parsed();
    const response = handleWorkerRequest(state, { type: 'value', requestId: 'r1' });

    expect(response).toEqual({
      type: 'value',
      requestId: 'r1',
      value: {
        mode: 'rule',
        port: 7890,
        hosts: { 'example.com': '1.2.3.4' },
        rules: ['DOMAIN,example.com,DIRECT'],
      },
    });
  });

  it('reflects a write made through applyPatch, not a stale snapshot', () => {
    const state = parsed();
    handleWorkerRequest(state, {
      type: 'applyPatch',
      requestId: 'r1',
      patch: { kind: 'set-scalar', path: ['port'], value: 7891 },
    });

    const response = handleWorkerRequest(state, { type: 'value', requestId: 'r2' });
    if (response.type !== 'value') throw new Error('unreachable');
    expect(response.value).toMatchObject({ port: 7891 });
  });
});

describe('handleWorkerRequest / diff', () => {
  it('reports NO_DOCUMENT before any successful parse', () => {
    const state = createWorkerState();
    const response = handleWorkerRequest(state, { type: 'diff', requestId: 'r1', baseline: '' });

    expect(response).toEqual({
      type: 'error',
      requestId: 'r1',
      code: 'NO_DOCUMENT',
      messageKey: 'worker.error.noDocument',
    });
  });

  it('diffs the current document text against a supplied baseline', () => {
    const state = parsed();
    handleWorkerRequest(state, {
      type: 'applyPatch',
      requestId: 'r1',
      patch: { kind: 'set-scalar', path: ['port'], value: 7891 },
    });

    const response = handleWorkerRequest(state, {
      type: 'diff',
      requestId: 'r2',
      baseline: SAMPLE,
    });
    if (response.type !== 'diff') throw new Error('unreachable');
    expect(response.diff.identical).toBe(false);
    expect(response.diff.added).toBeGreaterThan(0);
    expect(response.diff.removed).toBeGreaterThan(0);
  });

  it('reports identical: true against its own unmodified text', () => {
    const state = parsed();
    const response = handleWorkerRequest(state, {
      type: 'diff',
      requestId: 'r1',
      baseline: SAMPLE,
    });

    if (response.type !== 'diff') throw new Error('unreachable');
    expect(response.diff.identical).toBe(true);
  });
});

describe('handleWorkerRequest / serialize', () => {
  it('reports NO_DOCUMENT before any successful parse', () => {
    const state = createWorkerState();
    const response = handleWorkerRequest(state, { type: 'serialize', requestId: 'r1' });

    expect(response).toEqual({
      type: 'error',
      requestId: 'r1',
      code: 'NO_DOCUMENT',
      messageKey: 'worker.error.noDocument',
    });
  });

  it('round-trips untouched text byte for byte', () => {
    const state = parsed();
    const response = handleWorkerRequest(state, { type: 'serialize', requestId: 'r1' });

    expect(response).toEqual({ type: 'serialize', requestId: 'r1', text: SAMPLE });
  });

  it('forwards serialize options through to the document', () => {
    const state = parsed();
    // `remove` always calls the document's #markStructural(): CST replay
    // (the untouched-text fast path) ignores SerializeOptions entirely, so a
    // structural edit is required to exercise the code path that honours it.
    handleWorkerRequest(state, {
      type: 'applyPatch',
      requestId: 'r1',
      patch: { kind: 'remove', path: ['port'] },
    });

    const response = handleWorkerRequest(state, {
      type: 'serialize',
      requestId: 'r2',
      options: { indent: 4 },
    });

    if (response.type !== 'serialize') throw new Error('unreachable');
    expect(response.text).toContain('\n    example.com: 1.2.3.4');
  });
});

describe('handleWorkerRequest / locate', () => {
  it('reports NO_DOCUMENT before any successful parse', () => {
    const state = createWorkerState();
    const response = handleWorkerRequest(state, {
      type: 'locate',
      requestId: 'r1',
      path: ['port'],
    });

    expect(response).toEqual({
      type: 'error',
      requestId: 'r1',
      code: 'NO_DOCUMENT',
      messageKey: 'worker.error.noDocument',
    });
  });

  it('returns the range of an existing path', () => {
    const state = parsed();
    const response = handleWorkerRequest(state, {
      type: 'locate',
      requestId: 'r1',
      path: ['port'],
    });

    if (response.type !== 'locate') throw new Error('unreachable');
    expect(response.range).not.toBeNull();
    expect(response.range?.start.line).toBe(2);
  });

  it('returns a null range for a path that does not resolve to any node', () => {
    const state = parsed();
    const response = handleWorkerRequest(state, {
      type: 'locate',
      requestId: 'r1',
      path: ['does', 'not', 'exist'],
    });

    expect(response).toEqual({ type: 'locate', requestId: 'r1', range: null });
  });
});
