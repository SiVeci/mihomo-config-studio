import { readFixture } from '@mcs/test-fixtures';
import { MihomoYamlDocument } from '@mcs/yaml-engine';
import { describe, expect, it } from 'vitest';

import { detectCycles } from './cycles.js';

function parse(source: string): MihomoYamlDocument {
  const result = MihomoYamlDocument.parse(source);
  if (!result.document) {
    throw new Error(`fixture failed to parse: ${result.issues.map((i) => i.message).join('; ')}`);
  }
  return result.document;
}

describe('cycle detection (FR-REL-05)', () => {
  it('finds no cycles in comprehensive.yaml', () => {
    const document = parse(readFixture('yaml/comprehensive.yaml'));
    expect(detectCycles(document)).toEqual([]);
  });

  it('finds a mutual proxy-group nesting cycle', () => {
    const document = parse(readFixture('yaml/cycles/group-mutual.yaml'));
    expect(detectCycles(document)).toEqual([['A', 'B', 'A']]);
  });

  it('finds a dialer-proxy chain cycle, excluding a tail that dials into it', () => {
    const document = parse(readFixture('yaml/cycles/dialer-chain.yaml'));
    expect(detectCycles(document)).toEqual([['A', 'B', 'C', 'A']]);
  });

  it('does not treat a proxy-group listing a plain proxy as a cycle edge', () => {
    const source = [
      'proxy-groups:',
      '  - name: G',
      '    type: select',
      '    proxies: [DIRECT]',
      '',
    ].join('\n');
    expect(detectCycles(parse(source))).toEqual([]);
  });

  it('does not treat a dialer-proxy pointing at an unknown name as a cycle edge', () => {
    const source = [
      'proxies:',
      '  - name: A',
      '    type: ss',
      '    server: a.example.com',
      '    port: 1',
      '    cipher: aes-256-gcm',
      '    password: x',
      '    dialer-proxy: GHOST',
      '',
    ].join('\n');
    expect(detectCycles(parse(source))).toEqual([]);
  });

  it('reports a self-referencing group as a one-node cycle', () => {
    const source = [
      'proxy-groups:',
      '  - name: SELF',
      '    type: select',
      '    proxies: [SELF]',
      '',
    ].join('\n');
    expect(detectCycles(parse(source))).toEqual([['SELF', 'SELF']]);
  });

  it('returns no cycles when there are no proxy-groups or proxies at all', () => {
    expect(detectCycles(parse('mode: rule\n'))).toEqual([]);
  });

  it('skips proxy-groups and proxies entries missing a name instead of crashing', () => {
    const source = [
      'proxy-groups:',
      '  - type: select',
      '    proxies: [B]',
      '  - name: B',
      '    type: select',
      '    proxies: [A]',
      'proxies:',
      '  - type: ss',
      '    server: x.example.com',
      '    port: 1',
      '    cipher: aes-256-gcm',
      '    password: x',
      '    dialer-proxy: B',
      '',
    ].join('\n');
    expect(detectCycles(parse(source))).toEqual([]);
  });

  it('tracks multiple outgoing edges from the same group', () => {
    const source = [
      'proxy-groups:',
      '  - name: SRC',
      '    type: select',
      '    proxies: [X, Y]',
      '  - name: X',
      '    type: select',
      '    proxies: [DIRECT]',
      '  - name: Y',
      '    type: select',
      '    proxies: [DIRECT]',
      '',
    ].join('\n');
    expect(detectCycles(parse(source))).toEqual([]);
  });
});
