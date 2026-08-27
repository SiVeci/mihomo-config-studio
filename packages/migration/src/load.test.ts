import type { JsonSchema, ModuleManifest, SchemaModule, UiSchema } from '@mcs/schema-core';
import { describe, expect, it } from 'vitest';

import { loadMigrations } from './load.js';

const MANIFEST: ModuleManifest = { id: 'general', root: [], version: '1.1.0' };
const SCHEMA: JsonSchema = { type: 'object' };
const UI: UiSchema = {};

const BASE_MODULE: SchemaModule = { manifest: MANIFEST, schema: SCHEMA, ui: UI };

function moduleWith(migrations: NonNullable<SchemaModule['migrations']>): SchemaModule {
  return { ...BASE_MODULE, migrations };
}

describe('loadMigrations (ADR-025, v0.5.0 #6)', () => {
  it('returns an empty plan list when the module has no migrations field at all', () => {
    const result = loadMigrations(BASE_MODULE);
    expect(result).toEqual({ ok: true, plans: [] });
  });

  it('loads a well-formed single-operation spec into a real MigrationPlan', () => {
    const result = loadMigrations(
      moduleWith([
        { from: '1.0.0', to: '1.1.0', operations: [{ op: 'rename-field', path: 'a', to: 'b' }] },
      ]),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plans).toEqual([
      {
        from: '1.0.0',
        to: '1.1.0',
        operations: [{ op: 'rename-field', path: 'a', to: 'b' }],
        warnings: [],
        lossy: false,
      },
    ]);
  });

  it('correctly derives lossy: true when the loaded operations include remove-field', () => {
    const result = loadMigrations(
      moduleWith([
        { from: '1.0.0', to: '1.1.0', operations: [{ op: 'remove-field', path: 'legacy' }] },
      ]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plans[0]!.lossy).toBe(true);
  });

  it('round-trips every one of the seven opcodes with their own required fields', () => {
    const cases: Array<{
      raw: { op: string; path: string; [key: string]: unknown };
      expected: object;
    }> = [
      {
        raw: { op: 'rename-field', path: 'a', to: 'b' },
        expected: { op: 'rename-field', path: 'a', to: 'b' },
      },
      {
        raw: { op: 'move-field', path: 'a', to: 'x.b' },
        expected: { op: 'move-field', path: 'a', to: 'x.b' },
      },
      {
        raw: { op: 'set-default', path: 'a', value: 42 },
        expected: { op: 'set-default', path: 'a', value: 42 },
      },
      {
        raw: { op: 'deprecate-field', path: 'a', sinceVersion: '1.1.0' },
        expected: { op: 'deprecate-field', path: 'a', sinceVersion: '1.1.0' },
      },
      {
        raw: { op: 'deprecate-field', path: 'a', sinceVersion: '1.1.0', replacement: 'b' },
        expected: {
          op: 'deprecate-field',
          path: 'a',
          sinceVersion: '1.1.0',
          replacement: 'b',
        },
      },
      { raw: { op: 'remove-field', path: 'a' }, expected: { op: 'remove-field', path: 'a' } },
      {
        raw: { op: 'narrow-enum', path: 'a', allowed: ['x', 'y'] },
        expected: { op: 'narrow-enum', path: 'a', allowed: ['x', 'y'] },
      },
      {
        raw: { op: 'quarantine-field', path: 'a' },
        expected: { op: 'quarantine-field', path: 'a' },
      },
    ];

    for (const { raw, expected } of cases) {
      const result = loadMigrations(
        moduleWith([{ from: '1.0.0', to: '1.1.0', operations: [raw] }]),
      );
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.plans[0]!.operations).toEqual([expected]);
    }
  });

  it('rejects the whole module (not just the offending operation) on an unknown opcode', () => {
    const result = loadMigrations(
      moduleWith([
        {
          from: '1.0.0',
          to: '1.1.0',
          operations: [
            { op: 'rename-field', path: 'a', to: 'b' },
            { op: 'run-script', path: 'c' },
          ],
        },
      ]),
    );

    expect(result).toEqual({
      ok: false,
      issues: [
        expect.objectContaining({
          code: 'migration.load.unknownOpcode',
          location: 'migrations[0].operations[1].op',
          messageParams: { op: 'run-script' },
        }),
      ],
    });
    // All-or-nothing: no `plans` field leaks through on failure.
    expect('plans' in result).toBe(false);
  });

  it('rejects an operation with an empty path', () => {
    const result = loadMigrations(
      moduleWith([{ from: '1.0.0', to: '1.1.0', operations: [{ op: 'remove-field', path: '' }] }]),
    );
    expect(result).toEqual({
      ok: false,
      issues: [
        expect.objectContaining({
          code: 'migration.load.missingField',
          location: 'migrations[0].operations[0].path',
        }),
      ],
    });
  });

  it('rejects rename-field/move-field missing their to field', () => {
    for (const op of ['rename-field', 'move-field']) {
      const result = loadMigrations(
        moduleWith([{ from: '1.0.0', to: '1.1.0', operations: [{ op, path: 'a' }] }]),
      );
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.issues).toEqual([
        expect.objectContaining({
          code: 'migration.load.missingField',
          location: 'migrations[0].operations[0].to',
        }),
      ]);
    }
  });

  it('rejects set-default with a non-primitive value', () => {
    const result = loadMigrations(
      moduleWith([
        {
          from: '1.0.0',
          to: '1.1.0',
          operations: [{ op: 'set-default', path: 'a', value: { nested: true } }],
        },
      ]),
    );
    expect(result).toEqual({
      ok: false,
      issues: [
        expect.objectContaining({
          code: 'migration.load.invalidValue',
          location: 'migrations[0].operations[0].value',
        }),
      ],
    });
  });

  it('rejects deprecate-field missing sinceVersion', () => {
    const result = loadMigrations(
      moduleWith([
        { from: '1.0.0', to: '1.1.0', operations: [{ op: 'deprecate-field', path: 'a' }] },
      ]),
    );
    expect(result).toEqual({
      ok: false,
      issues: [
        expect.objectContaining({
          code: 'migration.load.missingField',
          location: 'migrations[0].operations[0].sinceVersion',
        }),
      ],
    });
  });

  it('rejects deprecate-field with a non-string replacement', () => {
    const result = loadMigrations(
      moduleWith([
        {
          from: '1.0.0',
          to: '1.1.0',
          operations: [
            { op: 'deprecate-field', path: 'a', sinceVersion: '1.1.0', replacement: 42 },
          ],
        },
      ]),
    );
    expect(result).toEqual({
      ok: false,
      issues: [
        expect.objectContaining({
          code: 'migration.load.invalidValue',
          location: 'migrations[0].operations[0].replacement',
        }),
      ],
    });
  });

  it('rejects narrow-enum whose allowed is not an array', () => {
    const result = loadMigrations(
      moduleWith([
        {
          from: '1.0.0',
          to: '1.1.0',
          operations: [{ op: 'narrow-enum', path: 'a', allowed: 'not-an-array' }],
        },
      ]),
    );
    expect(result).toEqual({
      ok: false,
      issues: [
        expect.objectContaining({
          code: 'migration.load.invalidValue',
          location: 'migrations[0].operations[0].allowed',
        }),
      ],
    });
  });

  it('rejects narrow-enum whose allowed contains a non-primitive entry', () => {
    const result = loadMigrations(
      moduleWith([
        {
          from: '1.0.0',
          to: '1.1.0',
          operations: [{ op: 'narrow-enum', path: 'a', allowed: ['x', { nested: true }] }],
        },
      ]),
    );
    expect(result.ok).toBe(false);
  });

  it('rejects an empty from or to on the spec itself', () => {
    const emptyFrom = loadMigrations(
      moduleWith([{ from: '', to: '1.1.0', operations: [{ op: 'remove-field', path: 'a' }] }]),
    );
    expect(emptyFrom).toEqual({
      ok: false,
      issues: [
        expect.objectContaining({
          code: 'migration.load.missingField',
          location: 'migrations[0].from',
        }),
      ],
    });

    const emptyTo = loadMigrations(
      moduleWith([{ from: '1.0.0', to: '', operations: [{ op: 'remove-field', path: 'a' }] }]),
    );
    expect(emptyTo).toEqual({
      ok: false,
      issues: [
        expect.objectContaining({
          code: 'migration.load.missingField',
          location: 'migrations[0].to',
        }),
      ],
    });
  });

  it('collects every issue across multiple specs and operations at once, not just the first', () => {
    const result = loadMigrations(
      moduleWith([
        { from: '', to: '1.1.0', operations: [{ op: 'bogus', path: 'a' }] },
        { from: '1.1.0', to: '1.2.0', operations: [{ op: 'remove-field', path: '' }] },
      ]),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((issue) => issue.code).sort()).toEqual(
      [
        'migration.load.missingField', // empty from
        'migration.load.missingField', // empty path
        'migration.load.unknownOpcode',
      ].sort(),
    );
  });
});
