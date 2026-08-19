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

import {
  DNS_MODULE,
  GENERAL_MODULE,
  INBOUND_MODULE,
  PROXIES_MODULE,
  SNIFFER_MODULE,
} from './index.js';

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
 * `proxies` has no top-level `.properties` — the discriminated union sits at
 * the schema's own root (`$defs` + `oneOf`), not on a named field, so
 * `collectSchemaPaths` (which only ever walks `.properties`) sees nothing.
 * Walks the same `_shared.<key>` / `<protocol>.<key>` naming
 * `UPSTREAM_P0_FIELDS.proxies` already uses (frozen in v0.3.0 #3), reading
 * `$defs` directly: this module's own `$ref` shape is simple and fully known
 * here (a branch ref, then that def's own `allOf: [sharedRef, ownProperties]`).
 */
function collectProxyFieldPaths(schema: JsonSchema): Set<string> {
  const defs = schema.$defs ?? {};
  const paths = new Set<string>();

  for (const key of Object.keys(defs.shared?.properties ?? {})) {
    paths.add(`_shared.${key}`);
  }

  for (const branchRef of schema.oneOf ?? []) {
    const refName = branchRef.$ref?.replace('#/$defs/', '');
    if (!refName) continue;
    const ownSchema = defs[refName]?.allOf?.find((member) => member.$ref === undefined);
    for (const key of Object.keys(ownSchema?.properties ?? {})) {
      // The discriminator is declared per-branch (each branch needs its own
      // `const`) but is conceptually shared — `UPSTREAM_P0_FIELDS` files it
      // under `_shared.type`, not `<protocol>.type`.
      paths.add(key === 'type' ? '_shared.type' : `${refName}.${key}`);
    }
  }

  return paths;
}

/**
 * `buildFormPlan` only detects a `oneOf`/`anyOf` union when it sits on a
 * *named field* inside an object (`planField`'s job) — never at a schema's
 * own root (`planObject` only ever walks `.properties`). A real `proxies[]`
 * element has no wrapping key of its own (an entry IS `{name, type, server,
 * ...}` directly), and baking a fake wrapper into `config.schema.json` just
 * to satisfy today's planner would make this module's stored schema stop
 * matching what a real element looks like on disk — so the wrapping happens
 * only here, for this proof, never in the stored module. This is the same
 * synthetic-harness technique `form-plan.test.ts`'s `variantModule` uses,
 * pointed at `PROXIES_MODULE`'s real `$defs`/`oneOf` instead of a made-up
 * one. A real per-item renderer (#14) will need the same wrap-then-reprefix
 * step to turn "one array element" into "one rendered form".
 */
function planOneProxy(value: unknown, schema: JsonSchema = PROXIES_MODULE.schema) {
  const probeModule: SchemaModule = {
    manifest: { id: 'proxies-item-probe', root: [], version: '1.0.0' },
    schema: {
      type: 'object',
      properties: { item: { ...(schema.oneOf !== undefined ? { oneOf: schema.oneOf } : {}) } },
      ...(schema.$defs !== undefined ? { $defs: schema.$defs } : {}),
    },
    ui: {
      fields: {
        item: {
          ...(PROXIES_MODULE.ui.fields !== undefined ? { fields: PROXIES_MODULE.ui.fields } : {}),
        },
      },
    },
  };
  return buildFormPlan(probeModule, { item: value }, { mode: 'advanced' });
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

describe('proxies module (v0.3.0 #9 — discriminated-union skeleton + http/socks5/ss/trojan)', () => {
  it('has no shape issues (rules/examples/i18n)', () => {
    expect(validateModuleShape(PROXIES_MODULE)).toEqual([]);
  });

  it('declares exactly the P0 fields UPSTREAM_P0_FIELDS lists for http/socks5/ss/trojan — no more, no less (the other five protocols are #10)', () => {
    const declared = collectProxyFieldPaths(PROXIES_MODULE.schema);
    const scopedUpstream = new Set(
      UPSTREAM_P0_FIELDS.proxies
        .map((record) => record.path)
        .filter((path) => /^(_shared|http|socks5|ss|trojan)\./.test(path)),
    );

    const declaredNotUpstream = [...declared].filter((path) => !scopedUpstream.has(path));
    const upstreamNotDeclared = [...scopedUpstream].filter((path) => !declared.has(path));

    expect(declaredNotUpstream).toEqual([]);
    expect(upstreamNotDeclared).toEqual([]);
  });

  it('gives every declared field a UI entry with docs + safety metadata', () => {
    const missing: string[] = [];
    for (const path of collectProxyFieldPaths(PROXIES_MODULE.schema)) {
      const bareKey = path.split('.').at(-1) ?? path;
      const spec = PROXIES_MODULE.ui.fields?.[bareKey];
      if (!spec?.docs || !spec.safety) missing.push(path);
    }
    expect(missing).toEqual([]);
  });

  it('lists all four example kinds with a path that exists on disk', () => {
    const kinds = PROXIES_MODULE.examples?.map((example) => example.kind).sort();
    expect(kinds).toEqual(['edge', 'invalid', 'unknown-fields', 'valid']);
    for (const example of PROXIES_MODULE.examples ?? []) {
      expect(() => readExample(PROXIES_MODULE, example.path)).not.toThrow();
    }
  });

  it('valid.yaml and edge.yaml have no schema violations', () => {
    for (const kind of ['valid', 'edge'] as const) {
      const example = PROXIES_MODULE.examples?.find((candidate) => candidate.kind === kind);
      if (!example) throw new Error(`no ${kind} example declared`);
      const value = parseExample(PROXIES_MODULE, example.path);
      expect(validateValue(value, PROXIES_MODULE.schema), example.path).toEqual([]);
    }
  });

  it('invalid.yaml has at least one schema violation', () => {
    const value = parseExample(PROXIES_MODULE, 'examples/invalid.yaml');
    expect(validateValue(value, PROXIES_MODULE.schema).length).toBeGreaterThan(0);
  });

  it('every docs URL is on the official wiki domain and carries no query string (NFR-SEC-03 boundary)', () => {
    const offenders: string[] = [];
    for (const [key, spec] of Object.entries(PROXIES_MODULE.ui.fields ?? {})) {
      if (!spec.docs) continue;
      const url = new URL(spec.docs);
      const onOfficialDomain = url.hostname === 'wiki.metacubex.one';
      const hasNoQuery = url.search === '';
      if (!onOfficialDomain || !hasNoQuery) offenders.push(key);
    }
    expect(offenders).toEqual([]);
  });

  it('unknown-fields.yaml plans its undeclared field as unknown instead of dropping it', () => {
    const value = parseExample(PROXIES_MODULE, 'examples/unknown-fields.yaml');
    const plan = planOneProxy(value);
    const item = plan.fields.find((field) => field.key === 'item');
    expect(item?.children?.some((child) => child.unknown)).toBe(true);
    expect(plan.unknownFields.length).toBeGreaterThan(0);
  });

  it('plans each of the four real protocols as a variant, discriminated on "type", with that protocol\'s own fields as children', () => {
    const cases: Array<{ value: Record<string, unknown>; protocol: string; ownField: string }> = [
      {
        value: { name: 'http1', type: 'http', server: 's', port: 1, username: 'u', password: 'p' },
        protocol: 'http',
        ownField: 'username',
      },
      {
        value: { name: 'socks1', type: 'socks5', server: 's', port: 1, tls: true },
        protocol: 'socks5',
        ownField: 'tls',
      },
      {
        value: {
          name: 'ss1',
          type: 'ss',
          server: 's',
          port: 1,
          cipher: 'aes-128-gcm',
          password: 'p',
        },
        protocol: 'ss',
        ownField: 'cipher',
      },
      {
        value: {
          name: 'trojan1',
          type: 'trojan',
          server: 's',
          port: 1,
          password: 'p',
          network: 'grpc',
        },
        protocol: 'trojan',
        ownField: 'network',
      },
    ];

    for (const { value, protocol, ownField } of cases) {
      const plan = planOneProxy(value);
      const item = plan.fields.find((field) => field.key === 'item');
      expect(item?.control, protocol).toBe('variant');
      expect(item?.variant, protocol).toMatchObject({
        discriminatorKey: 'type',
        selected: protocol,
        matched: true,
      });
      expect(
        item?.children?.some((child) => child.key === ownField),
        protocol,
      ).toBe(true);
      // The discriminator itself is represented by `variant`, never duplicated as a child row.
      expect(
        item?.children?.some((child) => child.key === 'type'),
        protocol,
      ).toBe(false);
    }
  });

  it('masks password as a secret control on every protocol that carries one, with no explicit UI override (NFR-SEC-02)', () => {
    expect(PROXIES_MODULE.ui.fields?.password?.control).toBeUndefined();

    const withPassword = [
      { name: 'http1', type: 'http', server: 's', port: 1, password: 'hunter2' },
      { name: 'socks1', type: 'socks5', server: 's', port: 1, password: 'hunter2' },
      { name: 'ss1', type: 'ss', server: 's', port: 1, cipher: 'aes-128-gcm', password: 'hunter2' },
      { name: 'trojan1', type: 'trojan', server: 's', port: 1, password: 'hunter2' },
    ];
    for (const value of withPassword) {
      const plan = planOneProxy(value);
      const item = plan.fields.find((field) => field.key === 'item');
      const password = item?.children?.find((child) => child.key === 'password');
      expect(password?.control, String(value.type)).toBe('secret');
    }
  });

  it('adding a fifth protocol branch needs no change outside config.schema.json/ui.schema.json — the same probe harness plans it immediately (FR-SCHEMA-06 applied to unions, real-field proof ahead of #10)', () => {
    const extendedSchema: JsonSchema = {
      ...PROXIES_MODULE.schema,
      $defs: {
        ...PROXIES_MODULE.schema.$defs,
        vmess: {
          allOf: [
            { $ref: '#/$defs/shared' },
            {
              type: 'object',
              properties: { type: { const: 'vmess' }, uuid: { type: 'string' } },
              required: ['type', 'uuid'],
            },
          ],
        },
      },
      oneOf: [...(PROXIES_MODULE.schema.oneOf ?? []), { $ref: '#/$defs/vmess' }],
    };

    const plan = planOneProxy(
      { name: 'v1', type: 'vmess', server: 's', port: 1, uuid: 'abc-123-def' },
      extendedSchema,
    );
    const item = plan.fields.find((field) => field.key === 'item');
    expect(item?.variant).toMatchObject({ selected: 'vmess', matched: true });
    const uuid = item?.children?.find((child) => child.key === 'uuid');
    expect(uuid?.value).toBe('abc-123-def');
    // NFR-SEC-02 holds on the brand-new branch too, for free — `uuid` is in
    // SENSITIVE_KEY regardless of which branch declares it, and no code
    // anywhere (not here, not form-renderer, not apps/web) had to change to
    // get this: only `extendedSchema`'s data changed.
    expect(uuid?.control).toBe('secret');
  });
});
