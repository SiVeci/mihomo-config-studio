import type { StorageAdapter } from '@mcs/storage';

export interface ProjectRecord {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly targetProfile: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * ADR-012: the first Stable compatibility profile locks to Mihomo v1.19.29.
 * A full `CompatibilityProfile` model (ADR-012's stated landing spot,
 * `config-model`) does not exist in the codebase yet — building one is not
 * scoped to this slice, so this is the plan's documented fallback: "a
 * well-defined constant export" local to the app that needs the value.
 */
export const DEFAULT_TARGET_PROFILE = 'v1.19.29';

/** Minimal syntactically-valid starting document; #12 replaces this via real import. */
export const DEFAULT_PROJECT_CONFIG_TEXT = 'mode: rule\n';

/**
 * No Schema Bundle is installed in v0.2.0 ("不装任何 Schema 模块" is this
 * release's own closed-loop scenario) — a real bundle version lands once
 * Schema module installation does. `.mcsproj` still needs *some*
 * `schemaLock.bundleVersion` to write (ADR-004), so this is the documented
 * placeholder, same pattern as `DEFAULT_TARGET_PROFILE` above.
 */
export const DEFAULT_BUNDLE_VERSION = 'none';

const PROJECT_PREFIX = 'project/';
const MANIFEST_SUFFIX = '/manifest.json';
const CONFIG_SUFFIX = '/config.yaml';
const IMPORT_BASELINE_SUFFIX = '/import-baseline.yaml';

function manifestKey(id: string): string {
  return `${PROJECT_PREFIX}${id}${MANIFEST_SUFFIX}`;
}

function configKey(id: string): string {
  return `${PROJECT_PREFIX}${id}${CONFIG_SUFFIX}`;
}

function importBaselineKey(id: string): string {
  return `${PROJECT_PREFIX}${id}${IMPORT_BASELINE_SUFFIX}`;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export async function listProjects(adapter: StorageAdapter): Promise<ProjectRecord[]> {
  const keys = await adapter.list(PROJECT_PREFIX);
  const manifestKeys = keys.filter((key) => key.endsWith(MANIFEST_SUFFIX));
  const records = await Promise.all(
    manifestKeys.map(async (key) => {
      const bytes = await adapter.get(key);
      if (!bytes) return null;
      return JSON.parse(decoder.decode(bytes)) as ProjectRecord;
    }),
  );
  return records.filter((record): record is ProjectRecord => record !== null);
}

export async function saveProjectManifest(
  adapter: StorageAdapter,
  record: ProjectRecord,
): Promise<void> {
  await adapter.put(manifestKey(record.id), encoder.encode(JSON.stringify(record)));
}

export async function saveProjectConfigText(
  adapter: StorageAdapter,
  id: string,
  text: string,
): Promise<void> {
  await adapter.put(configKey(id), encoder.encode(text));
}

/** `null` when the project has no stored config yet (should not happen past creation). */
export async function getProjectConfigText(
  adapter: StorageAdapter,
  id: string,
): Promise<string | null> {
  const bytes = await adapter.get(configKey(id));
  return bytes ? decoder.decode(bytes) : null;
}

/**
 * The text as of the last explicit import (or the default template, for a
 * project that was created but never imported into) — a fixed reference
 * point for the "diff against the imported version" baseline (FR-YAML-06),
 * distinct from `config.yaml` itself which changes on every keystroke.
 */
export async function saveImportBaseline(
  adapter: StorageAdapter,
  id: string,
  text: string,
): Promise<void> {
  await adapter.put(importBaselineKey(id), encoder.encode(text));
}

/** `null` for a project created before this baseline existed — callers fall back to treating the current text as its own baseline. */
export async function getImportBaseline(
  adapter: StorageAdapter,
  id: string,
): Promise<string | null> {
  const bytes = await adapter.get(importBaselineKey(id));
  return bytes ? decoder.decode(bytes) : null;
}

export async function deleteProject(adapter: StorageAdapter, id: string): Promise<void> {
  await adapter.delete(manifestKey(id));
  await adapter.delete(configKey(id));
  await adapter.delete(importBaselineKey(id));
}
