import type { SchemaModule } from '@mcs/schema-core';
import { describe, expect, it } from 'vitest';

import { buildUpgradePreview, collectLossyOperationCount } from './upgrade-preview.js';

function module(overrides: {
  id: string;
  version: string;
  schema?: unknown;
  migrations?: unknown[];
}): SchemaModule {
  return {
    manifest: { id: overrides.id, root: [overrides.id], version: overrides.version },
    schema: (overrides.schema ?? {}) as SchemaModule['schema'],
    ui: {},
    ...(overrides.migrations
      ? { migrations: overrides.migrations as NonNullable<SchemaModule['migrations']> }
      : {}),
  };
}

describe('buildUpgradePreview (v0.5.0 #11, FR-UPD-06)', () => {
  it('reports sameVersion when the bundle version has not changed', () => {
    const preview = buildUpgradePreview([], [], '1.0.0', '1.0.0');
    expect(preview.sameVersion).toBe(true);
  });

  it('reports not sameVersion when the bundle version differs', () => {
    const preview = buildUpgradePreview([], [], '1.0.0', '2.0.0');
    expect(preview.sameVersion).toBe(false);
  });

  it('diffs a module present in both old and new, surfacing an added field', () => {
    const old = [module({ id: 'general', version: '1.0.0', schema: { properties: { mode: {} } } })];
    const next = [
      module({
        id: 'general',
        version: '2.0.0',
        schema: { properties: { mode: {}, 'new-field': {} } },
      }),
    ];

    const preview = buildUpgradePreview(old, next, '1.0.0', '2.0.0');

    const general = preview.modules.find((m) => m.moduleId === 'general');
    expect(general?.diff?.added).toEqual([{ path: '$.new-field' }]);
    expect(general?.oldVersion).toBe('1.0.0');
    expect(general?.newVersion).toBe('2.0.0');
  });

  it('does not diff a brand-new module absent from the old bundle', () => {
    const next = [module({ id: 'sniffer', version: '1.0.0' })];

    const preview = buildUpgradePreview([], next, '1.0.0', '2.0.0');

    const sniffer = preview.modules.find((m) => m.moduleId === 'sniffer');
    expect(sniffer?.diff).toBeNull();
    expect(sniffer?.oldVersion).toBeNull();
  });

  it('excludes a module dropped entirely from the new bundle — nothing to preview or migrate for it', () => {
    const old = [module({ id: 'gone', version: '1.0.0' })];

    const preview = buildUpgradePreview(old, [], '1.0.0', '2.0.0');

    expect(preview.modules.find((m) => m.moduleId === 'gone')).toBeUndefined();
  });

  it('resolves a single-hop migration plan matching the old module version', () => {
    const old = [module({ id: 'general', version: '1.0.0' })];
    const next = [
      module({
        id: 'general',
        version: '2.0.0',
        migrations: [
          {
            from: '1.0.0',
            to: '2.0.0',
            operations: [{ op: 'rename-field', path: 'old', to: 'new' }],
          },
        ],
      }),
    ];

    const preview = buildUpgradePreview(old, next, '1.0.0', '2.0.0');

    const general = preview.modules.find((m) => m.moduleId === 'general');
    expect(general?.plans).toHaveLength(1);
    expect(general?.plans[0]).toMatchObject({ from: '1.0.0', to: '2.0.0' });
    expect(preview.lossy).toBe(false);
  });

  it('chains multiple migration hops when the old version is more than one release behind', () => {
    const old = [module({ id: 'general', version: '1.0.0' })];
    const next = [
      module({
        id: 'general',
        version: '3.0.0',
        migrations: [
          { from: '2.0.0', to: '3.0.0', operations: [{ op: 'remove-field', path: 'b' }] },
          { from: '1.0.0', to: '2.0.0', operations: [{ op: 'remove-field', path: 'a' }] },
        ],
      }),
    ];

    const preview = buildUpgradePreview(old, next, '1.0.0', '3.0.0');

    const general = preview.modules.find((m) => m.moduleId === 'general');
    expect(general?.plans.map((p) => [p.from, p.to])).toEqual([
      ['1.0.0', '2.0.0'],
      ['2.0.0', '3.0.0'],
    ]);
    // Both hops remove a field — lossy propagates up to the overall preview.
    expect(preview.lossy).toBe(true);
  });

  it('has no plan when the old version has no matching migration step (nothing to migrate for that module)', () => {
    const old = [module({ id: 'general', version: '9.9.9' })];
    const next = [
      module({
        id: 'general',
        version: '2.0.0',
        migrations: [{ from: '1.0.0', to: '2.0.0', operations: [] }],
      }),
    ];

    const preview = buildUpgradePreview(old, next, '1.0.0', '2.0.0');

    expect(preview.modules.find((m) => m.moduleId === 'general')?.plans).toEqual([]);
  });

  it('records loadIssues and an empty plan list when a module declares an unknown migration opcode (ADR-025)', () => {
    const old = [module({ id: 'general', version: '1.0.0' })];
    const next = [
      module({
        id: 'general',
        version: '2.0.0',
        migrations: [{ from: '1.0.0', to: '2.0.0', operations: [{ op: 'eval-js', path: 'x' }] }],
      }),
    ];

    const preview = buildUpgradePreview(old, next, '1.0.0', '2.0.0');

    const general = preview.modules.find((m) => m.moduleId === 'general');
    expect(general?.plans).toEqual([]);
    expect(general?.loadIssues.length).toBeGreaterThan(0);
  });
});

describe('collectLossyOperationCount', () => {
  it('counts lossy operations across every module, not just the first one', () => {
    const old = [module({ id: 'a', version: '1.0.0' }), module({ id: 'b', version: '1.0.0' })];
    const next = [
      module({
        id: 'a',
        version: '2.0.0',
        migrations: [
          {
            from: '1.0.0',
            to: '2.0.0',
            operations: [
              { op: 'remove-field', path: 'x' },
              { op: 'narrow-enum', path: 'y', allowed: ['keep'] },
            ],
          },
        ],
      }),
      module({
        id: 'b',
        version: '2.0.0',
        migrations: [
          { from: '1.0.0', to: '2.0.0', operations: [{ op: 'remove-field', path: 'z' }] },
        ],
      }),
    ];

    const preview = buildUpgradePreview(old, next, '1.0.0', '2.0.0');

    expect(collectLossyOperationCount(preview)).toBe(3);
  });

  it('is zero for a preview with no lossy operations anywhere', () => {
    const old = [module({ id: 'general', version: '1.0.0' })];
    const next = [
      module({
        id: 'general',
        version: '2.0.0',
        migrations: [
          { from: '1.0.0', to: '2.0.0', operations: [{ op: 'set-default', path: 'x', value: 1 }] },
        ],
      }),
    ];

    expect(collectLossyOperationCount(buildUpgradePreview(old, next, '1.0.0', '2.0.0'))).toBe(0);
  });
});
