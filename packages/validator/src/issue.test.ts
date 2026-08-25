import type { JsonSchema, ValidationRule } from '@mcs/schema-core';
import { evaluateRules, validateValue } from '@mcs/schema-core';
import { MihomoYamlDocument } from '@mcs/yaml-engine';
import { describe, expect, it } from 'vitest';

import {
  fromRuleIssue,
  fromSchemaIssue,
  fromYamlIssue,
  KERNEL_MODULES,
  type RangeLocator,
} from './issue.js';
import type { IssueFix, ValidationIssue } from './issue.js';

describe('fromYamlIssue (FR-VAL-01)', () => {
  it('widens a hand-built YamlIssue, defaulting module to "yaml" and deriving blocking from severity', () => {
    const issue = fromYamlIssue({
      severity: 'error',
      code: 'yaml.limit.size',
      messageKey: 'yaml.limit.size',
      messageParams: { bytes: 10, maxBytes: 4 },
    });
    expect(issue).toEqual({
      severity: 'error',
      code: 'yaml.limit.size',
      module: 'yaml',
      messageKey: 'yaml.limit.size',
      messageParams: { bytes: 10, maxBytes: 4 },
      blocking: true,
    });
  });

  it('accepts an explicit kernel module and never fabricates a fix for a syntax problem', () => {
    const issue = fromYamlIssue(
      { severity: 'warning', code: 'yaml.syntax.X', messageKey: 'yaml.syntax.X' },
      'reference',
    );
    expect(issue.module).toBe('reference');
    expect(issue.fix).toBeUndefined();
    expect(issue.blocking).toBe(false);
  });

  it('carries a real parser range through unchanged', () => {
    const result = MihomoYamlDocument.parse('a: 1\n  b: 2\n');
    const yamlIssue = result.issues[0];
    expect(yamlIssue).toBeDefined();
    const issue = fromYamlIssue(yamlIssue!);
    expect(issue.range?.start.line).toBeGreaterThan(0);
  });

  it('omits path and range entirely rather than setting them to undefined', () => {
    const issue = fromYamlIssue({
      severity: 'error',
      code: 'yaml.parse.empty',
      messageKey: 'yaml.parse.empty',
    });
    expect(Object.hasOwn(issue, 'path')).toBe(false);
    expect(Object.hasOwn(issue, 'range')).toBe(false);
    expect(Object.hasOwn(issue, 'messageParams')).toBe(false);
  });

  it('carries a path through when the producer sets one', () => {
    const issue = fromYamlIssue({
      severity: 'info',
      code: 'yaml.syntax.test',
      messageKey: 'yaml.syntax.test',
      path: ['foo'],
    });
    expect(issue.path).toEqual(['foo']);
  });
});

describe('fromSchemaIssue (FR-VAL-01)', () => {
  const schema: JsonSchema = {
    type: 'object',
    properties: {
      mode: { type: 'string', enum: ['rule', 'direct'] },
      secret: { type: 'string', const: 'placeholder' },
    },
    additionalProperties: false,
  };

  it('attaches the caller-supplied module id and is always blocking (severity is always error)', () => {
    const [issue] = validateValue({ mode: 'nope' }, schema);
    const widened = fromSchemaIssue(issue!, { module: 'sample' });
    expect(widened.module).toBe('sample');
    expect(widened.blocking).toBe(true);
  });

  it('locates a range via the supplied locator', () => {
    const { document } = MihomoYamlDocument.parse('mode: nope\n');
    const [issue] = validateValue(document!.toJS(), schema);
    const widened = fromSchemaIssue(issue!, { module: 'sample', locator: document! });
    expect(widened.range).toEqual(document!.locate(['mode']));
    expect(widened.range?.start.line).toBe(1);
  });

  it('omits range rather than setting it to undefined when no locator is given', () => {
    const [issue] = validateValue({ mode: 'nope' }, schema);
    const widened = fromSchemaIssue(issue!, { module: 'sample' });
    expect(Object.hasOwn(widened, 'range')).toBe(false);
  });

  it('accepts any object shaped like MihomoYamlDocument as a locator', () => {
    const fakeLocator: RangeLocator = {
      locate: () => ({
        start: { offset: 0, line: 1, column: 1 },
        end: { offset: 4, line: 1, column: 5 },
      }),
    };
    const [issue] = validateValue({ mode: 'nope' }, schema);
    const widened = fromSchemaIssue(issue!, { module: 'sample', locator: fakeLocator });
    expect(widened.range?.start.line).toBe(1);
  });

  it('suggests the first allowed value as a fix for an enum violation', () => {
    const [issue] = validateValue({ mode: 'nope' }, schema);
    const widened = fromSchemaIssue(issue!, { module: 'sample' });
    expect(widened.fix).toEqual({ kind: 'set-scalar', path: ['mode'], value: 'rule' });
  });

  it('suggests the const value as a fix for a const violation', () => {
    const [issue] = validateValue({ secret: 'wrong', mode: 'rule' }, schema);
    const widened = fromSchemaIssue(issue!, { module: 'sample' });
    expect(widened.fix).toEqual({ kind: 'set-scalar', path: ['secret'], value: 'placeholder' });
  });

  it('suggests removal for an undeclared field, never a value', () => {
    const [issue] = validateValue({ mode: 'rule', ghost: 'x' }, schema);
    const widened = fromSchemaIssue(issue!, { module: 'sample' });
    expect(widened.fix).toEqual({ kind: 'remove', path: ['ghost'] });
  });

  it('leaves fix undefined when there is no safe suggestion', () => {
    const [issue] = validateValue({ mode: 1 }, schema);
    const widened = fromSchemaIssue(issue!, { module: 'sample' });
    expect(widened.fix).toBeUndefined();
  });

  it('suggests a numeric const value as a fix', () => {
    const numericSchema: JsonSchema = { type: 'integer', const: 42 };
    const [issue] = validateValue(7, numericSchema);
    const widened = fromSchemaIssue(issue!, { module: 'sample' });
    expect(widened.fix).toEqual({ kind: 'set-scalar', path: [], value: 42 });
  });

  it('suggests a boolean enum value as a fix', () => {
    const boolSchema: JsonSchema = { type: 'boolean', enum: [true] };
    const [issue] = validateValue(false, boolSchema);
    const widened = fromSchemaIssue(issue!, { module: 'sample' });
    expect(widened.fix).toEqual({ kind: 'set-scalar', path: [], value: true });
  });

  it('leaves fix undefined for a hand-built enum issue with no usable allowed list (defensive)', () => {
    const widened = fromSchemaIssue(
      {
        severity: 'error',
        code: 'schema.enum',
        keyword: 'enum',
        path: ['mode'],
        messageKey: 'schema.enum',
        messageParams: { allowed: [] },
      },
      { module: 'sample' },
    );
    expect(widened.fix).toBeUndefined();
  });

  it('leaves fix undefined for a hand-built const issue with a non-primitive expected value (defensive)', () => {
    const widened = fromSchemaIssue(
      {
        severity: 'error',
        code: 'schema.const',
        keyword: 'const',
        path: ['mode'],
        messageKey: 'schema.const',
        messageParams: { expected: [1, 2] },
      },
      { module: 'sample' },
    );
    expect(widened.fix).toBeUndefined();
  });

  it('leaves fix undefined for a hand-built enum issue with no allowed list at all (defensive)', () => {
    const widened = fromSchemaIssue(
      {
        severity: 'error',
        code: 'schema.enum',
        keyword: 'enum',
        path: ['mode'],
        messageKey: 'schema.enum',
        messageParams: {},
      },
      { module: 'sample' },
    );
    expect(widened.fix).toBeUndefined();
  });

  it('omits messageParams entirely for a code that carries none, such as anyOf', () => {
    const anyOf: JsonSchema = { anyOf: [{ type: 'string' }, { type: 'integer' }] };
    const [issue] = validateValue(true, anyOf);
    const widened = fromSchemaIssue(issue!, { module: 'sample' });
    expect(widened.code).toBe('schema.anyOf');
    expect(Object.hasOwn(widened, 'messageParams')).toBe(false);
    expect(widened.fix).toBeUndefined();
  });

  it('never echoes the value that failed validation anywhere in the widened issue (NFR-SEC-03)', () => {
    const secretValue = 'sk-live-s3cr3t-do-not-leak';
    const [issue] = validateValue({ secret: secretValue, mode: 'rule' }, schema);
    const widened = fromSchemaIssue(issue!, { module: 'sample' });
    expect(JSON.stringify(widened)).not.toContain(secretValue);
    // The fix, if any, may only offer back the schema's own constant.
    if (widened.fix?.kind === 'set-scalar') {
      expect(widened.fix.value).toBe('placeholder');
    }
  });
});

describe('fromRuleIssue (FR-VAL-01, v0.3.0 #12)', () => {
  // Mirrors dns's real fallback-filter-geoip-code-requires-geoip rule shape
  // (v0.3.0 #7) rather than inventing an unrelated synthetic one — proves
  // the adapter against the same rule DSL shipped modules actually use.
  const rules: ValidationRule[] = [
    {
      id: 'geoip-code-requires-geoip',
      severity: 'warning',
      when: {
        op: 'not',
        of: {
          op: 'and',
          of: [
            { op: 'exists', path: 'geoip-code' },
            { op: 'eq', path: 'geoip', value: false },
          ],
        },
      },
      messageKey: 'rule.geoipCodeRequiresGeoip',
      path: 'geoip-code',
    },
  ];

  it('attaches the caller-supplied module id and derives blocking from severity (warning is not blocking)', () => {
    const [issue] = evaluateRules(rules, { geoip: false, 'geoip-code': 'CN' });
    const widened = fromRuleIssue(issue!, { module: 'dns' });
    expect(widened.module).toBe('dns');
    expect(widened.code).toBe('rule.geoip-code-requires-geoip');
    expect(widened.blocking).toBe(false);
  });

  it('carries messageParams through when the rule declares them', () => {
    const rulesWithParams: ValidationRule[] = [{ ...rules[0]!, messageParams: { field: 'geoip' } }];
    const [issue] = evaluateRules(rulesWithParams, { geoip: false, 'geoip-code': 'CN' });
    const widened = fromRuleIssue(issue!, { module: 'dns' });
    expect(widened.messageParams).toEqual({ field: 'geoip' });
  });

  it('carries the fix value through alongside the defaulted path', () => {
    const rulesWithFixValue: ValidationRule[] = [
      { ...rules[0]!, fix: { kind: 'set-scalar', value: true } },
    ];
    const [issue] = evaluateRules(rulesWithFixValue, { geoip: false, 'geoip-code': 'CN' });
    const widened = fromRuleIssue(issue!, { module: 'dns' });
    expect(widened.fix).toEqual({ kind: 'set-scalar', path: ['geoip-code'], value: true });
  });

  it('locates a range via the supplied locator, at the basePath-prefixed document path', () => {
    const { document } = MihomoYamlDocument.parse('geoip: false\ngeoip-code: CN\n');
    const [issue] = evaluateRules(rules, document!.toJS(), {
      basePath: ['dns', 'fallback-filter'],
    });
    expect(issue!.path).toEqual(['dns', 'fallback-filter', 'geoip-code']);
    const widened = fromRuleIssue(issue!, { module: 'dns', locator: document! });
    // The rule's own path segment is "geoip-code", relative to fallback-filter;
    // the *document* only has a bare "geoip-code" at its root in this fixture,
    // so locate() on the full prefixed path correctly finds nothing.
    expect(Object.hasOwn(widened, 'range')).toBe(false);
  });

  it('omits range rather than setting it to undefined when no locator is given', () => {
    const [issue] = evaluateRules(rules, { geoip: false, 'geoip-code': 'CN' });
    const widened = fromRuleIssue(issue!, { module: 'dns' });
    expect(Object.hasOwn(widened, 'range')).toBe(false);
  });

  it("defaults the fix to the issue's own path when the rule's fix omits one", () => {
    const rulesWithFix: ValidationRule[] = [
      {
        ...rules[0]!,
        fix: { kind: 'remove' },
      },
    ];
    const [issue] = evaluateRules(rulesWithFix, { geoip: false, 'geoip-code': 'CN' });
    const widened = fromRuleIssue(issue!, { module: 'dns' });
    expect(widened.fix).toEqual({ kind: 'remove', path: ['geoip-code'] });
  });

  it("drops the fix entirely when the rule's fix names its own relative path, rather than resolve it against the wrong scope", () => {
    const rulesWithRelativeFix: ValidationRule[] = [
      {
        ...rules[0]!,
        fix: { kind: 'set-scalar', path: 'geoip', value: true },
      },
    ];
    const [issue] = evaluateRules(rulesWithRelativeFix, { geoip: false, 'geoip-code': 'CN' });
    const widened = fromRuleIssue(issue!, { module: 'dns' });
    expect(widened.fix).toBeUndefined();
  });

  it('never echoes the value that failed validation anywhere in the widened issue (NFR-SEC-03)', () => {
    const secretValue = 'sk-live-s3cr3t-do-not-leak';
    const [issue] = evaluateRules(rules, { geoip: false, 'geoip-code': secretValue });
    const widened = fromRuleIssue(issue!, { module: 'dns' });
    expect(JSON.stringify(widened)).not.toContain(secretValue);
  });
});

describe('KERNEL_MODULES', () => {
  it('freezes the known kernel-stage module ids', () => {
    expect(KERNEL_MODULES).toEqual(['yaml', 'schema', 'reference', 'security', 'rule-order']);
  });
});

describe('type-level restrictions (NFR-SEC-03)', () => {
  it('rejects an arbitrary object as a messageParams value at compile time', () => {
    const build = (): ValidationIssue => ({
      severity: 'error',
      code: 'x',
      module: 'yaml',
      messageKey: 'x',
      // @ts-expect-error messageParams values must be paths, field names or schema constants
      messageParams: { blob: { nested: 'not allowed' } },
      blocking: true,
    });
    expect(build().messageParams).toBeDefined();
  });

  it('rejects a non-primitive fix value at compile time', () => {
    const build = (): ValidationIssue['fix'] => ({
      kind: 'set-scalar',
      path: ['mode'],
      // @ts-expect-error fix.value must be a JSON primitive, never an object
      value: { nested: true },
    });
    expect(build()).toBeDefined();
  });
});

describe('IssueFix — the "set" kind (v0.3.0 #14, non-scalar form edits)', () => {
  it('accepts a non-primitive value, unlike every other kind', () => {
    const arrayFix: IssueFix = { kind: 'set', path: ['dns', 'nameserver'], value: ['1.1.1.1'] };
    const objectFix: IssueFix = {
      kind: 'set',
      path: ['hosts'],
      value: { 'a.example.com': '127.0.0.1' },
    };
    expect(arrayFix.value).toEqual(['1.1.1.1']);
    expect(objectFix.value).toEqual({ 'a.example.com': '127.0.0.1' });
  });

  it('still narrows correctly in a kind switch alongside the other kinds', () => {
    function describeKind(fix: IssueFix): string {
      switch (fix.kind) {
        case 'set-scalar':
        case 'remove':
        case 'rename':
        case 'append':
          return 'scalar-shaped';
        case 'set':
          return 'unrestricted';
        case 'move':
          return 'reorder';
      }
    }
    expect(describeKind({ kind: 'set', path: [], value: [1, 2] })).toBe('unrestricted');
    expect(describeKind({ kind: 'set-scalar', path: [], value: 'x' })).toBe('scalar-shaped');
    expect(describeKind({ kind: 'move', path: ['rules'], from: 0, to: 2 })).toBe('reorder');
  });
});

describe('IssueFix — the "move" kind (v0.4.0 #9, drag/keyboard reorder)', () => {
  it('carries from/to indices instead of a value, unlike every other kind', () => {
    const fix: IssueFix = { kind: 'move', path: ['rules'], from: 3, to: 0 };
    expect(fix.from).toBe(3);
    expect(fix.to).toBe(0);
  });
});
