import { MemoryStorageAdapter } from '@mcs/storage';
import { describe, expect, it } from 'vitest';

import {
  collectAllTags,
  collectAllTargetProfiles,
  deleteProject,
  filterProjects,
  getProjectDisabledRules,
  listProjects,
  saveProjectDisabledRules,
  saveProjectManifest,
  type ProjectRecord,
} from './model.js';

function record(overrides: Partial<ProjectRecord> = {}): ProjectRecord {
  return {
    id: 'p1',
    name: 'Project One',
    description: '',
    targetProfile: 'v1.19.29',
    tags: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('listProjects backfills tags for pre-v0.9.0 #14 manifests', () => {
  it('defaults to an empty array when a stored manifest has no tags field at all', async () => {
    const adapter = new MemoryStorageAdapter();
    // A real pre-#14 manifest, written directly (not through
    // `saveProjectManifest`, which always writes the current shape) —
    // simulates a project created before this slice shipped.
    const { tags: _tags, ...withoutTags } = record();
    await adapter.put(
      'project/p1/manifest.json',
      new TextEncoder().encode(JSON.stringify(withoutTags)),
    );

    const projects = await listProjects(adapter);
    expect(projects).toEqual([record()]);
  });

  it('leaves a manifest that already has tags untouched', async () => {
    const adapter = new MemoryStorageAdapter();
    await saveProjectManifest(adapter, record({ tags: ['home', 'work'] }));

    const projects = await listProjects(adapter);
    expect(projects).toEqual([record({ tags: ['home', 'work'] })]);
  });
});

describe('filterProjects (FR-PROJ-07)', () => {
  const home = record({ id: 'home', name: 'Home Router', tags: ['home', 'stable'] });
  const office = record({
    id: 'office',
    name: 'Office VPN',
    tags: ['work'],
    targetProfile: 'v2.0.0',
  });
  const all = [home, office];

  it('returns every record for an empty query', () => {
    expect(filterProjects(all, { text: '', tag: null, targetProfile: null })).toEqual(all);
  });

  it('matches name case-insensitively, substring, not just a prefix', () => {
    expect(filterProjects(all, { text: 'router', tag: null, targetProfile: null })).toEqual([home]);
    expect(filterProjects(all, { text: 'OFFICE', tag: null, targetProfile: null })).toEqual([
      office,
    ]);
  });

  it('filters by tag, an exact membership check not a substring one', () => {
    expect(filterProjects(all, { text: '', tag: 'work', targetProfile: null })).toEqual([office]);
    expect(filterProjects(all, { text: '', tag: 'stable', targetProfile: null })).toEqual([home]);
  });

  it('filters by target profile', () => {
    expect(filterProjects(all, { text: '', tag: null, targetProfile: 'v2.0.0' })).toEqual([office]);
  });

  it('combines all three filters (AND, not OR)', () => {
    expect(filterProjects(all, { text: 'office', tag: 'work', targetProfile: null })).toEqual([
      office,
    ]);
    expect(filterProjects(all, { text: 'office', tag: 'home', targetProfile: null })).toEqual([]);
  });

  it('returns nothing rather than throwing when no record matches', () => {
    expect(filterProjects(all, { text: 'does-not-exist', tag: null, targetProfile: null })).toEqual(
      [],
    );
  });
});

describe('collectAllTags / collectAllTargetProfiles', () => {
  it('deduplicates and sorts tags across every record', () => {
    const records = [record({ id: 'a', tags: ['b', 'a'] }), record({ id: 'b', tags: ['a', 'c'] })];
    expect(collectAllTags(records)).toEqual(['a', 'b', 'c']);
  });

  it('returns an empty array when no record has any tag', () => {
    expect(collectAllTags([record({ tags: [] })])).toEqual([]);
  });

  it('deduplicates and sorts target profiles across every record', () => {
    const records = [
      record({ id: 'a', targetProfile: 'v2.0.0' }),
      record({ id: 'b', targetProfile: 'v1.19.29' }),
      record({ id: 'c', targetProfile: 'v1.19.29' }),
    ];
    expect(collectAllTargetProfiles(records)).toEqual(['v1.19.29', 'v2.0.0']);
  });
});

describe('getProjectDisabledRules / saveProjectDisabledRules (FR-VAL-06, v0.9.0 #15)', () => {
  it('defaults to an empty list for a project that has never saved one', async () => {
    const adapter = new MemoryStorageAdapter();
    expect(await getProjectDisabledRules(adapter, 'p1')).toEqual({ ruleIds: [] });
  });

  it('round-trips a saved set of disabled rule ids', async () => {
    const adapter = new MemoryStorageAdapter();
    await saveProjectDisabledRules(adapter, 'p1', {
      ruleIds: ['ruleOrder.domainShadowed', 'rule.tuic-token-conflicts-with-uuid-password'],
    });

    expect(await getProjectDisabledRules(adapter, 'p1')).toEqual({
      ruleIds: ['ruleOrder.domainShadowed', 'rule.tuic-token-conflicts-with-uuid-password'],
    });
  });

  it('keeps two projects independent — one project’s disabled rules never leak into another’s', async () => {
    const adapter = new MemoryStorageAdapter();
    await saveProjectDisabledRules(adapter, 'p1', { ruleIds: ['ruleOrder.noMatch'] });

    expect(await getProjectDisabledRules(adapter, 'p2')).toEqual({ ruleIds: [] });
  });

  it('deleteProject removes the saved disabled-rules key too', async () => {
    const adapter = new MemoryStorageAdapter();
    await saveProjectDisabledRules(adapter, 'p1', { ruleIds: ['ruleOrder.noMatch'] });

    await deleteProject(adapter, 'p1');

    expect(await getProjectDisabledRules(adapter, 'p1')).toEqual({ ruleIds: [] });
  });
});
