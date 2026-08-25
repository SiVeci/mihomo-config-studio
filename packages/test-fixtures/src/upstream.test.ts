import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { FIXTURES_ROOT, readFixture } from './index.js';
import {
  P0_MODULE_IDS,
  P0_PROTOCOLS,
  UPSTREAM_P0_FIELDS,
  UPSTREAM_RULE_PROVIDER_CONSTRAINTS,
  UPSTREAM_RULE_TYPES,
  UPSTREAM_SOURCE,
} from './upstream.js';

/** `rules:`/`sub-rules:` entries are comma-separated list values, not YAML keys — see `UpstreamFieldRecord.path`'s doc comment. */
const MODULES_WITHOUT_YAML_KEY_FIELDS = new Set(['rules']);

describe('vendored file integrity (the precondition for treating it as authoritative)', () => {
  it('matches the recorded byte length and SHA-256 exactly', () => {
    const bytes = readFileSync(join(FIXTURES_ROOT, UPSTREAM_SOURCE.vendoredPath));
    expect(bytes.length).toBe(UPSTREAM_SOURCE.byteLength);

    const sha256 = createHash('sha256').update(bytes).digest('hex');
    expect(sha256).toBe(UPSTREAM_SOURCE.sha256);
  });
});

describe('UPSTREAM_P0_FIELDS structure', () => {
  it('covers exactly the ten P0 modules named in PRD §8.3', () => {
    expect(Object.keys(UPSTREAM_P0_FIELDS).sort()).toEqual([...P0_MODULE_IDS].sort());
    expect(P0_MODULE_IDS).toHaveLength(10);
  });

  it('has at least one field recorded for every P0 protocol', () => {
    const proxyPaths = UPSTREAM_P0_FIELDS.proxies.map((record) => record.path);
    for (const protocol of P0_PROTOCOLS) {
      expect(proxyPaths.some((path) => path.startsWith(`${protocol}.`))).toBe(true);
    }
  });

  it('marks P1/P2 protocol entries as bare names, never a P0 protocol, never a field path', () => {
    const p1p2 = UPSTREAM_P0_FIELDS.proxies.filter((record) => record.note?.includes('P1/P2'));
    expect(p1p2.length).toBeGreaterThan(0);

    for (const record of p1p2) {
      expect(record.path.includes('.')).toBe(false);
      expect(P0_PROTOCOLS as readonly string[]).not.toContain(record.path);
    }
  });

  it('documents a reason for every entry that is not actually present upstream', () => {
    for (const [moduleId, records] of Object.entries(UPSTREAM_P0_FIELDS)) {
      for (const record of records) {
        if (record.presentUpstream) continue;
        expect(
          record.note,
          `${moduleId}: "${record.path}" needs a note explaining the gap`,
        ).toBeTruthy();
      }
    }
  });
});

describe("field names are traceable to the vendored text (catches this file's own transcription errors)", () => {
  const raw = readFixture(UPSTREAM_SOURCE.vendoredPath);

  function leafKey(path: string): string {
    return path.split('.').at(-1) ?? path;
  }

  it('finds a literal "<leaf-key>:" for every field recorded as present upstream', () => {
    const missing: string[] = [];

    for (const [moduleId, records] of Object.entries(UPSTREAM_P0_FIELDS)) {
      // `rules:`/`sub-rules:` entries are comma-separated list values, not
      // YAML keys (`DOMAIN-SUFFIX,example.com,DIRECT`, never
      // `DOMAIN-SUFFIX:`) — traced separately below via `UPSTREAM_RULE_TYPES`,
      // which also carries the `evidence` field this generic key-shaped
      // check has no equivalent for.
      if (MODULES_WITHOUT_YAML_KEY_FIELDS.has(moduleId)) continue;

      for (const record of records) {
        // Whole-protocol P1/P2 markers (e.g. `snell`) name a `type` value,
        // not a YAML key, so the "<key>:" shape does not apply to them.
        // `Meta-Docs`-noted fields (e.g. proxy-providers' `exclude-filter`)
        // were verified against the official docs source, not this vendored
        // sample — D-004 — so a grep of this one file is the wrong check.
        if (
          !record.presentUpstream ||
          record.note?.includes('P1/P2') ||
          record.note?.includes('Meta-Docs')
        ) {
          continue;
        }

        const key = leafKey(record.path);
        if (!raw.includes(`${key}:`)) {
          missing.push(`${moduleId}: "${record.path}" (looked for "${key}:")`);
        }
      }
    }

    expect(missing).toEqual([]);
  });

  it('finds every P1/P2 protocol name as a literal `type: <name>` declaration', () => {
    const missing: string[] = [];
    for (const record of UPSTREAM_P0_FIELDS.proxies) {
      if (!record.note?.includes('P1/P2')) continue;
      if (!raw.includes(`type: ${record.path}`)) missing.push(record.path);
    }
    expect(missing).toEqual([]);
  });

  it('finds a literal "<TYPE>," for every rule type whose evidence is the vendored sample', () => {
    const missing: string[] = [];
    for (const rule of UPSTREAM_RULE_TYPES) {
      if (rule.evidence !== 'vendored-sample') continue;
      if (!raw.includes(`${rule.type},`)) missing.push(rule.type);
    }
    expect(missing).toEqual([]);
  });
});

describe("UPSTREAM_RULE_TYPES structure (#0, comparison object for #3's rule-type catalog)", () => {
  it('names every rule type exactly once', () => {
    const names = UPSTREAM_RULE_TYPES.map((rule) => rule.type);
    expect(new Set(names).size).toBe(names.length);
  });

  it('splits into exactly sixteen P0 and twenty-one P1/P2 rule types', () => {
    const p0 = UPSTREAM_RULE_TYPES.filter((rule) => rule.p0);
    const p1p2 = UPSTREAM_RULE_TYPES.filter((rule) => !rule.p0);
    expect(p0).toHaveLength(16);
    expect(p1p2).toHaveLength(21);
  });

  it('marks the PRD §8.3 "常用域名、IP、端口、进程、GEO、RULE-SET、MATCH" representatives as P0', () => {
    const p0Names = new Set(UPSTREAM_RULE_TYPES.filter((rule) => rule.p0).map((rule) => rule.type));
    for (const expected of [
      'DOMAIN',
      'DOMAIN-SUFFIX',
      'IP-CIDR',
      'IP-ASN',
      'GEOIP',
      'GEOSITE',
      'DST-PORT',
      'PROCESS-NAME',
      'PROCESS-PATH',
      'RULE-SET',
      'MATCH',
      'SUB-RULE',
    ]) {
      expect(p0Names.has(expected), `${expected} should be P0`).toBe(true);
    }
  });

  it('marks NOT/AND/OR as P1/P2 (PRD §8.3 explicitly excludes 逻辑规则 from this version)', () => {
    for (const logic of ['NOT', 'AND', 'OR']) {
      const record = UPSTREAM_RULE_TYPES.find((rule) => rule.type === logic);
      expect(record?.p0, `${logic} should be P1/P2`).toBe(false);
    }
  });

  it('gives every meta-docs-evidenced entry a note that documents that source', () => {
    for (const rule of UPSTREAM_RULE_TYPES) {
      if (rule.evidence !== 'meta-docs') continue;
      expect(rule.note, `${rule.type} needs a Meta-Docs citation`).toMatch(/Meta-Docs/);
    }
  });

  it('requires no payload only for MATCH and SUB-RULE (both can be just a bare target)', () => {
    const noPayload = new Set(['MATCH', 'SUB-RULE']);
    for (const rule of UPSTREAM_RULE_TYPES) {
      expect(rule.payloadRequired, rule.type).toBe(!noPayload.has(rule.type));
    }
  });

  it("agrees with config-model/src/rule-line.ts's LAST_SEGMENT_IS_TARGET set", () => {
    const lastSegmentTypes = new Set([
      'NOT',
      'OR',
      'AND',
      'SUB-RULE',
      'DOMAIN-REGEX',
      'PROCESS-NAME-REGEX',
      'PROCESS-PATH-REGEX',
    ]);
    for (const rule of UPSTREAM_RULE_TYPES) {
      expect(rule.lastSegmentIsTarget, rule.type).toBe(lastSegmentTypes.has(rule.type));
    }
  });
});

describe('UPSTREAM_RULE_PROVIDER_CONSTRAINTS (closes the mrs/behavior prerequisite)', () => {
  it('records the format:mrs -> behavior constraint as modelled, with two independent sources', () => {
    const constraint = UPSTREAM_RULE_PROVIDER_CONSTRAINTS.find((entry) =>
      entry.description.includes('format: mrs'),
    );
    expect(constraint?.modeledThisVersion).toBe(true);
    expect(constraint?.evidence.length).toBeGreaterThanOrEqual(2);
  });

  it('records the fake-ip-filter/nameserver-policy behavior constraint as real but not modelled this version', () => {
    const constraint = UPSTREAM_RULE_PROVIDER_CONSTRAINTS.find((entry) =>
      entry.description.includes('fake-ip-filter'),
    );
    expect(constraint?.modeledThisVersion).toBe(false);
    expect(constraint?.note).toBeTruthy();
  });
});
