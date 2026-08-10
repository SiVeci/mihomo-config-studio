import { readFixture } from '@mcs/test-fixtures';
import { MihomoYamlDocument } from '@mcs/yaml-engine';
import { describe, expect, it } from 'vitest';

import { EntityRegistry, type Entity, type EntityKind } from './entity.js';

const COMPREHENSIVE = readFixture('yaml/comprehensive.yaml');
const MINIMAL = readFixture('yaml/minimal.yaml');

function parse(source: string): MihomoYamlDocument {
  const result = MihomoYamlDocument.parse(source);
  if (!result.document) {
    throw new Error(`fixture failed to parse: ${result.issues.map((i) => i.message).join('; ')}`);
  }
  return result.document;
}

function countBy(entities: Entity[], kind: EntityKind): number {
  return entities.filter((entity) => entity.kind === kind).length;
}

function find(entities: Entity[], predicate: (entity: Entity) => boolean): Entity {
  const found = entities.find(predicate);
  if (!found) throw new Error('entity not found');
  return found;
}

describe('entity extraction (FR-REL-01)', () => {
  it('extracts every referenceable kind from comprehensive.yaml', () => {
    const entities = new EntityRegistry().extract(parse(COMPREHENSIVE));

    expect(countBy(entities, 'proxy')).toBe(3);
    expect(countBy(entities, 'proxy-group')).toBe(3);
    expect(countBy(entities, 'proxy-provider')).toBe(2);
    expect(countBy(entities, 'rule-provider')).toBe(2);
    expect(countBy(entities, 'rule')).toBe(10);
  });

  it('registers the six unconditional builtins plus an auto GLOBAL when the document defines none', () => {
    const entities = new EntityRegistry().extract(parse(COMPREHENSIVE));
    const builtinNames = entities
      .filter((entity) => entity.kind === 'builtin')
      .map((entity) => entity.serializedName)
      .sort();

    expect(builtinNames).toEqual(
      ['COMPATIBLE', 'DIRECT', 'GLOBAL', 'PASS', 'PASS-RULE', 'REJECT', 'REJECT-DROP'].sort(),
    );
  });

  it('defers to a user-defined GLOBAL proxy-group instead of adding a builtin one', () => {
    const document = parse(
      ['proxy-groups:', '  - name: GLOBAL', '    type: select', '    proxies: [DIRECT]', ''].join(
        '\n',
      ),
    );
    const entities = new EntityRegistry().extract(document);

    expect(countBy(entities, 'builtin')).toBe(6);
    expect(find(entities, (e) => e.kind === 'proxy-group').serializedName).toBe('GLOBAL');
  });

  it('keeps a proxy-group id stable after its name field changes via setScalarIn', () => {
    const document = parse(COMPREHENSIVE);
    const registry = new EntityRegistry();
    const before = find(
      registry.extract(document),
      (e) => e.kind === 'proxy-group' && e.serializedName === 'PROXY',
    );

    document.setScalarIn(before.sourcePath, 'PROXY-MAIN');
    const after = registry.extract(document);

    expect(find(after, (e) => e.id === before.id).serializedName).toBe('PROXY-MAIN');
    expect(after.some((e) => e.serializedName === 'PROXY')).toBe(false);
  });

  it('keeps a proxy-provider id stable after its map key is renamed via renameKeyIn', () => {
    const document = parse(COMPREHENSIVE);
    const registry = new EntityRegistry();
    const before = find(
      registry.extract(document),
      (e) => e.kind === 'proxy-provider' && e.serializedName === 'provider-a',
    );

    document.renameKeyIn(['proxy-providers'], 'provider-a', 'prov-a');
    const after = registry.extract(document);

    expect(find(after, (e) => e.id === before.id).serializedName).toBe('prov-a');
  });

  it('drops an entity once it no longer exists in the document', () => {
    const document = parse(COMPREHENSIVE);
    const registry = new EntityRegistry();
    registry.extract(document);

    document.deleteIn(['proxies', 2]);
    const after = registry.extract(document);

    expect(countBy(after, 'proxy')).toBe(2);
    expect(after.some((e) => e.serializedName === 'Trojan-SG')).toBe(false);
  });

  it('never writes an assigned id into the serialised document', () => {
    const document = parse(COMPREHENSIVE);
    const entities = new EntityRegistry().extract(document);
    const text = document.toText();

    for (const entity of entities) {
      expect(text).not.toContain(entity.id);
    }
  });
});

describe('entity extraction edge cases', () => {
  it('returns only builtins when the document has no addressable sections', () => {
    const entities = new EntityRegistry().extract(parse('mode: rule\n'));

    expect(entities).toHaveLength(7);
    expect(entities.every((e) => e.kind === 'builtin')).toBe(true);
  });

  it('treats empty arrays the same as absent keys', () => {
    const entities = new EntityRegistry().extract(parse(MINIMAL));

    expect(countBy(entities, 'proxy')).toBe(0);
    expect(countBy(entities, 'proxy-group')).toBe(0);
    expect(countBy(entities, 'rule')).toBe(1);
  });

  it('skips array items that are not objects or that have no usable name', () => {
    const document = parse(
      [
        'proxies:',
        '  - name: Valid',
        '    type: ss',
        '  - type: ss',
        '  - "not-an-object"',
        '  - name: ""',
        '    type: ss',
        '',
      ].join('\n'),
    );
    const entities = new EntityRegistry().extract(document);

    expect(countBy(entities, 'proxy')).toBe(1);
    expect(find(entities, (e) => e.kind === 'proxy').serializedName).toBe('Valid');
  });

  it('skips non-string rule lines', () => {
    const document = parse(['rules:', '  - 123', '  - MATCH,DIRECT', ''].join('\n'));
    const entities = new EntityRegistry().extract(document);

    expect(countBy(entities, 'rule')).toBe(1);
    expect(find(entities, (e) => e.kind === 'rule').serializedName).toBe('MATCH,DIRECT');
  });

  it('extracts one entity per sub-rule line and skips malformed groups', () => {
    const document = parse(
      [
        'sub-rules:',
        '  ads-block:',
        '    - DOMAIN-SUFFIX,ads.example.com,REJECT',
        '    - 42',
        '  broken-group: "not-an-array"',
        'rules:',
        '  - MATCH,DIRECT',
        '',
      ].join('\n'),
    );
    const entities = new EntityRegistry().extract(document);

    expect(countBy(entities, 'sub-rule')).toBe(1);
    const subRule = find(entities, (e) => e.kind === 'sub-rule');
    expect(subRule.serializedName).toBe('DOMAIN-SUFFIX,ads.example.com,REJECT');
    expect(subRule.sourcePath).toEqual(['sub-rules', 'ads-block', 0]);
  });
});
