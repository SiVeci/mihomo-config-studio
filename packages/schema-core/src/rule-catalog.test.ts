import { describe, expect, it } from 'vitest';

import { buildRulePlan } from './rule-catalog.js';
import type { RuleTypeSpec } from './types.js';

const DOMAIN_SUFFIX: RuleTypeSpec = {
  type: 'DOMAIN-SUFFIX',
  payloadKind: 'domain-suffix',
  needsPayload: true,
  params: [],
  docsUrl: 'https://wiki.metacubex.one/config/rules/',
  safety: 'safe',
};

const IP_CIDR: RuleTypeSpec = {
  type: 'IP-CIDR',
  payloadKind: 'ipcidr',
  needsPayload: true,
  params: ['no-resolve', 'src'],
  docsUrl: 'https://wiki.metacubex.one/config/rules/',
  safety: 'safe',
};

const RULE_SET: RuleTypeSpec = {
  type: 'RULE-SET',
  payloadKind: 'rule-set',
  needsPayload: true,
  params: [],
  safety: 'safe',
};

const SUB_RULE: RuleTypeSpec = {
  type: 'SUB-RULE',
  payloadKind: 'sub-rule',
  needsPayload: false,
  params: [],
  safety: 'safe',
};

const MATCH: RuleTypeSpec = {
  type: 'MATCH',
  payloadKind: 'none',
  needsPayload: false,
  params: [],
  safety: 'safe',
};

const CATALOG: readonly RuleTypeSpec[] = [DOMAIN_SUFFIX, IP_CIDR, RULE_SET, SUB_RULE, MATCH];

describe('buildRulePlan (ADR-021)', () => {
  it('aligns a recognised type with its catalog entry and the parsed fragments', () => {
    const plan = buildRulePlan(CATALOG, 'DOMAIN-SUFFIX,google.com,PROXY');
    expect(plan.kind).toBe('structured');
    if (plan.kind !== 'structured') throw new Error('expected structured');
    expect(plan.spec).toBe(DOMAIN_SUFFIX);
    expect(plan.payload?.value).toBe('google.com');
    expect(plan.target?.value).toBe('PROXY');
    expect(plan.params).toEqual([]);
  });

  it('captures documented trailing params (no-resolve, src)', () => {
    const plan = buildRulePlan(CATALOG, 'IP-CIDR,198.18.0.0/16,REJECT,no-resolve');
    if (plan.kind !== 'structured') throw new Error('expected structured');
    expect(plan.spec).toBe(IP_CIDR);
    expect(plan.params.map((p) => p.value)).toEqual(['no-resolve']);
  });

  it('falls back to raw text for a type the catalog does not list (FR-RULE-05)', () => {
    const line = 'AND,((DOMAIN,a),(DOMAIN,b)),PROXY';
    const plan = buildRulePlan(CATALOG, line);
    expect(plan).toEqual({ kind: 'raw', text: line });
  });

  it('falls back to raw text for a type that is simply not in this catalog instance, even if it looks rule-like', () => {
    const line = 'GEOIP,CN,DIRECT';
    const plan = buildRulePlan(CATALOG, line);
    expect(plan).toEqual({ kind: 'raw', text: line });
  });

  it('never throws or drops content for a nonsense line — always either structured or the untouched original text', () => {
    const line = 'NOT-A-REAL-RULE-TYPE-AT-ALL';
    expect(() => buildRulePlan(CATALOG, line)).not.toThrow();
    expect(buildRulePlan(CATALOG, line)).toEqual({ kind: 'raw', text: line });
  });

  it('has no payload for MATCH (payloadKind: none) — target only', () => {
    const plan = buildRulePlan(CATALOG, 'MATCH,PROXY');
    if (plan.kind !== 'structured') throw new Error('expected structured');
    expect(plan.spec).toBe(MATCH);
    expect(plan.payload).toBeNull();
    expect(plan.target?.value).toBe('PROXY');
  });

  it('treats a bare SUB-RULE (no condition payload) as structured with a null payload and the sub-rule name as target', () => {
    const plan = buildRulePlan(CATALOG, 'SUB-RULE,ads-block');
    if (plan.kind !== 'structured') throw new Error('expected structured');
    expect(plan.spec).toBe(SUB_RULE);
    expect(plan.payload).toBeNull();
    expect(plan.target?.value).toBe('ads-block');
  });

  it('resolves a RULE-SET line, treating the payload as an entity reference, not a literal value', () => {
    const plan = buildRulePlan(CATALOG, 'RULE-SET,cn-domain,DIRECT');
    if (plan.kind !== 'structured') throw new Error('expected structured');
    expect(plan.spec.payloadKind).toBe('rule-set');
    expect(plan.payload?.value).toBe('cn-domain');
  });

  it("is case-insensitive on the rule type, matching parseRuleLine's own normalisation", () => {
    const upper = buildRulePlan(CATALOG, 'DOMAIN-SUFFIX,local,DIRECT');
    const lower = buildRulePlan(CATALOG, 'domain-suffix,local,DIRECT');
    expect(lower).toEqual(upper);
  });

  it('recognises an eleventh, entirely synthetic catalog entry with zero code changes (FR-SCHEMA-06 applied to rules, ADR-021)', () => {
    const synthetic: RuleTypeSpec = {
      type: 'SYNTHETIC-TEST-TYPE',
      payloadKind: 'domain',
      needsPayload: true,
      params: [],
      safety: 'safe',
    };
    const extendedCatalog = [...CATALOG, synthetic];

    const plan = buildRulePlan(extendedCatalog, 'SYNTHETIC-TEST-TYPE,example.com,PROXY');
    if (plan.kind !== 'structured') throw new Error('expected structured');
    expect(plan.spec).toBe(synthetic);
    expect(plan.payload?.value).toBe('example.com');

    // The very same line is unrecognised (raw) without that one extra data entry.
    expect(buildRulePlan(CATALOG, 'SYNTHETIC-TEST-TYPE,example.com,PROXY')).toEqual({
      kind: 'raw',
      text: 'SYNTHETIC-TEST-TYPE,example.com,PROXY',
    });
  });

  it('preserves the exact original text (including odd spacing) in the raw fallback', () => {
    const line = '  AND , ((DOMAIN,a),(DOMAIN,b)) , PROXY  ';
    expect(buildRulePlan(CATALOG, line)).toEqual({ kind: 'raw', text: line });
  });
});
