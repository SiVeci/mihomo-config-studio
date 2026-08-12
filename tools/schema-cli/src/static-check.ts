import { extname } from 'node:path';

/**
 * Pure content checks — no filesystem access here (`pack.ts` owns reading
 * the source tree). Allowlist rather than blocklist (FR-UPD-07): only
 * `.json`/`.yaml`/`.md` may ship in a Bundle at all, and `.json` content is
 * additionally walked for values shaped like executable code. This is a
 * mechanical check of the invariant `schema-core/src/types.ts` documents —
 * "there is deliberately no place to put a function, an expression string,
 * or a module specifier" — not a general malware scanner.
 */
export type StaticCheckIssueCode =
  'SCHEMA_CLI_DISALLOWED_EXTENSION' | 'SCHEMA_CLI_INVALID_JSON' | 'SCHEMA_CLI_EXECUTABLE_CONTENT';

export interface StaticCheckIssue {
  readonly code: StaticCheckIssueCode;
  readonly path: string;
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
  return findExecutableValue(parsed, relativePath);
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
