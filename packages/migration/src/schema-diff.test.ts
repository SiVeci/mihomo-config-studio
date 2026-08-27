import type { JsonSchema } from '@mcs/schema-core';
import { describe, expect, it } from 'vitest';

import { diffSchemas, SchemaDiffError } from './schema-diff.js';

describe('diffSchemas — added fields', () => {
  it('reports a top-level field present only in the new schema', () => {
    const oldSchema: JsonSchema = { type: 'object', properties: { a: { type: 'string' } } };
    const newSchema: JsonSchema = {
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'number' } },
    };

    const diff = diffSchemas(oldSchema, newSchema);
    expect(diff.added).toEqual([{ path: '$.b' }]);
  });

  it('does not individually list the children of a brand-new nested object', () => {
    const oldSchema: JsonSchema = { type: 'object', properties: {} };
    const newSchema: JsonSchema = {
      type: 'object',
      properties: {
        group: {
          type: 'object',
          properties: { inner: { type: 'string', default: 'x' } },
        },
      },
    };

    const diff = diffSchemas(oldSchema, newSchema);
    expect(diff.added).toEqual([{ path: '$.group' }]);
  });

  it('finds an added field nested inside an object that already existed in both schemas', () => {
    const oldSchema: JsonSchema = {
      type: 'object',
      properties: { group: { type: 'object', properties: { a: { type: 'string' } } } },
    };
    const newSchema: JsonSchema = {
      type: 'object',
      properties: {
        group: {
          type: 'object',
          properties: { a: { type: 'string' }, b: { type: 'string' } },
        },
      },
    };

    const diff = diffSchemas(oldSchema, newSchema);
    expect(diff.added).toEqual([{ path: '$.group.b' }]);
  });

  it('finds an added field inside an array items schema', () => {
    const oldSchema: JsonSchema = {
      type: 'object',
      properties: {
        list: { type: 'array', items: { type: 'object', properties: { a: { type: 'string' } } } },
      },
    };
    const newSchema: JsonSchema = {
      type: 'object',
      properties: {
        list: {
          type: 'array',
          items: {
            type: 'object',
            properties: { a: { type: 'string' }, b: { type: 'string' } },
          },
        },
      },
    };

    const diff = diffSchemas(oldSchema, newSchema);
    expect(diff.added).toEqual([{ path: '$.list[].b' }]);
  });
});

describe('diffSchemas — deprecated fields', () => {
  it('reports a field newly marked deprecated in the new schema', () => {
    const oldSchema: JsonSchema = { type: 'object', properties: { a: { type: 'string' } } };
    const newSchema: JsonSchema = {
      type: 'object',
      properties: { a: { type: 'string', deprecated: true } },
    };

    const diff = diffSchemas(oldSchema, newSchema);
    expect(diff.deprecated).toEqual([{ path: '$.a' }]);
  });

  it('does not re-report a field that was already deprecated in the old schema', () => {
    const oldSchema: JsonSchema = {
      type: 'object',
      properties: { a: { type: 'string', deprecated: true } },
    };
    const newSchema: JsonSchema = {
      type: 'object',
      properties: { a: { type: 'string', deprecated: true } },
    };

    const diff = diffSchemas(oldSchema, newSchema);
    expect(diff.deprecated).toEqual([]);
  });
});

describe('diffSchemas — defaultChanged', () => {
  it('reports a changed default value', () => {
    const oldSchema: JsonSchema = {
      type: 'object',
      properties: { a: { type: 'number', default: 5 } },
    };
    const newSchema: JsonSchema = {
      type: 'object',
      properties: { a: { type: 'number', default: 10 } },
    };

    const diff = diffSchemas(oldSchema, newSchema);
    expect(diff.defaultChanged).toEqual([{ path: '$.a', oldDefault: 5, newDefault: 10 }]);
  });

  it('reports a default that was newly added (previously undeclared)', () => {
    const oldSchema: JsonSchema = { type: 'object', properties: { a: { type: 'number' } } };
    const newSchema: JsonSchema = {
      type: 'object',
      properties: { a: { type: 'number', default: 10 } },
    };

    const diff = diffSchemas(oldSchema, newSchema);
    expect(diff.defaultChanged).toEqual([{ path: '$.a', oldDefault: undefined, newDefault: 10 }]);
  });

  it('reports a default that was removed', () => {
    const oldSchema: JsonSchema = {
      type: 'object',
      properties: { a: { type: 'number', default: 10 } },
    };
    const newSchema: JsonSchema = { type: 'object', properties: { a: { type: 'number' } } };

    const diff = diffSchemas(oldSchema, newSchema);
    expect(diff.defaultChanged).toEqual([{ path: '$.a', oldDefault: 10, newDefault: undefined }]);
  });

  it('reports nothing when the default is unchanged', () => {
    const schema: JsonSchema = {
      type: 'object',
      properties: { a: { type: 'number', default: 5 } },
    };
    const diff = diffSchemas(schema, structuredClone(schema));
    expect(diff.defaultChanged).toEqual([]);
  });
});

describe('diffSchemas — oneOf discriminated unions (ADR-019)', () => {
  function proxyLikeSchema(branches: JsonSchema[]): JsonSchema {
    return { oneOf: branches };
  }

  it('diffs branch-by-branch, matched by discriminator, without pooling fields across branches', () => {
    const oldSchema = proxyLikeSchema([
      {
        type: 'object',
        properties: { type: { const: 'ss' }, password: { type: 'string' } },
      },
      {
        type: 'object',
        properties: { type: { const: 'vmess' }, uuid: { type: 'string' } },
      },
    ]);
    const newSchema = proxyLikeSchema([
      {
        type: 'object',
        properties: {
          type: { const: 'ss' },
          password: { type: 'string' },
          udp: { type: 'boolean' },
        },
      },
      {
        type: 'object',
        properties: { type: { const: 'vmess' }, uuid: { type: 'string' } },
      },
    ]);

    const diff = diffSchemas(oldSchema, newSchema);
    // Only the ss branch gained a field; the field name never appears
    // attributed to the vmess branch, and vmess reports nothing at all.
    expect(diff.added).toEqual([{ path: '$<type=ss>.udp' }]);
  });

  it('treats a same-named field in two different branches as independent, not a match', () => {
    const oldSchema = proxyLikeSchema([
      { type: 'object', properties: { type: { const: 'a' } } },
      { type: 'object', properties: { type: { const: 'b' }, shared: { type: 'string' } } },
    ]);
    const newSchema = proxyLikeSchema([
      { type: 'object', properties: { type: { const: 'a' }, shared: { type: 'string' } } },
      { type: 'object', properties: { type: { const: 'b' }, shared: { type: 'string' } } },
    ]);

    const diff = diffSchemas(oldSchema, newSchema);
    // "shared" already existed in branch b; it is newly added only in branch a.
    expect(diff.added).toEqual([{ path: '$<type=a>.shared' }]);
  });

  it('reports every field of a branch that is entirely new (no discriminator match in the old schema) as added', () => {
    const oldSchema = proxyLikeSchema([
      { type: 'object', properties: { type: { const: 'ss' }, password: { type: 'string' } } },
    ]);
    const newSchema = proxyLikeSchema([
      { type: 'object', properties: { type: { const: 'ss' }, password: { type: 'string' } } },
      { type: 'object', properties: { type: { const: 'trojan' }, sni: { type: 'string' } } },
    ]);

    const diff = diffSchemas(oldSchema, newSchema);
    expect(diff.added).toEqual([{ path: '$<type=trojan>.sni' }]);
  });

  it('uses a single-value enum as the discriminator when no branch declares a const', () => {
    const oldSchema = proxyLikeSchema([
      { type: 'object', properties: { type: { enum: ['ss'] }, password: { type: 'string' } } },
    ]);
    const newSchema = proxyLikeSchema([
      {
        type: 'object',
        properties: {
          type: { enum: ['ss'] },
          password: { type: 'string' },
          udp: { type: 'boolean' },
        },
      },
    ]);

    const diff = diffSchemas(oldSchema, newSchema);
    expect(diff.added).toEqual([{ path: '$<type=ss>.udp' }]);
  });

  it('falls back to a positional label when no branch has any const/single-enum candidate', () => {
    const oldSchema = proxyLikeSchema([{ type: 'object', properties: { a: { type: 'string' } } }]);
    const newSchema = proxyLikeSchema([
      { type: 'object', properties: { a: { type: 'string' }, b: { type: 'string' } } },
    ]);

    const diff = diffSchemas(oldSchema, newSchema);
    expect(diff.added).toEqual([{ path: '$<#0>.b' }]);
  });
});

describe('diffSchemas — allOf + $ref composition (ADR-019 shared-field pattern)', () => {
  it('finds a field added to a $defs fragment shared via allOf', () => {
    const oldSchema: JsonSchema = {
      $defs: { shared: { properties: { a: { type: 'string' } } } },
      oneOf: [{ allOf: [{ $ref: '#/$defs/shared' }, { properties: { type: { const: 'x' } } }] }],
    };
    const newSchema: JsonSchema = {
      $defs: { shared: { properties: { a: { type: 'string' }, b: { type: 'string' } } } },
      oneOf: [{ allOf: [{ $ref: '#/$defs/shared' }, { properties: { type: { const: 'x' } } }] }],
    };

    const diff = diffSchemas(oldSchema, newSchema);
    expect(diff.added).toEqual([{ path: '$<type=x>.b' }]);
  });
});

describe('diffSchemas — resource limits', () => {
  it('throws SchemaDiffError rather than recursing forever on a pathologically deep schema', () => {
    function buildDeep(levels: number): JsonSchema {
      let schema: JsonSchema = { type: 'string' };
      for (let i = 0; i < levels; i += 1) {
        schema = { type: 'object', properties: { next: schema } };
      }
      return schema;
    }

    const deep = buildDeep(200);
    expect(() => diffSchemas(deep, deep)).toThrow(SchemaDiffError);
  });
});
