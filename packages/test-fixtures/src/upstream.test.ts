import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { FIXTURES_ROOT, readFixture } from './index.js';
import { P0_MODULE_IDS, P0_PROTOCOLS, UPSTREAM_P0_FIELDS, UPSTREAM_SOURCE } from './upstream.js';

describe('vendored file integrity (the precondition for treating it as authoritative)', () => {
  it('matches the recorded byte length and SHA-256 exactly', () => {
    const bytes = readFileSync(join(FIXTURES_ROOT, UPSTREAM_SOURCE.vendoredPath));
    expect(bytes.length).toBe(UPSTREAM_SOURCE.byteLength);

    const sha256 = createHash('sha256').update(bytes).digest('hex');
    expect(sha256).toBe(UPSTREAM_SOURCE.sha256);
  });
});

describe('UPSTREAM_P0_FIELDS structure', () => {
  it('covers exactly the six P0 modules named in PRD §8.3', () => {
    expect(Object.keys(UPSTREAM_P0_FIELDS).sort()).toEqual([...P0_MODULE_IDS].sort());
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
});
