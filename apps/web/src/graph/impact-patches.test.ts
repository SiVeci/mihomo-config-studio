import { describe, expect, it } from 'vitest';

import type { Entity, IssueFix, Reference } from '../worker/protocol.js';
import { buildCascadeDeletePatches, buildReplacePatches } from './impact-patches.js';

describe('buildReplacePatches', () => {
  it('rewrites a seq-item reference to the new target and removes the entity itself', () => {
    const replaceable: Reference[] = [
      {
        fromId: 'proxy-group:1',
        toId: 'proxy-group:0',
        path: ['proxy-groups', 1, 'proxies', 0],
        referenceType: 'seq-item',
      },
    ];
    const patches = buildReplacePatches({}, ['proxy-groups', 0], replaceable, 'DIRECT');

    expect(patches).toEqual<IssueFix[]>([
      { kind: 'set', path: ['proxy-groups', 1, 'proxies', 0], value: 'DIRECT' },
      { kind: 'remove', path: ['proxy-groups', 0] },
    ]);
  });

  it('splices the new target into a scalar-fragment reference, preserving the rest of the line', () => {
    const documentValue = { rules: ['RULE-SET,ads,PROXY'] };
    const replaceable: Reference[] = [
      {
        fromId: 'rule:0',
        toId: 'rule-provider:0',
        path: ['rules', 0],
        referenceType: 'scalar-fragment',
        fragment: { start: 9, end: 12 }, // the "ads" span
      },
    ];
    const patches = buildReplacePatches(
      documentValue,
      ['rule-providers', 'ads'],
      replaceable,
      'cn',
    );

    expect(patches).toEqual<IssueFix[]>([
      { kind: 'set', path: ['rules', 0], value: 'RULE-SET,cn,PROXY' },
      { kind: 'remove', path: ['rule-providers', 'ads'] },
    ]);
  });

  it('produces only the remove patch when there is nothing to replace', () => {
    const patches = buildReplacePatches({}, ['proxy-groups', 0], [], 'DIRECT');
    expect(patches).toEqual<IssueFix[]>([{ kind: 'remove', path: ['proxy-groups', 0] }]);
  });

  it('skips a scalar-fragment reference whose path no longer resolves to a string, rather than throwing', () => {
    const replaceable: Reference[] = [
      {
        fromId: 'rule:0',
        toId: 'rule-provider:0',
        path: ['rules', 5], // out of range in this documentValue
        referenceType: 'scalar-fragment',
        fragment: { start: 0, end: 3 },
      },
    ];
    const patches = buildReplacePatches(
      { rules: [] },
      ['rule-providers', 'ads'],
      replaceable,
      'cn',
    );
    expect(patches).toEqual<IssueFix[]>([{ kind: 'remove', path: ['rule-providers', 'ads'] }]);
  });
});

describe('buildCascadeDeletePatches', () => {
  it('deletes the entity plus every cascading entity, and drops a replaceable seq-item reference rather than rewriting it', () => {
    const replaceable: Reference[] = [
      {
        fromId: 'proxy-group:1',
        toId: 'proxy-group:0',
        path: ['proxy-groups', 1, 'proxies', 0],
        referenceType: 'seq-item',
      },
    ];
    const cascading: Entity[] = [
      {
        id: 'proxy-group:2',
        kind: 'proxy-group',
        serializedName: 'SOLO',
        sourcePath: ['proxy-groups', 2, 'name'],
      },
    ];
    const patches = buildCascadeDeletePatches(['proxy-groups', 0], replaceable, cascading);

    expect(patches).toContainEqual({ kind: 'remove', path: ['proxy-groups', 1, 'proxies', 0] });
    // The two `proxy-groups` root-array removals (the cascading entity at
    // index 2, the entity itself at index 0) share that array, so *between
    // those two* descending order is required. The `proxies`-nested
    // removal lives in an unrelated array — its position relative to the
    // other two is irrelevant to correctness, only asserted as present above.
    const rootArrayIndices = patches
      .map((p) => p.path)
      .filter((path) => path.length === 2 && path[0] === 'proxy-groups')
      .map((path) => path[1]);
    expect(rootArrayIndices).toEqual([2, 0]);
  });

  it('drops the whole rule line for a scalar-fragment reference, since a rule cannot be left with no target', () => {
    const replaceable: Reference[] = [
      {
        fromId: 'rule:3',
        toId: 'proxy-group:0',
        path: ['rules', 3],
        referenceType: 'scalar-fragment',
        fragment: { start: 6, end: 10 },
      },
    ];
    const patches = buildCascadeDeletePatches(['proxy-groups', 0], replaceable, []);

    // Unrelated arrays (`rules` vs `proxy-groups`) — relative order between
    // them is irrelevant to correctness, only that both removals are present.
    expect(patches).toContainEqual({ kind: 'remove', path: ['rules', 3] });
    expect(patches).toContainEqual({ kind: 'remove', path: ['proxy-groups', 0] });
    expect(patches).toHaveLength(2);
  });

  it('sorts deletions within the same array in descending index order regardless of input order (the easiest mistake to make, per ADR-023’s batch-delete precedent)', () => {
    const cascading: Entity[] = [
      {
        id: 'proxy-group:1',
        kind: 'proxy-group',
        serializedName: 'A',
        sourcePath: ['proxy-groups', 1, 'name'],
      },
      {
        id: 'proxy-group:4',
        kind: 'proxy-group',
        serializedName: 'B',
        sourcePath: ['proxy-groups', 4, 'name'],
      },
    ];
    const patches = buildCascadeDeletePatches(['proxy-groups', 2], [], cascading);

    expect(patches.map((p) => p.path[p.path.length - 1])).toEqual([4, 2, 1]);
  });

  it('produces only the entity’s own removal when there is nothing replaceable or cascading', () => {
    const patches = buildCascadeDeletePatches(['proxy-groups', 0], [], []);
    expect(patches).toEqual<IssueFix[]>([{ kind: 'remove', path: ['proxy-groups', 0] }]);
  });
});
