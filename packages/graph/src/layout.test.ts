import { EntityRegistry, type Entity } from '@mcs/config-model';
import { MihomoYamlDocument } from '@mcs/yaml-engine';
import { describe, expect, it } from 'vitest';

import { buildGraphLayout, type RelevantIssue } from './layout.js';
import { ReferenceIndex, type Reference } from './reference-index.js';

function parse(source: string): MihomoYamlDocument {
  const result = MihomoYamlDocument.parse(source);
  if (!result.document) {
    throw new Error(
      `fixture failed to parse: ${result.issues.map((i) => i.messageKey).join('; ')}`,
    );
  }
  return result.document;
}

/** Real extraction + a real reference scan, the same pipeline `analyzeImpact`'s own tests use — `buildGraphLayout` itself never touches a document. */
function setUp(source: string) {
  const document = parse(source);
  const entities = new EntityRegistry().extract(document);
  const index = new ReferenceIndex();
  index.rebuild(document, entities);
  return { entities, references: index.allReferences() };
}

const SAMPLE = [
  'proxy-groups:',
  '  - name: AUTO',
  '    type: url-test',
  '    proxies: [DIRECT]',
  '  - name: PROXY',
  '    type: select',
  '    proxies: [AUTO, MISSING-GROUP]',
  'rule-providers:',
  '  ads:',
  '    type: http',
  '    behavior: domain',
  '    url: https://example.invalid/ads.txt',
  '    path: ./ads.yaml',
  'rules:',
  '  - RULE-SET,ads,PROXY',
  '  - MATCH,DIRECT',
  '',
].join('\n');

describe('buildGraphLayout (v0.4.0 #12, FR-REL-04 data side)', () => {
  it('places every entity in the layer its kind belongs to: node/provider, proxy-group, rule', () => {
    const { entities, references } = setUp(SAMPLE);
    const { nodes } = buildGraphLayout(entities, references, []);

    const layerOf = (name: string) => nodes.find((n) => !n.aggregated && n.name === name)?.layer;
    expect(layerOf('AUTO')).toBe(1); // proxy-group
    expect(layerOf('PROXY')).toBe(1); // proxy-group
    expect(layerOf('DIRECT')).toBe(0); // builtin
    expect(layerOf('ads')).toBe(2); // rule-provider
    expect(layerOf('RULE-SET,ads,PROXY')).toBe(2); // rule
  });

  it('carries only id/kind/name/layer per node — never another field value (NFR-SEC-03)', () => {
    const { entities, references } = setUp(SAMPLE);
    const { nodes } = buildGraphLayout(entities, references, []);

    for (const node of nodes) {
      expect(Object.keys(node).sort()).toEqual(
        node.aggregated
          ? ['aggregated', 'count', 'id', 'kind', 'layer', 'memberIds']
          : ['aggregated', 'id', 'kind', 'layer', 'name'],
      );
    }
  });

  it('sorts nodes within a layer/kind group by name, for a deterministic, diff-stable result', () => {
    const { entities } = setUp(SAMPLE);
    const { nodes } = buildGraphLayout(entities, [], []);
    const groupNames = nodes
      .filter((n) => !n.aggregated && n.kind === 'proxy-group')
      .map((n) => (n.aggregated ? '' : n.name));
    expect(groupNames).toEqual(['AUTO', 'PROXY']);
  });

  it('produces byte-for-byte identical output across two calls with the same input (determinism)', () => {
    const { entities, references } = setUp(SAMPLE);
    const first = buildGraphLayout(entities, references, []);
    const second = buildGraphLayout(entities, references, []);
    expect(first).toEqual(second);
  });

  it('marks an edge "missing" when a matching-path issue is supplied, "ok" otherwise', () => {
    const { entities, references } = setUp(SAMPLE);
    // The PROXY -> MISSING-GROUP text never resolved to a real entity (no
    // entity named MISSING-GROUP exists), so it never became a `Reference`
    // at all — `referenceStage` reports *that* kind of gap by path, not by
    // an edge this function ever sees. Feed a realistic missing-reference
    // issue for an edge that *did* resolve instead, to isolate the marking
    // logic itself from name resolution.
    const ruleSetRef = references.find((r) => r.referenceType === 'scalar-fragment');
    if (!ruleSetRef) throw new Error('expected a scalar-fragment reference in the sample');
    const issues: RelevantIssue[] = [{ code: 'reference.missingRuleSet', path: ruleSetRef.path }];

    const { edges } = buildGraphLayout(entities, references, issues);
    const flagged = edges.find((e) => e.fromId === ruleSetRef.fromId && e.toId === ruleSetRef.toId);
    expect(flagged?.status).toBe('missing');
    expect(edges.every((e) => e === flagged || e.status === 'ok')).toBe(true);
  });

  it('marks an edge "cycle" when a reference.cycle issue lists its two entity names as adjacent', () => {
    const { entities, references } = setUp(SAMPLE);
    const groupRef = references.find((r) => r.referenceType === 'seq-item');
    if (!groupRef) throw new Error('expected a seq-item reference in the sample');
    const fromName = entities.find((e) => e.id === groupRef.fromId)?.serializedName;
    const toName = entities.find((e) => e.id === groupRef.toId)?.serializedName;
    const issues: RelevantIssue[] = [
      {
        code: 'reference.cycle',
        messageParams: { cycle: [fromName as string, toName as string, fromName as string] },
      },
    ];

    const { edges } = buildGraphLayout(entities, references, issues);
    const flagged = edges.find((e) => e.fromId === groupRef.fromId && e.toId === groupRef.toId);
    expect(flagged?.status).toBe('cycle');
  });

  it('ignores an issue whose code is not a missing-reference or cycle code', () => {
    const { entities, references } = setUp(SAMPLE);
    const { edges } = buildGraphLayout(entities, references, [
      { code: 'reference.duplicateName', path: ['proxy-groups', 0] },
      { code: 'reference.portConflict' },
    ]);
    expect(edges.every((e) => e.status === 'ok')).toBe(true);
  });

  it('collapses a layer/kind group larger than the threshold into one aggregate node, redirecting and deduping its edges', () => {
    const entities: Entity[] = Array.from({ length: 5 }, (_, i) => ({
      id: `proxy:${i}`,
      kind: 'proxy',
      serializedName: `node-${i}`,
      sourcePath: ['proxies', i, 'name'],
    }));
    const group: Entity = {
      id: 'proxy-group:0',
      kind: 'proxy-group',
      serializedName: 'AUTO',
      sourcePath: ['proxy-groups', 0, 'name'],
    };
    const references: Reference[] = entities.map((entity, i) => ({
      fromId: group.id,
      toId: entity.id,
      path: ['proxy-groups', 0, 'proxies', i],
      referenceType: 'seq-item',
    }));

    const { nodes, edges } = buildGraphLayout([...entities, group], references, [], {
      aggregateThreshold: 3,
    });

    const aggregate = nodes.find((n) => n.aggregated && n.kind === 'proxy');
    expect(aggregate).toMatchObject({ count: 5, kind: 'proxy', layer: 0 });
    expect(nodes.some((n) => !n.aggregated && n.kind === 'proxy')).toBe(false); // no individual proxy nodes survive
    // 5 references, all from the same group to the same collapsed group, dedupe to 1 edge.
    expect(edges).toEqual([{ fromId: group.id, toId: aggregate?.id, status: 'ok' }]);
  });

  it('does not aggregate a group at or under the threshold', () => {
    const entities: Entity[] = Array.from({ length: 3 }, (_, i) => ({
      id: `proxy:${i}`,
      kind: 'proxy',
      serializedName: `node-${i}`,
      sourcePath: ['proxies', i, 'name'],
    }));
    const { nodes } = buildGraphLayout(entities, [], [], { aggregateThreshold: 3 });
    expect(nodes.every((n) => !n.aggregated)).toBe(true);
    expect(nodes).toHaveLength(3);
  });

  it('lays out 1,000 entities well within a generous time bound (NFR-PERF-04 data-side)', () => {
    const entities: Entity[] = [];
    const references: Reference[] = [];
    for (let i = 0; i < 300; i += 1) {
      entities.push({
        id: `proxy:${i}`,
        kind: 'proxy',
        serializedName: `node-${i}`,
        sourcePath: ['proxies', i, 'name'],
      });
    }
    for (let i = 0; i < 100; i += 1) {
      const groupId = `proxy-group:${i}`;
      entities.push({
        id: groupId,
        kind: 'proxy-group',
        serializedName: `group-${i}`,
        sourcePath: ['proxy-groups', i, 'name'],
      });
      for (let j = 0; j < 5; j += 1) {
        references.push({
          fromId: groupId,
          toId: `proxy:${(i * 5 + j) % 300}`,
          path: ['proxy-groups', i, 'proxies', j],
          referenceType: 'seq-item',
        });
      }
    }
    for (let i = 0; i < 600; i += 1) {
      entities.push({
        id: `rule:${i}`,
        kind: 'rule',
        serializedName: `MATCH,PROXY-${i % 100}`,
        sourcePath: ['rules', i],
      });
    }

    const start = performance.now();
    const { nodes } = buildGraphLayout(entities, references, []);
    const elapsedMs = performance.now() - start;

    expect(nodes.length).toBeGreaterThan(0);
    expect(elapsedMs).toBeLessThan(200);
  });

  it('returns empty nodes and edges for no entities, without throwing', () => {
    expect(buildGraphLayout([], [], [])).toEqual({ nodes: [], edges: [] });
  });
});
