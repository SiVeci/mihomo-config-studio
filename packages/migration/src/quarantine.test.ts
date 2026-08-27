import { MihomoYamlDocument } from '@mcs/yaml-engine';
import { describe, expect, it } from 'vitest';

import { applyMigration, type QuarantinedField, type SnapshotRecorder } from './apply.js';
import { buildMigrationPlan } from './plan.js';
import { restoreQuarantinedField } from './quarantine.js';

function parse(text: string): MihomoYamlDocument {
  const { document } = MihomoYamlDocument.parse(text);
  if (!document) throw new Error('unreachable: fixture text must always parse');
  return document;
}

const ALWAYS_SUCCEEDS: SnapshotRecorder = {
  record: async () => ({
    level: 'normal',
    messageKey: 'storage.snapshot.normal',
    retainedCount: 1,
  }),
};

const FIXTURE = ['mode: rule', 'legacy-flag: on', 'port: 7890', ''].join('\n');

describe('quarantine-field via applyMigration (PRD §9.5 point 6, v0.5.0 #9)', () => {
  it('is lossy: false — quarantining does not require confirmedLossy', () => {
    const plan = buildMigrationPlan({
      from: '2.0.0',
      to: '1.0.0',
      operations: [{ op: 'quarantine-field', path: 'legacy-flag' }],
      warnings: [],
    });
    expect(plan.lossy).toBe(false);
  });

  it('moves the value into the injected sink, deletes it from the document, and warns', async () => {
    const collected: QuarantinedField[] = [];
    const sink = { quarantine: (field: QuarantinedField) => collected.push(field) };

    const result = await applyMigration(
      buildMigrationPlan({
        from: '2.0.0',
        to: '1.0.0',
        operations: [{ op: 'quarantine-field', path: 'legacy-flag' }],
        warnings: [],
      }),
      parse(FIXTURE),
      { snapshots: ALWAYS_SUCCEEDS, quarantine: sink },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.toText()).not.toContain('legacy-flag');
    expect(result.warnings).toEqual([{ code: 'FIELD_QUARANTINED', path: 'legacy-flag' }]);
    expect(collected).toEqual([{ path: 'legacy-flag', value: 'on' }]);
  });

  it('falls back to a no-op — never a silent delete — when no sink is injected', async () => {
    const result = await applyMigration(
      buildMigrationPlan({
        from: '2.0.0',
        to: '1.0.0',
        operations: [{ op: 'quarantine-field', path: 'legacy-flag' }],
        warnings: [],
      }),
      parse(FIXTURE),
      { snapshots: ALWAYS_SUCCEEDS },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.toText()).toBe(FIXTURE);
    expect(result.warnings).toEqual([]);
  });

  it('is a no-op when the field does not exist, sink or not', async () => {
    const collected: QuarantinedField[] = [];
    const sink = { quarantine: (field: QuarantinedField) => collected.push(field) };

    const result = await applyMigration(
      buildMigrationPlan({
        from: '2.0.0',
        to: '1.0.0',
        operations: [{ op: 'quarantine-field', path: 'never-existed' }],
        warnings: [],
      }),
      parse(FIXTURE),
      { snapshots: ALWAYS_SUCCEEDS, quarantine: sink },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.toText()).toBe(FIXTURE);
    expect(collected).toEqual([]);
  });
});

describe('restoreQuarantinedField — a quarantined field can be fully retrieved', () => {
  it('writes the value back at the field’s original path', () => {
    const document = parse(['mode: rule', 'port: 7890', ''].join('\n'));

    restoreQuarantinedField(document, { path: 'legacy-flag', value: 'on' });

    expect(document.getIn(['legacy-flag'])).toBe('on');
  });

  it('round-trips through a real quarantine-then-restore cycle with the value fully preserved', async () => {
    const collected: QuarantinedField[] = [];
    const sink = { quarantine: (field: QuarantinedField) => collected.push(field) };

    const quarantined = await applyMigration(
      buildMigrationPlan({
        from: '2.0.0',
        to: '1.0.0',
        operations: [{ op: 'quarantine-field', path: 'legacy-flag' }],
        warnings: [],
      }),
      parse(FIXTURE),
      { snapshots: ALWAYS_SUCCEEDS, quarantine: sink },
    );
    expect(quarantined.ok).toBe(true);
    if (!quarantined.ok) return;
    expect(quarantined.document.getIn(['legacy-flag'])).toBeUndefined();

    restoreQuarantinedField(quarantined.document, collected[0]!);

    expect(quarantined.document.getIn(['legacy-flag'])).toBe('on');
    expect(quarantined.document.getIn(['mode'])).toBe('rule');
    expect(quarantined.document.getIn(['port'])).toBe(7890);
  });

  it('resolves the restore path relative to a non-empty moduleRoot, matching how it was quarantined', async () => {
    const collected: QuarantinedField[] = [];
    const sink = { quarantine: (field: QuarantinedField) => collected.push(field) };
    const document = parse(['dns:', '  legacy-flag: on', 'mode: rule', ''].join('\n'));

    const quarantined = await applyMigration(
      buildMigrationPlan({
        from: '2.0.0',
        to: '1.0.0',
        operations: [{ op: 'quarantine-field', path: 'legacy-flag' }],
        warnings: [],
      }),
      document,
      { snapshots: ALWAYS_SUCCEEDS, quarantine: sink, moduleRoot: ['dns'] },
    );
    expect(quarantined.ok).toBe(true);
    if (!quarantined.ok) return;

    restoreQuarantinedField(quarantined.document, collected[0]!, ['dns']);

    expect(quarantined.document.getIn(['dns', 'legacy-flag'])).toBe('on');
  });
});
