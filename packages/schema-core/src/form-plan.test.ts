import { describe, expect, it } from 'vitest';

import { buildFormPlan, inferControl, type PlannedField } from './form-plan.js';
import { sampleModule } from './testing/sample-module.js';
import type { SchemaModule } from './types.js';

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
