import type { RuleTypeSpec } from '@mcs/schema-core';
import { describe, expect, it } from 'vitest';

import { explainRule } from './rule-explain.js';

const DOMAIN_SUFFIX: RuleTypeSpec = {
  type: 'DOMAIN-SUFFIX',
  payloadKind: 'domain-suffix',
  needsPayload: true,
  params: [],
  safety: 'safe',
};

const IP_CIDR: RuleTypeSpec = {
  type: 'IP-CIDR',
  payloadKind: 'ipcidr',
  needsPayload: true,
  params: ['no-resolve', 'src'],
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

const CATALOG: readonly RuleTypeSpec[] = [DOMAIN_SUFFIX, IP_CIDR, SUB_RULE, MATCH];

describe('explainRule (FR-RULE-06, v0.9.0 #16)', () => {
  it('returns kind: raw for a type the catalog does not list, same as buildRulePlan itself', () => {
    expect(explainRule(CATALOG, 'GEOSITE,cn,DIRECT')).toEqual({ kind: 'raw' });
  });

  it('names the matched type as the first explanation line', () => {
    const explanation = explainRule(CATALOG, 'DOMAIN-SUFFIX,example.com,PROXY');
    expect(explanation).toEqual({
      kind: 'structured',
      lines: [
        { messageKey: 'ruleExplain.type.DOMAIN-SUFFIX' },
        { messageKey: 'ruleExplain.target' },
      ],
    });
  });

  it('never includes the payload or target value anywhere in the output (NFR-SEC-03)', () => {
    const explanation = explainRule(CATALOG, 'DOMAIN-SUFFIX,example.com,MySecretProxyName');
    const serialized = JSON.stringify(explanation);
    expect(serialized).not.toContain('example.com');
    expect(serialized).not.toContain('MySecretProxyName');
  });

  it('includes one line per param the catalog itself declares, in order', () => {
    const explanation = explainRule(CATALOG, 'IP-CIDR,10.0.0.0/8,DIRECT,no-resolve,src');
    expect(explanation).toEqual({
      kind: 'structured',
      lines: [
        { messageKey: 'ruleExplain.type.IP-CIDR' },
        { messageKey: 'ruleExplain.target' },
        { messageKey: 'ruleExplain.param.no-resolve' },
        { messageKey: 'ruleExplain.param.src' },
      ],
    });
  });

  it('omits a param the catalog does not recognise, rather than embedding its raw text in a message key (NFR-SEC-03)', () => {
    const explanation = explainRule(CATALOG, 'IP-CIDR,10.0.0.0/8,DIRECT,some-secret-token');
    expect(explanation).toEqual({
      kind: 'structured',
      lines: [{ messageKey: 'ruleExplain.type.IP-CIDR' }, { messageKey: 'ruleExplain.target' }],
    });
    expect(JSON.stringify(explanation)).not.toContain('some-secret-token');
  });

  it('uses the sub-rule-specific target explanation for a sub-rule-payloadKind type', () => {
    const explanation = explainRule(CATALOG, 'SUB-RULE,my-sub-rule-group');
    expect(explanation).toEqual({
      kind: 'structured',
      lines: [
        { messageKey: 'ruleExplain.type.SUB-RULE' },
        { messageKey: 'ruleExplain.target.subRule' },
      ],
    });
  });

  it('MATCH still explains its target (the catch-all destination) even though it needs no payload', () => {
    const explanation = explainRule(CATALOG, 'MATCH,DIRECT');
    expect(explanation).toEqual({
      kind: 'structured',
      lines: [{ messageKey: 'ruleExplain.type.MATCH' }, { messageKey: 'ruleExplain.target' }],
    });
  });
});
