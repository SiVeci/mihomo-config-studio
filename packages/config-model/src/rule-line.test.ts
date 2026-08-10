import { readFixture } from '@mcs/test-fixtures';
import { MihomoYamlDocument } from '@mcs/yaml-engine';
import { describe, expect, it } from 'vitest';

import { parseRuleLine, type RuleFragment } from './rule-line.js';

const COMPREHENSIVE = readFixture('yaml/comprehensive.yaml');

/** Locates `text` in `line` (its `occurrence`-th appearance) instead of hand-counting offsets. */
function fragment(line: string, text: string, occurrence = 0): RuleFragment {
  let idx = -1;
  for (let i = 0; i <= occurrence; i += 1) {
    idx = line.indexOf(text, idx + 1);
  }
  if (idx < 0) throw new Error(`"${text}" not found in "${line}"`);
  return { value: text, start: idx, end: idx + text.length };
}

function rulesOf(source: string): string[] {
  const result = MihomoYamlDocument.parse(source);
  if (!result.document) throw new Error('fixture failed to parse');
  const rules = result.document.getIn(['rules']);
  if (!Array.isArray(rules)) throw new Error('no rules array');
  return rules as string[];
}

describe('rule line parsing (FR-REL-02)', () => {
  it('locates the target of every rule in comprehensive.yaml', () => {
    const rules = rulesOf(COMPREHENSIVE);
    const expectedTargets = [
      'DIRECT', // DOMAIN-SUFFIX,local,DIRECT
      'PROXY', // DOMAIN-KEYWORD,speedtest,PROXY
      'REJECT', // DOMAIN-REGEX,^ad[0-9]*\.example\.com$,REJECT
      'DIRECT', // RULE-SET,private-ip,DIRECT
      'DIRECT', // RULE-SET,cn-domain,DIRECT
      'REJECT', // IP-CIDR,198.18.0.0/16,REJECT,no-resolve
      'PROXY', // IP-CIDR6,2001:db8::/32,PROXY
      'DIRECT', // PROCESS-NAME,ssh,DIRECT
      'DIRECT', // GEOIP,CN,DIRECT
      'PROXY', // MATCH,PROXY
    ];
    expect(rules).toHaveLength(expectedTargets.length);

    rules.forEach((line, index) => {
      const parsed = parseRuleLine(line);
      const expectedTarget = expectedTargets[index];
      expect(parsed.target).toEqual(fragment(line, expectedTarget as string));
    });
  });

  it('takes the fixed third field as target, not the last one (default branch)', () => {
    const line = 'IP-CIDR,198.18.0.0/16,REJECT,no-resolve';
    const parsed = parseRuleLine(line);

    expect(parsed.type).toBe('IP-CIDR');
    expect(parsed.payload).toEqual(fragment(line, '198.18.0.0/16'));
    expect(parsed.target).toEqual(fragment(line, 'REJECT'));
    expect(parsed.params).toEqual([fragment(line, 'no-resolve')]);
  });

  it('produces two distinct reference fragments for RULE-SET (payload: rule-provider, target: proxy/group)', () => {
    const line = 'RULE-SET,cn-domain,DIRECT';
    const parsed = parseRuleLine(line);

    expect(parsed.payload).toEqual(fragment(line, 'cn-domain'));
    expect(parsed.target).toEqual(fragment(line, 'DIRECT'));
  });

  it('collects multiple trailing params', () => {
    const line = 'IP-CIDR,1.2.3.0/24,PROXY,no-resolve,extra-flag';
    const parsed = parseRuleLine(line);

    expect(parsed.params).toEqual([fragment(line, 'no-resolve'), fragment(line, 'extra-flag')]);
  });

  it('has no payload or params for MATCH', () => {
    const line = 'MATCH,PROXY';
    const parsed = parseRuleLine(line);

    expect(parsed.type).toBe('MATCH');
    expect(parsed.payload).toBeNull();
    expect(parsed.target).toEqual(fragment(line, 'PROXY'));
    expect(parsed.params).toEqual([]);
  });

  it('takes the last field as target for logic rules and keeps internal commas in the rejoined payload', () => {
    const line = 'AND,((DOMAIN,a),(DOMAIN,b)),PROXY';
    const parsed = parseRuleLine(line);

    expect(parsed.type).toBe('AND');
    expect(parsed.target).toEqual(fragment(line, 'PROXY'));
    expect(parsed.payload?.value).toBe('((DOMAIN,a),(DOMAIN,b))');
  });

  it('takes the last field as target for DOMAIN-REGEX and keeps a comma inside a quantifier', () => {
    const line = 'DOMAIN-REGEX,a{1,2},REJECT';
    const parsed = parseRuleLine(line);

    expect(parsed.target).toEqual(fragment(line, 'REJECT'));
    expect(parsed.payload?.value).toBe('a{1,2}');
  });

  it('resolves DOMAIN-REGEX target to the last segment even without an internal comma', () => {
    const line = String.raw`DOMAIN-REGEX,^ad[0-9]*\.example\.com$,REJECT`;
    const parsed = parseRuleLine(line);

    expect(parsed.target).toEqual(fragment(line, 'REJECT'));
    expect(parsed.payload).toEqual(fragment(line, String.raw`^ad[0-9]*\.example\.com$`));
  });

  it('treats a SUB-RULE target as a sub-rule name, distinct from a proxy/group', () => {
    const line = 'SUB-RULE,ads-block';
    const parsed = parseRuleLine(line);

    expect(parsed.type).toBe('SUB-RULE');
    expect(parsed.payload).toBeNull();
    expect(parsed.target).toEqual(fragment(line, 'ads-block'));
  });

  it('is case-insensitive on the rule type and produces identical results', () => {
    const upper = parseRuleLine('DOMAIN-SUFFIX,local,DIRECT');
    const lower = parseRuleLine('domain-suffix,local,DIRECT');

    expect(lower).toEqual(upper);
    expect(upper.type).toBe('DOMAIN-SUFFIX');
  });

  it('excludes surrounding whitespace from the target offset and preserves it on replacement', () => {
    const line = 'DOMAIN , example.com , PROXY';
    const parsed = parseRuleLine(line);

    expect(parsed.payload).toEqual(fragment(line, 'example.com'));
    expect(parsed.target).toEqual(fragment(line, 'PROXY'));

    const target = parsed.target as RuleFragment;
    const replaced = line.slice(0, target.start) + 'PROXY-2' + line.slice(target.end);
    expect(replaced).toBe('DOMAIN , example.com , PROXY-2');
  });

  it('leaves every field null for a bare type with no comma', () => {
    const parsed = parseRuleLine('MATCH');

    expect(parsed).toEqual({ type: 'MATCH', payload: null, target: null, params: [] });
  });

  it('treats an empty or whitespace-only field as an empty fragment instead of throwing', () => {
    expect(parseRuleLine('DOMAIN,,DIRECT').payload?.value).toBe('');
    expect(parseRuleLine('DOMAIN,  ,DIRECT').payload?.value).toBe('');
  });

  it('leaves target null when the default branch has no third field', () => {
    const line = 'GEOIP,CN';
    const parsed = parseRuleLine(line);

    expect(parsed.payload).toEqual(fragment(line, 'CN'));
    expect(parsed.target).toBeNull();
    expect(parsed.params).toEqual([]);
  });
});
