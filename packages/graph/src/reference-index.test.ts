import { EntityRegistry, type Entity } from '@mcs/config-model';
import { readFixture } from '@mcs/test-fixtures';
import { changedLineNumbers, diffLines, MihomoYamlDocument } from '@mcs/yaml-engine';
import { describe, expect, it } from 'vitest';

import { GraphError, ReferenceIndex } from './reference-index.js';

const COMPREHENSIVE = readFixture('yaml/comprehensive.yaml');

function parse(source: string): MihomoYamlDocument {
  const result = MihomoYamlDocument.parse(source);
  if (!result.document) {
    throw new Error(`fixture failed to parse: ${result.issues.map((i) => i.message).join('; ')}`);
  }
  return result.document;
}

function find(entities: Entity[], predicate: (entity: Entity) => boolean): Entity {
  const found = entities.find(predicate);
  if (!found) throw new Error('entity not found');
  return found;
}

/** Builds a document + index + entities ready for a rename, from a fresh parse each time. */
function setUp(source: string = COMPREHENSIVE) {
  const document = parse(source);
  const registry = new EntityRegistry();
  const entities = registry.extract(document);
  const index = new ReferenceIndex();
  index.rebuild(document, entities);
  return { document, registry, entities, index };
}

/**
 * Asserts that renaming changed exactly `expectedLines` (1-indexed) and left
 * every other line byte-identical, including line count — the strong form
 * of "cascading rename touches only what it must".
 */
function assertOnlyLinesChanged(
  before: string,
  after: string,
  expectedLines: readonly number[],
): void {
  const sorted = [...expectedLines].sort((a, b) => a - b);
  expect(changedLineNumbers(diffLines(before, after))).toEqual({ removed: sorted, added: sorted });

  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');
  expect(afterLines).toHaveLength(beforeLines.length);
  beforeLines.forEach((line, i) => {
    if (expectedLines.includes(i + 1)) return;
    expect(afterLines[i]).toBe(line);
  });
}

describe('cascading rename (FR-REL-02)', () => {
  it('renames a proxy-group and every rule target that points at it, and nothing else', () => {
    const { document, entities, index } = setUp();
    const proxy = find(entities, (e) => e.kind === 'proxy-group' && e.serializedName === 'PROXY');

    index.rename(document, proxy.id, 'PROXY-MAIN');

    assertOnlyLinesChanged(COMPREHENSIVE, document.toText(), [116, 154, 159, 162]);
    expect(document.toText()).toContain('name: PROXY-MAIN');
  });

  it('renames a proxy-provider map key and every use[] reference, leaving a same-named file path untouched', () => {
    const { document, entities, index } = setUp();
    const provider = find(
      entities,
      (e) => e.kind === 'proxy-provider' && e.serializedName === 'provider-a',
    );

    index.rename(document, provider.id, 'prov-a');
    const after = document.toText();

    assertOnlyLinesChanged(COMPREHENSIVE, after, [100, 124, 128]);
    expect(after).toContain('path: ./providers/provider-a.yaml');
    expect(after).toContain('use: [prov-a, provider-b]');
    expect(document.anchors()).toEqual(['common-hc']);
  });

  it('renames a rule-provider map key and its RULE-SET payload, leaving a same-named file path untouched', () => {
    const { document, entities, index } = setUp();
    const ruleProvider = find(
      entities,
      (e) => e.kind === 'rule-provider' && e.serializedName === 'cn-domain',
    );

    index.rename(document, ruleProvider.id, 'cn-dom');
    const after = document.toText();

    assertOnlyLinesChanged(COMPREHENSIVE, after, [136, 157]);
    expect(after).toContain('path: ./rules/cn-domain.mrs');
    expect(after).toContain('RULE-SET,cn-dom,DIRECT');
  });

  it('renames a proxy-group referenced from a sibling group and nothing else', () => {
    const { document, entities, index } = setUp();
    const auto = find(entities, (e) => e.kind === 'proxy-group' && e.serializedName === 'AUTO');

    index.rename(document, auto.id, 'AUTO-URL');

    assertOnlyLinesChanged(COMPREHENSIVE, document.toText(), [119, 125]);
  });

  it('does not touch the document when the rename target does not exist', () => {
    const { document, index } = setUp();

    expect(() => index.rename(document, 'proxy-group:999', 'X')).toThrow(GraphError);
    expect(document.toText()).toBe(COMPREHENSIVE);
  });

  it('rejects a rename that collides with another entity of the same kind, without a half-done rewrite', () => {
    const { document, entities, index } = setUp();
    const auto = find(entities, (e) => e.kind === 'proxy-group' && e.serializedName === 'AUTO');

    let error: unknown;
    try {
      index.rename(document, auto.id, 'PROXY');
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(GraphError);
    expect((error as GraphError).code).toBe('GRAPH_NAME_CONFLICT');
    expect(document.toText()).toBe(COMPREHENSIVE);
  });

  it('rejects renaming a kind that has no name to rename (rule, builtin)', () => {
    const { document, entities, index } = setUp();
    const rule = find(entities, (e) => e.kind === 'rule');
    const builtin = find(entities, (e) => e.kind === 'builtin');

    expect(() => index.rename(document, rule.id, 'x')).toThrow(GraphError);
    expect(() => index.rename(document, builtin.id, 'x')).toThrow(GraphError);
    try {
      index.rename(document, rule.id, 'x');
    } catch (error) {
      expect((error as GraphError).code).toBe('GRAPH_RENAME_UNSUPPORTED');
    }
  });

  it('reflects a rename on the next rebuild, so a second rename resolves against the new name', () => {
    const { document, registry, entities, index } = setUp();
    const provider = find(
      entities,
      (e) => e.kind === 'proxy-provider' && e.serializedName === 'provider-a',
    );

    index.rename(document, provider.id, 'prov-a');
    const after = registry.extract(document);
    index.rebuild(document, after);

    const renamed = find(after, (e) => e.id === provider.id);
    expect(renamed.serializedName).toBe('prov-a');
    expect(after.some((e) => e.serializedName === 'provider-a')).toBe(false);

    // The old name resolves nothing now; renaming AUTO's own use[] entry still works.
    const auto = find(after, (e) => e.kind === 'proxy-group' && e.serializedName === 'AUTO');
    index.rename(document, auto.id, 'AUTO-2');
    expect(document.toText()).toContain('use: [prov-a, provider-b]');
  });
});

describe('reference scanning robustness', () => {
  it('produces no references when the document has no proxy-groups, rules or providers', () => {
    const { entities, index } = setUp('mode: rule\n');

    const builtin = find(entities, (e) => e.kind === 'builtin');
    expect(index.referencesTo(builtin.id)).toEqual([]);
  });

  it('skips a proxy-group with no name instead of crashing, and produces no reference from it', () => {
    const source = [
      'proxy-groups:',
      '  - type: select',
      '    proxies: [DIRECT]',
      '  - name: NAMED',
      '    type: select',
      '    proxies: [REJECT]',
      '',
    ].join('\n');
    const { entities, index } = setUp(source);

    const direct = find(entities, (e) => e.kind === 'builtin' && e.serializedName === 'DIRECT');
    const reject = find(entities, (e) => e.kind === 'builtin' && e.serializedName === 'REJECT');
    const named = find(entities, (e) => e.kind === 'proxy-group' && e.serializedName === 'NAMED');

    // The unnamed group has no entity id, so its "proxies: [DIRECT]" cannot
    // be attributed to a fromId and is silently skipped.
    expect(index.referencesTo(direct.id)).toEqual([]);
    // The named group's own reference (at array index 1) is still found.
    expect(index.referencesTo(reject.id)).toEqual([
      {
        fromId: named.id,
        toId: reject.id,
        path: ['proxy-groups', 1, 'proxies', 0],
        referenceType: 'seq-item',
      },
    ]);
  });

  it('ignores a dangling reference to a name no entity has', () => {
    const source = [
      'proxy-groups:',
      '  - name: G',
      '    type: select',
      '    proxies: [DOES-NOT-EXIST, DIRECT]',
      '',
    ].join('\n');
    const { entities, index } = setUp(source);

    const direct = find(entities, (e) => e.kind === 'builtin' && e.serializedName === 'DIRECT');
    expect(index.referencesTo(direct.id)).toHaveLength(1);
    expect(entities.some((e) => e.serializedName === 'DOES-NOT-EXIST')).toBe(false);
  });

  it('finds a scalar-fragment reference inside a sub-rule line', () => {
    const source = [
      'sub-rules:',
      '  ads-block:',
      '    - DOMAIN-SUFFIX,ads.example.com,PROXY',
      'proxy-groups:',
      '  - name: PROXY',
      '    type: select',
      '    proxies: [DIRECT]',
      'rules:',
      '  - MATCH,DIRECT',
      '',
    ].join('\n');
    const { document, entities, index } = setUp(source);

    const proxy = find(entities, (e) => e.kind === 'proxy-group' && e.serializedName === 'PROXY');
    index.rename(document, proxy.id, 'PROXY-2');

    expect(document.toText()).toContain('DOMAIN-SUFFIX,ads.example.com,PROXY-2');
  });

  it('does not resolve a SUB-RULE target even when a same-named entity exists', () => {
    const source = [
      'proxy-groups:',
      '  - name: ads-block',
      '    type: select',
      '    proxies: [DIRECT]',
      'rules:',
      '  - SUB-RULE,(NETWORK,TCP),ads-block',
      '  - MATCH,DIRECT',
      '',
    ].join('\n');
    const { entities, index } = setUp(source);

    const group = find(
      entities,
      (e) => e.kind === 'proxy-group' && e.serializedName === 'ads-block',
    );
    // A SUB-RULE's target names a sub-rule group, not a proxy-group, even
    // though this fixture happens to have a proxy-group with the same name.
    expect(index.referencesTo(group.id)).toEqual([]);
  });

  it('skips empty rule lines and malformed sub-rule groups instead of crashing', () => {
    const source = [
      'sub-rules:',
      '  empty-line:',
      '    - ""',
      '  not-an-array: "oops"',
      '  numbers:',
      '    - 42',
      'rules:',
      '  - ""',
      '  - MATCH,DIRECT',
      '',
    ].join('\n');
    const { entities, index } = setUp(source);

    expect(entities.some((e) => e.kind === 'rule' && e.serializedName === '')).toBe(false);
    expect(entities.some((e) => e.kind === 'sub-rule' && e.serializedName === '')).toBe(false);
    // Only the well-formed "MATCH,DIRECT" line contributes a reference; the
    // empty and malformed entries around it neither crash nor add one.
    const direct = find(entities, (e) => e.kind === 'builtin' && e.serializedName === 'DIRECT');
    expect(index.referencesTo(direct.id)).toHaveLength(1);
  });

  it('skips non-string items in a proxies[] list and a rules[] list instead of crashing', () => {
    const source = [
      'proxy-groups:',
      '  - name: G',
      '    type: select',
      '    proxies: [123, REJECT]',
      'rules:',
      '  - 456',
      '  - MATCH,DIRECT',
      '',
    ].join('\n');
    const { entities, index } = setUp(source);

    const reject = find(entities, (e) => e.kind === 'builtin' && e.serializedName === 'REJECT');
    const direct = find(entities, (e) => e.kind === 'builtin' && e.serializedName === 'DIRECT');
    expect(index.referencesTo(reject.id)).toHaveLength(1);
    expect(index.referencesTo(direct.id)).toHaveLength(1);
  });
});
