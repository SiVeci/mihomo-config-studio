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

const PROJECT_PREFIX = 'project/';
const MANIFEST_SUFFIX = '/manifest.json';
const CONFIG_SUFFIX = '/config.yaml';

function manifestKey(id: string): string {
  return `${PROJECT_PREFIX}${id}${MANIFEST_SUFFIX}`;
}

function configKey(id: string): string {
  return `${PROJECT_PREFIX}${id}${CONFIG_SUFFIX}`;
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

export async function deleteProject(adapter: StorageAdapter, id: string): Promise<void> {
  await adapter.delete(manifestKey(id));
  await adapter.delete(configKey(id));
}
