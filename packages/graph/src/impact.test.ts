import { EntityRegistry, type Entity } from '@mcs/config-model';
import { readFixture } from '@mcs/test-fixtures';
import { MihomoYamlDocument } from '@mcs/yaml-engine';
import { describe, expect, it } from 'vitest';

import { analyzeImpact } from './impact.js';
import { GraphError, ReferenceIndex } from './reference-index.js';

const COMPREHENSIVE = readFixture('yaml/comprehensive.yaml');

function parse(source: string): MihomoYamlDocument {
  const result = MihomoYamlDocument.parse(source);
  if (!result.document) {
    throw new Error(
      `fixture failed to parse: ${result.issues.map((i) => i.messageKey).join('; ')}`,
    );
  }
  return result.document;
}

function find(entities: Entity[], predicate: (entity: Entity) => boolean): Entity {
  const found = entities.find(predicate);
  if (!found) throw new Error('entity not found');
  return found;
}

function setUp(source: string = COMPREHENSIVE) {
  const document = parse(source);
  const entities = new EntityRegistry().extract(document);
  const index = new ReferenceIndex();
  index.rebuild(document, entities);
  return { document, entities, index };
}

describe('impact analysis (FR-REL-03)', () => {
  it('classifies AUTO as replaceable via the one group that lists it, since PROXY keeps other members', () => {
    const { entities, index } = setUp();
    const auto = find(entities, (e) => e.kind === 'proxy-group' && e.serializedName === 'AUTO');
    const proxy = find(entities, (e) => e.kind === 'proxy-group' && e.serializedName === 'PROXY');

    const result = analyzeImpact(parse(COMPREHENSIVE), index, auto.id);

    expect(result.cascading).toEqual([]);
    expect(result.replaceable).toEqual([
      {
        fromId: proxy.id,
        toId: auto.id,
        path: ['proxy-groups', 0, 'proxies', 0],
        referenceType: 'seq-item',
      },
    ]);
  });

  it('classifies a RULE-SET payload reference to a rule-provider as replaceable', () => {
    const { entities, index } = setUp();
    const cnDomain = find(
      entities,
      (e) => e.kind === 'rule-provider' && e.serializedName === 'cn-domain',
    );

    const result = analyzeImpact(parse(COMPREHENSIVE), index, cnDomain.id);

    expect(result.cascading).toEqual([]);
    expect(result.replaceable).toHaveLength(1);
    expect(result.replaceable[0]).toMatchObject({
      referenceType: 'scalar-fragment',
      toId: cnDomain.id,
    });
  });

  it('classifies both group.use[] references to a proxy-provider as replaceable when neither group is emptied', () => {
    const { entities, index } = setUp();
    const providerA = find(
      entities,
      (e) => e.kind === 'proxy-provider' && e.serializedName === 'provider-a',
    );

    const result = analyzeImpact(parse(COMPREHENSIVE), index, providerA.id);

    expect(result.cascading).toEqual([]);
    expect(result.replaceable).toHaveLength(2);
    expect(result.replaceable.every((ref) => ref.toId === providerA.id)).toBe(true);
  });

  it('finds no references and no cascades for an entity nothing points at', () => {
    const { entities, index } = setUp();
    // DIRECT-GROUP is a proxy-group nothing else lists in proxies[]/use[] or
    // targets from a rule — unlike SS-Tokyo/Vmess-HK/Trojan-SG, which all
    // appear in PROXY's own proxies[] list.
    const directGroup = find(
      entities,
      (e) => e.kind === 'proxy-group' && e.serializedName === 'DIRECT-GROUP',
    );

    const result = analyzeImpact(parse(COMPREHENSIVE), index, directGroup.id);

    expect(result).toEqual({ replaceable: [], cascading: [] });
  });

  it('throws for an unknown entity id', () => {
    const { index } = setUp();
    expect(() => analyzeImpact(parse(COMPREHENSIVE), index, 'proxy:999')).toThrow(GraphError);
  });

  it('cascades a group whose only reference is the deleted proxy-provider', () => {
    const source = [
      'proxy-providers:',
      '  solo:',
      '    type: file',
      '    path: ./solo.yaml',
      'proxy-groups:',
      '  - name: LONE',
      '    type: select',
      '    use: [solo]',
      '',
    ].join('\n');
    const { document, entities, index } = setUp(source);
    const solo = find(entities, (e) => e.kind === 'proxy-provider' && e.serializedName === 'solo');
    const lone = find(entities, (e) => e.kind === 'proxy-group' && e.serializedName === 'LONE');

    const result = analyzeImpact(document, index, solo.id);

    expect(result.replaceable).toEqual([]);
    expect(result.cascading).toEqual([lone]);
  });

  it('recursively cascades a chain of groups that each become empty', () => {
    const source = [
      'proxy-providers:',
      '  solo:',
      '    type: file',
      '    path: ./solo.yaml',
      'proxy-groups:',
      '  - name: MID',
      '    type: select',
      '    use: [solo]',
      '  - name: TOP',
      '    type: select',
      '    proxies: [MID]',
      '',
    ].join('\n');
    const { document, entities, index } = setUp(source);
    const solo = find(entities, (e) => e.kind === 'proxy-provider' && e.serializedName === 'solo');
    const mid = find(entities, (e) => e.kind === 'proxy-group' && e.serializedName === 'MID');
    const top = find(entities, (e) => e.kind === 'proxy-group' && e.serializedName === 'TOP');

    const result = analyzeImpact(document, index, solo.id);

    expect(result.replaceable).toEqual([]);
    expect(result.cascading).toEqual([mid, top]);
  });

  it('stops the cascade where a downstream group still has other members', () => {
    const source = [
      'proxy-providers:',
      '  solo:',
      '    type: file',
      '    path: ./solo.yaml',
      'proxy-groups:',
      '  - name: MID',
      '    type: select',
      '    use: [solo]',
      '  - name: TOP',
      '    type: select',
      '    proxies: [MID, DIRECT]',
      '',
    ].join('\n');
    const { document, entities, index } = setUp(source);
    const solo = find(entities, (e) => e.kind === 'proxy-provider' && e.serializedName === 'solo');
    const mid = find(entities, (e) => e.kind === 'proxy-group' && e.serializedName === 'MID');
    const top = find(entities, (e) => e.kind === 'proxy-group' && e.serializedName === 'TOP');

    const result = analyzeImpact(document, index, solo.id);

    expect(result.cascading).toEqual([mid]);
    expect(result.replaceable).toEqual([
      {
        fromId: top.id,
        toId: mid.id,
        path: ['proxy-groups', 1, 'proxies', 0],
        referenceType: 'seq-item',
      },
    ]);
  });

  it('groups duplicate references from the same owner and keeps the group non-cascading when other content remains', () => {
    const source = [
      'proxy-groups:',
      '  - name: DUP',
      '    type: select',
      '    proxies: [AUTO, AUTO, DIRECT]',
      '  - name: AUTO',
      '    type: url-test',
      '    proxies: [DIRECT]',
      '',
    ].join('\n');
    const { document, entities, index } = setUp(source);
    const auto = find(entities, (e) => e.kind === 'proxy-group' && e.serializedName === 'AUTO');
    const dup = find(entities, (e) => e.kind === 'proxy-group' && e.serializedName === 'DUP');

    const result = analyzeImpact(document, index, auto.id);

    expect(result.cascading).toEqual([]);
    expect(result.replaceable).toEqual([
      {
        fromId: dup.id,
        toId: auto.id,
        path: ['proxy-groups', 0, 'proxies', 0],
        referenceType: 'seq-item',
      },
      {
        fromId: dup.id,
        toId: auto.id,
        path: ['proxy-groups', 0, 'proxies', 1],
        referenceType: 'seq-item',
      },
    ]);
  });
});
