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
    expect(response).toEqual({
      type: 'applyPatch',
      requestId: 'r1',
      canUndo: true,
      canRedo: false,
    });

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
    expect(response).toEqual({
      type: 'applyPatch',
      requestId: 'r1',
      canUndo: true,
      canRedo: false,
    });

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

describe('handleWorkerRequest / undo, redo (FR-PROJ-04, v0.3.0 #15)', () => {
  it('undo reports NO_DOCUMENT before any successful parse', () => {
    const state = createWorkerState();
    const response = handleWorkerRequest(state, { type: 'undo', requestId: 'r1' });
    expect(response).toEqual({
      type: 'error',
      requestId: 'r1',
      code: 'NO_DOCUMENT',
      messageKey: 'worker.error.noDocument',
    });
  });

  it('redo reports NO_DOCUMENT before any successful parse', () => {
    const state = createWorkerState();
    const response = handleWorkerRequest(state, { type: 'redo', requestId: 'r1' });
    expect(response).toEqual({
      type: 'error',
      requestId: 'r1',
      code: 'NO_DOCUMENT',
      messageKey: 'worker.error.noDocument',
    });
  });

  it('undo with nothing recorded is a no-op — reflects the unchanged document, never throws', () => {
    const state = parsed();
    expect(() => handleWorkerRequest(state, { type: 'undo', requestId: 'r1' })).not.toThrow();
    const response = handleWorkerRequest(state, { type: 'undo', requestId: 'r2' });
    if (response.type !== 'undo') throw new Error('unreachable');
    expect(response).toMatchObject({ canUndo: false, canRedo: false, text: SAMPLE });
  });

  it('redo with nothing recorded is a no-op — reflects the unchanged document, never throws', () => {
    const state = parsed();
    expect(() => handleWorkerRequest(state, { type: 'redo', requestId: 'r1' })).not.toThrow();
    const response = handleWorkerRequest(state, { type: 'redo', requestId: 'r2' });
    if (response.type !== 'redo') throw new Error('unreachable');
    expect(response).toMatchObject({ canUndo: false, canRedo: false, text: SAMPLE });
  });

  it('undo after a real applyPatch restores the export text byte-exact and flips canUndo/canRedo', () => {
    const state = parsed();
    const patch: IssueFix = { kind: 'set-scalar', path: ['port'], value: 7891 };
    handleWorkerRequest(state, { type: 'applyPatch', requestId: 'r1', patch });

    const response = handleWorkerRequest(state, { type: 'undo', requestId: 'r2' });

    if (response.type !== 'undo') throw new Error('unreachable');
    expect(response.text).toBe(SAMPLE);
    expect(response.canUndo).toBe(false);
    expect(response.canRedo).toBe(true);
    expect(response.value).toMatchObject({ port: 7890 });
  });

  it('redo after an undo restores the edited text byte-exact', () => {
    const state = parsed();
    const patch: IssueFix = { kind: 'set-scalar', path: ['port'], value: 7891 };
    handleWorkerRequest(state, { type: 'applyPatch', requestId: 'r1', patch });
    handleWorkerRequest(state, { type: 'undo', requestId: 'r2' });

    const response = handleWorkerRequest(state, { type: 'redo', requestId: 'r3' });

    if (response.type !== 'redo') throw new Error('unreachable');
    expect(response.text).toContain('port: 7891');
    expect(response.canUndo).toBe(true);
    expect(response.canRedo).toBe(false);
    expect(response.value).toMatchObject({ port: 7891 });
  });

  it('two edits to the same path within the merge window collapse into one undo step', () => {
    const state = parsed();
    handleWorkerRequest(state, {
      type: 'applyPatch',
      requestId: 'r1',
      patch: { kind: 'set-scalar', path: ['port'], value: 1 },
    });
    handleWorkerRequest(state, {
      type: 'applyPatch',
      requestId: 'r2',
      patch: { kind: 'set-scalar', path: ['port'], value: 2 },
    });

    // One undo reaches all the way back to the original text, not the
    // intermediate `port: 1` — proving both edits merged into one entry.
    const response = handleWorkerRequest(state, { type: 'undo', requestId: 'r3' });

    if (response.type !== 'undo') throw new Error('unreachable');
    expect(response.text).toBe(SAMPLE);
    expect(response.canUndo).toBe(false);
  });

  it('a new edit after undo truncates the redo branch', () => {
    const state = parsed();
    handleWorkerRequest(state, {
      type: 'applyPatch',
      requestId: 'r1',
      patch: { kind: 'set-scalar', path: ['port'], value: 7891 },
    });
    handleWorkerRequest(state, { type: 'undo', requestId: 'r2' });

    handleWorkerRequest(state, {
      type: 'applyPatch',
      requestId: 'r3',
      patch: { kind: 'set-scalar', path: ['port'], value: 7892 },
    });

    const response = handleWorkerRequest(state, { type: 'redo', requestId: 'r4' });
    if (response.type !== 'redo') throw new Error('unreachable');
    expect(response.canRedo).toBe(false); // nothing to redo — the old branch was discarded
  });

  it('a fresh parse resets the undo/redo stack, so a project switch never reaches into the previous document', () => {
    const state = parsed();
    handleWorkerRequest(state, {
      type: 'applyPatch',
      requestId: 'r1',
      patch: { kind: 'set-scalar', path: ['port'], value: 7891 },
    });

    handleWorkerRequest(state, { type: 'parse', requestId: 'r2', text: 'mode: direct\n' });

    const response = handleWorkerRequest(state, { type: 'undo', requestId: 'r3' });
    if (response.type !== 'undo') throw new Error('unreachable');
    expect(response).toMatchObject({ canUndo: false, canRedo: false, text: 'mode: direct\n' });
  });

  it('re-parsing the exact text the Worker already holds does NOT reset the undo stack (regression: caught manually in a real browser, not by any automated test — see the plan\'s #15 "执行时修正")', () => {
    // `ProjectPage` feeds every applyPatch/undo/redo response's `text`
    // straight back into `configText`, which is `YamlEditor`'s controlled
    // `text` prop — its own debounced effect re-parses that *exact same*
    // text roughly 300ms later, with no user action involved. A parse that
    // unconditionally reset history made undo silently stop working a
    // fraction of a second after every single edit: invisible to a fast
    // synchronous test (which asserts well inside that window), real for
    // an actual user waiting more than 300ms before clicking Undo.
    const state = parsed();
    handleWorkerRequest(state, {
      type: 'applyPatch',
      requestId: 'r1',
      patch: { kind: 'set-scalar', path: ['port'], value: 7891 },
    });
    const serialized = handleWorkerRequest(state, { type: 'serialize', requestId: 'r2' });
    if (serialized.type !== 'serialize') throw new Error('unreachable');

    // The exact scenario: YamlEditor's own debounce re-parses the document's
    // own just-produced text, not anything a user typed.
    handleWorkerRequest(state, { type: 'parse', requestId: 'r3', text: serialized.text });

    const response = handleWorkerRequest(state, { type: 'undo', requestId: 'r4' });
    if (response.type !== 'undo') throw new Error('unreachable');
    expect(response.text).toBe(SAMPLE);
    expect(response.canUndo).toBe(false);
    expect(response.canRedo).toBe(true);
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

describe('handleWorkerRequest / previewProvider (PRD §8.11, v0.3.0 #17)', () => {
  it('summarizes proxy count, name, and type — never touching the currently open project state', () => {
    const state = parsed(); // a real project document is already open
    const response = handleWorkerRequest(state, {
      type: 'previewProvider',
      requestId: 'r1',
      text: 'proxies:\n  - name: HK-01\n    type: ss\n    server: s\n    port: 1\n    password: hunter2\n',
    });

    if (response.type !== 'previewProvider') throw new Error('unreachable');
    expect(response.preview).toEqual({
      proxyCount: 1,
      nodes: [
        {
          name: 'HK-01',
          proxyType: 'ss',
          fieldKeys: ['name', 'type', 'server', 'port', 'password'],
        },
      ],
    });
    // The Worker's actual open document is untouched by the preview call.
    expect(state.parseResult?.document?.toText()).toBe(SAMPLE);
  });

  it('never includes a sensitive value anywhere in the response — only the key name, for any field beyond name/type', () => {
    const state = createWorkerState();
    const response = handleWorkerRequest(state, {
      type: 'previewProvider',
      requestId: 'r1',
      text: 'proxies:\n  - name: a\n    type: vmess\n    uuid: 11111111-2222-3333-4444-555555555555\n    password: hunter2\n',
    });

    const serialized = JSON.stringify(response);
    expect(serialized).not.toContain('11111111-2222-3333-4444-555555555555');
    expect(serialized).not.toContain('hunter2');
    expect(serialized).toContain('uuid');
    expect(serialized).toContain('password');
  });

  it('is null for a syntax error, same as for well-formed YAML with no top-level proxies list', () => {
    const state = createWorkerState();

    const syntaxError = handleWorkerRequest(state, {
      type: 'previewProvider',
      requestId: 'r1',
      text: 'a: [1, 2\n',
    });
    if (syntaxError.type !== 'previewProvider') throw new Error('unreachable');
    expect(syntaxError.preview).toBeNull();

    const notAProviderFile = handleWorkerRequest(state, {
      type: 'previewProvider',
      requestId: 'r2',
      text: 'mode: rule\n',
    });
    if (notAProviderFile.type !== 'previewProvider') throw new Error('unreachable');
    expect(notAProviderFile.preview).toBeNull();
  });

  it('counts a malformed (non-object) entry rather than throwing, with empty shape info', () => {
    const state = createWorkerState();
    const response = handleWorkerRequest(state, {
      type: 'previewProvider',
      requestId: 'r1',
      text: 'proxies:\n  - "just a string"\n  - name: b\n    type: ss\n',
    });

    if (response.type !== 'previewProvider') throw new Error('unreachable');
    expect(response.preview).toEqual({
      proxyCount: 2,
      nodes: [
        { name: null, proxyType: null, fieldKeys: [] },
        { name: 'b', proxyType: 'ss', fieldKeys: ['name', 'type'] },
      ],
    });
  });
});
