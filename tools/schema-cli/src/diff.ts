import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { diffSchemas, SchemaDiffError, type SchemaDiff } from '@mcs/migration';
import type { JsonSchema } from '@mcs/schema-core';

const CONFIG_SCHEMA_FILE = 'config.schema.json';

export type ModuleDiffStatus = 'added' | 'removed' | 'changed' | 'unchanged' | 'error';

export interface ModuleDiffReport {
  readonly moduleId: string;
  readonly status: ModuleDiffStatus;
  readonly diff?: SchemaDiff;
  readonly error?: string;
}

export interface DiffOptions {
  readonly oldDir: string;
  readonly newDir: string;
}

function listModuleIds(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function readModuleSchema(dir: string, moduleId: string): JsonSchema | null {
  const schemaPath = join(dir, moduleId, CONFIG_SCHEMA_FILE);
  try {
    if (!statSync(schemaPath).isFile()) return null;
  } catch {
    return null;
  }
  return JSON.parse(readFileSync(schemaPath, 'utf8')) as JsonSchema;
}

/**
 * Diffs every module common to both directories — each module is one
 * subdirectory containing its own `config.schema.json`, the same layout
 * `packages/schema-builtin/modules/*` already uses. Reuses #7's
 * `diffSchemas` (`@mcs/migration`) for the actual comparison; this file only
 * walks two directory trees and maps each module to a diff — no second diff
 * algorithm.
 */
export function diffDirectories(options: DiffOptions): ModuleDiffReport[] {
  const oldIds = new Set(listModuleIds(options.oldDir));
  const newIds = new Set(listModuleIds(options.newDir));
  const allIds = [...new Set([...oldIds, ...newIds])].sort();

  return allIds.map((moduleId): ModuleDiffReport => {
    if (!oldIds.has(moduleId)) return { moduleId, status: 'added' };
    if (!newIds.has(moduleId)) return { moduleId, status: 'removed' };

    const oldSchema = readModuleSchema(options.oldDir, moduleId);
    const newSchema = readModuleSchema(options.newDir, moduleId);
    if (!oldSchema || !newSchema) {
      return { moduleId, status: 'error', error: `missing ${CONFIG_SCHEMA_FILE}` };
    }

    try {
      const diff = diffSchemas(oldSchema, newSchema);
      const changed =
        diff.added.length > 0 || diff.deprecated.length > 0 || diff.defaultChanged.length > 0;
      return { moduleId, status: changed ? 'changed' : 'unchanged', diff };
    } catch (error) {
      return {
        moduleId,
        status: 'error',
        error: error instanceof SchemaDiffError ? error.message : String(error),
      };
    }
  });
}

/** Human-readable report for pasting into a release PR (plan's own "输出人可读的字段增减报告"). */
export function formatDiffReport(reports: readonly ModuleDiffReport[]): string {
  const lines: string[] = [];
  for (const report of reports) {
    if (report.status === 'added') {
      lines.push(`+ ${report.moduleId} (new module)`);
      continue;
    }
    if (report.status === 'removed') {
      lines.push(`- ${report.moduleId} (removed module)`);
      continue;
    }
    if (report.status === 'error') {
      lines.push(`! ${report.moduleId}: ${report.error}`);
      continue;
    }
    if (report.status === 'unchanged') {
      lines.push(`  ${report.moduleId}: no schema changes`);
      continue;
    }
    lines.push(`~ ${report.moduleId}:`);
    for (const entry of report.diff?.added ?? []) lines.push(`    + added ${entry.path}`);
    for (const entry of report.diff?.deprecated ?? []) lines.push(`    ~ deprecated ${entry.path}`);
    for (const entry of report.diff?.defaultChanged ?? []) {
      lines.push(
        `    ~ default changed ${entry.path}: ${JSON.stringify(entry.oldDefault)} -> ${JSON.stringify(entry.newDefault)}`,
      );
    }
  }
  return lines.join('\n');
}
