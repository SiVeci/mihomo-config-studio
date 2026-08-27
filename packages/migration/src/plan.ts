import type { JsonPrimitive } from '@mcs/schema-core';

/**
 * The closed set of migration operation codes (ADR-025, ADR-002's "Bundle
 * cannot introduce new opcodes"). A Bundle's `migrations/*.json` can only
 * ever combine these seven — the same "封闭操作码集合，由应用代码解释执行"
 * shape `condition.ts` already uses for `Condition.op`. Loading a raw
 * `migrations/*.json` and rejecting anything outside this set is #6's job
 * (`load.ts`); this file only defines the shape and the derived judgements
 * (`isLossyOperation`, `buildMigrationPlan`) — no evaluator lives here yet
 * (that is #8's `apply.ts`).
 */
export const MIGRATION_OPERATION_KINDS = [
  'rename-field',
  'move-field',
  'set-default',
  'deprecate-field',
  'remove-field',
  'narrow-enum',
  'quarantine-field',
] as const;

export type MigrationOperationKind = (typeof MIGRATION_OPERATION_KINDS)[number];

interface MigrationOperationBase {
  /** Dot-path into the module's document scope, same addressing as `Condition.path` (`$.` for the module root). */
  readonly path: string;
}

/** Old path → new path at the same nesting level; the value moves unchanged. */
export interface RenameFieldOperation extends MigrationOperationBase {
  readonly op: 'rename-field';
  readonly to: string;
}

/** Old path → new path, potentially at a different nesting level; the value moves unchanged. */
export interface MoveFieldOperation extends MigrationOperationBase {
  readonly op: 'move-field';
  readonly to: string;
}

/** Fills in the Schema's new default only when the field is absent — never overwrites an existing value. */
export interface SetDefaultOperation extends MigrationOperationBase {
  readonly op: 'set-default';
  readonly value: JsonPrimitive;
}

/** Marked deprecated but still displayed and exported (PRD §9.5 point 5) — this operation itself changes nothing. */
export interface DeprecateFieldOperation extends MigrationOperationBase {
  readonly op: 'deprecate-field';
  readonly sinceVersion: string;
  /** Path of the field that replaces this one, if any. */
  readonly replacement?: string;
}

/** The field and its value are dropped entirely — lossy. */
export interface RemoveFieldOperation extends MigrationOperationBase {
  readonly op: 'remove-field';
}

/** The set of values the field may hold shrinks; a current value outside the new set cannot be expressed — lossy. */
export interface NarrowEnumOperation extends MigrationOperationBase {
  readonly op: 'narrow-enum';
  readonly allowed: readonly JsonPrimitive[];
}

/** Moves the field's value into the project's quarantine area (#9) rather than deleting it — not lossy, the value survives. */
export interface QuarantineFieldOperation extends MigrationOperationBase {
  readonly op: 'quarantine-field';
}

export type MigrationOperation =
  | RenameFieldOperation
  | MoveFieldOperation
  | SetDefaultOperation
  | DeprecateFieldOperation
  | RemoveFieldOperation
  | NarrowEnumOperation
  | QuarantineFieldOperation;

const LOSSY_OPERATION_KINDS: ReadonlySet<MigrationOperationKind> = new Set([
  'remove-field',
  'narrow-enum',
]);

/** Whether one operation can, by itself, make a value unrepresentable after migration. */
export function isLossyOperation(operation: MigrationOperation): boolean {
  return LOSSY_OPERATION_KINDS.has(operation.op);
}

export type MigrationWarningCode =
  'FIELD_REMOVED' | 'ENUM_NARROWED' | 'FIELD_QUARANTINED' | 'FIELD_DEPRECATED';

/**
 * Never carries a value read from the user's document — only structural
 * identifiers (a path, a field name, a Schema-declared constant such as an
 * enum's allowed values). This is the same "names not values" line
 * `ModuleShapeIssue`/`ValidationIssue` already draw (NFR-SEC-03); migration
 * warnings are a higher-risk surface than most, since they exist
 * specifically to describe what happens to the user's own configuration.
 */
export interface MigrationWarning {
  readonly code: MigrationWarningCode;
  readonly path: string;
  readonly messageParams?: Readonly<Record<string, string>>;
}

export interface MigrationPlanInput {
  /** Source module version (`ModuleManifest.version`), not the Bundle version — modules evolve independently. */
  readonly from: string;
  readonly to: string;
  readonly operations: readonly MigrationOperation[];
  readonly warnings: readonly MigrationWarning[];
}

export interface MigrationPlan extends MigrationPlanInput {
  /**
   * Computed, never authored: `lossy === operations.some(isLossyOperation)`.
   * A Bundle declaring `lossy: false` while its own `operations` contain a
   * `remove-field` would hand the NFR-REL-01 gate to untrusted data — there
   * is deliberately no code path that constructs a `MigrationPlan` from a
   * caller-supplied `lossy` value.
   */
  readonly lossy: boolean;
}

/** The only way to produce a `MigrationPlan` — `lossy` is always derived, never passed in. */
export function buildMigrationPlan(input: MigrationPlanInput): MigrationPlan {
  return { ...input, lossy: input.operations.some(isLossyOperation) };
}
