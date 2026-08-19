import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildFormPlan,
  evaluateRules,
  validateModuleShape,
  validateValue,
  type JsonSchema,
  type SchemaModule,
} from '@mcs/schema-core';
import { UPSTREAM_P0_FIELDS, type P0ModuleId } from '@mcs/test-fixtures';
import { MihomoYamlDocument } from '@mcs/yaml-engine';
import { describe, expect, it } from 'vitest';

import { DNS_MODULE, GENERAL_MODULE, INBOUND_MODULE, SNIFFER_MODULE } from './index.js';

const MODULES_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'modules');

function moduleDir(module: SchemaModule): string {
  return join(MODULES_ROOT, module.manifest.id);
}

function readExample(module: SchemaModule, relativePath: string): string {
  return readFileSync(join(moduleDir(module), relativePath), 'utf8');
}

/** Parses one of a module's own example files into the plain value `validateValue`/`buildFormPlan` expect. */
function parseExample(module: SchemaModule, relativePath: string): unknown {
  const { document, issues } = MihomoYamlDocument.parse(readExample(module, relativePath));
  expect(issues, `${relativePath} must itself be syntactically valid YAML`).toEqual([]);
  return document?.toJS();
}

/**
 * `buildFormPlan` takes the whole Mihomo document and extracts its own
 * subtree via `manifest.root` (see `SchemaFormProps.value`'s doc comment in
 * `form-renderer`) — unlike `validateValue`, which takes an already-scoped
 * value. Example fixtures are written scoped (flat, matching `module.schema`
 * directly, root-agnostic like `UPSTREAM_P0_FIELDS`' document paths are
 * not), so re-wrap one under `root` before handing it to `buildFormPlan`.
 * A no-op for `general`/`inbound` (`root: []`).
 */
function toDocument(module: SchemaModule, scopedValue: unknown): unknown {
  return module.manifest.root.reduceRight<unknown>(
    (value, segment) => ({ [segment]: value }),
    scopedValue,
  );
}

/** Every `properties` path in a JSON Schema, descending into nested objects — the same dot-path shape `UPSTREAM_P0_FIELDS` uses. */
function collectSchemaPaths(schema: JsonSchema, prefix = ''): string[] {
  const paths: string[] = [];
  for (const [key, propSchema] of Object.entries(schema.properties ?? {})) {
    const path = prefix ? `${prefix}.${key}` : key;
    paths.push(path);
    if (propSchema.type === 'object' && propSchema.properties) {
      paths.push(...collectSchemaPaths(propSchema, path));
    }
  }
  return paths;
}

/**
 * Every module this package ships, checked the same way. One module's own
 * quirks (a real `secret` field, a real `validation.rules` example) get a
 * dedicated `describe` block further down instead of bloating this table —
 * the point of the table is the checks every module owes regardless of
 * content, not an exhaustive per-field audit.
 */
const MODULES: ReadonlyArray<{ id: P0ModuleId; module: SchemaModule }> = [
  { id: 'general', module: GENERAL_MODULE },
  { id: 'dns', module: DNS_MODULE },
  { id: 'sniffer', module: SNIFFER_MODULE },
  { id: 'inbound', module: INBOUND_MODULE },
];

describe.each(MODULES)('$id module (v0.3.0 #6-#8)', ({ id, module }) => {
  it('has no shape issues (rules/examples/i18n)', () => {
    expect(validateModuleShape(module)).toEqual([]);
  });

  it('declares exactly the P0 fields UPSTREAM_P0_FIELDS lists for this module — no more, no less', () => {
    // UPSTREAM_P0_FIELDS paths are document-rooted (e.g. "dns.enable"), but a
    // module's own schema is relative to its `manifest.root` — project back
    // onto the document by re-prepending it before comparing.
    const rootPrefix = module.manifest.root.join('.');
    const declared = new Set(
      collectSchemaPaths(module.schema).map((path) =>
        rootPrefix ? `${rootPrefix}.${path}` : path,
      ),
    );
    const upstream = new Set(UPSTREAM_P0_FIELDS[id].map((record) => record.path));

    const declaredNotUpstream = [...declared].filter((path) => !upstream.has(path));
    const upstreamNotDeclared = [...upstream].filter((path) => !declared.has(path));

    expect(declaredNotUpstream).toEqual([]);
    expect(upstreamNotDeclared).toEqual([]);
  });

  it('gives every declared field a UI entry with docs + safety metadata (head start on FR-SCHEMA-04, full assertion in #18)', () => {
    const missing: string[] = [];
    for (const path of collectSchemaPaths(module.schema)) {
      const segments = path.split('.');
      let fields = module.ui.fields ?? {};
      let spec: (typeof fields)[string] | undefined;
      for (const segment of segments) {
        spec = fields[segment];
        if (!spec) break;
        fields = spec.fields ?? {};
      }
      if (!spec?.docs || !spec.safety) missing.push(path);
    }
    expect(missing).toEqual([]);
  });

  it('lists all four example kinds with a path that exists on disk', () => {
    const kinds = module.examples?.map((example) => example.kind).sort();
    expect(kinds).toEqual(['edge', 'invalid', 'unknown-fields', 'valid']);

    for (const example of module.examples ?? []) {
      expect(() => readExample(module, example.path)).not.toThrow();
    }
  });

  it('valid.yaml and edge.yaml have no schema violations', () => {
    for (const kind of ['valid', 'edge'] as const) {
      const example = module.examples?.find((candidate) => candidate.kind === kind);
      if (!example) throw new Error(`${id}: no ${kind} example declared`);
      const value = parseExample(module, example.path);
      expect(validateValue(value, module.schema), `${id}/${example.path}`).toEqual([]);
    }
  });

  it('invalid.yaml has at least one schema violation', () => {
    const example = module.examples?.find((candidate) => candidate.kind === 'invalid');
    if (!example) throw new Error(`${id}: no invalid example declared`);
    const value = parseExample(module, example.path);
    expect(validateValue(value, module.schema).length).toBeGreaterThan(0);
  });

  it('unknown-fields.yaml plans its undeclared field as unknown instead of dropping it', () => {
    const example = module.examples?.find((candidate) => candidate.kind === 'unknown-fields');
    if (!example) throw new Error(`${id}: no unknown-fields example declared`);
    const value = parseExample(module, example.path);
    const plan = buildFormPlan(module, toDocument(module, value), { mode: 'advanced' });
    expect(plan.unknownFields.length).toBeGreaterThan(0);
  });

  it('every docs URL is on the official wiki domain and carries no query string (NFR-SEC-03 boundary)', () => {
    const offenders: string[] = [];
    for (const [key, spec] of Object.entries(module.ui.fields ?? {})) {
      if (!spec.docs) continue;
      const url = new URL(spec.docs);
      const onOfficialDomain = url.hostname === 'wiki.metacubex.one';
      const hasNoQuery = url.search === '';
      if (!onOfficialDomain || !hasNoQuery) offenders.push(key);
    }
    expect(offenders).toEqual([]);
  });
});

describe('general module specifics', () => {
  it('infers the Controller secret as a secret control without any explicit UI override (NFR-SEC-02)', () => {
    expect(GENERAL_MODULE.ui.fields?.secret?.control).toBeUndefined();

    const plan = buildFormPlan(GENERAL_MODULE, { secret: 'hunter2' }, { mode: 'advanced' });
    const secretField = plan.fields.find((field) => field.key === 'secret');
    expect(secretField?.control).toBe('secret');
  });
});

describe('dns module specifics', () => {
  it('invalid.yaml has schema violations on every field its own comment claims', () => {
    const value = parseExample(DNS_MODULE, 'examples/invalid.yaml');
    const issues = validateValue(value, DNS_MODULE.schema);
    const paths = issues.map((issue) => issue.path.join('.'));
    expect(paths).toContain('enhanced-mode');
    expect(paths).toContain('fake-ip-range');
  });

  it('evaluates the real validation.rules.json entry against real content, both ways', () => {
    // geoip disabled but geoip-code still set: the rule must fire.
    const firing = evaluateRules(DNS_MODULE.rules ?? [], {
      'fallback-filter': { geoip: false, 'geoip-code': 'CN' },
    });
    expect(firing).toEqual([
      expect.objectContaining({
        ruleId: 'fallback-filter-geoip-code-requires-geoip',
        path: ['fallback-filter', 'geoip-code'],
      }),
    ]);

    // geoip enabled: no complaint about geoip-code.
    const quiet = evaluateRules(DNS_MODULE.rules ?? [], {
      'fallback-filter': { geoip: true, 'geoip-code': 'CN' },
    });
    expect(quiet).toEqual([]);
  });
});

describe('inbound module specifics', () => {
  it('hides TUN fields on ios but keeps them visible on desktop/android (real-field re-verification of the platform-restriction mechanism, v0.3.0 #8)', () => {
    const value = { tun: { enable: true, stack: 'mixed' } };

    const onIos = buildFormPlan(INBOUND_MODULE, value, { mode: 'advanced', platform: 'ios' });
    const stackOnIos = onIos.fields
      .find((field) => field.key === 'tun')
      ?.children?.find((child) => child.key === 'stack');
    expect(stackOnIos?.visible).toBe(false);
    // Hidden, not dropped: the value survives.
    expect(stackOnIos?.value).toBe('mixed');

    const onLinux = buildFormPlan(INBOUND_MODULE, value, { mode: 'advanced', platform: 'linux' });
    const stackOnLinux = onLinux.fields
      .find((field) => field.key === 'tun')
      ?.children?.find((child) => child.key === 'stack');
    expect(stackOnLinux?.visible).toBe(true);
  });

  it('hides tun sub-fields until tun.enable is true, without dropping their values', () => {
    const value = { tun: { enable: false, stack: 'mixed' } };
    const plan = buildFormPlan(INBOUND_MODULE, value, { mode: 'advanced', platform: 'linux' });
    const stack = plan.fields
      .find((field) => field.key === 'tun')
      ?.children?.find((child) => child.key === 'stack');
    expect(stack?.visible).toBe(false);
    expect(stack?.value).toBe('mixed');
  });

  it('marks the listening-port fields caution, the same risk category as allow-lan (metadata groundwork for #13 FR-VAL-04)', () => {
    expect(INBOUND_MODULE.ui.fields?.port?.safety).toBe('caution');
    expect(INBOUND_MODULE.ui.fields?.['socks-port']?.safety).toBe('caution');
    expect(INBOUND_MODULE.ui.fields?.['mixed-port']?.safety).toBe('caution');
  });
});
