export { applyMigration, resolveMigrationPath } from './apply.ts';
export type {
  ApplyMigrationErrorCode,
  ApplyMigrationFailure,
  ApplyMigrationOptions,
  ApplyMigrationResult,
  ApplyMigrationSuccess,
  QuarantinedField,
  QuarantineSink,
  SnapshotRecorder,
} from './apply.ts';
export { loadMigrations } from './load.ts';
export type { LoadMigrationsResult } from './load.ts';
export { buildMigrationPlan, isLossyOperation, MIGRATION_OPERATION_KINDS } from './plan.ts';
export { restoreQuarantinedField } from './quarantine.ts';
export { diffSchemas, SchemaDiffError } from './schema-diff.ts';
export type { DefaultChangedEntry, SchemaDiff, SchemaDiffEntry } from './schema-diff.ts';
export type {
  DeprecateFieldOperation,
  MigrationOperation,
  MigrationOperationKind,
  MigrationPlan,
  MigrationPlanInput,
  MigrationWarning,
  MigrationWarningCode,
  MoveFieldOperation,
  NarrowEnumOperation,
  QuarantineFieldOperation,
  RemoveFieldOperation,
  RenameFieldOperation,
  SetDefaultOperation,
} from './plan.ts';
