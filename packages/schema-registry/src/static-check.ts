import { MIGRATION_OPERATION_KINDS } from '@mcs/migration';

import type { BundleChannel } from './manifest.js';

/**
 * Pure content checks — no filesystem access here (the CLI's own file-walking
 * loop owns reading the source tree; this package only ever sees already-read
 * path/content strings). Allowlist rather than blocklist (FR-UPD-07): only
 * `.json`/`.yaml`/`.md` may ship in a Bundle at all, and `.json` content is
 * additionally walked for values shaped like executable code. This is a
 * mechanical check of the invariant `schema-core/src/types.ts` documents —
 * "there is deliberately no place to put a function, an expression string,
 * or a module specifier" — not a general malware scanner.
 *
 * v0.9.0 #17: relocated here from `tools/schema-cli` so `apps/web`'s upcoming
 * manual community-Bundle import flow (FR-UPD-09) can run the exact same
 * checks the packaging CLI already runs, rather than a second hand-maintained
 * copy. The file was already fs-free before the move — its only Node-specific
 * dependency was `node:path`'s pure `extname`, replaced below with a local
 * equivalent so this package (already consumed directly by `apps/web`) stays
 * entirely free of Node built-ins.
 */
export type StaticCheckIssueCode =
  | 'SCHEMA_CLI_DISALLOWED_EXTENSION'
  | 'SCHEMA_CLI_INVALID_JSON'
  | 'SCHEMA_CLI_EXECUTABLE_CONTENT'
  | 'SCHEMA_CLI_UNKNOWN_MIGRATION_OPCODE'
  | 'SCHEMA_CLI_UNSTABLE_FIELD_IN_STABLE_CHANNEL';

export interface StaticCheckIssue {
  readonly code: StaticCheckIssueCode;
  readonly path: string;
}

/** Minimal pure port of `node:path`'s `extname`: last `.` in the final path segment, excluding a leading dotfile's own dot (`.gitignore` → `''`, matching Node). */
function extname(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dotIndex = base.lastIndexOf('.');
  if (dotIndex <= 0) return '';
  return base.slice(dotIndex);
}

const ALLOWED_EXTENSIONS = new Set(['.json', '.yaml', '.md']);

/** `function name? (` or `function (` — real declaration/expression syntax, not the English word in prose. */
const FUNCTION_DECLARATION_PATTERN = /\bfunction\s*[\w$]*\s*\(/;
/** `(a, b) =>` or `x =>` — arrow function syntax. */
const ARROW_FUNCTION_PATTERN = /(\([^()]*\)|\b[\w$]+)\s*=>/;
/** Direct calls to known code-execution/dynamic-loading entry points. */
const EXECUTION_CALL_PATTERN = /\b(eval|Function|require|import)\s*\(/;
/** A relative path, a `node:`/`npm:` scheme, or a path ending in a native/script extension. */
const MODULE_SPECIFIER_PATTERN = /^(\.{1,2}\/|node:|npm:)|\.(m?js|cjs|wasm|so|dylib|dll)(\?|#|$)/i;

function looksExecutable(value: string): boolean {
  return (
    FUNCTION_DECLARATION_PATTERN.test(value) ||
    ARROW_FUNCTION_PATTERN.test(value) ||
    EXECUTION_CALL_PATTERN.test(value) ||
    MODULE_SPECIFIER_PATTERN.test(value.trim())
  );
}

export function checkExtension(relativePath: string): StaticCheckIssue | null {
  const ext = extname(relativePath).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return { code: 'SCHEMA_CLI_DISALLOWED_EXTENSION', path: relativePath };
  }
  return null;
}

export function checkJsonContent(relativePath: string, jsonText: string): StaticCheckIssue | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return { code: 'SCHEMA_CLI_INVALID_JSON', path: relativePath };
  }
  return (
    findExecutableValue(parsed, relativePath) ?? findUnknownMigrationOpcode(parsed, relativePath)
  );
}

function findExecutableValue(value: unknown, path: string): StaticCheckIssue | null {
  if (typeof value === 'string') {
    return looksExecutable(value) ? { code: 'SCHEMA_CLI_EXECUTABLE_CONTENT', path } : null;
  }
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const issue = findExecutableValue(item, `${path}[${index}]`);
      if (issue) return issue;
    }
    return null;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      const issue = findExecutableValue(child, `${path}.${key}`);
      if (issue) return issue;
    }
    return null;
  }
  return null;
}

const KNOWN_MIGRATION_OPCODES: ReadonlySet<string> = new Set(MIGRATION_OPERATION_KINDS);

/** An object shaped like a migration operation (ADR-025's `{ op, path, ... }`). Only meaningful *inside* a `migrations` subtree — `validation.rules.json`'s `Condition` objects (`condition.ts`) also carry `op`/`path` keys from their own, unrelated closed operator set, so this shape alone is not sufficient signal on its own (real false positive found against the actual shipping built-in modules while building this check: `visibleWhen`/`when` conditions were flagged). */
function looksLikeMigrationOperation(value: unknown): value is { op: unknown } {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    'op' in value &&
    'path' in value &&
    typeof (value as Record<string, unknown>).op === 'string'
  );
}

/**
 * Finds the module's `migrations` key wherever it appears in the tree (a
 * Bundle author could nest it under any file, not just a fixed path) and, once
 * inside that specific subtree, checks every operation-shaped object's `op`
 * against the closed set (ADR-025). Deliberately does **not** apply the
 * opcode check outside a `migrations` subtree — `op`+`path` alone is not
 * unique to migration operations (see `looksLikeMigrationOperation`'s own
 * note). FR-UPD-07's real gap this closes: a declared `{"op": "run-script",
 * ...}` inside `migrations` previously passed static check outright, since it
 * is — on its own — just an ordinary string value, not code.
 */
function findUnknownMigrationOpcode(value: unknown, path: string): StaticCheckIssue | null {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const issue = findUnknownMigrationOpcode(item, `${path}[${index}]`);
      if (issue) return issue;
    }
    return null;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (key === 'migrations') {
        const issue = findUnknownOpcodeWithinMigrations(child, `${path}.${key}`);
        if (issue) return issue;
        continue;
      }
      const issue = findUnknownMigrationOpcode(child, `${path}.${key}`);
      if (issue) return issue;
    }
    return null;
  }
  return null;
}

function findUnknownOpcodeWithinMigrations(value: unknown, path: string): StaticCheckIssue | null {
  if (looksLikeMigrationOperation(value)) {
    const op = value.op as string;
    if (!KNOWN_MIGRATION_OPCODES.has(op)) {
      return { code: 'SCHEMA_CLI_UNKNOWN_MIGRATION_OPCODE', path: `${path}.op` };
    }
  }
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const issue = findUnknownOpcodeWithinMigrations(item, `${path}[${index}]`);
      if (issue) return issue;
    }
    return null;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      const issue = findUnknownOpcodeWithinMigrations(child, `${path}.${key}`);
      if (issue) return issue;
    }
    return null;
  }
  return null;
}

/** Runs both layers for one file; `content` is only parsed as JSON when the extension is `.json`. */
export function checkFile(relativePath: string, content: string): StaticCheckIssue | null {
  const extensionIssue = checkExtension(relativePath);
  if (extensionIssue) return extensionIssue;
  if (extname(relativePath).toLowerCase() === '.json') {
    return checkJsonContent(relativePath, content);
  }
  return null;
}

/** Collects every violation rather than stopping at the first, so a caller can report them all at once. */
export function checkFiles(files: ReadonlyMap<string, string>): StaticCheckIssue[] {
  const issues: StaticCheckIssue[] = [];
  for (const [path, content] of files) {
    const issue = checkFile(path, content);
    if (issue) issues.push(issue);
  }
  return issues;
}

/**
 * ADR-031 / v0.9.0 §6: an Alpha/still-in-development field is marked with a
 * `"x-unstable": true` sibling key wherever it is declared in a module's own
 * JSON files (typically `config.schema.json`, but checked everywhere — a
 * Bundle author could mark it in `ui.schema.json` instead). A Bundle destined
 * for the Stable channel may not carry any such marker at all: Stable is the
 * one channel PRD §13.5's release blockers hold to the full kernel test
 * matrix, so shipping a field nobody has verified there defeats the point of
 * the channel split. `x-unstable` is a plain JSON Schema vendor-extension
 * keyword (the `x-` prefix is exactly what JSON Schema reserves for this) —
 * unknown to every validator in this codebase, so it is otherwise inert; this
 * is the one place that gives it meaning.
 */
export function checkNoUnstableFieldsForChannel(
  files: ReadonlyMap<string, string>,
  channel: BundleChannel,
): StaticCheckIssue[] {
  if (channel !== 'stable') return [];

  const issues: StaticCheckIssue[] = [];
  for (const [path, content] of files) {
    if (extname(path).toLowerCase() !== '.json') continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      continue; // Already reported by checkJsonContent — not this function's concern.
    }
    const issue = findUnstableMarker(parsed, path);
    if (issue) issues.push(issue);
  }
  return issues;
}

function findUnstableMarker(value: unknown, path: string): StaticCheckIssue | null {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const issue = findUnstableMarker(item, `${path}[${index}]`);
      if (issue) return issue;
    }
    return null;
  }
  if (value !== null && typeof value === 'object') {
    if ((value as Record<string, unknown>)['x-unstable'] === true) {
      return { code: 'SCHEMA_CLI_UNSTABLE_FIELD_IN_STABLE_CHANNEL', path };
    }
    for (const [key, child] of Object.entries(value)) {
      const issue = findUnstableMarker(child, `${path}.${key}`);
      if (issue) return issue;
    }
    return null;
  }
  return null;
}
