import { MemoryStorageAdapter, SnapshotManager, type StorageAdapter } from '@mcs/storage';
import { MihomoYamlDocument } from '@mcs/yaml-engine';
import { describe, expect, it } from 'vitest';

import { applyMigration, type ApplyMigrationOptions, type SnapshotRecorder } from './apply.js';
import { buildMigrationPlan, type MigrationOperation, type MigrationPlanInput } from './plan.js';

function parse(text: string): MihomoYamlDocument {
  const { document } = MihomoYamlDocument.parse(text);
  if (!document) throw new Error('unreachable: fixture text must always parse');
  return document;
}

/** Always succeeds, records nothing durable — the common case for tests that only care about the migration outcome, not snapshot storage itself. */
const ALWAYS_SUCCEEDS: SnapshotRecorder = {
  record: async () => ({
    level: 'normal',
    messageKey: 'storage.snapshot.normal',
    retainedCount: 1,
  }),
};

const ALWAYS_STOPS: SnapshotRecorder = {
  record: async () => ({
    level: 'stopped',
    messageKey: 'storage.snapshot.stopped',
    retainedCount: 0,
  }),
};

const ALWAYS_THROWS: SnapshotRecorder = {
  record: async () => {
    throw new Error('disk unplugged');
  },
};

function plan(operations: MigrationOperation[], overrides: Partial<MigrationPlanInput> = {}) {
  return buildMigrationPlan({ from: '1.0.0', to: '1.1.0', operations, warnings: [], ...overrides });
}

function options(overrides: Partial<ApplyMigrationOptions> = {}): ApplyMigrationOptions {
  return { snapshots: ALWAYS_SUCCEEDS, ...overrides };
}

const FIXTURE = [
  'mode: rule',
  'port: 7890',
  '# keep me',
  'old-name: value-a',
  'already-set: existing',
  'deprecated-thing: on',
  'enum-thing: legacy',
  'unrelated:',
  '  nested: kept-as-is',
  '',
].join('\n');

describe('applyMigration — Lossy gate (decision F7)', () => {
  it('refuses to execute a lossy plan without confirmedLossy, leaving the document byte-exact', async () => {
    const document = parse(FIXTURE);
    const result = await applyMigration(
      plan([{ op: 'remove-field', path: 'old-name' }]),
      document,
      options(),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('MIGRATION_LOSSY_NOT_CONFIRMED');
    expect(result.document.toText()).toBe(FIXTURE);
  });

  it('executes a lossy plan once confirmedLossy is true', async () => {
    const document = parse(FIXTURE);
    const result = await applyMigration(
      plan([{ op: 'remove-field', path: 'old-name' }]),
      document,
      options({ confirmedLossy: true }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.toText()).not.toContain('old-name');
  });

  it('executes a non-lossy plan regardless of confirmedLossy', async () => {
    const document = parse(FIXTURE);
    const result = await applyMigration(
      plan([{ op: 'rename-field', path: 'old-name', to: 'new-name' }]),
      document,
      options(),
    );

    expect(result.ok).toBe(true);
  });
});

describe('applyMigration — snapshot gate (NFR-REL-01)', () => {
  it('aborts and leaves the document byte-exact when the snapshot recorder reports stopped', async () => {
    const document = parse(FIXTURE);
    const result = await applyMigration(
      plan([{ op: 'rename-field', path: 'old-name', to: 'new-name' }]),
      document,
      options({ snapshots: ALWAYS_STOPS }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('MIGRATION_SNAPSHOT_FAILED');
    expect(result.document.toText()).toBe(FIXTURE);
  });

  it('aborts and leaves the document byte-exact when the snapshot recorder throws', async () => {
    const document = parse(FIXTURE);
    const result = await applyMigration(
      plan([{ op: 'rename-field', path: 'old-name', to: 'new-name' }]),
      document,
      options({ snapshots: ALWAYS_THROWS }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('MIGRATION_SNAPSHOT_FAILED');
    expect(result.document.toText()).toBe(FIXTURE);
  });

  it('a real SnapshotManager backed by an always-failing adapter also aborts the migration, document byte-exact', async () => {
    const inner = new MemoryStorageAdapter();
    const alwaysFailingAdapter: StorageAdapter = {
      get: (key) => inner.get(key),
      put: async () => {
        const error = new Error('quota');
        error.name = 'QuotaExceededError';
        throw error;
      },
      delete: (key) => inner.delete(key),
      list: (prefix) => inner.list(prefix),
    };
    const manager = new SnapshotManager({
      adapter: alwaysFailingAdapter,
      prefix: 'migration-snap/',
      maxSnapshots: 5,
      minSnapshots: 1,
    });
    const document = parse(FIXTURE);

    const result = await applyMigration(
      plan([{ op: 'rename-field', path: 'old-name', to: 'new-name' }]),
      document,
      options({ snapshots: manager }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('MIGRATION_SNAPSHOT_FAILED');
    expect(result.document.toText()).toBe(FIXTURE);
  });

  it('proceeds once a snapshot is actually recorded (real SnapshotManager + real adapter)', async () => {
    const manager = new SnapshotManager({ adapter: new MemoryStorageAdapter(), prefix: 'snap/' });
    const document = parse(FIXTURE);

    const result = await applyMigration(
      plan([{ op: 'rename-field', path: 'old-name', to: 'new-name' }]),
      document,
      options({ snapshots: manager }),
    );

    expect(result.ok).toBe(true);
    const snapshots = await manager.list();
    expect(snapshots).toHaveLength(1);
    expect(new TextDecoder().decode(snapshots[0]!.content)).toBe(FIXTURE);
  });
});

describe('applyMigration — per-opcode execution', () => {
  it('rename-field: renames the key in place, preserving the value and the rest of the document', async () => {
    const document = parse(FIXTURE);
    const result = await applyMigration(
      plan([{ op: 'rename-field', path: 'old-name', to: 'new-name' }]),
      document,
      options(),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const text = result.document.toText();
    expect(text).toContain('new-name: value-a');
    expect(text).not.toContain('old-name');
    expect(text).toContain('# keep me');
    expect(text).toContain('unrelated:\n  nested: kept-as-is');
  });

  it('rename-field: no-op when the source path does not exist', async () => {
    const document = parse(FIXTURE);
    const result = await applyMigration(
      plan([{ op: 'rename-field', path: 'never-existed', to: 'still-never' }]),
      document,
      options(),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.toText()).toBe(FIXTURE);
  });

  it('move-field: moves the value under a new nested parent and removes the old key', async () => {
    const document = parse(FIXTURE);
    const result = await applyMigration(
      plan([{ op: 'move-field', path: 'old-name', to: 'unrelated.moved' }]),
      document,
      options(),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const reparsed = parse(result.document.toText());
    expect(reparsed.getIn(['unrelated', 'moved'])).toBe('value-a');
    expect(reparsed.hasIn(['old-name'])).toBe(false);
  });

  it('move-field: no-op when the source path does not exist', async () => {
    const document = parse(FIXTURE);
    const result = await applyMigration(
      plan([{ op: 'move-field', path: 'never-existed', to: 'unrelated.moved' }]),
      document,
      options(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.toText()).toBe(FIXTURE);
  });

  it('set-default: fills a field that is currently absent', async () => {
    const document = parse(FIXTURE);
    const result = await applyMigration(
      plan([{ op: 'set-default', path: 'brand-new', value: 'schema-default' }]),
      document,
      options(),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const reparsed = parse(result.document.toText());
    expect(reparsed.getIn(['brand-new'])).toBe('schema-default');
  });

  it('set-default: never overwrites a field the document already sets', async () => {
    const document = parse(FIXTURE);
    const result = await applyMigration(
      plan([{ op: 'set-default', path: 'already-set', value: 'schema-default' }]),
      document,
      options(),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.toText()).toBe(FIXTURE);
  });

  it('deprecate-field: never mutates the document, only warns, and only when the field is present', async () => {
    const document = parse(FIXTURE);
    const present = await applyMigration(
      plan([{ op: 'deprecate-field', path: 'deprecated-thing', sinceVersion: '1.1.0' }]),
      document,
      options(),
    );
    expect(present.ok).toBe(true);
    if (!present.ok) return;
    expect(present.document.toText()).toBe(FIXTURE);
    expect(present.warnings).toEqual([{ code: 'FIELD_DEPRECATED', path: 'deprecated-thing' }]);

    const absentResult = await applyMigration(
      plan([{ op: 'deprecate-field', path: 'never-existed', sinceVersion: '1.1.0' }]),
      parse(FIXTURE),
      options(),
    );
    expect(absentResult.ok).toBe(true);
    if (!absentResult.ok) return;
    expect(absentResult.warnings).toEqual([]);
  });

  it('remove-field: deletes the key; lossy, requires confirmation', async () => {
    const document = parse(FIXTURE);
    const result = await applyMigration(
      plan([{ op: 'remove-field', path: 'old-name' }]),
      document,
      options({ confirmedLossy: true }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.toText()).not.toContain('old-name');
  });

  it('remove-field: no-op when the path does not exist', async () => {
    const document = parse(FIXTURE);
    const result = await applyMigration(
      plan([{ op: 'remove-field', path: 'never-existed' }]),
      document,
      options({ confirmedLossy: true }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.toText()).toBe(FIXTURE);
  });

  it('narrow-enum: retains the current value and warns when it falls outside the new allowed set', async () => {
    const document = parse(FIXTURE);
    const result = await applyMigration(
      plan([{ op: 'narrow-enum', path: 'enum-thing', allowed: ['current', 'future'] }]),
      document,
      options({ confirmedLossy: true }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // "legacy" is not in the new allowed set, but PRD §9.5's retain+warn
    // posture means the document text is untouched, not silently rewritten.
    expect(result.document.toText()).toBe(FIXTURE);
    expect(result.warnings).toEqual([{ code: 'ENUM_NARROWED', path: 'enum-thing' }]);
  });

  it('narrow-enum: warns nothing when the current value is still allowed', async () => {
    const document = parse(FIXTURE);
    const result = await applyMigration(
      plan([{ op: 'narrow-enum', path: 'enum-thing', allowed: ['legacy', 'current'] }]),
      document,
      options({ confirmedLossy: true }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toEqual([]);
  });

  it('quarantine-field: falls back to a no-op when no quarantine sink is injected (real wiring + sink tested in quarantine.test.ts, v0.5.0 #9)', async () => {
    const document = parse(FIXTURE);
    const result = await applyMigration(
      plan([{ op: 'quarantine-field', path: 'old-name' }]),
      document,
      options(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.toText()).toBe(FIXTURE);
    expect(result.warnings).toEqual([]);
  });

  it('resolves operation paths relative to a non-empty moduleRoot', async () => {
    const document = parse(['dns:', '  old-name: value-a', 'mode: rule', ''].join('\n'));
    const result = await applyMigration(
      plan([{ op: 'rename-field', path: 'old-name', to: 'new-name' }]),
      document,
      options({ moduleRoot: ['dns'] }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const reparsed = parse(result.document.toText());
    expect(reparsed.getIn(['dns', 'new-name'])).toBe('value-a');
    expect(reparsed.getIn(['mode'])).toBe('rule');
  });

  it('resolves a numeric path segment as an array index when the live document holds a list there', async () => {
    const document = parse(
      ['proxies:', '  - name: a', '    old-name: value-a', '  - name: b', ''].join('\n'),
    );
    const result = await applyMigration(
      plan([{ op: 'rename-field', path: 'proxies.0.old-name', to: 'new-name' }]),
      document,
      options(),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const reparsed = parse(result.document.toText());
    expect(reparsed.getIn(['proxies', 0, 'new-name'])).toBe('value-a');
    expect(reparsed.getIn(['proxies', 1, 'name'])).toBe('b');
  });
});

describe('applyMigration — atomicity: a failing operation rolls back every earlier operation in the same plan', () => {
  it('leaves the document byte-exact when a later operation in the plan throws', async () => {
    const document = parse(FIXTURE);
    // The second rename targets "mode", which already exists — renameKeyIn
    // refuses to rename onto an existing key and throws.
    const twoOperationPlan = plan([
      { op: 'rename-field', path: 'old-name', to: 'new-name' },
      { op: 'rename-field', path: 'port', to: 'mode' },
    ]);

    const result = await applyMigration(twoOperationPlan, document, options());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('MIGRATION_OPERATION_FAILED');
    expect(result.path).toBe('port');
    // The first rename's effect must not survive either.
    expect(result.document.toText()).toBe(FIXTURE);
  });
});

describe('applyMigration — structural correspondence between plan and result (decision F7)', () => {
  it('every operation in the plan produces a locatable, corresponding change in the executed document', async () => {
    const document = parse(FIXTURE);
    const threeOperationPlan = plan(
      [
        { op: 'rename-field', path: 'old-name', to: 'new-name' },
        { op: 'set-default', path: 'brand-new', value: 'schema-default' },
        { op: 'remove-field', path: 'deprecated-thing' },
      ],
      {},
    );

    const result = await applyMigration(
      threeOperationPlan,
      document,
      options({ confirmedLossy: true }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const after = parse(result.document.toText());
    // rename-field
    expect(after.getIn(['new-name'])).toBe('value-a');
    expect(after.hasIn(['old-name'])).toBe(false);
    // set-default
    expect(after.getIn(['brand-new'])).toBe('schema-default');
    // remove-field
    expect(after.hasIn(['deprecated-thing'])).toBe(false);
  });
});

describe('applyMigration — idempotence', () => {
  it('applying the same plan a second time, against the first result, produces byte-identical output', async () => {
    const migrationPlan = plan([
      { op: 'rename-field', path: 'old-name', to: 'new-name' },
      { op: 'set-default', path: 'brand-new', value: 'x' },
    ]);

    const first = await applyMigration(migrationPlan, parse(FIXTURE), options());
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = await applyMigration(migrationPlan, first.document, options());
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(second.document.toText()).toBe(first.document.toText());
  });
});

describe('applyMigration — reversibility of a non-lossy plan', () => {
  it('applying a rename-only plan, then its hand-built inverse, returns to the original text byte-exact', async () => {
    // Only demonstrated for rename-field, the one opcode with a
    // straightforward, generic inverse (swap path/to). This is not a claim
    // that every non-lossy plan is reversible in general — set-default's
    // "only fill when absent" semantics, for instance, has no clean static
    // inverse without knowing whether the field was absent beforehand.
    const forward = plan([
      { op: 'rename-field', path: 'old-name', to: 'new-name' },
      { op: 'rename-field', path: 'port', to: 'listen-port' },
    ]);
    const inverse = plan([
      { op: 'rename-field', path: 'listen-port', to: 'port' },
      { op: 'rename-field', path: 'new-name', to: 'old-name' },
    ]);
    expect(forward.lossy).toBe(false);

    const migrated = await applyMigration(forward, parse(FIXTURE), options());
    expect(migrated.ok).toBe(true);
    if (!migrated.ok) return;
    expect(migrated.document.toText()).not.toBe(FIXTURE);

    const restored = await applyMigration(inverse, migrated.document, options());
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(restored.document.toText()).toBe(FIXTURE);
  });
});
