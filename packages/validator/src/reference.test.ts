import { MihomoYamlDocument } from '@mcs/yaml-engine';
import { describe, expect, it } from 'vitest';

import { referenceStage } from './reference.js';

function run(yaml: string) {
  const parse = MihomoYamlDocument.parse(yaml);
  return referenceStage.run({ parse });
}

describe('referenceStage (FR-VAL-03)', () => {
  it('produces nothing for an empty/absent document section', () => {
    expect(run('mode: rule\n')).toEqual([]);
  });

  describe('duplicate names', () => {
    it('flags two proxies sharing a name', () => {
      const issues = run(
        [
          'proxies:',
          '  - {name: ss1, type: ss, server: a, port: 1}',
          '  - {name: ss1, type: ss, server: b, port: 2}',
        ].join('\n'),
      );
      const duplicates = issues.filter((i) => i.code === 'reference.duplicateName');
      expect(duplicates).toHaveLength(2);
      expect(duplicates.every((i) => i.severity === 'error' && i.blocking)).toBe(true);
      expect(duplicates.map((i) => i.path)).toEqual([
        ['proxies', 0, 'name'],
        ['proxies', 1, 'name'],
      ]);
    });

    it('flags a proxy-group sharing a name with a proxy (same shared outbound namespace)', () => {
      const issues = run(
        [
          'proxies:',
          '  - {name: auto, type: ss, server: a, port: 1}',
          'proxy-groups:',
          '  - {name: auto, type: select, proxies: [DIRECT]}',
        ].join('\n'),
      );
      expect(issues.filter((i) => i.code === 'reference.duplicateName')).toHaveLength(2);
    });

    it('flags a proxy-group reusing a built-in name (DIRECT)', () => {
      const issues = run(
        ['proxy-groups:', '  - {name: DIRECT, type: select, proxies: [REJECT]}'].join('\n'),
      );
      expect(issues).toContainEqual(
        expect.objectContaining({
          code: 'reference.duplicateName',
          path: ['proxy-groups', 0, 'name'],
        }),
      );
    });

    it('does not flag distinctly named proxies, or two proxies each independently named the same as different builtins', () => {
      const issues = run(
        [
          'proxies:',
          '  - {name: ss1, type: ss, server: a, port: 1}',
          '  - {name: ss2, type: ss, server: b, port: 2}',
        ].join('\n'),
      );
      expect(issues.filter((i) => i.code === 'reference.duplicateName')).toEqual([]);
    });

    it('does not flag a rule-provider and a proxy sharing the same name — different namespaces', () => {
      const issues = run(
        [
          'proxies:',
          '  - {name: shared-name, type: ss, server: a, port: 1}',
          'rule-providers:',
          '  shared-name:',
          '    type: http',
          '    url: "https://example.com/x.yaml"',
          '    behavior: classical',
        ].join('\n'),
      );
      expect(issues.filter((i) => i.code === 'reference.duplicateName')).toEqual([]);
    });
  });

  describe('missing references', () => {
    it('flags a proxy-group "proxies" entry naming a node that does not exist', () => {
      const issues = run(
        ['proxy-groups:', '  - {name: g, type: select, proxies: [does-not-exist]}'].join('\n'),
      );
      expect(issues).toContainEqual(
        expect.objectContaining({
          code: 'reference.missingTarget',
          path: ['proxy-groups', 0, 'proxies', 0],
          severity: 'error',
          blocking: true,
        }),
      );
    });

    it('flags a proxy-group "use" entry naming a provider that does not exist', () => {
      const issues = run(
        ['proxy-groups:', '  - {name: g, type: select, use: [ghost-provider]}'].join('\n'),
      );
      expect(issues).toContainEqual(
        expect.objectContaining({
          code: 'reference.missingTarget',
          path: ['proxy-groups', 0, 'use', 0],
        }),
      );
    });

    it('does not flag a proxy-group "proxies" entry naming a real built-in target', () => {
      const issues = run(
        ['proxy-groups:', '  - {name: g, type: select, proxies: [DIRECT, REJECT]}'].join('\n'),
      );
      expect(issues.filter((i) => i.code === 'reference.missingTarget')).toEqual([]);
    });

    it('flags a RULE-SET rule naming a rule-provider that does not exist', () => {
      const issues = run(['rules:', '  - RULE-SET,ghost-ruleset,DIRECT'].join('\n'));
      expect(issues).toContainEqual(
        expect.objectContaining({
          code: 'reference.missingRuleSet',
          path: ['rules', 0],
        }),
      );
    });

    it('does not flag a RULE-SET rule naming a real rule-provider', () => {
      const issues = run(
        [
          'rule-providers:',
          '  cn-domain:',
          '    type: http',
          '    url: "https://example.com/cn.yaml"',
          '    behavior: classical',
          'rules:',
          '  - RULE-SET,cn-domain,DIRECT',
        ].join('\n'),
      );
      expect(issues.filter((i) => i.code === 'reference.missingRuleSet')).toEqual([]);
    });

    it('flags a rule target naming a proxy/group that does not exist', () => {
      const issues = run(['rules:', '  - DOMAIN-SUFFIX,example.com,ghost-target'].join('\n'));
      expect(issues).toContainEqual(
        expect.objectContaining({
          code: 'reference.missingRuleTarget',
          path: ['rules', 0],
        }),
      );
    });

    it('flags a MATCH rule with a missing target the same as any other rule type', () => {
      const issues = run(['rules:', '  - MATCH,ghost-target'].join('\n'));
      expect(issues).toContainEqual(
        expect.objectContaining({ code: 'reference.missingRuleTarget', path: ['rules', 0] }),
      );
    });

    it('does not flag a rule target naming a real built-in (DIRECT/REJECT/...)', () => {
      const issues = run(
        ['rules:', '  - DOMAIN-SUFFIX,example.com,DIRECT', '  - MATCH,REJECT'].join('\n'),
      );
      expect(issues.filter((i) => i.code === 'reference.missingRuleTarget')).toEqual([]);
    });

    it('never flags a SUB-RULE target — the sub-rule group name is not modelled as its own entity (documented gap, mirrors @mcs/graph)', () => {
      const issues = run(
        ['rules:', '  - SUB-RULE,(NETWORK,tcp),this-group-does-not-exist'].join('\n'),
      );
      expect(issues.filter((i) => i.code.startsWith('reference.missing'))).toEqual([]);
    });

    it('checks rule lines nested inside sub-rules the same way as top-level rules', () => {
      const issues = run(
        ['sub-rules:', '  block-ads:', '    - DOMAIN-SUFFIX,ads.example.com,ghost-target'].join(
          '\n',
        ),
      );
      expect(issues).toContainEqual(
        expect.objectContaining({
          code: 'reference.missingRuleTarget',
          path: ['sub-rules', 'block-ads', 0],
        }),
      );
    });

    it('never puts the unresolved name itself into the issue (NFR-SEC-03)', () => {
      const issues = run(
        ['rules:', '  - DOMAIN-SUFFIX,example.com,super-secret-target-name'].join('\n'),
      );
      expect(JSON.stringify(issues)).not.toContain('super-secret-target-name');
      const missing = issues.find((i) => i.code === 'reference.missingRuleTarget');
      expect(missing?.messageParams).toBeUndefined();
    });
  });

  describe('cycles', () => {
    it('flags a proxy-group nesting cycle and carries the cycle as a name sequence', () => {
      const issues = run(
        [
          'proxy-groups:',
          '  - {name: a, type: select, proxies: [b]}',
          '  - {name: b, type: select, proxies: [a]}',
        ].join('\n'),
      );
      const cycles = issues.filter((i) => i.code === 'reference.cycle');
      expect(cycles).toHaveLength(1);
      expect(cycles[0]).toMatchObject({ severity: 'error', blocking: true });
      const cycleNames = cycles[0]?.messageParams?.cycle;
      expect(cycleNames).toEqual(expect.arrayContaining(['a', 'b']));
    });

    it('does not flag an acyclic group hierarchy', () => {
      const issues = run(
        [
          'proxies:',
          '  - {name: ss1, type: ss, server: a, port: 1}',
          'proxy-groups:',
          '  - {name: top, type: select, proxies: [mid]}',
          '  - {name: mid, type: select, proxies: [ss1]}',
        ].join('\n'),
      );
      expect(issues.filter((i) => i.code === 'reference.cycle')).toEqual([]);
    });
  });

  describe('port conflicts', () => {
    it('flags port and socks-port sharing the same number', () => {
      const issues = run(['port: 7890', 'socks-port: 7890'].join('\n'));
      const conflicts = issues.filter((i) => i.code === 'reference.portConflict');
      expect(conflicts).toHaveLength(2);
      expect(conflicts.map((i) => i.path)).toEqual(
        expect.arrayContaining([['port'], ['socks-port']]),
      );
      expect(conflicts.every((i) => i.severity === 'error' && i.blocking)).toBe(true);
    });

    it('flags external-controller sharing a port with mixed-port, extracting the port from host:port', () => {
      const issues = run(['mixed-port: 9090', 'external-controller: "127.0.0.1:9090"'].join('\n'));
      expect(issues).toContainEqual(
        expect.objectContaining({ code: 'reference.portConflict', path: ['external-controller'] }),
      );
      expect(issues).toContainEqual(
        expect.objectContaining({ code: 'reference.portConflict', path: ['mixed-port'] }),
      );
    });

    it('does not flag distinct ports', () => {
      const issues = run(
        [
          'port: 7890',
          'socks-port: 7891',
          'mixed-port: 7892',
          'external-controller: "127.0.0.1:9090"',
        ].join('\n'),
      );
      expect(issues.filter((i) => i.code === 'reference.portConflict')).toEqual([]);
    });

    it('does not misread a malformed external-controller value (no colon) as a port', () => {
      const issues = run(['port: 7890', 'external-controller: "not-a-host-port"'].join('\n'));
      expect(issues.filter((i) => i.code === 'reference.portConflict')).toEqual([]);
    });

    it('does not misread a non-numeric port segment (host:notanumber) as a port', () => {
      const issues = run(['port: 7890', 'external-controller: "127.0.0.1:notanumber"'].join('\n'));
      expect(issues.filter((i) => i.code === 'reference.portConflict')).toEqual([]);
    });

    it('reports each field once even when three fields share the same port (dedup)', () => {
      const issues = run(['port: 7890', 'socks-port: 7890', 'mixed-port: 7890'].join('\n'));
      const conflicts = issues.filter((i) => i.code === 'reference.portConflict');
      expect(conflicts).toHaveLength(3);
      expect(conflicts.map((i) => i.path)).toEqual(
        expect.arrayContaining([['port'], ['socks-port'], ['mixed-port']]),
      );
    });
  });
});
