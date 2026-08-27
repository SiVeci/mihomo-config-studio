import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { diffDirectories, formatDiffReport } from './diff.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeModuleDirs(): { oldDir: string; newDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'schema-cli-diff-test-'));
  tempDirs.push(root);
  const oldDir = join(root, 'old');
  const newDir = join(root, 'new');
  mkdirSync(oldDir, { recursive: true });
  mkdirSync(newDir, { recursive: true });
  return { oldDir, newDir };
}

function writeModuleSchema(dir: string, moduleId: string, schema: unknown): void {
  const moduleDir = join(dir, moduleId);
  mkdirSync(moduleDir, { recursive: true });
  writeFileSync(join(moduleDir, 'config.schema.json'), JSON.stringify(schema));
}

describe('diffDirectories (FR-UPD-06/07, v0.5.0 #13, reuses #7 diffSchemas)', () => {
  it('reports a changed module with an added field', () => {
    const { oldDir, newDir } = makeModuleDirs();
    writeModuleSchema(oldDir, 'general', { properties: { mode: {} } });
    writeModuleSchema(newDir, 'general', { properties: { mode: {}, 'new-field': {} } });

    const [report] = diffDirectories({ oldDir, newDir });

    expect(report).toMatchObject({ moduleId: 'general', status: 'changed' });
    expect(report?.diff?.added).toEqual([{ path: '$.new-field' }]);
  });

  it('reports an unchanged module as unchanged, not unreported', () => {
    const { oldDir, newDir } = makeModuleDirs();
    writeModuleSchema(oldDir, 'general', { properties: { mode: {} } });
    writeModuleSchema(newDir, 'general', { properties: { mode: {} } });

    const [report] = diffDirectories({ oldDir, newDir });

    expect(report).toEqual({
      moduleId: 'general',
      status: 'unchanged',
      diff: { added: [], deprecated: [], defaultChanged: [] },
    });
  });

  it('reports a module present only in the new directory as added, without attempting to diff it', () => {
    const { oldDir, newDir } = makeModuleDirs();
    writeModuleSchema(newDir, 'sniffer', { properties: {} });

    const [report] = diffDirectories({ oldDir, newDir });

    expect(report).toEqual({ moduleId: 'sniffer', status: 'added' });
  });

  it('reports a module present only in the old directory as removed', () => {
    const { oldDir, newDir } = makeModuleDirs();
    writeModuleSchema(oldDir, 'legacy', { properties: {} });

    const [report] = diffDirectories({ oldDir, newDir });

    expect(report).toEqual({ moduleId: 'legacy', status: 'removed' });
  });

  it('sorts modules by id, independent of directory listing order', () => {
    const { oldDir, newDir } = makeModuleDirs();
    for (const id of ['sniffer', 'dns', 'general']) {
      writeModuleSchema(oldDir, id, { properties: {} });
      writeModuleSchema(newDir, id, { properties: {} });
    }

    const reports = diffDirectories({ oldDir, newDir });

    expect(reports.map((r) => r.moduleId)).toEqual(['dns', 'general', 'sniffer']);
  });
});

describe('formatDiffReport', () => {
  it('formats every status kind into a readable line', () => {
    const report = formatDiffReport([
      { moduleId: 'added-mod', status: 'added' },
      { moduleId: 'removed-mod', status: 'removed' },
      { moduleId: 'same-mod', status: 'unchanged' },
      {
        moduleId: 'changed-mod',
        status: 'changed',
        diff: {
          added: [{ path: '$.x' }],
          deprecated: [{ path: '$.y' }],
          defaultChanged: [{ path: '$.z', oldDefault: 1, newDefault: 2 }],
        },
      },
    ]);

    expect(report).toContain('+ added-mod (new module)');
    expect(report).toContain('- removed-mod (removed module)');
    expect(report).toContain('same-mod: no schema changes');
    expect(report).toContain('+ added $.x');
    expect(report).toContain('~ deprecated $.y');
    expect(report).toContain('default changed $.z: 1 -> 2');
  });
});
