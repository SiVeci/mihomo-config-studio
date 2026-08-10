import { describe, expect, it } from 'vitest';

import { checkFormat, isRiskyPattern } from './formats.js';
import { SchemaRefError, resolveRef } from './ref.js';
import { sampleModule } from './testing/sample-module.js';
import type { JsonSchema } from './types.js';
import { validateValue } from './validate.js';

const codes = (issues: { code: string }[]) => issues.map((issue) => issue.code);

describe('JSON Schema subset interpreter (ADR-008)', () => {
  it('accepts a valid value against a real module schema', () => {
    const issues = validateValue(
      {
        mode: 'rule',
        'log-level': 'info',
        'allow-lan': false,
        'mixed-port': 7890,
        tun: { enable: true, stack: 'mixed' },
      },
      sampleModule.schema,
    );
    expect(issues).toEqual([]);
  });

  it('reports type mismatches with a path but never the value', () => {
    const issues = validateValue({ mode: 'rule', 'mixed-port': 'seven' }, sampleModule.schema);
    expect(codes(issues)).toEqual(['schema.type']);
    expect(issues[0]?.path).toEqual(['mixed-port']);
    expect(issues[0]?.message).toContain('mixed-port');
    expect(issues[0]?.message).not.toContain('seven');
  });

  it('reports missing required fields at the field path', () => {
    const issues = validateValue({}, sampleModule.schema);
    expect(codes(issues)).toEqual(['schema.required']);
    expect(issues[0]?.path).toEqual(['mode']);
  });

  it('checks enum, const and numeric bounds', () => {
    expect(codes(validateValue({ mode: 'nope' }, sampleModule.schema))).toEqual(['schema.enum']);
    expect(
      codes(validateValue({ mode: 'rule', 'mixed-port': 99999 }, sampleModule.schema)),
    ).toEqual(['schema.maximum']);
    expect(codes(validateValue(2, { type: 'integer', const: 1 }))).toEqual(['schema.const']);
    expect(codes(validateValue(7, { type: 'integer', multipleOf: 2 }))).toEqual([
      'schema.multipleOf',
    ]);
    expect(codes(validateValue(6, { type: 'integer', multipleOf: 2 }))).toEqual([]);
    expect(codes(validateValue(1, { type: 'integer', exclusiveMinimum: 1 }))).toEqual([
      'schema.exclusiveMinimum',
    ]);
  });

  it('checks string length, pattern and format', () => {
    expect(codes(validateValue('ab', { type: 'string', minLength: 3 }))).toEqual([
      'schema.minLength',
    ]);
    expect(codes(validateValue('abcd', { type: 'string', maxLength: 3 }))).toEqual([
      'schema.maxLength',
    ]);
    expect(codes(validateValue('xyz', { type: 'string', pattern: '^[0-9]+$' }))).toEqual([
      'schema.pattern',
    ]);
    expect(codes(validateValue('not a url', { type: 'string', format: 'uri' }))).toEqual([
      'schema.format',
    ]);
    expect(
      codes(validateValue('https://example.com/x', { type: 'string', format: 'uri' })),
    ).toEqual([]);
  });

  it('checks array constraints and descends into items', () => {
    const schema: JsonSchema = {
      type: 'array',
      items: { type: 'string' },
      minItems: 1,
      maxItems: 2,
      uniqueItems: true,
    };
    expect(codes(validateValue([], schema))).toEqual(['schema.minItems']);
    expect(codes(validateValue(['a', 'b', 'c'], schema))).toEqual(['schema.maxItems']);
    expect(codes(validateValue(['a', 'a'], schema))).toEqual(['schema.uniqueItems']);
    const nested = validateValue(['a', 1], schema);
    expect(codes(nested)).toEqual(['schema.type']);
    expect(nested[0]?.path).toEqual([1]);
  });

  it('honours prefixItems for tuple-shaped values', () => {
    const schema: JsonSchema = {
      type: 'array',
      prefixItems: [{ type: 'string' }, { type: 'integer' }],
      items: { type: 'boolean' },
    };
    expect(codes(validateValue(['a', 1, true], schema))).toEqual([]);
    expect(codes(validateValue(['a', 'b', true], schema))).toEqual(['schema.type']);
    expect(codes(validateValue(['a', 1, 'c'], schema))).toEqual(['schema.type']);
  });

  it('validates free-form maps through additionalProperties', () => {
    const schema: JsonSchema = { type: 'object', additionalProperties: { type: 'string' } };
    expect(codes(validateValue({ a: 'x' }, schema))).toEqual([]);
    const issues = validateValue({ a: 1 }, schema);
    expect(codes(issues)).toEqual(['schema.type']);
    expect(issues[0]?.path).toEqual(['a']);
  });

  it('reports but does not escalate an undeclared field when additionalProperties is false', () => {
    const schema: JsonSchema = {
      type: 'object',
      properties: { a: { type: 'string' } },
      additionalProperties: false,
    };
    const issues = validateValue({ a: 'x', b: 1 }, schema);
    expect(codes(issues)).toEqual(['schema.additionalProperties']);
    expect(issues[0]?.path).toEqual(['b']);
  });

  it('evaluates allOf, anyOf, oneOf and not in isolation', () => {
    const anyOf: JsonSchema = { anyOf: [{ type: 'string' }, { type: 'integer' }] };
    expect(codes(validateValue('a', anyOf))).toEqual([]);
    expect(codes(validateValue(1, anyOf))).toEqual([]);
    expect(codes(validateValue(true, anyOf))).toEqual(['schema.anyOf']);

    const oneOf: JsonSchema = {
      oneOf: [
        { type: 'integer', minimum: 10 },
        { type: 'integer', maximum: 5 },
      ],
    };
    expect(codes(validateValue(20, oneOf))).toEqual([]);
    expect(codes(validateValue(7, oneOf))).toEqual(['schema.oneOf']);

    expect(codes(validateValue('x', { allOf: [{ type: 'string' }, { minLength: 5 }] }))).toEqual([
      'schema.minLength',
    ]);
    expect(codes(validateValue('x', { not: { type: 'string' } }))).toEqual(['schema.not']);
  });

  it('bounds the number of issues and the recursion depth', () => {
    const wide = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`k${i}`, 1]));
    const schema: JsonSchema = {
      type: 'object',
      additionalProperties: { type: 'string' },
    };
    expect(validateValue(wide, schema, { maxIssues: 5 })).toHaveLength(5);

    let deep: unknown = 1;
    let deepSchema: JsonSchema = { type: 'integer' };
    for (let i = 0; i < 10; i += 1) {
      deep = { child: deep };
      deepSchema = { type: 'object', properties: { child: deepSchema } };
    }
    expect(codes(validateValue(deep, deepSchema, { maxDepth: 3 }))).toContain('schema.depth');
  });

  it('applies basePath so issues address the whole document', () => {
    const issues = validateValue({ mode: 1 }, sampleModule.schema, { basePath: ['sample'] });
    expect(issues[0]?.path).toEqual(['sample', 'mode']);
  });
});

describe('$ref resolution (NFR-SEC-05)', () => {
  it('resolves a local $defs reference and keeps sibling keywords', () => {
    const root: JsonSchema = { $defs: { a: { type: 'string', minLength: 2 } } };
    expect(resolveRef({ $ref: '#/$defs/a' }, root)).toMatchObject({ type: 'string', minLength: 2 });
    expect(resolveRef({ $ref: '#/$defs/a', title: 'T' }, root).title).toBe('T');
  });

  it('refuses remote and malformed references', () => {
    const root: JsonSchema = { $defs: {} };
    expect(() => resolveRef({ $ref: 'https://evil.example/schema.json' }, root)).toThrow(
      SchemaRefError,
    );
    expect(() => resolveRef({ $ref: '#/definitions/a' }, root)).toThrow(SchemaRefError);
    expect(() => resolveRef({ $ref: '#/$defs/missing' }, root)).toThrow(/Unresolved/);
    expect(() => resolveRef({ $ref: '#/$defs/a/b' }, root)).toThrow(/Malformed/);
  });

  it('detects a reference cycle instead of looping forever', () => {
    const root: JsonSchema = {
      $defs: { a: { $ref: '#/$defs/b' }, b: { $ref: '#/$defs/a' } },
    };
    expect(() => resolveRef({ $ref: '#/$defs/a' }, root)).toThrow(/exceeds/);
  });

  it('reports an unresolvable reference as an issue rather than throwing', () => {
    expect(codes(validateValue(1, { $ref: '#/$defs/nope' }, { rootSchema: {} }))).toEqual([
      'schema.ref',
    ]);
  });
});

describe('format checkers', () => {
  it('accepts and rejects the documented shapes', () => {
    expect(checkFormat('ipv4', '198.18.0.1')).toBe(true);
    expect(checkFormat('ipv4', '256.0.0.1')).toBe(false);
    expect(checkFormat('ipv6', '2606:4700:4700::1111')).toBe(true);
    expect(checkFormat('ipv6', 'not-an-address')).toBe(false);
    expect(checkFormat('ip-cidr', '198.18.0.0/16')).toBe(true);
    expect(checkFormat('ip-cidr', '2001:db8::/32')).toBe(true);
    expect(checkFormat('ip-cidr', '198.18.0.0/64')).toBe(false);
    expect(checkFormat('hostname', 'hk.example.com')).toBe(true);
    expect(checkFormat('hostname', '-bad.example.com')).toBe(false);
    expect(checkFormat('port', '7890')).toBe(true);
    expect(checkFormat('port', '70000')).toBe(false);
    expect(checkFormat('host-port', '127.0.0.1:9090')).toBe(true);
    expect(checkFormat('host-port', '[::1]:53')).toBe(true);
    expect(checkFormat('host-port', ':7890')).toBe(true);
    expect(checkFormat('host-port', 'example.com')).toBe(false);
    expect(checkFormat('uuid', '00000000-0000-0000-0000-000000000000')).toBe(true);
    expect(checkFormat('uuid', 'nope')).toBe(false);
    expect(checkFormat('duration-seconds', '300')).toBe(true);
    expect(checkFormat('duration-seconds', '5m')).toBe(false);
  });
});

describe('pattern risk screening (NFR-SEC-05)', () => {
  it('flags classic catastrophic-backtracking shapes', () => {
    expect(isRiskyPattern('(a+)+$')).toBe(true);
    expect(isRiskyPattern('(a|a)*$')).toBe(true);
    expect(isRiskyPattern('a'.repeat(600))).toBe(true);
  });

  it('accepts the anchored patterns real schemas use', () => {
    expect(isRiskyPattern('^[0-9]+$')).toBe(false);
    expect(isRiskyPattern('^[a-z0-9-]{1,63}$')).toBe(false);
  });
});
