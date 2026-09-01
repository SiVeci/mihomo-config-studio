import { ProjectFormatError, readZip, writeZip } from './zip.js';
import type { ZipEntry } from './zip.js';

/**
 * `.mcsproj` container shape (PRD §8.1, `docs/releases/v0.2.0-config-core-and-web-shell.md`).
 * Bumped whenever a future version changes the container shape in a way
 * `readMcsproj` can't transparently absorb.
 */
export const MCSPROJ_FORMAT_VERSION = 1;

const MANIFEST_ENTRY = 'manifest.json';
const CONFIG_ENTRY = 'config.yaml';
const UI_STATE_ENTRY = 'ui-state.json';
const SCHEMA_LOCK_ENTRY = 'schema-lock.json';
const QUARANTINE_ENTRY = 'quarantine.json';
const DISABLED_RULES_ENTRY = 'disabled-rules.json';

export interface McsProjManifest {
  readonly formatVersion: number;
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly targetProfile: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** ADR-004: every project fixes the Bundle version and compatibility profile it was authored against. */
export interface McsProjSchemaLock {
  readonly bundleVersion: string;
  readonly compatibilityProfile: string;
}

/**
 * One field a downgrade migration (`@mcs/migration`'s `quarantine-field`
 * opcode) moved out of `config.yaml` rather than deleting it (PRD §9.5
 * point 6). `value` is the field's actual data — unlike a diagnostic
 * message, a quarantine entry's whole purpose is to hold it, so NFR-SEC-03
 * ("no document values in logs/warnings") does not apply here.
 */
export interface McsProjQuarantinedField {
  readonly path: string;
  readonly value: unknown;
  readonly moduleId: string;
  readonly quarantinedAt: string;
}

export interface McsProjQuarantine {
  readonly fields: readonly McsProjQuarantinedField[];
}

/** FR-VAL-06 (v0.9.0 #15): rule ids (matching `ValidationIssue.code`) this project's own validation has muted — project-level, not global, so opening the same `.mcsproj` on another device sees the same issue list (same reasoning as ADR-004's schema lock). */
export interface McsProjDisabledRules {
  readonly ruleIds: readonly string[];
}

export interface McsProject {
  readonly manifest: McsProjManifest;
  /** Stored and restored verbatim — never re-serialized (M0-1 losslessness must survive the container, too). */
  readonly configText: string;
  /** Opaque, app-owned bag (collapsed-panel state, internal entity IDs, …). No shape is fixed yet in v0.2.0. */
  readonly uiState: Record<string, unknown>;
  readonly schemaLock: McsProjSchemaLock;
  /** Fields moved out of `config.yaml` by a downgrade migration (v0.5.0 #9). Absent in any `.mcsproj` exported before this — `readMcsproj` defaults it to `{ fields: [] }` rather than requiring every existing project to be re-exported. */
  readonly quarantine: McsProjQuarantine;
  /** Absent in any `.mcsproj` exported before v0.9.0 #15 — `readMcsproj` defaults it to `{ ruleIds: [] }`, same backward-compatibility posture as `quarantine`. */
  readonly disabledRules: McsProjDisabledRules;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/**
 * Deep, key-sorted JSON serialisation. Plain `JSON.stringify` follows each
 * object's own insertion order, which depends on how the caller happened to
 * build it — fine for a human, not for the "same project exported twice is
 * byte-identical" contract (D2), especially for `uiState`, an open bag whose
 * key order isn't controlled by this module at all.
 */
function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value), null, 2);
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

function parseJsonEntry(entries: readonly ZipEntry[], path: string): unknown {
  const entry = entries.find((candidate) => candidate.path === path);
  if (!entry) {
    throw new ProjectFormatError(
      'PROJECT_FORMAT_MISSING_ENTRY',
      `Missing "${path}" in the .mcsproj container.`,
    );
  }
  try {
    return JSON.parse(textDecoder.decode(entry.data));
  } catch {
    throw new ProjectFormatError('PROJECT_FORMAT_INVALID_JSON', `"${path}" is not valid JSON.`);
  }
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new ProjectFormatError('PROJECT_FORMAT_INVALID_MANIFEST', `"${field}" must be a string.`);
  }
  return value;
}

function requireNumber(value: unknown, field: string): number {
  if (typeof value !== 'number') {
    throw new ProjectFormatError('PROJECT_FORMAT_INVALID_MANIFEST', `"${field}" must be a number.`);
  }
  return value;
}

function parseManifest(raw: unknown): McsProjManifest {
  if (raw === null || typeof raw !== 'object') {
    throw new ProjectFormatError(
      'PROJECT_FORMAT_INVALID_MANIFEST',
      'manifest.json must be an object.',
    );
  }
  const record = raw as Record<string, unknown>;
  return {
    formatVersion: requireNumber(record.formatVersion, 'formatVersion'),
    id: requireString(record.id, 'id'),
    name: requireString(record.name, 'name'),
    description: requireString(record.description, 'description'),
    targetProfile: requireString(record.targetProfile, 'targetProfile'),
    createdAt: requireString(record.createdAt, 'createdAt'),
    updatedAt: requireString(record.updatedAt, 'updatedAt'),
  };
}

function parseSchemaLock(raw: unknown): McsProjSchemaLock {
  if (raw === null || typeof raw !== 'object') {
    throw new ProjectFormatError(
      'PROJECT_FORMAT_INVALID_MANIFEST',
      'schema-lock.json must be an object.',
    );
  }
  const record = raw as Record<string, unknown>;
  return {
    bundleVersion: requireString(record.bundleVersion, 'bundleVersion'),
    compatibilityProfile: requireString(record.compatibilityProfile, 'compatibilityProfile'),
  };
}

function parseQuarantinedField(raw: unknown, index: number): McsProjQuarantinedField {
  if (raw === null || typeof raw !== 'object') {
    throw new ProjectFormatError(
      'PROJECT_FORMAT_INVALID_MANIFEST',
      `quarantine.fields[${index}] must be an object.`,
    );
  }
  const record = raw as Record<string, unknown>;
  return {
    path: requireString(record.path, `quarantine.fields[${index}].path`),
    value: record.value,
    moduleId: requireString(record.moduleId, `quarantine.fields[${index}].moduleId`),
    quarantinedAt: requireString(record.quarantinedAt, `quarantine.fields[${index}].quarantinedAt`),
  };
}

function parseQuarantine(raw: unknown): McsProjQuarantine {
  if (raw === null || typeof raw !== 'object') {
    throw new ProjectFormatError(
      'PROJECT_FORMAT_INVALID_MANIFEST',
      'quarantine.json must be an object.',
    );
  }
  const record = raw as Record<string, unknown>;
  if (!Array.isArray(record.fields)) {
    throw new ProjectFormatError(
      'PROJECT_FORMAT_INVALID_MANIFEST',
      '"quarantine.fields" must be an array.',
    );
  }
  return { fields: record.fields.map((entry, index) => parseQuarantinedField(entry, index)) };
}

function parseDisabledRules(raw: unknown): McsProjDisabledRules {
  if (raw === null || typeof raw !== 'object') {
    throw new ProjectFormatError(
      'PROJECT_FORMAT_INVALID_MANIFEST',
      'disabled-rules.json must be an object.',
    );
  }
  const record = raw as Record<string, unknown>;
  if (!Array.isArray(record.ruleIds) || record.ruleIds.some((id) => typeof id !== 'string')) {
    throw new ProjectFormatError(
      'PROJECT_FORMAT_INVALID_MANIFEST',
      '"disabledRules.ruleIds" must be an array of strings.',
    );
  }
  return { ruleIds: record.ruleIds as string[] };
}

function parseUiState(raw: unknown): Record<string, unknown> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ProjectFormatError(
      'PROJECT_FORMAT_INVALID_MANIFEST',
      'ui-state.json must be an object.',
    );
  }
  return raw as Record<string, unknown>;
}

/** Fixed write order is part of the deterministic-byte-output contract (see zip.ts, ADR-018). */
export async function writeMcsproj(project: McsProject): Promise<Uint8Array> {
  const entries: ZipEntry[] = [
    { path: MANIFEST_ENTRY, data: textEncoder.encode(stableStringify(project.manifest)) },
    { path: CONFIG_ENTRY, data: textEncoder.encode(project.configText) },
    { path: UI_STATE_ENTRY, data: textEncoder.encode(stableStringify(project.uiState)) },
    { path: SCHEMA_LOCK_ENTRY, data: textEncoder.encode(stableStringify(project.schemaLock)) },
    { path: QUARANTINE_ENTRY, data: textEncoder.encode(stableStringify(project.quarantine)) },
    {
      path: DISABLED_RULES_ENTRY,
      data: textEncoder.encode(stableStringify(project.disabledRules)),
    },
  ];
  return writeZip(entries);
}

export async function readMcsproj(bytes: Uint8Array): Promise<McsProject> {
  const entries = await readZip(bytes);
  const configEntry = entries.find((entry) => entry.path === CONFIG_ENTRY);
  if (!configEntry) {
    throw new ProjectFormatError(
      'PROJECT_FORMAT_MISSING_ENTRY',
      `Missing "${CONFIG_ENTRY}" in the .mcsproj container.`,
    );
  }
  // Absent in any .mcsproj exported before v0.5.0 #9 — defaulting rather
  // than requiring the entry keeps every previously-exported project
  // readable, the same backward-compatibility posture PRD §9.5 point 3
  // already requires of the app as a whole.
  const quarantineEntry = entries.find((entry) => entry.path === QUARANTINE_ENTRY);
  const quarantine = quarantineEntry
    ? parseQuarantine(parseJsonEntry(entries, QUARANTINE_ENTRY))
    : { fields: [] };

  // Same backward-compatibility posture as quarantine above — absent in any
  // .mcsproj exported before v0.9.0 #15.
  const disabledRulesEntry = entries.find((entry) => entry.path === DISABLED_RULES_ENTRY);
  const disabledRules = disabledRulesEntry
    ? parseDisabledRules(parseJsonEntry(entries, DISABLED_RULES_ENTRY))
    : { ruleIds: [] };

  return {
    manifest: parseManifest(parseJsonEntry(entries, MANIFEST_ENTRY)),
    configText: textDecoder.decode(configEntry.data),
    uiState: parseUiState(parseJsonEntry(entries, UI_STATE_ENTRY)),
    schemaLock: parseSchemaLock(parseJsonEntry(entries, SCHEMA_LOCK_ENTRY)),
    quarantine,
    disabledRules,
  };
}

export type SensitivityKind = 'subscription-url' | 'password' | 'uuid' | 'private-key';

export interface SensitivityFinding {
  readonly segment: 'config.yaml';
  readonly kind: SensitivityKind;
}

// `(?:-[^\S\r\n]+)?` optionally absorbs a YAML list item's `-` marker: the
// key under scrutiny is often the first key of a list entry (each `proxies`
// item is one list item, and `password`/`url` etc. commonly appear right
// after its own `-`), not always a nested key on its own indented line.
const SENSITIVE_KEY_LINE =
  /^[^\S\r\n]*(?:-[^\S\r\n]+)?(password|passwd|secret|token|psk|auth-?str|private-?key|client-?secret|credential|ca-?str)\s*:/im;
const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
const PRIVATE_KEY_BLOCK = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;
const SUBSCRIPTION_URL_LINE = /^[^\S\r\n]*(?:-[^\S\r\n]+)?url\s*:\s*["']?https?:\/\//im;

/**
 * Structural-only determination of which `.mcsproj` segments *might* carry
 * sensitive data — never returns the matched text itself (NFR-SEC-03).
 * Copy for the export-time warning is #15's job (i18n key, not this
 * package). Heuristic and intentionally over-eager: false positives just
 * mean an unnecessary warning, false negatives mean a leaked secret, so
 * this errs toward flagging (same stance as `schema-core`'s credential-shaped
 * key masking, NFR-SEC-02).
 */
export function describeSensitivity(project: McsProject): SensitivityFinding[] {
  const findings: SensitivityFinding[] = [];
  const text = project.configText;
  if (SUBSCRIPTION_URL_LINE.test(text))
    findings.push({ segment: 'config.yaml', kind: 'subscription-url' });
  if (SENSITIVE_KEY_LINE.test(text)) findings.push({ segment: 'config.yaml', kind: 'password' });
  if (UUID_PATTERN.test(text)) findings.push({ segment: 'config.yaml', kind: 'uuid' });
  if (PRIVATE_KEY_BLOCK.test(text)) findings.push({ segment: 'config.yaml', kind: 'private-key' });
  return findings;
}
