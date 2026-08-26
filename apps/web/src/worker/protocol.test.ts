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

  it('move reorders a sequence item (v0.4.0 #9 drag/keyboard reorder)', () => {
    const state = parsed(`mode: rule
rules:
  - MATCH,DIRECT
  - DOMAIN,a.com,PROXY
  - DOMAIN,b.com,PROXY
`);
    const patch: IssueFix = { kind: 'move', path: ['rules'], from: 0, to: 2 };

    const response = handleWorkerRequest(state, { type: 'applyPatch', requestId: 'r1', patch });
    expect(response).toEqual({
      type: 'applyPatch',
      requestId: 'r1',
      canUndo: true,
      canRedo: false,
    });

    const value = handleWorkerRequest(state, { type: 'value', requestId: 'r2' });
    if (value.type !== 'value') throw new Error('unreachable');
    expect(value.value).toMatchObject({
      rules: ['DOMAIN,a.com,PROXY', 'DOMAIN,b.com,PROXY', 'MATCH,DIRECT'],
    });
  });

  it('move with an out-of-range index is rejected as a structured error, not a thrown exception', () => {
    const state = parsed(`mode: rule
rules:
  - MATCH,DIRECT
`);
    const patch: IssueFix = { kind: 'move', path: ['rules'], from: 0, to: 5 };

    const response = handleWorkerRequest(state, { type: 'applyPatch', requestId: 'r1', patch });

    expect(response).toMatchObject({ type: 'error', code: 'YAML_INVALID_OPERATION' });
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

describe('handleWorkerRequest / applyBatch (v0.4.0 #10, ADR-023)', () => {
  it('reports NO_DOCUMENT before any successful parse', () => {
    const state = createWorkerState();
    const response = handleWorkerRequest(state, {
      type: 'applyBatch',
      requestId: 'r1',
      patches: [{ kind: 'set-scalar', path: ['port'], value: 1 }],
    });

    expect(response).toEqual({
      type: 'error',
      requestId: 'r1',
      code: 'NO_DOCUMENT',
      messageKey: 'worker.error.noDocument',
    });
  });

  it('applies every patch in the batch and records exactly one history entry (one undo reverts all of them)', () => {
    const state = parsed(`mode: rule
rules:
  - MATCH,A
  - MATCH,B
  - MATCH,C
`);
    const response = handleWorkerRequest(state, {
      type: 'applyBatch',
      requestId: 'r1',
      patches: [
        { kind: 'set', path: ['rules', 0], value: 'MATCH,A2' },
        { kind: 'set', path: ['rules', 1], value: 'MATCH,B2' },
        { kind: 'set', path: ['rules', 2], value: 'MATCH,C2' },
      ],
    });

    expect(response).toEqual({
      type: 'applyBatch',
      requestId: 'r1',
      canUndo: true,
      canRedo: false,
    });

    const serialized = handleWorkerRequest(state, { type: 'serialize', requestId: 'r2' });
    if (serialized.type !== 'serialize') throw new Error('unreachable');
    expect(serialized.text).toContain('MATCH,A2');
    expect(serialized.text).toContain('MATCH,B2');
    expect(serialized.text).toContain('MATCH,C2');

    const undone = handleWorkerRequest(state, { type: 'undo', requestId: 'r3' });
    if (undone.type !== 'undo') throw new Error('unreachable');
    // A single undo restores every one of the three patches at once — this is
    // the whole point of a batch: not three history entries collapsing into
    // three undo presses, but one.
    expect(undone.canUndo).toBe(false);
    expect(undone.text).toContain('MATCH,A\n');
    expect(undone.text).toContain('MATCH,B\n');
    expect(undone.text).toContain('MATCH,C\n');
  });

  it('never merges a batch into an adjacent single-patch edit, even inside the same merge window', () => {
    const state = parsed(`mode: rule
rules:
  - MATCH,A
  - MATCH,B
`);
    handleWorkerRequest(state, {
      type: 'applyPatch',
      requestId: 'r1',
      patch: { kind: 'set', path: ['rules', 0], value: 'MATCH,A2' },
    });
    handleWorkerRequest(state, {
      type: 'applyBatch',
      requestId: 'r2',
      patches: [{ kind: 'set', path: ['rules', 1], value: 'MATCH,B2' }],
    });

    // Two separate history entries, not one merged entry: undoing once must
    // only revert the batch, leaving the earlier single-patch edit intact.
    const undone = handleWorkerRequest(state, { type: 'undo', requestId: 'r3' });
    if (undone.type !== 'undo') throw new Error('unreachable');
    expect(undone.canUndo).toBe(true);
    expect(undone.text).toContain('MATCH,A2');
    expect(undone.text).toContain('MATCH,B\n');
  });

  it('is all-or-nothing: a failing patch mid-batch leaves the document byte-identical to before the batch, with no history entry recorded', () => {
    const state = parsed(`mode: rule
rules:
  - MATCH,A
  - MATCH,B
`);
    const beforeSerialize = handleWorkerRequest(state, { type: 'serialize', requestId: 'r0' });
    if (beforeSerialize.type !== 'serialize') throw new Error('unreachable');
    const beforeText = beforeSerialize.text;
    const canUndoBefore = state.historyStack.canUndo;

    const response = handleWorkerRequest(state, {
      type: 'applyBatch',
      requestId: 'r1',
      patches: [
        { kind: 'set', path: ['rules', 0], value: 'MATCH,A2' }, // succeeds
        { kind: 'set-scalar', path: ['does', 'not', 'exist'], value: 1 }, // fails
        { kind: 'set', path: ['rules', 1], value: 'MATCH,B2' }, // never reached
      ],
    });

    expect(response).toMatchObject({ type: 'error', code: 'YAML_PATH_NOT_FOUND' });

    const afterSerialize = handleWorkerRequest(state, { type: 'serialize', requestId: 'r2' });
    if (afterSerialize.type !== 'serialize') throw new Error('unreachable');
    expect(afterSerialize.text).toBe(beforeText);
    expect(afterSerialize.text).not.toContain('MATCH,A2');
    expect(state.historyStack.canUndo).toBe(canUndoBefore);
  });
});

describe('handleWorkerRequest / analyzeImpact (v0.4.0 #11, FR-REL-03 UI)', () => {
  const IMPACT_SAMPLE = `mode: rule
proxy-groups:
  - name: AUTO
    type: url-test
    proxies: [DIRECT]
  - name: PROXY
    type: select
    proxies: [AUTO, DIRECT]
rule-providers:
  ads:
    type: http
    behavior: domain
    url: https://example.invalid/ads.txt
    path: ./ads.yaml
rules:
  - RULE-SET,ads,DIRECT
  - MATCH,DIRECT
`;

  it('reports NO_DOCUMENT before any successful parse', () => {
    const state = createWorkerState();
    const response = handleWorkerRequest(state, {
      type: 'analyzeImpact',
      requestId: 'r1',
      path: ['proxy-groups', 0, 'name'],
    });

    expect(response).toEqual({
      type: 'error',
      requestId: 'r1',
      code: 'NO_DOCUMENT',
      messageKey: 'worker.error.noDocument',
    });
  });

  it('reports GRAPH_ENTITY_NOT_FOUND for a path that does not name an existing entity', () => {
    const state = parsed(IMPACT_SAMPLE);
    const response = handleWorkerRequest(state, {
      type: 'analyzeImpact',
      requestId: 'r1',
      path: ['proxy-groups', 99, 'name'],
    });

    expect(response).toEqual({
      type: 'error',
      requestId: 'r1',
      code: 'GRAPH_ENTITY_NOT_FOUND',
      messageKey: 'worker.error.GRAPH_ENTITY_NOT_FOUND',
      path: ['proxy-groups', 99, 'name'],
    });
  });

  it('finds the entity by sourcePath and reports the proxy-group that references it as replaceable (not cascading, since it keeps another member)', () => {
    const state = parsed(IMPACT_SAMPLE);
    const response = handleWorkerRequest(state, {
      type: 'analyzeImpact',
      requestId: 'r1',
      path: ['proxy-groups', 0, 'name'], // AUTO
    });

    if (response.type !== 'analyzeImpact') throw new Error('unreachable');
    expect(response.entity).toMatchObject({ kind: 'proxy-group', serializedName: 'AUTO' });
    expect(response.result.cascading).toEqual([]);
    expect(response.result.replaceable).toHaveLength(1);
    expect(response.result.replaceable[0]).toMatchObject({
      path: ['proxy-groups', 1, 'proxies', 0],
      referenceType: 'seq-item',
    });
  });

  it('also finds a named-array entity by its item’s own path (one segment shorter than sourcePath) — the shape the real UI actually has', () => {
    const state = parsed(IMPACT_SAMPLE);
    const response = handleWorkerRequest(state, {
      type: 'analyzeImpact',
      requestId: 'r1',
      path: ['proxy-groups', 0], // AUTO, item path rather than its `name` field's sourcePath
    });

    if (response.type !== 'analyzeImpact') throw new Error('unreachable');
    expect(response.entity).toMatchObject({ kind: 'proxy-group', serializedName: 'AUTO' });
    expect(response.result.replaceable).toHaveLength(1);
  });

  it('finds a rule-provider by its map-key sourcePath and reports the RULE-SET rule referencing it', () => {
    const state = parsed(IMPACT_SAMPLE);
    const response = handleWorkerRequest(state, {
      type: 'analyzeImpact',
      requestId: 'r1',
      path: ['rule-providers', 'ads'],
    });

    if (response.type !== 'analyzeImpact') throw new Error('unreachable');
    expect(response.result.cascading).toEqual([]);
    expect(response.result.replaceable).toHaveLength(1);
    expect(response.result.replaceable[0]).toMatchObject({ path: ['rules', 0] });
  });

  it('re-derives the entity index fresh from the current document rather than caching it (an edit between two requests changes the answer)', () => {
    const state = parsed(IMPACT_SAMPLE);
    // Empty PROXY's proxies down to just AUTO, so removing AUTO now cascades.
    handleWorkerRequest(state, {
      type: 'applyPatch',
      requestId: 'r0',
      patch: { kind: 'set', path: ['proxy-groups', 1, 'proxies'], value: ['AUTO'] },
    });

    const response = handleWorkerRequest(state, {
      type: 'analyzeImpact',
      requestId: 'r1',
      path: ['proxy-groups', 0, 'name'], // AUTO
    });

    if (response.type !== 'analyzeImpact') throw new Error('unreachable');
    expect(response.result.cascading).toHaveLength(1);
    expect(response.result.cascading[0]).toMatchObject({
      kind: 'proxy-group',
      serializedName: 'PROXY',
    });
  });
});

describe('handleWorkerRequest / graphLayout (v0.4.0 #13, FR-REL-04/06)', () => {
  const GRAPH_SAMPLE = `mode: rule
proxy-groups:
  - name: AUTO
    type: url-test
    proxies: [DIRECT]
  - name: PROXY
    type: select
    proxies: [AUTO, DIRECT]
rule-providers:
  ads:
    type: http
    behavior: domain
    url: https://example.invalid/ads.txt
    path: ./ads.yaml
rules:
  - RULE-SET,ads,DIRECT
  - MATCH,DIRECT
`;

  it('reports NO_DOCUMENT before any successful parse', () => {
    const state = createWorkerState();
    const response = handleWorkerRequest(state, { type: 'graphLayout', requestId: 'r1' });

    expect(response).toEqual({
      type: 'error',
      requestId: 'r1',
      code: 'NO_DOCUMENT',
      messageKey: 'worker.error.noDocument',
    });
  });

  it('lays out every entity into its layer, alongside a non-empty edge list and an empty cycle list for an acyclic document', () => {
    const state = parsed(GRAPH_SAMPLE);
    const response = handleWorkerRequest(state, { type: 'graphLayout', requestId: 'r1' });

    if (response.type !== 'graphLayout') throw new Error('unreachable');
    const byName = (name: string) =>
      response.layout.nodes.find((n) => !n.aggregated && n.name === name);
    expect(byName('AUTO')).toMatchObject({ kind: 'proxy-group', layer: 1 });
    expect(byName('DIRECT')).toMatchObject({ kind: 'builtin', layer: 0 });
    expect(byName('ads')).toMatchObject({ kind: 'rule-provider', layer: 2 });
    expect(response.layout.edges.length).toBeGreaterThan(0);
    expect(response.cycles).toEqual([]);
  });

  it('carries the full entity list alongside the layout, so a clicked node’s id resolves back to a jump-to-field sourcePath', () => {
    const state = parsed(GRAPH_SAMPLE);
    const response = handleWorkerRequest(state, { type: 'graphLayout', requestId: 'r1' });

    if (response.type !== 'graphLayout') throw new Error('unreachable');
    const node = response.layout.nodes.find((n) => !n.aggregated && n.name === 'AUTO');
    if (!node) throw new Error('expected an AUTO node');
    const entity = response.entities.find((e) => e.id === node.id);
    expect(entity).toMatchObject({ kind: 'proxy-group', sourcePath: ['proxy-groups', 0, 'name'] });
  });

  it('forwards options.aggregateThreshold through to buildGraphLayout', () => {
    const state = parsed(GRAPH_SAMPLE);
    const response = handleWorkerRequest(state, {
      type: 'graphLayout',
      requestId: 'r1',
      options: { aggregateThreshold: 1 },
    });

    if (response.type !== 'graphLayout') throw new Error('unreachable');
    const aggregate = response.layout.nodes.find((n) => n.aggregated && n.kind === 'proxy-group');
    expect(aggregate).toMatchObject({ count: 2 });
  });

  it('flags a real proxy-group nesting cycle as both an edge status and a name-sequence list', () => {
    const state = parsed(
      [
        'proxy-groups:',
        '  - {name: a, type: select, proxies: [b]}',
        '  - {name: b, type: select, proxies: [a]}',
        '',
      ].join('\n'),
    );
    const response = handleWorkerRequest(state, { type: 'graphLayout', requestId: 'r1' });

    if (response.type !== 'graphLayout') throw new Error('unreachable');
    expect(response.cycles).toHaveLength(1);
    expect(response.cycles[0]).toEqual(expect.arrayContaining(['a', 'b']));
    expect(response.layout.edges.some((e) => e.status === 'cycle')).toBe(true);
  });

  it('re-derives the graph fresh from the current document rather than caching it (an edit between two requests changes the answer)', () => {
    const state = parsed(GRAPH_SAMPLE);
    // Empties PROXY's proxies down to just AUTO, so the DIRECT edge from PROXY should disappear.
    handleWorkerRequest(state, {
      type: 'applyPatch',
      requestId: 'r0',
      patch: { kind: 'set', path: ['proxy-groups', 1, 'proxies'], value: ['AUTO'] },
    });

    const response = handleWorkerRequest(state, { type: 'graphLayout', requestId: 'r1' });

    if (response.type !== 'graphLayout') throw new Error('unreachable');
    const proxyNode = response.layout.nodes.find((n) => !n.aggregated && n.name === 'PROXY');
    if (!proxyNode) throw new Error('expected a PROXY node');
    const edgesFromProxy = response.layout.edges.filter((e) => e.fromId === proxyNode.id);
    expect(edgesFromProxy).toHaveLength(1);
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
