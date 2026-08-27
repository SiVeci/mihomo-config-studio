import { describe, expect, it } from 'vitest';

import { validateModuleShape } from './module.js';
import { sampleModule } from './testing/sample-module.js';
import type {
  MigrationSpec,
  ModuleExample,
  ModuleI18n,
  RuleTypeSpec,
  SchemaModule,
  ValidationRule,
} from './types.js';

describe('backward compatibility (v0.3.0 #2)', () => {
  it('validates a module with none of the three new optional fields as shape-clean', () => {
    // sampleModule predates rules/examples/i18n entirely — the point is that
    // this compiles (SchemaModule's new fields are optional) and reports no
    // issues, so #6 onward is not forced to touch every existing module.
    expect(validateModuleShape(sampleModule)).toEqual([]);
  });

  it('validates a module carrying well-formed rules/examples/i18n as shape-clean', () => {
    const module: SchemaModule = {
      ...sampleModule,
      rules: [
        {
          id: 'mutex-a-b',
          severity: 'error',
          when: { op: 'exists', path: 'a' },
          messageKey: 'rule.mutexAB',
        },
      ],
      examples: [
        { name: 'basic', kind: 'valid', path: 'examples/valid.yaml' },
        { name: 'broken', kind: 'invalid', path: 'examples/invalid.yaml' },
        { name: 'boundary', kind: 'edge', path: 'examples/edge.yaml' },
        { name: 'extra-field', kind: 'unknown-fields', path: 'examples/unknown.yaml' },
      ],
      i18n: {
        'zh-CN': { 'field.mode': '模式' },
        en: { 'field.mode': 'Mode' },
      },
    };
    expect(validateModuleShape(module)).toEqual([]);
  });
});

describe('validation.rules shape', () => {
  const baseRule: ValidationRule = {
    id: 'r1',
    severity: 'warning',
    when: { op: 'exists', path: 'x' },
    messageKey: 'rule.x',
  };

  it('flags an empty rule id', () => {
    const module: SchemaModule = { ...sampleModule, rules: [{ ...baseRule, id: '' }] };
    const issues = validateModuleShape(module);
    expect(issues).toEqual([
      expect.objectContaining({ code: 'module.rule.emptyId', location: 'rules[0].id' }),
    ]);
  });

  it('flags a duplicate rule id but not the first occurrence', () => {
    const module: SchemaModule = {
      ...sampleModule,
      rules: [baseRule, { ...baseRule, messageKey: 'rule.x2' }],
    };
    const issues = validateModuleShape(module);
    expect(issues).toEqual([
      expect.objectContaining({
        code: 'module.rule.duplicateId',
        location: 'rules[1].id',
        messageParams: { id: 'r1' },
      }),
    ]);
  });

  it('flags an empty message key', () => {
    const module: SchemaModule = { ...sampleModule, rules: [{ ...baseRule, messageKey: '' }] };
    const issues = validateModuleShape(module);
    expect(issues).toEqual([
      expect.objectContaining({
        code: 'module.rule.emptyMessageKey',
        location: 'rules[0].messageKey',
      }),
    ]);
  });
});

describe('examples shape', () => {
  const baseExample: ModuleExample = { name: 'e1', kind: 'valid', path: 'examples/e1.yaml' };

  it('flags an empty name', () => {
    const module: SchemaModule = { ...sampleModule, examples: [{ ...baseExample, name: '' }] };
    expect(validateModuleShape(module)).toEqual([
      expect.objectContaining({ code: 'module.example.emptyName', location: 'examples[0].name' }),
    ]);
  });

  it('flags an unrecognised kind (bundle bypassing the type system)', () => {
    const bad = { ...baseExample, kind: 'bogus' } as unknown as ModuleExample;
    const module: SchemaModule = { ...sampleModule, examples: [bad] };
    expect(validateModuleShape(module)).toEqual([
      expect.objectContaining({ code: 'module.example.invalidKind', location: 'examples[0].kind' }),
    ]);
  });

  it('flags an empty path', () => {
    const module: SchemaModule = { ...sampleModule, examples: [{ ...baseExample, path: '' }] };
    expect(validateModuleShape(module)).toEqual([
      expect.objectContaining({ code: 'module.example.emptyPath', location: 'examples[0].path' }),
    ]);
  });

  it('accepts each of the four sample kinds', () => {
    const kinds: ModuleExample['kind'][] = ['valid', 'invalid', 'edge', 'unknown-fields'];
    for (const kind of kinds) {
      const module: SchemaModule = {
        ...sampleModule,
        examples: [{ ...baseExample, kind }],
      };
      expect(validateModuleShape(module)).toEqual([]);
    }
  });
});

describe('ruleTypes shape (ADR-021, v0.4.0 #3)', () => {
  const baseType: RuleTypeSpec = {
    type: 'DOMAIN-SUFFIX',
    payloadKind: 'domain-suffix',
    needsPayload: true,
    params: [],
  };

  it('accepts a well-formed catalog', () => {
    const module: SchemaModule = { ...sampleModule, ruleTypes: [baseType] };
    expect(validateModuleShape(module)).toEqual([]);
  });

  it('flags an empty type', () => {
    const module: SchemaModule = { ...sampleModule, ruleTypes: [{ ...baseType, type: '' }] };
    expect(validateModuleShape(module)).toEqual([
      expect.objectContaining({ code: 'module.ruleType.emptyType', location: 'ruleTypes[0].type' }),
    ]);
  });

  it('flags a duplicate type but not the first occurrence', () => {
    const module: SchemaModule = {
      ...sampleModule,
      ruleTypes: [baseType, { ...baseType, payloadKind: 'domain' }],
    };
    expect(validateModuleShape(module)).toEqual([
      expect.objectContaining({
        code: 'module.ruleType.duplicateType',
        location: 'ruleTypes[1].type',
        messageParams: { type: 'DOMAIN-SUFFIX' },
      }),
    ]);
  });

  it('flags a payloadKind outside the closed set (a bundle bypassing the type system)', () => {
    const bad = { ...baseType, payloadKind: 'regex' } as unknown as RuleTypeSpec;
    const module: SchemaModule = { ...sampleModule, ruleTypes: [bad] };
    expect(validateModuleShape(module)).toEqual([
      expect.objectContaining({
        code: 'module.ruleType.invalidPayloadKind',
        location: 'ruleTypes[0].payloadKind',
      }),
    ]);
  });

  it('accepts every closed payloadKind value', () => {
    const kinds: RuleTypeSpec['payloadKind'][] = [
      'domain',
      'domain-suffix',
      'ipcidr',
      'port',
      'process',
      'geo',
      'rule-set',
      'sub-rule',
      'none',
    ];
    for (const payloadKind of kinds) {
      const module: SchemaModule = {
        ...sampleModule,
        ruleTypes: [{ ...baseType, type: `TYPE-${payloadKind}`, payloadKind }],
      };
      expect(validateModuleShape(module)).toEqual([]);
    }
  });
});

describe('migrations shape (ADR-025, v0.5.0 #6)', () => {
  const baseSpec: MigrationSpec = {
    from: '1.0.0',
    to: '1.1.0',
    operations: [{ op: 'rename-field', path: 'a', to: 'b' }],
  };

  it('accepts a well-formed migration spec', () => {
    const module: SchemaModule = { ...sampleModule, migrations: [baseSpec] };
    expect(validateModuleShape(module)).toEqual([]);
  });

  it('flags an empty from', () => {
    const module: SchemaModule = { ...sampleModule, migrations: [{ ...baseSpec, from: '' }] };
    expect(validateModuleShape(module)).toEqual([
      expect.objectContaining({
        code: 'module.migration.emptyFrom',
        location: 'migrations[0].from',
      }),
    ]);
  });

  it('flags an empty to', () => {
    const module: SchemaModule = { ...sampleModule, migrations: [{ ...baseSpec, to: '' }] };
    expect(validateModuleShape(module)).toEqual([
      expect.objectContaining({ code: 'module.migration.emptyTo', location: 'migrations[0].to' }),
    ]);
  });

  it('flags an operation whose op is outside the seven closed opcodes (a bundle bypassing the type system)', () => {
    const module: SchemaModule = {
      ...sampleModule,
      migrations: [{ ...baseSpec, operations: [{ op: 'run-script', path: 'a' }] }],
    };
    expect(validateModuleShape(module)).toEqual([
      expect.objectContaining({
        code: 'module.migration.unknownOp',
        location: 'migrations[0].operations[0].op',
        messageParams: { op: 'run-script' },
      }),
    ]);
  });

  it('accepts every one of the seven closed opcodes', () => {
    const opcodes = [
      'rename-field',
      'move-field',
      'set-default',
      'deprecate-field',
      'remove-field',
      'narrow-enum',
      'quarantine-field',
    ];
    for (const op of opcodes) {
      const module: SchemaModule = {
        ...sampleModule,
        migrations: [{ ...baseSpec, operations: [{ op, path: 'a' }] }],
      };
      expect(validateModuleShape(module)).toEqual([]);
    }
  });

  it('flags an empty operation path', () => {
    const module: SchemaModule = {
      ...sampleModule,
      migrations: [{ ...baseSpec, operations: [{ op: 'remove-field', path: '' }] }],
    };
    expect(validateModuleShape(module)).toEqual([
      expect.objectContaining({
        code: 'module.migration.emptyPath',
        location: 'migrations[0].operations[0].path',
      }),
    ]);
  });

  it('reports every violation at once across multiple specs and operations, not just the first', () => {
    const module: SchemaModule = {
      ...sampleModule,
      migrations: [
        { from: '', to: '1.1.0', operations: [{ op: 'bogus', path: 'a' }] },
        { from: '1.1.0', to: '1.2.0', operations: [{ op: 'remove-field', path: '' }] },
      ],
    };
    const issues = validateModuleShape(module);
    expect(issues.map((issue) => issue.code).sort()).toEqual(
      [
        'module.migration.emptyFrom',
        'module.migration.unknownOp',
        'module.migration.emptyPath',
      ].sort(),
    );
  });
});

describe('i18n shape (bidirectional key parity, same rule as apps/web/src/i18n/i18n.test.ts)', () => {
  it('flags a key missing from one locale but present in another', () => {
    const i18n: ModuleI18n = {
      'zh-CN': { a: '甲', b: '乙' },
      en: { a: 'A' },
    };
    const module: SchemaModule = { ...sampleModule, i18n };
    expect(validateModuleShape(module)).toEqual([
      expect.objectContaining({
        code: 'module.i18n.missingKey',
        location: 'i18n.en',
        messageParams: { locale: 'en', key: 'b' },
      }),
    ]);
  });

  it('flags an empty value without treating it as a missing key', () => {
    const i18n: ModuleI18n = {
      'zh-CN': { a: '' },
      en: { a: 'A' },
    };
    const module: SchemaModule = { ...sampleModule, i18n };
    expect(validateModuleShape(module)).toEqual([
      expect.objectContaining({
        code: 'module.i18n.emptyValue',
        location: 'i18n.zh-CN.a',
        messageParams: { locale: 'zh-CN', key: 'a' },
      }),
    ]);
  });

  it('never echoes an i18n value into the issue it reports (NFR-SEC-03)', () => {
    const secret = 'this-translated-string-must-never-appear-in-an-issue';
    const i18n: ModuleI18n = {
      'zh-CN': { a: secret },
      en: {}, // missing "a" — triggers a missingKey issue, not emptyValue
    };
    const module: SchemaModule = { ...sampleModule, i18n };
    const issues = validateModuleShape(module);

    expect(issues.length).toBeGreaterThan(0);
    expect(JSON.stringify(issues)).not.toContain(secret);
  });
});
