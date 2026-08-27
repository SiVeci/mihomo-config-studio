import { describe, expect, it } from 'vitest';

import {
  buildMigrationPlan,
  isLossyOperation,
  MIGRATION_OPERATION_KINDS,
  type MigrationOperation,
  type MigrationPlanInput,
  type MigrationWarning,
} from './plan.js';

describe('MIGRATION_OPERATION_KINDS (ADR-025)', () => {
  it('is exactly the seven closed opcodes, with no duplicates', () => {
    expect(MIGRATION_OPERATION_KINDS).toHaveLength(7);
    expect(new Set(MIGRATION_OPERATION_KINDS).size).toBe(7);
    expect([...MIGRATION_OPERATION_KINDS].sort()).toEqual(
      [
        'rename-field',
        'move-field',
        'set-default',
        'deprecate-field',
        'remove-field',
        'narrow-enum',
        'quarantine-field',
      ].sort(),
    );
  });
});

describe('isLossyOperation', () => {
  it('is lossy for remove-field and narrow-enum only', () => {
    const cases: ReadonlyArray<{ operation: MigrationOperation; lossy: boolean }> = [
      { operation: { op: 'rename-field', path: 'a', to: 'b' }, lossy: false },
      { operation: { op: 'move-field', path: 'a', to: 'b.c' }, lossy: false },
      { operation: { op: 'set-default', path: 'a', value: 1 }, lossy: false },
      {
        operation: { op: 'deprecate-field', path: 'a', sinceVersion: '1.1.0' },
        lossy: false,
      },
      { operation: { op: 'remove-field', path: 'a' }, lossy: true },
      { operation: { op: 'narrow-enum', path: 'a', allowed: ['x', 'y'] }, lossy: true },
      { operation: { op: 'quarantine-field', path: 'a' }, lossy: false },
    ];

    for (const { operation, lossy } of cases) {
      expect(isLossyOperation(operation)).toBe(lossy);
    }
  });
});

function baseInput(operations: MigrationOperation[]): MigrationPlanInput {
  return { from: '1.0.0', to: '1.1.0', operations, warnings: [] };
}

describe('buildMigrationPlan', () => {
  it('computes lossy: false when no operation is lossy', () => {
    const plan = buildMigrationPlan(baseInput([{ op: 'rename-field', path: 'a', to: 'b' }]));
    expect(plan.lossy).toBe(false);
  });

  it('computes lossy: true when at least one operation is lossy, even among mostly non-lossy ones', () => {
    const plan = buildMigrationPlan(
      baseInput([
        { op: 'rename-field', path: 'a', to: 'b' },
        { op: 'set-default', path: 'c', value: 'x' },
        { op: 'remove-field', path: 'd' },
      ]),
    );
    expect(plan.lossy).toBe(true);
  });

  it('computes lossy: false for an empty operations list', () => {
    const plan = buildMigrationPlan(baseInput([]));
    expect(plan.lossy).toBe(false);
  });

  it('passes from/to/operations/warnings through unchanged', () => {
    const operations: MigrationOperation[] = [{ op: 'rename-field', path: 'a', to: 'b' }];
    const warnings: MigrationWarning[] = [{ code: 'FIELD_DEPRECATED', path: 'a' }];
    const plan = buildMigrationPlan({ from: '1.0.0', to: '2.0.0', operations, warnings });

    expect(plan.from).toBe('1.0.0');
    expect(plan.to).toBe('2.0.0');
    expect(plan.operations).toBe(operations);
    expect(plan.warnings).toBe(warnings);
  });

  it('ignores a caller-injected lossy value on the input — it is always recomputed, never trusted', () => {
    const poisonedInput = {
      ...baseInput([{ op: 'remove-field', path: 'secret-field' }]),
      lossy: false, // a Bundle (or a bug) declaring "not lossy" despite a remove-field.
    } as unknown as MigrationPlanInput;

    const plan = buildMigrationPlan(poisonedInput);

    expect(plan.lossy).toBe(true);
  });
});

describe('MigrationWarning shape (NFR-SEC-03)', () => {
  it('only ever exposes structural identifiers as keys — code, path, messageParams', () => {
    const warning: MigrationWarning = {
      code: 'FIELD_REMOVED',
      path: 'proxies.0.password',
      messageParams: { field: 'password' },
    };

    expect(Object.keys(warning).sort()).toEqual(['code', 'messageParams', 'path']);
  });

  it('a plan built from identifier-only warnings never serializes a real document value, even one never passed to any constructor here', () => {
    // Mirrors apps/web/src/worker/protocol.test.ts's "never includes a
    // sensitive value anywhere in the response" technique: a realistic
    // secret exists in the test, but is never given to buildMigrationPlan or
    // any MigrationWarning — the whole point is that this shape has no field
    // that could carry it even if a future author tried to.
    const REAL_LOOKING_SECRET = 'hunter2-not-a-real-password-but-shaped-like-one';

    const plan = buildMigrationPlan({
      from: '1.0.0',
      to: '1.1.0',
      operations: [{ op: 'remove-field', path: 'proxies.0.password' }],
      warnings: [
        {
          code: 'FIELD_REMOVED',
          path: 'proxies.0.password',
          messageParams: { field: 'password' },
        },
      ],
    });

    const serialized = JSON.stringify(plan);
    expect(serialized).not.toContain(REAL_LOOKING_SECRET);
    expect(serialized).toContain('password');
    expect(serialized).toContain('proxies.0.password');
  });
});
