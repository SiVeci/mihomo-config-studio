import type { ConfigPath, MihomoYamlDocument } from '@mcs/yaml-engine';

import { resolveMigrationPath, type QuarantinedField } from './apply.ts';

export type { QuarantinedField, QuarantineSink } from './apply.ts';

/**
 * Puts a previously-quarantined field's value back into a document, at the
 * same module-root-relative path it was taken from (the inverse of
 * `applyMigration`'s own `quarantine-field` handling, `apply.ts`). This is
 * how "a quarantined field can be fully retrieved" (PRD §9.5 point 6) is
 * actually exercised — quarantining is a move, not a loss, and this
 * function is the other half of that move.
 *
 * Does not itself touch `.mcsproj` or any persistence layer: the caller
 * (`@mcs/project-format`'s `quarantine.json` entry, or a future UI action)
 * owns wherever `QuarantinedField[]` is stored between the quarantine and
 * the restore.
 */
export function restoreQuarantinedField(
  document: MihomoYamlDocument,
  field: QuarantinedField,
  moduleRoot: ConfigPath = [],
): void {
  const path = resolveMigrationPath(document, moduleRoot, field.path);
  document.setIn(path, field.value);
}
