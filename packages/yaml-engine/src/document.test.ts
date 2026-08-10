import { readFixture } from '@mcs/test-fixtures';
import { describe, expect, it } from 'vitest';

import { changedLineNumbers, diffLines } from './diff.js';
import { MihomoYamlDocument } from './document.js';
import { YamlEngineError } from './errors.js';

const COMPREHENSIVE = readFixture('yaml/comprehensive.yaml');

type ParseArgs = Parameters<typeof MihomoYamlDocument.parse>;
type ParsedOk = {
  document: MihomoYamlDocument;
  issues: ReturnType<typeof MihomoYamlDocument.parse>['issues'];
};

/** Parse helper that fails the test instead of returning a nullable document. */
function parse(source: string, options?: ParseArgs[1]): ParsedOk {
  const result = MihomoYamlDocument.parse(source, options);
  if (!result.document) {
    throw new Error(`fixture failed to parse: ${result.issues.map((i) => i.message).join('; ')}`);
  }
  return { document: result.document, issues: result.issues };
}

describe('round-trip fidelity (FR-YAML-02, FR-YAML-03, G-05)', () => {
  it('reproduces an untouched document byte for byte', () => {
    const { document, issues } = parse(COMPREHENSIVE);
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(document.toText()).toBe(COMPREHENSIVE);
  });

  it('is idempotent across a second import/export cycle', () => {
    const first = parse(COMPREHENSIVE).document.toText();
    const second = parse(first).document.toText();
    expect(second).toBe(first);
  });

  it('confines a scalar edit to the edited line', () => {
    const { document } = parse(COMPREHENSIVE);
    document.setScalarIn(['mixed-port'], 7891);

    const diff = diffLines(COMPREHENSIVE, document.toText());
    expect(diff.added).toBe(1);
    expect(diff.removed).toBe(1);
    const sourceLines = COMPREHENSIVE.split('\n');
    const expectedLine = sourceLines.findIndex((line) => line.startsWith('mixed-port:')) + 1;
    expect(changedLineNumbers(diff)).toEqual({ removed: [expectedLine], added: [expectedLine] });
    expect(document.getIn(['mixed-port'])).toBe(7891);
  });

  it('keeps comments, anchors and unknown fields after an edit', () => {
    const { document } = parse(COMPREHENSIVE);
    document.setScalarIn(['log-level'], 'debug');
    const text = document.toText();

    // Head comment, inline comment and section comment survive verbatim.
    expect(text).toContain('# Mihomo Config Studio round-trip fixture.');
    expect(text).toContain('secret: "s3cr3t-token" # keep quoted');
    expect(text).toContain('# Order matters: MATCH must stay last.');

    // Anchors and aliases survive as written, not expanded.
    expect(text).toContain('common-hc: &common-hc');
    expect(text).toContain('<<: *common-hc');
    expect(document.anchors()).toEqual(['common-hc']);

    // A field no schema module knows about is untouched (FR-YAML-02).
    expect(text).toContain('totally-new-mihomo-option:');
    expect(text).toContain('    deep: [1, 2, 3]');
  });

  it('preserves flow style and single-space padding inside nested lists', () => {
    const { document } = parse(COMPREHENSIVE);
    document.setScalarIn(['proxies', 1, 'port'], 8443);
    const text = document.toText();

    // doc.toString() would rewrite this to `{ Host: hk.example.com }`.
    expect(text).toContain('headers: { Host: hk.example.com } # flow mapping, single-space style');
    expect(changedLineNumbers(diffLines(COMPREHENSIVE, text)).added).toHaveLength(1);
  });

  it('keeps a quoted numeric string quoted', () => {
    const { document } = parse(COMPREHENSIVE);
    document.setScalarIn(['proxies', 0, 'password'], '5678');
    const text = document.toText();

    expect(text).toContain('password: "5678" # quoted on purpose');
    expect(parse(text).document.getIn(['proxies', 0, 'password'])).toBe('5678');
  });

  it('forces quoting when a string would otherwise resolve to another type', () => {
    const { document } = parse('mode: rule\n');
    document.setScalarIn(['mode'], '1234');
    const text = document.toText();

    expect(text).toBe('mode: "1234"\n');
    expect(parse(text).document.getIn(['mode'])).toBe('1234');
  });

  it('preserves block scalars around an edit', () => {
    const { document } = parse(COMPREHENSIVE);
    document.setScalarIn(['experimental', 'quic-go-disable-gso'], true);
    const text = document.toText();

    expect(text).toContain('  fingerprint: |\n');
    expect(text).toContain('    -----BEGIN CERTIFICATE-----\n');
    expect(text).toContain('    -----END CERTIFICATE-----\n');
  });

  it('stays byte exact while only scalar edits are applied', () => {
    const { document } = parse(COMPREHENSIVE);
    expect(document.mode).toBe('cst');
    document.setScalarIn(['allow-lan'], false);
    expect(document.mode).toBe('cst');
    document.appendIn(['rules'], 'MATCH,DIRECT');
    expect(document.mode).toBe('ast');
  });
});

describe('structural edits (FR-YAML-02, FR-RULE-02)', () => {
  it('appends a rule while retaining unknown fields and comments', () => {
    const { document } = parse(COMPREHENSIVE);
    document.appendIn(['rules'], 'DOMAIN,new.example.com,PROXY');
    const text = document.toText();

    expect(text).toContain('totally-new-mihomo-option:');
    expect(text).toContain('# Order matters: MATCH must stay last.');
    expect(text).toContain('- DOMAIN,new.example.com,PROXY');

    const reparsed = parse(text).document;
    expect((reparsed.getIn(['rules']) as string[]).at(-1)).toBe('DOMAIN,new.example.com,PROXY');
    expect(reparsed.getIn(['totally-new-mihomo-option', 'nested', 'deep'])).toEqual([1, 2, 3]);
  });

  it('reorders rules without losing any entry', () => {
    const { document } = parse(COMPREHENSIVE);
    const before = document.getIn(['rules']) as string[];
    document.moveSeqItem(['rules'], before.length - 1, 0);

    const after = parse(document.toText()).document.getIn(['rules']) as string[];
    expect(after[0]).toBe('MATCH,PROXY');
    expect([...after].sort()).toEqual([...before].sort());
  });

  it('deletes a node and reports a missing path afterwards', () => {
    const { document } = parse(COMPREHENSIVE);
    document.deleteIn(['proxies', 2]);
    expect((document.getIn(['proxies']) as unknown[]).length).toBe(2);
    expect(() => document.deleteIn(['nope'])).toThrow(YamlEngineError);
  });

  it('renames a map key in place, preserving order and value', () => {
    const { document } = parse(COMPREHENSIVE);
    document.renameKeyIn(['proxy-providers'], 'provider-a', 'provider-main');
    const text = document.toText();

    expect(text).toContain('  provider-main:');
    expect(text).not.toContain('  provider-a:\n');
    const reparsed = parse(text).document;
    expect(Object.keys(reparsed.getIn(['proxy-providers']) as object)).toEqual([
      'provider-main',
      'provider-b',
    ]);
    expect(reparsed.getIn(['proxy-providers', 'provider-main', 'interval'])).toBe(3600);
  });

  it('refuses to rename onto an existing key', () => {
    const { document } = parse(COMPREHENSIVE);
    expect(() => document.renameKeyIn(['proxy-providers'], 'provider-a', 'provider-b')).toThrow(
      /already exists/,
    );
  });

  it('returns to byte-exact mode after commit()', () => {
    const { document } = parse(COMPREHENSIVE);
    document.appendIn(['rules'], 'MATCH,DIRECT');
    const committed = document.commit();

    expect(committed.mode).toBe('cst');
    expect(committed.toText()).toBe(document.toText());
    committed.setScalarIn(['mode'], 'global');
    expect(committed.mode).toBe('cst');
  });
});

describe('addressing and diagnostics (FR-VAL-01, FR-VAL-02)', () => {
  it('locates a nested path by line and column', () => {
    const { document } = parse(COMPREHENSIVE);
    const range = document.locate(['dns', 'enhanced-mode']);
    expect(range).not.toBeNull();

    const line = COMPREHENSIVE.split('\n')[range!.start.line - 1];
    expect(line).toContain('enhanced-mode: fake-ip');
  });

  it('recomputes positions after an edit shifts the text', () => {
    const { document } = parse('a: 1\nb: 2\nc: 3\n');
    document.setIn(['a2'], 'inserted');
    const range = document.locate(['c']);
    const line = document.toText().split('\n')[range!.start.line - 1];
    expect(line).toContain('c: 3');
  });

  it('exposes unknown leaf paths so the UI can surface them', () => {
    const { document } = parse(COMPREHENSIVE);
    const pointers = document.leafPaths().map((path) => path.join('.'));
    expect(pointers).toContain('totally-new-mihomo-option.nested.deep.0');
    expect(pointers).toContain('totally-new-mihomo-option.nested.flag');
  });

  it('keeps the document readable but flags syntax errors', () => {
    const result = MihomoYamlDocument.parse('a: 1\n  b: 2\n');
    expect(result.issues.some((issue) => issue.severity === 'error')).toBe(true);
    const [issue] = result.issues;
    expect(issue?.range?.start.line).toBeGreaterThan(0);
    expect(result.document?.hasSyntaxErrors).toBe(true);
  });

  it('throws a typed error for a missing or non-scalar path', () => {
    const { document } = parse(COMPREHENSIVE);
    expect(() => document.setScalarIn(['does', 'not', 'exist'], 1)).toThrow(
      expect.objectContaining({ code: 'YAML_PATH_NOT_FOUND' }),
    );
    expect(() => document.setScalarIn(['proxies'], 1)).toThrow(
      expect.objectContaining({ code: 'YAML_PATH_NOT_SCALAR' }),
    );
    expect(() => document.appendIn(['dns'], 'x')).toThrow(/not a sequence/);
    expect(() => document.moveSeqItem(['rules'], 0, 999)).toThrow(/out of range/);
  });

  it('never puts configuration values into error messages (NFR-SEC-03)', () => {
    const { document } = parse(COMPREHENSIVE);
    try {
      document.setScalarIn(['secret', 'inner'], 'x');
      throw new Error('expected a failure');
    } catch (error) {
      expect(error).toBeInstanceOf(YamlEngineError);
      expect((error as Error).message).not.toContain('s3cr3t-token');
    }
  });
});

describe('resource limits (NFR-SEC-06)', () => {
  it('rejects oversized input', () => {
    const result = MihomoYamlDocument.parse('a: 1\n', { limits: { maxBytes: 4 } });
    expect(result.document).toBeNull();
    expect(result.issues[0]?.code).toBe('yaml.limit.size');
  });

  it('rejects documents nested past the depth limit', () => {
    let text = 'leaf: 1';
    for (let i = 0; i < 40; i += 1) text = `k${i}:\n  ${text.replace(/\n/g, '\n  ')}`;
    const result = MihomoYamlDocument.parse(text, { limits: { maxDepth: 10 } });
    expect(result.document).toBeNull();
    expect(result.issues.some((issue) => issue.code === 'yaml.limit.depth')).toBe(true);
  });

  it('rejects multi-document streams past the limit', () => {
    const result = MihomoYamlDocument.parse('a: 1\n---\nb: 2\n---\nc: 3\n', {
      limits: { maxDocuments: 2 },
    });
    expect(result.document).toBeNull();
    expect(result.issues[0]?.code).toBe('yaml.limit.documents');
  });

  it('stops alias expansion bombs instead of materialising them', () => {
    const bomb = readFixture('yaml/adversarial/billion-laughs.yaml');
    const result = MihomoYamlDocument.parse(bomb, { limits: { maxAliasCount: 100 } });
    // The document parses (the text is small); expansion is what must fail.
    expect(result.document).not.toBeNull();
    expect(() => result.document!.toJS()).toThrow(/alias/i);
  });

  it('measures UTF-8 length rather than UTF-16 code units', () => {
    const result = MihomoYamlDocument.parse('a: "中文测试"\n', { limits: { maxBytes: 12 } });
    expect(result.document).toBeNull();
    expect(result.issues[0]?.code).toBe('yaml.limit.size');
  });
});
