import type { ModuleExample, SchemaModule } from '@mcs/schema-core';
import { BUILTIN_MODULE_FILES } from '@mcs/schema-builtin';
import { BUILTIN_TEMPLATES } from '@mcs/templates';
import { MihomoYamlDocument } from '@mcs/yaml-engine';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  buildCorpus,
  buildMigrationCases,
  buildModuleExampleCases,
  buildTemplateCases,
  SCHEMA_BUILTIN_MODULES_ROOT,
  TEMPLATES_ROOT,
  type KernelTestCase,
  type ReadTextFile,
} from './corpus.js';

const BASIC_PROXY_TEXT = [
  'mode: rule',
  'log-level: info',
  'allow-lan: false',
  'mixed-port: 7890',
  'dns:',
  '  enable: true',
  '  enhanced-mode: fake-ip',
  '  nameserver:',
  '    - 223.5.5.5',
  'proxies:',
  '  - name: my-server-1',
  '    type: ss',
  '    server: example.com',
  '    port: 8388',
  '    cipher: aes-128-gcm',
  '    password: CHANGE_ME',
  '  - name: my-server-2',
  '    type: trojan',
  '    server: example.com',
  '    port: 443',
  '    password: CHANGE_ME',
  '',
].join('\n');

function fakeModule(overrides: {
  id: string;
  root: string[];
  examples?: ModuleExample[];
  migrations?: SchemaModule['migrations'];
}): SchemaModule {
  return {
    manifest: { id: overrides.id, root: overrides.root, version: '1.0.0' },
    schema: {},
    ui: {},
    ...(overrides.examples ? { examples: overrides.examples } : {}),
    ...(overrides.migrations ? { migrations: overrides.migrations } : {}),
  };
}

/** Fake `ReadTextFile` port keyed by exact path string, so tests never touch the real filesystem for synthetic fixtures. */
function fakeReader(files: Record<string, string>): ReadTextFile {
  return (path) => {
    const text = files[path];
    if (text === undefined) throw new Error(`fakeReader: no fixture registered for "${path}"`);
    return text;
  };
}

/**
 * Builds a fake reader's file map using the exact same path-joining
 * `buildModuleExampleCases` uses internally (`SCHEMA_BUILTIN_MODULES_ROOT` +
 * module id + the example's own relative path) — so tests never need to
 * pattern-match or normalise a path themselves (fragile across win32/posix
 * separators), they just describe fixtures by their relative path.
 */
function moduleExampleReader(
  moduleId: string,
  filesByRelativePath: Record<string, string>,
): ReadTextFile {
  return fakeReader(
    Object.fromEntries(
      Object.entries(filesByRelativePath).map(([relativePath, text]) => [
        join(SCHEMA_BUILTIN_MODULES_ROOT, moduleId, relativePath),
        text,
      ]),
    ),
  );
}

function parseDoc(text: string): MihomoYamlDocument {
  const { document } = MihomoYamlDocument.parse(text);
  if (!document) throw new Error('test fixture failed to parse as YAML');
  return document;
}

describe('buildTemplateCases', () => {
  it('turns every BUILTIN_TEMPLATE into a pass-expecting case carrying its real config text', () => {
    const read = fakeReader(
      Object.fromEntries(
        BUILTIN_TEMPLATES.map((template) => [
          join(TEMPLATES_ROOT, template.configPath),
          `# ${template.id}\n`,
        ]),
      ),
    );
    const cases = buildTemplateCases(read);
    expect(cases).toHaveLength(5);
    expect(cases.every((c) => c.kind === 'template' && c.expect === 'pass')).toBe(true);
    expect(cases.map((c) => c.id)).toEqual([
      'template:basic-proxy',
      'template:provider-auto-select',
      'template:home-router',
      'template:rule-set-routing',
      'template:android-target',
    ]);
  });
});

/**
 * Pinning the exact count here is a deliberate checkpoint: `buildCorpus`
 * (`corpus.ts`) iterates `BUILTIN_TEMPLATES` directly to build the kernel
 * matrix's `template` cases, so a future template addition has to consciously
 * update this test, the same reasoning `index.test.ts` used to carry before
 * this responsibility moved from `main()` (`index.ts`) to `buildCorpus()`
 * (v0.9.0 #2).
 */
describe('BUILTIN_TEMPLATES feeding the kernel test matrix (PRD §13.3/§13.5, v0.4.0 #17)', () => {
  it('covers all five PRD §8.8 MVP templates', () => {
    expect(BUILTIN_TEMPLATES.map((template) => template.id)).toEqual([
      'basic-proxy',
      'provider-auto-select',
      'home-router',
      'rule-set-routing',
      'android-target',
    ]);
  });
});

describe('buildModuleExampleCases / merge strategies', () => {
  it("spreads a root: [] fragment's top-level keys onto the document root (general/inbound shape)", () => {
    const module = fakeModule({
      id: 'general',
      root: [],
      examples: [{ name: 'valid', kind: 'valid', path: 'examples/valid.yaml' }],
    });
    const read = moduleExampleReader('general', {
      'examples/valid.yaml': 'mode: global\nallow-lan: true\n',
    });
    const cases = buildModuleExampleCases(read, [module], BASIC_PROXY_TEXT);
    expect(cases).toHaveLength(1);
    const doc = parseDoc(cases[0]!.configText);
    expect(doc.getIn(['mode'])).toBe('global');
    expect(doc.getIn(['allow-lan'])).toBe(true);
    // Untouched sibling keys from the skeleton survive.
    expect(doc.getIn(['mixed-port'])).toBe(7890);
  });

  it('rejects a root: [] fragment that is not a map', () => {
    const module = fakeModule({
      id: 'inbound',
      root: [],
      examples: [{ name: 'valid', kind: 'valid', path: 'examples/valid.yaml' }],
    });
    const read = moduleExampleReader('inbound', { 'examples/valid.yaml': '- 1\n- 2\n' });
    expect(() => buildModuleExampleCases(read, [module], BASIC_PROXY_TEXT)).toThrow(
      /must be a map/,
    );
  });

  it('sets a root: [k] fragment as the whole value at that path (dns/sniffer/rules/sub-rules shape)', () => {
    const module = fakeModule({
      id: 'dns',
      root: ['dns'],
      examples: [{ name: 'edge', kind: 'edge', path: 'examples/edge.yaml' }],
    });
    const read = moduleExampleReader('dns', { 'examples/edge.yaml': 'enable: false\n' });
    const cases = buildModuleExampleCases(read, [module], BASIC_PROXY_TEXT);
    const doc = parseDoc(cases[0]!.configText);
    expect(doc.getIn(['dns'])).toEqual({ enable: false });
  });

  it('wraps a root: [k] fragment as the sole element of the array at that path (proxies/proxy-groups shape)', () => {
    const module = fakeModule({
      id: 'proxies',
      root: ['proxies'],
      examples: [{ name: 'valid', kind: 'valid', path: 'examples/valid.yaml' }],
    });
    const read = moduleExampleReader('proxies', {
      'examples/valid.yaml': 'name: solo\ntype: ss\nserver: h\nport: 1\ncipher: c\npassword: p\n',
    });
    const cases = buildModuleExampleCases(read, [module], BASIC_PROXY_TEXT);
    const doc = parseDoc(cases[0]!.configText);
    expect(doc.getIn(['proxies'])).toEqual([
      { name: 'solo', type: 'ss', server: 'h', port: 1, cipher: 'c', password: 'p' },
    ]);
  });

  it('wraps a root: [k] fragment as one synthetically-keyed entry of the map at that path (proxy-providers/rule-providers shape)', () => {
    const module = fakeModule({
      id: 'proxy-providers',
      root: ['proxy-providers'],
      examples: [{ name: 'edge', kind: 'edge', path: 'examples/edge.yaml' }],
    });
    const read = moduleExampleReader('proxy-providers', {
      'examples/edge.yaml': 'type: file\npath: ./x.yaml\n',
    });
    const cases = buildModuleExampleCases(read, [module], BASIC_PROXY_TEXT);
    const doc = parseDoc(cases[0]!.configText);
    expect(doc.getIn(['proxy-providers'])).toEqual({
      provider1: { type: 'file', path: './x.yaml' },
    });
  });

  it('throws for a module id with no registered merge strategy, rather than guessing one', () => {
    const module = fakeModule({
      id: 'not-a-real-module',
      root: ['not-a-real-module'],
      examples: [{ name: 'valid', kind: 'valid', path: 'examples/valid.yaml' }],
    });
    const read = moduleExampleReader('not-a-real-module', { 'examples/valid.yaml': 'x: 1\n' });
    expect(() => buildModuleExampleCases(read, [module], BASIC_PROXY_TEXT)).toThrow(
      /no registered corpus merge strategy/,
    );
  });

  it('maps each ModuleExample.kind to the expected kernel outcome — valid/edge/unknown-fields pass, invalid fails', () => {
    const module = fakeModule({
      id: 'sniffer',
      root: ['sniffer'],
      examples: [
        { name: 'valid', kind: 'valid', path: 'v.yaml' },
        { name: 'edge', kind: 'edge', path: 'e.yaml' },
        { name: 'invalid', kind: 'invalid', path: 'i.yaml' },
        { name: 'unknown-fields', kind: 'unknown-fields', path: 'u.yaml' },
      ],
    });
    const read = moduleExampleReader('sniffer', {
      'v.yaml': 'enable: true\n',
      'e.yaml': 'enable: false\n',
      'i.yaml': 'enable: true\n',
      'u.yaml': 'enable: true\n',
    });
    const cases = buildModuleExampleCases(read, [module], BASIC_PROXY_TEXT);
    const byKind = Object.fromEntries(cases.map((c) => [c.id.split(':').pop(), c.expect]));
    expect(byKind).toEqual({
      valid: 'pass',
      edge: 'pass',
      invalid: 'fail',
      'unknown-fields': 'pass',
    });
  });

  it('leaves the permanent cross-reference baseline (ss1/ss2, the PROXY group, the cn-domain rule-provider) intact for a module that does not own those keys', () => {
    const module = fakeModule({
      id: 'dns',
      root: ['dns'],
      examples: [{ name: 'valid', kind: 'valid', path: 'v.yaml' }],
    });
    const read = moduleExampleReader('dns', { 'v.yaml': 'enable: true\n' });
    const cases = buildModuleExampleCases(read, [module], BASIC_PROXY_TEXT);
    const doc = parseDoc(cases[0]!.configText);
    const proxyNames = (doc.getIn(['proxies']) as { name: string }[]).map((p) => p.name);
    expect(proxyNames).toEqual(['my-server-1', 'my-server-2', 'ss1', 'ss2']);
    expect(doc.getIn(['proxy-groups'])).toEqual([
      { name: 'PROXY', type: 'select', proxies: ['my-server-1', 'my-server-2', 'ss1', 'ss2'] },
    ]);
    expect(doc.hasIn(['rule-providers', 'cn-domain'])).toBe(true);
  });
});

describe('buildMigrationCases', () => {
  const dnsModuleWithMigrations = (migrations: SchemaModule['migrations']) =>
    fakeModule({ id: 'dns', root: ['dns'], migrations });

  it('produces no cases when no built-in module declares a migrations array', async () => {
    const modules = [
      fakeModule({ id: 'dns', root: ['dns'] }),
      fakeModule({ id: 'general', root: [] }),
    ];
    await expect(buildMigrationCases(modules, BASIC_PROXY_TEXT)).resolves.toEqual([]);
  });

  it('is currently empty for the real built-in module set — every module is still at its first version', async () => {
    await expect(
      buildMigrationCases(Object.values(BUILTIN_MODULE_FILES), BASIC_PROXY_TEXT),
    ).resolves.toEqual([]);
  });

  it('runs a real, non-lossy migration plan end to end and reports it as a pass-expecting case', async () => {
    const module = dnsModuleWithMigrations([
      {
        from: '1.0.0',
        to: '1.1.0',
        operations: [{ op: 'rename-field', path: 'enable', to: 'enabled' }],
      },
    ]);
    const cases = await buildMigrationCases([module], BASIC_PROXY_TEXT);
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({
      kind: 'migration',
      expect: 'pass',
      id: 'migration:dns:1.0.0->1.1.0',
    });
    const doc = parseDoc(cases[0]!.configText);
    expect(doc.hasIn(['dns', 'enabled'])).toBe(true);
    expect(doc.hasIn(['dns', 'enable'])).toBe(false);
  });

  it('throws rather than silently dropping a declared migration that cannot actually apply (a lossy op without confirmation)', async () => {
    const module = dnsModuleWithMigrations([
      { from: '1.0.0', to: '1.1.0', operations: [{ op: 'remove-field', path: 'enable' }] },
    ]);
    await expect(buildMigrationCases([module], BASIC_PROXY_TEXT)).rejects.toThrow(
      /MIGRATION_LOSSY_NOT_CONFIRMED/,
    );
  });
});

describe('buildCorpus — real BUILTIN_MODULE_FILES / BUILTIN_TEMPLATES data, real disk reads', () => {
  const realReadTextFile: ReadTextFile = (path) => readFileSync(path, 'utf8');
  let corpus: KernelTestCase[];

  it('builds without throwing against every real built-in module and template', async () => {
    corpus = await buildCorpus(realReadTextFile, Object.values(BUILTIN_MODULE_FILES));
    expect(corpus.length).toBeGreaterThan(0);
  });

  it('has exactly 5 template cases + 40 module-example cases (10 modules x 4 kinds) + 0 migration cases today', () => {
    const byKind = { template: 0, 'module-example': 0, migration: 0 };
    for (const testCase of corpus) byKind[testCase.kind] += 1;
    expect(byKind).toEqual({ template: 5, 'module-example': 40, migration: 0 });
  });

  it('gives every case a unique id', () => {
    expect(new Set(corpus.map((c) => c.id)).size).toBe(corpus.length);
  });

  it('produces config text for every case that parses as syntactically valid YAML (a real kernel run is #1s CI-only concern, not this unit test)', () => {
    for (const testCase of corpus) {
      const { document } = MihomoYamlDocument.parse(testCase.configText);
      expect(document, `case "${testCase.id}" produced unparsable YAML`).not.toBeNull();
      expect(
        document?.hasSyntaxErrors,
        `case "${testCase.id}" produced YAML with syntax errors`,
      ).toBe(false);
    }
  });
});
