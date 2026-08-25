import { parseRuleLine } from '@mcs/config-model';
import type { ConfigPath, MihomoYamlDocument } from '@mcs/yaml-engine';

import type { ValidationIssue } from './issue.js';
import type { ValidationStage } from './pipeline.js';

export const RULE_ORDER_STAGE_ID = 'rule-order';

/**
 * PRD §8.7 pipeline stage 5 (FR-RULE-04, ordering side): MATCH position and
 * obvious shadowing. "Missing RULE-SET" / "missing target" are reference
 * integrity, not ordering — those are `referenceStage`'s job (#4, E6); this
 * stage never re-checks them.
 *
 * Every issue here is `severity: 'warning'`, `blocking: false` (E6): static
 * analysis of a rule LIST is not a claim about kernel runtime behaviour —
 * PRD §8.6's closing line and NG-07 both require this app never assert
 * equivalence with what mihomo actually does at match time. #18 audits the
 * i18n copy itself for accidentally-assertive wording; this file only wires
 * the checks and drafts the keys.
 *
 * NFR-SEC-03: every issue carries only a rule *index*, a *type name*, and a
 * *payloadKind* — never the payload/target text itself. A user's domain or
 * IP range is configuration content, not something this app echoes back
 * into a diagnostic message.
 *
 * **Performance note for #14/#15**: the shadowing/MATCH-position algorithms
 * below are the O(rules × small-constant) the plan asks for — verified in
 * isolation at ~15ms for a 13k-rule, 1MB corpus. On that same corpus,
 * *producing* the resulting issues (via `document.locate()`, one call per
 * issue) costs roughly 1.7s instead, because `MihomoYamlDocument`'s
 * `#positionState()` re-serialises the whole document with `toText()`
 * before its own cache-hit check can short-circuit — every stage's issues
 * pay this per call, not something specific to this file. Left for #14 to
 * measure formally and #15 to fix (likely a version counter bumped by every
 * mutating method, compared instead of re-serialising to compare by value)
 * rather than patched narrowly here.
 */
export const ruleOrderStage: ValidationStage = {
  id: RULE_ORDER_STAGE_ID,
  run: (ctx) => {
    const { document } = ctx.parse;
    if (!document) return [];

    return [...checkMatchPosition(document, ['rules']), ...checkShadowing(document, ['rules'])];
  },
};

// ---------------------------------------------------------------------------
// MATCH position
// ---------------------------------------------------------------------------

function checkMatchPosition(document: MihomoYamlDocument, basePath: ConfigPath): ValidationIssue[] {
  const rules = document.getIn(basePath);
  if (!Array.isArray(rules) || rules.length === 0) return [];

  const matchIndex = rules.findIndex(
    (line) => typeof line === 'string' && matchType(line) === 'MATCH',
  );

  if (matchIndex === -1) {
    return [ruleOrderIssue(document, 'ruleOrder.noMatch', basePath, {})];
  }

  const issues: ValidationIssue[] = [];
  for (let i = matchIndex + 1; i < rules.length; i += 1) {
    if (typeof rules[i] !== 'string') continue;
    issues.push(
      ruleOrderIssue(document, 'ruleOrder.afterMatch', [...basePath, i], { ruleIndex: i }),
    );
  }
  return issues;
}

function matchType(line: string): string {
  return parseRuleLine(line).type;
}

// ---------------------------------------------------------------------------
// Obvious shadowing (E7: same-payloadKind-family true containment only)
// ---------------------------------------------------------------------------

function checkShadowing(document: MihomoYamlDocument, basePath: ConfigPath): ValidationIssue[] {
  const rules = document.getIn(basePath);
  if (!Array.isArray(rules)) return [];

  const issues: ValidationIssue[] = [];
  const domainSuffixSeen = new Map<string, { index: number; target: string }>();
  const cidrSeen = new Map<string, { index: number; target: string }>();

  rules.forEach((line, index) => {
    if (typeof line !== 'string') return;
    const parsed = parseRuleLine(line);
    const target = parsed.target?.value;
    if (target === undefined) return;

    if (parsed.type === 'DOMAIN' || parsed.type === 'DOMAIN-SUFFIX') {
      const domain = parsed.payload?.value;
      if (domain) {
        const shadower = findDomainShadower(domainSuffixSeen, domain, target);
        if (shadower !== undefined) {
          issues.push(
            ruleOrderIssue(document, 'ruleOrder.domainShadowed', [...basePath, index], {
              ruleIndex: index,
              shadowedByIndex: shadower,
              type: parsed.type,
              payloadKind: 'domain-suffix',
            }),
          );
        }
        if (parsed.type === 'DOMAIN-SUFFIX') {
          domainSuffixSeen.set(domain, { index, target });
        }
      }
    } else if (parsed.type === 'IP-CIDR' || parsed.type === 'IP-CIDR6') {
      const cidr = parsed.payload?.value;
      const parsedCidr = cidr ? parseCidr(cidr) : null;
      if (parsedCidr) {
        const hasSrc = parsed.params.some((p) => p.value === 'src');
        const shadower = findCidrShadower(cidrSeen, parsedCidr, hasSrc, target);
        if (shadower !== undefined) {
          issues.push(
            ruleOrderIssue(document, 'ruleOrder.cidrShadowed', [...basePath, index], {
              ruleIndex: index,
              shadowedByIndex: shadower,
              type: parsed.type,
              payloadKind: 'ipcidr',
            }),
          );
        }
        cidrSeen.set(cidrKey(parsedCidr.family, hasSrc, parsedCidr.prefixLen, parsedCidr.network), {
          index,
          target,
        });
      }
    }
  });

  return issues;
}

/**
 * Walks every dot-label ancestor of `domain` (itself, then with the
 * left-most label dropped, down to the bare TLD) looking for an earlier
 * `DOMAIN-SUFFIX` rule at that exact suffix with a *different* target — same
 * target is redundant, not a behavioural difference (E7). O(labels), not
 * O(n): `domainSuffixSeen` is a hash map, not a linear scan.
 */
function findDomainShadower(
  seen: ReadonlyMap<string, { index: number; target: string }>,
  domain: string,
  target: string,
): number | undefined {
  const labels = domain.split('.');
  for (let start = 0; start < labels.length; start += 1) {
    const ancestor = labels.slice(start).join('.');
    const candidate = seen.get(ancestor);
    if (candidate && candidate.target !== target) return candidate.index;
  }
  return undefined;
}

interface ParsedCidr {
  family: 'v4' | 'v6';
  /** Network address truncated to `prefixLen` bits, as an unsigned integer. */
  network: bigint;
  prefixLen: number;
}

const IPV4_OCTET = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d|0)$/;

function parseCidr(value: string): ParsedCidr | null {
  const slash = value.lastIndexOf('/');
  if (slash <= 0) return null;
  const address = value.slice(0, slash);
  const prefixText = value.slice(slash + 1);
  if (!/^\d{1,3}$/.test(prefixText)) return null;
  const prefixLen = Number(prefixText);

  const v4 = parseIpv4(address);
  if (v4 !== null) {
    if (prefixLen > 32) return null;
    return { family: 'v4', network: truncate(v4, prefixLen, 32), prefixLen };
  }
  const v6 = parseIpv6(address);
  if (v6 !== null) {
    if (prefixLen > 128) return null;
    return { family: 'v6', network: truncate(v6, prefixLen, 128), prefixLen };
  }
  return null;
}

function parseIpv4(address: string): bigint | null {
  const parts = address.split('.');
  if (parts.length !== 4) return null;
  let bits = 0n;
  for (const part of parts) {
    if (!IPV4_OCTET.test(part)) return null;
    bits = (bits << 8n) | BigInt(Number(part));
  }
  return bits;
}

function parseIpv6(address: string): bigint | null {
  const sides = address.split('::');
  if (sides.length > 2) return null;

  const parseGroups = (segment: string): bigint[] | null => {
    if (segment === '') return [];
    const groups: bigint[] = [];
    for (const part of segment.split(':')) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(part)) return null;
      groups.push(BigInt(parseInt(part, 16)));
    }
    return groups;
  };

  if (sides.length === 1) {
    const groups = parseGroups(sides[0] ?? '');
    if (!groups || groups.length !== 8) return null;
    return groups.reduce((acc, g) => (acc << 16n) | g, 0n);
  }

  const left = parseGroups(sides[0] ?? '');
  const right = parseGroups(sides[1] ?? '');
  if (!left || !right) return null;
  const missing = 8 - left.length - right.length;
  if (missing < 0) return null;
  const allGroups = [...left, ...Array<bigint>(missing).fill(0n), ...right];
  if (allGroups.length !== 8) return null;
  return allGroups.reduce((acc, g) => (acc << 16n) | g, 0n);
}

function truncate(bits: bigint, prefixLen: number, totalBits: number): bigint {
  const shift = BigInt(totalBits - prefixLen);
  return (bits >> shift) << shift;
}

function cidrKey(family: 'v4' | 'v6', hasSrc: boolean, prefixLen: number, network: bigint): string {
  return `${family}:${hasSrc}:${prefixLen}:${network.toString()}`;
}

/**
 * Walks every shorter-or-equal prefix length of `candidate` looking for an
 * earlier CIDR at that exact (family, prefixLen, network) with a different
 * target — a true superset containment, never a heuristic distance measure.
 * O(prefixLen) per rule (≤32 or ≤128), not O(n): `seen` is a hash map keyed
 * by the exact truncated network, not a linear scan of every prior CIDR.
 */
function findCidrShadower(
  seen: ReadonlyMap<string, { index: number; target: string }>,
  candidate: ParsedCidr,
  hasSrc: boolean,
  target: string,
): number | undefined {
  for (let prefixLen = 0; prefixLen <= candidate.prefixLen; prefixLen += 1) {
    const totalBits = candidate.family === 'v4' ? 32 : 128;
    const ancestorNetwork = truncate(candidate.network, prefixLen, totalBits);
    const key = cidrKey(candidate.family, hasSrc, prefixLen, ancestorNetwork);
    const found = seen.get(key);
    if (found && found.target !== target) return found.index;
  }
  return undefined;
}

// ---------------------------------------------------------------------------

function ruleOrderIssue(
  document: MihomoYamlDocument,
  messageKey: string,
  path: ConfigPath,
  messageParams: Record<string, string | number>,
): ValidationIssue {
  const range = document.locate(path) ?? undefined;
  return {
    severity: 'warning',
    code: messageKey,
    module: RULE_ORDER_STAGE_ID,
    messageKey,
    ...(Object.keys(messageParams).length > 0 ? { messageParams } : {}),
    path,
    ...(range !== undefined ? { range } : {}),
    blocking: false,
  };
}
