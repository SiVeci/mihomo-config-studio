import { MihomoYamlDocument } from '@mcs/yaml-engine';
import { describe, expect, it } from 'vitest';

import { ruleOrderStage } from './rule-order.js';

function run(yaml: string) {
  const parse = MihomoYamlDocument.parse(yaml);
  return ruleOrderStage.run({ parse });
}

describe('ruleOrderStage (FR-RULE-04, ordering side)', () => {
  it('produces nothing when there is no rules: section', () => {
    expect(run('mode: rule\n')).toEqual([]);
  });

  it('produces nothing for an empty rules list', () => {
    expect(run('rules: []\n')).toEqual([]);
  });

  describe('MATCH position', () => {
    it('warns once, non-blocking, when a non-empty rules list has no MATCH at all', () => {
      const issues = run(['rules:', '  - DOMAIN-SUFFIX,example.com,DIRECT'].join('\n'));
      expect(issues).toEqual([
        expect.objectContaining({
          code: 'ruleOrder.noMatch',
          severity: 'warning',
          blocking: false,
          path: ['rules'],
        }),
      ]);
    });

    it('does not warn when MATCH is the last rule', () => {
      const issues = run(
        ['rules:', '  - DOMAIN-SUFFIX,example.com,DIRECT', '  - MATCH,PROXY'].join('\n'),
      );
      expect(
        issues.filter(
          (i) => i.code.startsWith('ruleOrder.noMatch') || i.code === 'ruleOrder.afterMatch',
        ),
      ).toEqual([]);
    });

    it("warns once per rule that follows MATCH, carrying that rule's own index", () => {
      const issues = run(
        [
          'rules:',
          '  - MATCH,PROXY',
          '  - DOMAIN-SUFFIX,a.com,DIRECT',
          '  - DOMAIN-SUFFIX,b.com,DIRECT',
        ].join('\n'),
      );
      const afterMatch = issues.filter((i) => i.code === 'ruleOrder.afterMatch');
      expect(afterMatch).toHaveLength(2);
      expect(afterMatch.every((i) => i.severity === 'warning' && i.blocking === false)).toBe(true);
      expect(afterMatch.map((i) => i.path)).toEqual([
        ['rules', 1],
        ['rules', 2],
      ]);
      expect(afterMatch.map((i) => i.messageParams?.ruleIndex)).toEqual([1, 2]);
    });

    it('is case-insensitive when locating MATCH, matching parseRuleLine', () => {
      const issues = run(
        ['rules:', '  - match,PROXY', '  - DOMAIN-SUFFIX,a.com,DIRECT'].join('\n'),
      );
      expect(issues.filter((i) => i.code === 'ruleOrder.afterMatch')).toHaveLength(1);
    });
  });

  describe('domain shadowing', () => {
    it('flags a later DOMAIN shadowed by an earlier DOMAIN-SUFFIX ancestor with a different target', () => {
      const issues = run(
        [
          'rules:',
          '  - DOMAIN-SUFFIX,google.com,DIRECT',
          '  - DOMAIN,mail.google.com,PROXY',
          '  - MATCH,PROXY',
        ].join('\n'),
      );
      expect(issues).toContainEqual(
        expect.objectContaining({
          code: 'ruleOrder.domainShadowed',
          severity: 'warning',
          blocking: false,
          path: ['rules', 1],
          messageParams: expect.objectContaining({ ruleIndex: 1, shadowedByIndex: 0 }),
        }),
      );
    });

    it('flags a later DOMAIN-SUFFIX shadowed by an earlier, broader DOMAIN-SUFFIX with a different target', () => {
      const issues = run(
        [
          'rules:',
          '  - DOMAIN-SUFFIX,google.com,DIRECT',
          '  - DOMAIN-SUFFIX,mail.google.com,PROXY',
          '  - MATCH,PROXY',
        ].join('\n'),
      );
      expect(issues).toContainEqual(
        expect.objectContaining({ code: 'ruleOrder.domainShadowed', path: ['rules', 1] }),
      );
    });

    it('does not flag when the shadowing and shadowed rule share the same target (redundant, not a behaviour difference)', () => {
      const issues = run(
        [
          'rules:',
          '  - DOMAIN-SUFFIX,google.com,DIRECT',
          '  - DOMAIN,mail.google.com,DIRECT',
          '  - MATCH,PROXY',
        ].join('\n'),
      );
      expect(issues.filter((i) => i.code === 'ruleOrder.domainShadowed')).toEqual([]);
    });

    it('a plain DOMAIN rule never shadows anything later (only DOMAIN-SUFFIX acts as a shadower)', () => {
      const issues = run(
        [
          'rules:',
          '  - DOMAIN,google.com,DIRECT',
          '  - DOMAIN-SUFFIX,google.com,PROXY',
          '  - MATCH,PROXY',
        ].join('\n'),
      );
      expect(issues.filter((i) => i.code === 'ruleOrder.domainShadowed')).toEqual([]);
    });

    it('does not flag the reverse order (a narrower suffix declared first never shadows a broader one declared later)', () => {
      const issues = run(
        [
          'rules:',
          '  - DOMAIN-SUFFIX,mail.google.com,DIRECT',
          '  - DOMAIN-SUFFIX,google.com,PROXY',
          '  - MATCH,PROXY',
        ].join('\n'),
      );
      expect(issues.filter((i) => i.code === 'ruleOrder.domainShadowed')).toEqual([]);
    });

    it('does not flag unrelated domains', () => {
      const issues = run(
        [
          'rules:',
          '  - DOMAIN-SUFFIX,google.com,DIRECT',
          '  - DOMAIN,example.com,PROXY',
          '  - MATCH,PROXY',
        ].join('\n'),
      );
      expect(issues.filter((i) => i.code === 'ruleOrder.domainShadowed')).toEqual([]);
    });

    it('never puts the domain text itself into the issue (NFR-SEC-03)', () => {
      const issues = run(
        [
          'rules:',
          '  - DOMAIN-SUFFIX,super-secret-domain.example,DIRECT',
          '  - DOMAIN,mail.super-secret-domain.example,PROXY',
        ].join('\n'),
      );
      expect(JSON.stringify(issues)).not.toContain('super-secret-domain.example');
    });
  });

  describe('IP-CIDR shadowing', () => {
    it('flags a later, narrower IP-CIDR shadowed by an earlier, broader one with a different target', () => {
      const issues = run(
        ['rules:', '  - IP-CIDR,10.0.0.0/8,DIRECT', '  - IP-CIDR,10.1.2.3/32,PROXY'].join('\n'),
      );
      expect(issues).toContainEqual(
        expect.objectContaining({
          code: 'ruleOrder.cidrShadowed',
          severity: 'warning',
          blocking: false,
          path: ['rules', 1],
          messageParams: expect.objectContaining({ ruleIndex: 1, shadowedByIndex: 0 }),
        }),
      );
    });

    it('flags shadowing within IPv6 CIDRs the same way', () => {
      const issues = run(
        ['rules:', '  - IP-CIDR6,2001:db8::/32,DIRECT', '  - IP-CIDR6,2001:db8::1/128,PROXY'].join(
          '\n',
        ),
      );
      expect(issues).toContainEqual(
        expect.objectContaining({ code: 'ruleOrder.cidrShadowed', path: ['rules', 1] }),
      );
    });

    it('does not flag when target is the same (redundant, not a behaviour difference)', () => {
      const issues = run(
        ['rules:', '  - IP-CIDR,10.0.0.0/8,DIRECT', '  - IP-CIDR,10.1.2.3/32,DIRECT'].join('\n'),
      );
      expect(issues.filter((i) => i.code === 'ruleOrder.cidrShadowed')).toEqual([]);
    });

    it('does not flag the reverse order (a narrower range declared first never shadows a broader one declared later)', () => {
      const issues = run(
        ['rules:', '  - IP-CIDR,10.1.2.3/32,DIRECT', '  - IP-CIDR,10.0.0.0/8,PROXY'].join('\n'),
      );
      expect(issues.filter((i) => i.code === 'ruleOrder.cidrShadowed')).toEqual([]);
    });

    it('never compares across address families (an IPv4 CIDR never shadows an IPv6 one or vice versa)', () => {
      const issues = run(
        ['rules:', '  - IP-CIDR,0.0.0.0/0,DIRECT', '  - IP-CIDR6,::/0,PROXY'].join('\n'),
      );
      expect(issues.filter((i) => i.code === 'ruleOrder.cidrShadowed')).toEqual([]);
    });

    it('never compares a "src" CIDR against a destination-scoped one — different semantic axis', () => {
      const issues = run(
        ['rules:', '  - IP-CIDR,10.0.0.0/8,DIRECT', '  - IP-CIDR,10.1.2.3/32,PROXY,src'].join('\n'),
      );
      expect(issues.filter((i) => i.code === 'ruleOrder.cidrShadowed')).toEqual([]);
    });

    it('does not flag disjoint ranges', () => {
      const issues = run(
        ['rules:', '  - IP-CIDR,10.0.0.0/8,DIRECT', '  - IP-CIDR,192.168.1.0/24,PROXY'].join('\n'),
      );
      expect(issues.filter((i) => i.code === 'ruleOrder.cidrShadowed')).toEqual([]);
    });

    it('ignores a rule whose payload is not a parseable CIDR at all, rather than crashing', () => {
      expect(() =>
        run(['rules:', '  - IP-CIDR,not-an-ip-address/8,DIRECT'].join('\n')),
      ).not.toThrow();
      const issues = run(['rules:', '  - IP-CIDR,not-an-ip-address/8,DIRECT'].join('\n'));
      expect(issues.filter((i) => i.code === 'ruleOrder.cidrShadowed')).toEqual([]);
    });

    it('flags shadowing between two full, uncompressed IPv6 addresses (no "::")', () => {
      const issues = run(
        [
          'rules:',
          '  - IP-CIDR6,2001:0db8:0000:0000:0000:0000:0000:0000/32,DIRECT',
          '  - IP-CIDR6,2001:0db8:0000:0000:0000:0000:0000:0001/128,PROXY',
        ].join('\n'),
      );
      expect(issues).toContainEqual(
        expect.objectContaining({ code: 'ruleOrder.cidrShadowed', path: ['rules', 1] }),
      );
    });

    it('never puts the IP/CIDR text itself into the issue (NFR-SEC-03)', () => {
      const issues = run(
        ['rules:', '  - IP-CIDR,203.0.113.0/24,DIRECT', '  - IP-CIDR,203.0.113.55/32,PROXY'].join(
          '\n',
        ),
      );
      expect(JSON.stringify(issues)).not.toContain('203.0.113');
    });
  });
});
