import {
  DNS_MODULE,
  GENERAL_MODULE,
  INBOUND_MODULE,
  PROXIES_MODULE,
  PROXY_PROVIDERS_MODULE,
  SNIFFER_MODULE,
} from '@mcs/schema-builtin';
import { collectUnknownFields, type SchemaModule } from '@mcs/schema-core';
import { listFixtures, readFixture, UPSTREAM_SOURCE } from '@mcs/test-fixtures';
import { changedLineNumbers, diffLines, MihomoYamlDocument } from '@mcs/yaml-engine';
import { describe, expect, it } from 'vitest';

/**
 * PRD §13.2 golden/round-trip test, v0.3.0 #19. Five steps, one assertion
 * per step (not merged), against the real vendored upstream sample
 * (`packages/test-fixtures/fixtures/upstream/mihomo-v1.19.29/config.yaml`,
 * 134,840 bytes, see its own `SOURCE.md` for provenance) — the same file
 * `packages/test-fixtures/src/upstream.ts` already uses as its P0
 * field-coverage baseline, reused here for its other documented purpose:
 * a comparison baseline for this repo's own round-trip tests.
 */
const UPSTREAM = readFixture(UPSTREAM_SOURCE.vendoredPath);

const MODULES: readonly SchemaModule[] = [
  GENERAL_MODULE,
  DNS_MODULE,
  SNIFFER_MODULE,
  INBOUND_MODULE,
  PROXIES_MODULE,
  PROXY_PROVIDERS_MODULE,
];

function parseUpstream(): MihomoYamlDocument {
  const parsed = MihomoYamlDocument.parse(UPSTREAM);
  if (!parsed.document) throw new Error('unreachable: the vendored sample must parse');
  return parsed.document;
}

describe('golden five-step round-trip (PRD §13.2, v0.3.0 #19)', () => {
  it('step 1: imports the real vendored 134 KB sample with no syntax error', () => {
    const parsed = MihomoYamlDocument.parse(UPSTREAM);
    expect(parsed.document).not.toBeNull();
    expect(parsed.issues.filter((issue) => issue.severity === 'error')).toEqual([]);
  });

  it('step 2a: exporting without any change is byte-exact', () => {
    expect(parseUpstream().toText()).toBe(UPSTREAM);
  });

  it('step 2b: the semantic tree (parsed JS value) is unchanged by an unedited round trip', () => {
    const before = parseUpstream().toJS();
    const after = MihomoYamlDocument.parse(parseUpstream().toText()).document!.toJS();
    expect(after).toEqual(before);
  });

  it('step 2c: every unknown (P1/P2) field survives an unedited round trip — by path AND by value, none lost, none gained', () => {
    const before = collectUnknownFields(MODULES, parseUpstream().toJS(), { mode: 'advanced' });
    // Sanity: the real sample must actually exercise this path, or the rest
    // of this test would pass vacuously.
    expect(before.length).toBeGreaterThan(0);

    const roundTrippedValue = MihomoYamlDocument.parse(parseUpstream().toText()).document!.toJS();
    const after = collectUnknownFields(MODULES, roundTrippedValue, { mode: 'advanced' });

    const beforeByPath = new Map(before.map((field) => [JSON.stringify(field.path), field.value]));
    const afterByPath = new Map(after.map((field) => [JSON.stringify(field.path), field.value]));
    expect(afterByPath.size).toBe(beforeByPath.size);
    for (const [path, value] of beforeByPath) {
      expect(afterByPath.has(path), `lost unknown field ${path}`).toBe(true);
      expect(afterByPath.get(path)).toEqual(value);
    }
  });

  it('step 3: changing a single real field produces a diff touching exactly that line, nothing else', () => {
    const document = parseUpstream();
    // Line 3 of the vendored file: `mixed-port: 10801 # HTTP(S) 和 SOCKS 代理混合端口`.
    document.setScalarIn(['mixed-port'], 10802);
    const edited = document.toText();

    expect(changedLineNumbers(diffLines(UPSTREAM, edited))).toEqual({ removed: [3], added: [3] });

    const beforeLines = UPSTREAM.split('\n');
    const afterLines = edited.split('\n');
    expect(afterLines).toHaveLength(beforeLines.length);
    beforeLines.forEach((line, index) => {
      if (index === 2) return; // line 3, 0-indexed — the one line allowed to differ
      expect(afterLines[index]).toBe(line);
    });
    expect(afterLines[2]).toBe('mixed-port: 10802 # HTTP(S) 和 SOCKS 代理混合端口');
  });

  it('step 4: re-importing the edited text and exporting again is idempotent', () => {
    const document = parseUpstream();
    document.setScalarIn(['mixed-port'], 10802);
    const onceEdited = document.toText();

    const reparsed = MihomoYamlDocument.parse(onceEdited);
    expect(reparsed.document!.toText()).toBe(onceEdited);
  });
});

describe('golden step 5: specialized syntax samples each round-trip byte-exact (v0.3.0 #19)', () => {
  const SAMPLES = listFixtures('yaml/golden');

  it('covers all six syntax features the version plan calls for — not a hardcoded count, discovered from disk', () => {
    expect(SAMPLES).toEqual([
      'anchors.yaml',
      'comments.yaml',
      'ipv6.yaml',
      'multi-line-secret.yaml',
      'regex.yaml',
      'special-strings.yaml',
    ]);
  });

  it.each(SAMPLES)('%s parses and exports byte-exact, unedited', (name) => {
    const original = readFixture(`yaml/golden/${name}`);
    const parsed = MihomoYamlDocument.parse(original);
    expect(parsed.document, `${name} failed to parse`).not.toBeNull();
    expect(parsed.document!.toText()).toBe(original);
  });
});
