import type { JsonPrimitive, SchemaIssue } from '@mcs/schema-core';
import type {
  ConfigPath,
  IssueSeverity,
  MessageParams,
  TextRange,
  YamlIssue,
} from '@mcs/yaml-engine';

/**
 * Kernel-level producers that are not a Schema module. A Schema module
 * instead reports its own `ModuleManifest.id` as `module`; `reference` and
 * `security` stages are wired up in v0.3.0/v0.4.0 (see the pipeline in
 * `pipeline.ts`), but the module id is reserved here so producers agree on it
 * from day one.
 */
export const KERNEL_MODULES = ['yaml', 'reference', 'security'] as const;
export type KernelModule = (typeof KERNEL_MODULES)[number];

/**
 * A declarative patch suggestion, never anything executable (ADR-002,
 * FR-UPD-07). `value` may only be a Schema-declared constant — the field's
 * `default`, one of its `enum` options, or its `const` — and must never echo
 * back the value that failed validation (NFR-SEC-03). For `rename`, `value`
 * carries the proposed key name instead of a scalar value.
 */
export interface IssueFix {
  kind: 'set-scalar' | 'remove' | 'rename' | 'append';
  path: ConfigPath;
  value?: JsonPrimitive;
}

/**
 * The single issue shape the UI consumes, unifying `YamlIssue` (syntax layer)
 * and `SchemaIssue` (structural layer) with the fields PRD §8.7 needs that
 * neither producer alone can supply: `module`, a located `range`, and an
 * optional `fix` (FR-VAL-01).
 */
export interface ValidationIssue {
  severity: IssueSeverity;
  code: string;
  /** Producer identity: a Schema module id, or a kernel stage from `KERNEL_MODULES`. */
  module: string;
  messageKey: string;
  messageParams?: MessageParams;
  path?: ConfigPath;
  range?: TextRange;
  fix?: IssueFix;
  /**
   * Whether this issue alone must block export. The pipeline's
   * `hasBlockingIssues` (see `pipeline.ts`) just folds this over the whole
   * array — the per-issue rule lives here so every producer computes it the
   * same way.
   */
  blocking: boolean;
}

/**
 * Resolves a document path to its text span. `MihomoYamlDocument` satisfies
 * this structurally, but tests and future callers are not forced to
 * construct a real document just to supply a range.
 */
export interface RangeLocator {
  locate(path: ConfigPath): TextRange | null;
}

function isBlocking(severity: IssueSeverity): boolean {
  return severity === 'error';
}

/**
 * Widen a `YamlIssue` into a `ValidationIssue`. Never carries a `fix`: a
 * syntax problem is fixed by editing text, not by a declarative patch.
 */
export function fromYamlIssue(issue: YamlIssue, module: KernelModule = 'yaml'): ValidationIssue {
  return {
    severity: issue.severity,
    code: issue.code,
    module,
    messageKey: issue.messageKey,
    ...(issue.messageParams !== undefined ? { messageParams: issue.messageParams } : {}),
    ...(issue.path !== undefined ? { path: issue.path } : {}),
    ...(issue.range !== undefined ? { range: issue.range } : {}),
    blocking: isBlocking(issue.severity),
  };
}

export interface SchemaIssueAdapterOptions {
  /** The Schema module id this issue belongs to (or a kernel stage for schema-less checks). */
  module: string;
  /** Supplies `range` by locating `issue.path`; omit when no document is available. */
  locator?: RangeLocator;
}

/**
 * Widen a `SchemaIssue` into a `ValidationIssue`. `schema-core` only ever
 * sees a plain JS value, never the source document, so `range` is filled in
 * here via `locator.locate(path)` instead of inside `schema-core` — that
 * keeps the dependency direction document -> validator rather than making
 * schema-core depend on `MihomoYamlDocument`.
 */
export function fromSchemaIssue(
  issue: SchemaIssue,
  options: SchemaIssueAdapterOptions,
): ValidationIssue {
  const range = options.locator?.locate(issue.path) ?? undefined;
  const fix = deriveFix(issue);
  return {
    severity: issue.severity,
    code: issue.code,
    module: options.module,
    messageKey: issue.messageKey,
    ...(issue.messageParams !== undefined ? { messageParams: issue.messageParams } : {}),
    path: issue.path,
    ...(range !== undefined ? { range } : {}),
    ...(fix !== undefined ? { fix } : {}),
    blocking: isBlocking(issue.severity),
  };
}

/**
 * Suggest a fix using only already-vetted-safe data: the issue `code` and the
 * Schema constants already carried in `messageParams` (see `validate.ts`'s
 * `push`). Never reads the value that failed validation, so it structurally
 * cannot echo it back (NFR-SEC-03) — there is no code path here that touches
 * anything but schema-declared constants.
 */
function deriveFix(issue: SchemaIssue): IssueFix | undefined {
  const params = issue.messageParams;
  if (!params) return undefined;

  if (issue.code === 'schema.enum') {
    const allowed = params.allowed;
    const first = Array.isArray(allowed) ? allowed[0] : undefined;
    return isJsonPrimitive(first)
      ? { kind: 'set-scalar', path: issue.path, value: first }
      : undefined;
  }
  if (issue.code === 'schema.const') {
    const expected = params.expected;
    return isJsonPrimitive(expected)
      ? { kind: 'set-scalar', path: issue.path, value: expected }
      : undefined;
  }
  if (issue.code === 'schema.additionalProperties') {
    return { kind: 'remove', path: issue.path };
  }
  return undefined;
}

function isJsonPrimitive(value: unknown): value is JsonPrimitive {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}
