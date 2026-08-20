import { describe, expect, it } from 'vitest';

import {
  buildArrayFormPlan,
  buildFormPlan,
  collectUnknownFields,
  computeKnownPaths,
  inferControl,
  isArrayEntryModule,
  type PlannedField,
} from './form-plan.js';
import { sampleModule } from './testing/sample-module.js';
import type { JsonSchema, SchemaModule } from './types.js';

const DOCUMENT = {
  sample: {
    mode: 'rule',
    'log-level': 'info',
    'allow-lan': false,
    'mixed-port': 7890,
    secret: 'do-not-render-me',
    hosts: { 'a.example.com': '127.0.0.1' },
    'skip-domain': ['Mijia Cloud'],
    tun: { enable: true, stack: 'mixed' },
  },
};

function find(fields: PlannedField[], key: string): PlannedField {
  const found = fields.find((field) => field.key === key);
  if (!found) throw new Error(`no planned field named ${key}`);
  return found;
}

describe('control inference (FR-SCHEMA-01, FR-SCHEMA-02, FR-SCHEMA-06)', () => {
  it('derives a control for every supported shape without UI metadata', () => {
    expect(inferControl({ type: 'string', enum: ['a', 'b'] })).toBe('select');
    expect(inferControl({ type: 'boolean' })).toBe('switch');
    expect(inferControl({ type: 'integer' })).toBe('integer');
    expect(inferControl({ type: 'integer' }, 'mixed-port')).toBe('port');
    expect(inferControl({ type: 'integer', format: 'port' })).toBe('port');
    expect(inferControl({ type: 'number' })).toBe('number');
    expect(inferControl({ type: 'string' })).toBe('text');
    expect(inferControl({ type: 'string', maxLength: 4096 })).toBe('textarea');
    expect(inferControl({ type: 'array', items: { type: 'string' } })).toBe('tags');
    expect(inferControl({ type: 'array', items: { type: 'string', enum: ['x'] } })).toBe(
      'multi-select',
    );
    expect(inferControl({ type: 'array', items: { type: 'object' } })).toBe('list');
    expect(inferControl({ type: 'object', additionalProperties: { type: 'string' } })).toBe(
      'key-value',
    );
    expect(inferControl({ type: 'object', properties: { a: { type: 'string' } } })).toBe('object');
    expect(inferControl({})).toBe('unknown');
  });

  it('masks credential-shaped keys even with no UI metadata (NFR-SEC-02)', () => {
    for (const key of ['password', 'secret', 'uuid', 'private-key', 'auth-str']) {
      expect(inferControl({ type: 'string' }, key)).toBe('secret');
    }
    expect(inferControl({ type: 'string' }, 'server')).toBe('text');
  });
});

describe('discriminated union control inference (FR-SCHEMA-02)', () => {
  const SHARED_DEFS: Record<string, JsonSchema> = {
    shared: { type: 'object', properties: { label: { type: 'string' } } },
    kindA: {
      allOf: [
        { $ref: '#/$defs/shared' },
        {
          type: 'object',
          properties: { kind: { const: 'a' }, x: { type: 'string' } },
          required: ['kind', 'x'],
        },
      ],
    },
    kindB: {
      allOf: [
        { $ref: '#/$defs/shared' },
        { type: 'object', properties: { kind: { const: 'b' }, y: { type: 'integer' } } },
      ],
    },
  };
  const ROOT: JsonSchema = {
    type: 'object',
    properties: { transport: { oneOf: [{ $ref: '#/$defs/kindA' }, { $ref: '#/$defs/kindB' }] } },
    $defs: SHARED_DEFS,
  };

  it('infers variant for a oneOf union whose branches share a $defs/allOf const discriminator', () => {
    const transportSchema = ROOT.properties?.transport;
    expect(transportSchema).toBeDefined();
    expect(inferControl(transportSchema as JsonSchema, 'transport', ROOT)).toBe('variant');
  });

  it('accepts a single-value enum as a discriminator, not just const', () => {
    const schema: JsonSchema = {
      oneOf: [
        {
          type: 'object',
          properties: { kind: { type: 'string', enum: ['p'] }, p: { type: 'string' } },
        },
        {
          type: 'object',
          properties: { kind: { type: 'string', enum: ['q'] }, q: { type: 'string' } },
        },
      ],
    };
    expect(inferControl(schema)).toBe('variant');
  });

  it('also recognizes anyOf unions, not just oneOf', () => {
    const schema: JsonSchema = {
      anyOf: [
        { type: 'object', properties: { kind: { const: 'a' } } },
        { type: 'object', properties: { kind: { const: 'b' } } },
      ],
    };
    expect(inferControl(schema)).toBe('variant');
  });

  it('falls back to unknown, never guessing, when branches share no const/enum property', () => {
    const schema: JsonSchema = {
      oneOf: [
        { type: 'object', properties: { x: { type: 'string' } } },
        { type: 'object', properties: { y: { type: 'string' } } },
      ],
    };
    expect(inferControl(schema)).toBe('unknown');
  });

  it('does not recurse forever on a self-referential allOf cycle (malicious schema safety)', () => {
    const root: JsonSchema = {
      $defs: {
        cyclic: {
          allOf: [
            { $ref: '#/$defs/cyclic' },
            { type: 'object', properties: { kind: { const: 'a' } } },
          ],
        },
        other: { type: 'object', properties: { kind: { const: 'b' } } },
      },
    };
    const schema: JsonSchema = { oneOf: [{ $ref: '#/$defs/cyclic' }, { $ref: '#/$defs/other' }] };
    expect(() => inferControl(schema, 'x', root)).not.toThrow();
  });
});

describe('form plan (FR-SCHEMA-01 … 05)', () => {
  it('plans every declared property with values from the document', () => {
    const plan = buildFormPlan(sampleModule, DOCUMENT, { mode: 'advanced' });

    expect(find(plan.fields, 'mode')).toMatchObject({
      control: 'select',
      value: 'rule',
      required: true,
      present: true,
      path: ['sample', 'mode'],
      enumValues: ['rule', 'global', 'direct'],
    });
    expect(find(plan.fields, 'mixed-port').control).toBe('port');
    expect(find(plan.fields, 'hosts').control).toBe('key-value');
    expect(find(plan.fields, 'skip-domain').control).toBe('tags');
    expect(find(plan.fields, 'secret').sensitive).toBe(true);
  });

  it('falls back to the schema default for an absent field', () => {
    const plan = buildFormPlan(sampleModule, { sample: { mode: 'global' } }, { mode: 'advanced' });
    const logLevel = find(plan.fields, 'log-level');
    expect(logLevel.present).toBe(false);
    expect(logLevel.value).toBe('info');
  });

  it('resolves $ref and plans nested object children', () => {
    const plan = buildFormPlan(sampleModule, DOCUMENT, { mode: 'advanced' });
    const tun = find(plan.fields, 'tun');
    expect(tun.control).toBe('object');
    expect(tun.children?.map((child) => child.key).sort()).toEqual([
      'auto-route',
      'enable',
      'stack',
    ]);
    expect(find(tun.children ?? [], 'stack')).toMatchObject({
      path: ['sample', 'tun', 'stack'],
      value: 'mixed',
    });
  });

  it('applies visibleWhen and requiredWhen against sibling values (FR-SCHEMA-03)', () => {
    const off = buildFormPlan(sampleModule, DOCUMENT, { mode: 'advanced' });
    expect(find(off.fields, 'bind-address')).toMatchObject({ visible: false, required: false });

    const on = buildFormPlan(
      sampleModule,
      { sample: { ...DOCUMENT.sample, 'allow-lan': true } },
      { mode: 'advanced' },
    );
    expect(find(on.fields, 'bind-address')).toMatchObject({ visible: true, required: true });
  });

  it('hides advanced fields in basic mode without dropping them (PRD §7.4)', () => {
    const basic = buildFormPlan(sampleModule, DOCUMENT, { mode: 'basic' });
    const tun = find(basic.fields, 'tun');
    expect(tun.visible).toBe(false);
    // Still planned, still carrying its value: switching modes must not reset it.
    expect(tun.value).toEqual({ enable: true, stack: 'mixed' });

    expect(
      find(buildFormPlan(sampleModule, DOCUMENT, { mode: 'advanced' }).fields, 'tun').visible,
    ).toBe(true);
  });

  it('hides platform-restricted fields on other platforms', () => {
    const onIos = buildFormPlan(sampleModule, DOCUMENT, { mode: 'advanced', platform: 'ios' });
    const tun = find(onIos.fields, 'tun');
    expect(find(tun.children ?? [], 'stack').visible).toBe(false);

    const onAndroid = buildFormPlan(sampleModule, DOCUMENT, {
      mode: 'advanced',
      platform: 'android',
    });
    const tunAndroid = find(onAndroid.fields, 'tun');
    expect(find(tunAndroid.children ?? [], 'stack').visible).toBe(true);
  });

  it('orders fields by UI order then by key', () => {
    const plan = buildFormPlan(sampleModule, DOCUMENT, { mode: 'advanced' });
    const inbound = plan.groups.find((group) => group.id === 'inbound');
    expect(inbound?.fields.map((field) => field.key)).toEqual([
      'allow-lan',
      'mixed-port',
      'bind-address',
      'tun',
    ]);
  });

  it('groups fields and drops empty groups', () => {
    const plan = buildFormPlan(sampleModule, DOCUMENT, { mode: 'advanced' });
    expect(plan.groups.map((group) => group.id)).toEqual(['general', 'inbound', 'controller']);
  });
});

describe('unknown fields (FR-YAML-02, FR-VAL-05)', () => {
  it('surfaces a value no schema property describes instead of ignoring it', () => {
    const plan = buildFormPlan(
      sampleModule,
      { sample: { mode: 'rule', 'brand-new-mihomo-flag': 42 } },
      { mode: 'advanced' },
    );

    expect(plan.unknownFields.map((field) => field.key)).toEqual(['brand-new-mihomo-flag']);
    const unknown = plan.unknownFields[0] as PlannedField;
    expect(unknown).toMatchObject({
      control: 'unknown',
      value: 42,
      visible: true,
      group: 'unknown',
      path: ['sample', 'brand-new-mihomo-flag'],
    });
    // It sorts last and lives in its own group.
    expect(plan.groups.at(-1)?.id).toBe('unknown');
  });

  it('masks an unknown field whose name looks like a credential', () => {
    const plan = buildFormPlan(
      sampleModule,
      { sample: { mode: 'rule', password: 'x' } },
      { mode: 'advanced' },
    );
    expect(plan.unknownFields[0]?.sensitive).toBe(true);
  });
});

describe('schema-only extension (FR-SCHEMA-06)', () => {
  it('renders a brand-new field with no UI entry and no page code change', () => {
    // Simulates a Schema Bundle update that only adds `properties`.
    const updated: SchemaModule = {
      ...sampleModule,
      schema: {
        ...sampleModule.schema,
        properties: {
          ...sampleModule.schema.properties,
          'unified-delay': { type: 'boolean', default: false, title: 'Unified delay' },
          'find-process-mode': {
            type: 'string',
            enum: ['always', 'strict', 'off'],
            default: 'strict',
          },
        },
      },
    };

    const plan = buildFormPlan(updated, DOCUMENT, { mode: 'advanced' });

    expect(find(plan.fields, 'unified-delay')).toMatchObject({
      control: 'switch',
      value: false,
      visible: true,
      unknown: false,
      group: 'general',
    });
    expect(find(plan.fields, 'find-process-mode')).toMatchObject({
      control: 'select',
      enumValues: ['always', 'strict', 'off'],
    });
  });
});

describe('discriminated union planning (FR-SCHEMA-02, E4)', () => {
  // Deliberately Mihomo-unrelated names: `proxies` working is meant to be one
  // instance of this general mechanism, not a special case the planner knows
  // about (FR-SCHEMA-06 applied to unions).
  const variantModule: SchemaModule = {
    manifest: { id: 'variant-sample', root: ['sample'], version: '1.0.0' },
    schema: {
      type: 'object',
      properties: {
        transport: { oneOf: [{ $ref: '#/$defs/kindA' }, { $ref: '#/$defs/kindB' }] },
      },
      $defs: {
        shared: { type: 'object', properties: { label: { type: 'string' } } },
        kindA: {
          allOf: [
            { $ref: '#/$defs/shared' },
            {
              type: 'object',
              properties: { kind: { const: 'a' }, x: { type: 'string' } },
              required: ['kind', 'x'],
            },
          ],
        },
        kindB: {
          allOf: [
            { $ref: '#/$defs/shared' },
            { type: 'object', properties: { kind: { const: 'b' }, y: { type: 'integer' } } },
          ],
        },
      },
    },
    ui: {
      fields: {
        // Only branch "a" gets a label, so the fallback-to-raw-value case
        // (rendered by form-renderer in #1) has something to fall back from.
        transport: { variantLabels: { a: 'variant.kindA' } },
      },
    },
  };

  it("plans the matched branch's properties as children without adding a path segment", () => {
    const doc = {
      sample: { transport: { kind: 'a', label: 'shared-a', x: 'hello', extra: 'unlisted' } },
    };
    const plan = buildFormPlan(variantModule, doc, { mode: 'advanced' });
    const transport = find(plan.fields, 'transport');

    expect(transport.control).toBe('variant');
    expect(transport.variant).toMatchObject({
      discriminatorKey: 'kind',
      selected: 'a',
      matched: true,
    });
    expect(transport.variant?.options).toEqual([
      { value: 'a', label: 'variant.kindA' },
      { value: 'b' },
    ]);
    expect(find(transport.children ?? [], 'x')).toMatchObject({
      path: ['sample', 'transport', 'x'],
      value: 'hello',
    });
    // The discriminator is represented by `variant`, not duplicated as a child row.
    expect(transport.children?.some((child) => child.key === 'kind')).toBe(false);
  });

  it("replans a different branch's properties when the discriminator value changes", () => {
    const doc = { sample: { transport: { kind: 'b', label: 'shared-b', y: 42 } } };
    const plan = buildFormPlan(variantModule, doc, { mode: 'advanced' });
    const transport = find(plan.fields, 'transport');

    expect(transport.variant).toMatchObject({ selected: 'b', matched: true });
    expect(transport.children?.map((child) => child.key).sort()).toEqual(['label', 'y']);
    expect(find(transport.children ?? [], 'y').control).toBe('integer');
  });

  it('keeps a property the matched branch does not declare as an unknown child instead of dropping it (E4)', () => {
    const doc = {
      sample: { transport: { kind: 'a', label: 'shared-a', x: 'hello', extra: 'unlisted' } },
    };
    const plan = buildFormPlan(variantModule, doc, { mode: 'advanced' });
    const transport = find(plan.fields, 'transport');

    expect(find(transport.children ?? [], 'extra')).toMatchObject({
      unknown: true,
      value: 'unlisted',
      path: ['sample', 'transport', 'extra'],
    });
    expect(plan.unknownFields.some((field) => field.key === 'extra')).toBe(true);
  });

  it('does not plan children when the value matches no branch, but keeps the raw value intact', () => {
    const doc = { sample: { transport: { kind: 'c', mystery: true } } };
    const plan = buildFormPlan(variantModule, doc, { mode: 'advanced' });
    const transport = find(plan.fields, 'transport');

    expect(transport.variant).toMatchObject({ selected: 'c', matched: false });
    expect(transport.children).toBeUndefined();
    expect(transport.value).toEqual({ kind: 'c', mystery: true });
  });

  it('prefers the first common candidate key in declaration order when several qualify', () => {
    const module: SchemaModule = {
      manifest: { id: 'two-candidates', root: ['sample'], version: '1.0.0' },
      schema: {
        type: 'object',
        properties: {
          transport: {
            oneOf: [
              { type: 'object', properties: { kind: { const: 'a' }, type: { const: 'x' } } },
              { type: 'object', properties: { kind: { const: 'b' }, type: { const: 'y' } } },
            ],
          },
        },
      },
      ui: {},
    };
    const plan = buildFormPlan(module, { sample: { transport: { kind: 'a', type: 'x' } } });
    expect(find(plan.fields, 'transport').variant?.discriminatorKey).toBe('kind');
  });

  it('marks the unknown-control fallback reason instead of silently guessing, and keeps the value', () => {
    const badModule: SchemaModule = {
      manifest: { id: 'bad-union', root: ['sample'], version: '1.0.0' },
      schema: {
        type: 'object',
        properties: {
          mystery: {
            oneOf: [
              { type: 'object', properties: { x: { type: 'string' } } },
              { type: 'object', properties: { y: { type: 'string' } } },
            ],
          },
        },
      },
      ui: {},
    };
    const plan = buildFormPlan(
      badModule,
      { sample: { mystery: { x: 'hi' } } },
      { mode: 'advanced' },
    );
    const mystery = find(plan.fields, 'mystery');

    expect(mystery.control).toBe('unknown');
    expect(mystery.unknownReason).toBe('variant-no-discriminator');
    expect(mystery.value).toEqual({ x: 'hi' });
  });
});

// Two modules sharing a document root (`general`/`inbound`'s real shape,
// v0.3.0 #8/#14) — each declares one property of a shared, flat root object.
const ALPHA_MODULE: SchemaModule = {
  manifest: { id: 'alpha', root: [], version: '1.0.0' },
  schema: { type: 'object', properties: { foo: { type: 'string' } } },
  ui: {},
};
const BETA_MODULE: SchemaModule = {
  manifest: { id: 'beta', root: [], version: '1.0.0' },
  schema: { type: 'object', properties: { bar: { type: 'string' } } },
  ui: {},
};
const SHARED_ROOT_DOCUMENT = { foo: 'x', bar: 'y' };

describe('additionalKnownPaths / computeKnownPaths (FR-VAL-05, v0.3.0 #14)', () => {
  it('without additionalKnownPaths, a module flags a sibling module’s own field as unknown', () => {
    const plan = buildFormPlan(ALPHA_MODULE, SHARED_ROOT_DOCUMENT, { mode: 'advanced' });
    expect(plan.unknownFields.map((field) => field.key)).toEqual(['bar']);
  });

  it('computeKnownPaths unions every given module’s own declared paths', () => {
    const known = computeKnownPaths([ALPHA_MODULE, BETA_MODULE], SHARED_ROOT_DOCUMENT, {
      mode: 'advanced',
    });
    expect(known.has(JSON.stringify(['foo']))).toBe(true);
    expect(known.has(JSON.stringify(['bar']))).toBe(true);
  });

  it('passing computeKnownPaths back in suppresses the sibling’s field from unknownFields, in both directions', () => {
    const known = computeKnownPaths([ALPHA_MODULE, BETA_MODULE], SHARED_ROOT_DOCUMENT, {
      mode: 'advanced',
    });

    const alphaPlan = buildFormPlan(ALPHA_MODULE, SHARED_ROOT_DOCUMENT, {
      mode: 'advanced',
      additionalKnownPaths: known,
    });
    expect(alphaPlan.unknownFields).toEqual([]);
    expect(find(alphaPlan.fields, 'foo').unknown).toBe(false);

    const betaPlan = buildFormPlan(BETA_MODULE, SHARED_ROOT_DOCUMENT, {
      mode: 'advanced',
      additionalKnownPaths: known,
    });
    expect(betaPlan.unknownFields).toEqual([]);
  });

  it('a genuinely unrecognised field is still flagged unknown even with additionalKnownPaths passed', () => {
    const known = computeKnownPaths([ALPHA_MODULE, BETA_MODULE], SHARED_ROOT_DOCUMENT, {
      mode: 'advanced',
    });
    const plan = buildFormPlan(
      ALPHA_MODULE,
      { ...SHARED_ROOT_DOCUMENT, mystery: 1 },
      { mode: 'advanced', additionalKnownPaths: known },
    );
    expect(plan.unknownFields.map((field) => field.key)).toEqual(['mystery']);
  });
});

// A discriminated-union-of-array-elements module (`proxies`'/`proxy-providers`'
// real shape, v0.3.0 #9-#11): the schema's own root is `oneOf`, no `type`/
// `properties`, and `manifest.root` addresses an array in the document.
const ARRAY_ENTRY_MODULE: SchemaModule = {
  manifest: { id: 'items', root: ['items'], version: '1.0.0' },
  schema: {
    $defs: {
      shared: { type: 'object', properties: { label: { type: 'string' } } },
      a: {
        allOf: [
          { $ref: '#/$defs/shared' },
          { type: 'object', properties: { kind: { const: 'a' }, onlyA: { type: 'integer' } } },
        ],
      },
      b: {
        allOf: [
          { $ref: '#/$defs/shared' },
          { type: 'object', properties: { kind: { const: 'b' }, onlyB: { type: 'integer' } } },
        ],
      },
    },
    oneOf: [{ $ref: '#/$defs/a' }, { $ref: '#/$defs/b' }],
  },
  ui: {},
};

describe('isArrayEntryModule (v0.3.0 #14)', () => {
  it('is true for a module whose root schema is oneOf with no type/properties', () => {
    expect(isArrayEntryModule(ARRAY_ENTRY_MODULE)).toBe(true);
  });

  it('is false for an ordinary object-rooted module, including one with its own oneOf field', () => {
    expect(isArrayEntryModule(sampleModule)).toBe(false);
    expect(isArrayEntryModule(ALPHA_MODULE)).toBe(false);
  });
});

describe('buildArrayFormPlan (FR-SCHEMA-01, v0.3.0 #14)', () => {
  const DOC = {
    items: [
      { kind: 'a', label: 'first', onlyA: 1 },
      { kind: 'b', label: 'second', onlyB: 2 },
    ],
  };

  it('plans one field per array element, addressed by its real absolute path', () => {
    const fields = buildArrayFormPlan(ARRAY_ENTRY_MODULE, DOC, { mode: 'advanced' });
    expect(fields).toHaveLength(2);
    expect(fields[0]?.path).toEqual(['items', 0]);
    expect(fields[1]?.path).toEqual(['items', 1]);
  });

  it('each element is a discriminated variant with the matched branch’s own fields as children, correctly addressed', () => {
    const fields = buildArrayFormPlan(ARRAY_ENTRY_MODULE, DOC, { mode: 'advanced' });
    const first = fields[0]!;
    expect(first.control).toBe('variant');
    expect(first.variant).toMatchObject({ discriminatorKey: 'kind', selected: 'a', matched: true });
    expect(first.variant?.discriminatorPath).toEqual(['items', 0, 'kind']);
    const onlyA = first.children?.find((child) => child.key === 'onlyA');
    expect(onlyA).toMatchObject({ path: ['items', 0, 'onlyA'], value: 1 });
    const label = first.children?.find((child) => child.key === 'label');
    expect(label).toMatchObject({ path: ['items', 0, 'label'], value: 'first' });

    const second = fields[1]!;
    expect(second.variant).toMatchObject({
      discriminatorKey: 'kind',
      selected: 'b',
      matched: true,
    });
    const onlyB = second.children?.find((child) => child.key === 'onlyB');
    expect(onlyB).toMatchObject({ path: ['items', 1, 'onlyB'], value: 2 });
  });

  it('never deletes an element that does not match any branch — kept, unmatched, its raw value intact', () => {
    const fields = buildArrayFormPlan(
      ARRAY_ENTRY_MODULE,
      { items: [{ kind: 'unrecognised-protocol', label: 'x' }] },
      { mode: 'advanced' },
    );
    expect(fields).toHaveLength(1);
    expect(fields[0]).toMatchObject({
      path: ['items', 0],
      control: 'variant',
      variant: { matched: false, selected: 'unrecognised-protocol' },
    });
  });

  it('returns an empty array when the module’s root is absent or neither a list nor a map, without throwing', () => {
    expect(buildArrayFormPlan(ARRAY_ENTRY_MODULE, {}, { mode: 'advanced' })).toEqual([]);
    expect(
      buildArrayFormPlan(ARRAY_ENTRY_MODULE, { items: 'not-a-collection' }, { mode: 'advanced' }),
    ).toEqual([]);
  });

  // `proxy-providers`' real upstream shape (v0.3.0 #17, confirmed against the
  // vendored comprehensive sample): a YAML *map* keyed by provider name, not
  // a list. `isArrayEntryModule` cannot tell the two apart from the schema
  // alone (both are a bare `oneOf`), so `buildArrayFormPlan` must plan a map
  // just as well as a list — regression for the real bug this exposed: #14's
  // own fixtures only ever used a list, so a map-shaped module silently
  // planned to `[]` (`Array.isArray` false) instead of failing loudly.
  it('plans one field per entry of a map-shaped collection too, addressed by its real string key', () => {
    const fields = buildArrayFormPlan(
      ARRAY_ENTRY_MODULE,
      { items: { 'provider-a': { kind: 'a', label: 'first', onlyA: 1 } } },
      { mode: 'advanced' },
    );
    expect(fields).toHaveLength(1);
    expect(fields[0]?.path).toEqual(['items', 'provider-a']);
    expect(fields[0]?.variant?.discriminatorPath).toEqual(['items', 'provider-a', 'kind']);
    const onlyA = fields[0]?.children?.find((child) => child.key === 'onlyA');
    expect(onlyA).toMatchObject({ path: ['items', 'provider-a', 'onlyA'], value: 1 });
  });
});

describe('collectUnknownFields (FR-VAL-05 UI side, v0.3.0 #16)', () => {
  it('collects an unknown field from an ordinary object module', () => {
    const unknown = collectUnknownFields(
      [sampleModule],
      { sample: { mode: 'rule', 'brand-new-flag': 42 } },
      { mode: 'advanced' },
    );
    expect(unknown.map((field) => field.path)).toEqual([['sample', 'brand-new-flag']]);
  });

  it('collects an unknown field nested inside an array-entry module’s own element', () => {
    const unknown = collectUnknownFields(
      [ARRAY_ENTRY_MODULE],
      { items: [{ kind: 'a', label: 'x', onlyA: 1, 'mystery-field': true }] },
      { mode: 'advanced' },
    );
    expect(unknown.map((field) => field.path)).toEqual([['items', 0, 'mystery-field']]);
  });

  it('combines unknown fields across several modules into one list, in module order', () => {
    const unknown = collectUnknownFields(
      [ALPHA_MODULE, ARRAY_ENTRY_MODULE],
      { foo: 'x', extra: 1, items: [{ kind: 'b', label: 'y', onlyB: 2, weird: true }] },
      { mode: 'advanced' },
    );
    expect(unknown.map((field) => field.path)).toEqual([['extra'], ['items', 0, 'weird']]);
  });

  it('returns an empty array when nothing is unknown anywhere', () => {
    const unknown = collectUnknownFields(
      [sampleModule, ARRAY_ENTRY_MODULE],
      { sample: { mode: 'rule' }, items: [{ kind: 'a', label: 'x', onlyA: 1 }] },
      { mode: 'advanced' },
    );
    expect(unknown).toEqual([]);
  });

  // Regression for a real bug (v0.3.0 #17, caught live in a browser — React
  // warned about two list items sharing the same key): `additionalKnownPaths`
  // only suppresses a leaf *some* module declares as its own. A leaf *no*
  // module recognises isn't in that set either, so both ALPHA_MODULE and
  // BETA_MODULE (sharing `root: []`, general/inbound's real shape) used to
  // each independently report the exact same path as their own unknown
  // field — one leaf, two identical entries.
  it('reports a leaf no module recognises exactly once, even when several modules share its document root', () => {
    const unknown = collectUnknownFields(
      [ALPHA_MODULE, BETA_MODULE],
      { ...SHARED_ROOT_DOCUMENT, mystery: 1 },
      { mode: 'advanced' },
    );
    expect(unknown.map((field) => field.path)).toEqual([['mystery']]);
  });
});
