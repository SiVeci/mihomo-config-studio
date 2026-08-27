import type { SnapshotDegradationSignal } from '@mcs/storage';
import { MihomoYamlDocument, type ConfigPath, type PathSegment } from '@mcs/yaml-engine';

import type { MigrationOperation, MigrationPlan, MigrationWarning } from './plan.js';

/** Records a pre-migration snapshot. The concrete adapter/quota policy is `@mcs/storage`'s `SnapshotManager` concern, not this package's. */
export interface SnapshotRecorder {
  record(content: Uint8Array): Promise<SnapshotDegradationSignal>;
}

export interface ApplyMigrationOptions {
  /**
   * Required when `plan.lossy === true` (decision F7's Lossy gate); ignored
   * for a non-lossy plan. A lossy plan without this set to `true` is
   * refused outright — not executed with the lossy operations silently
   * skipped, which would produce a half-migrated document the user never
   * previewed as such.
   */
  readonly confirmedLossy?: boolean;
  readonly snapshots: SnapshotRecorder;
  /**
   * The module's own document root (`ModuleManifest.root`, e.g. `['dns']`),
   * empty for a module that owns the document root directly (`general`).
   * `MigrationOperation.path` is relative to this, the same convention
   * `Condition.path` uses for a module's own field addressing.
   */
  readonly moduleRoot?: ConfigPath;
  /**
   * Where a `quarantine-field` operation deposits the field's value (v0.5.0
   * #9). Omitted entirely, `quarantine-field` falls back to a no-op — the
   * field stays in the document rather than being deleted with nowhere to
   * put it (PRD §9.5 point 6: never a silent delete). `packages/migration`
   * has no opinion on where a quarantined value ultimately lives (that's
   * `.mcsproj`'s `quarantine.json`, `@mcs/project-format`'s concern); this
   * is only the injection point.
   */
  readonly quarantine?: QuarantineSink;
}

/** Where `applyMigration` deposits a field's value when a `quarantine-field` operation fires (v0.5.0 #9). */
export interface QuarantinedField {
  readonly path: string;
  readonly value: unknown;
}

export interface QuarantineSink {
  quarantine(field: QuarantinedField): void;
}

export type ApplyMigrationErrorCode =
  'MIGRATION_LOSSY_NOT_CONFIRMED' | 'MIGRATION_SNAPSHOT_FAILED' | 'MIGRATION_OPERATION_FAILED';

export interface ApplyMigrationFailure {
  readonly ok: false;
  readonly code: ApplyMigrationErrorCode;
  /** The operation's own path, when the failure is operation-specific (`MIGRATION_OPERATION_FAILED`). */
  readonly path?: string;
  /** Always the pre-migration document, byte-identical to the input — a failed migration never leaves a partial edit in place. */
  readonly document: MihomoYamlDocument;
}

export interface ApplyMigrationSuccess {
  readonly ok: true;
  readonly document: MihomoYamlDocument;
  readonly warnings: readonly MigrationWarning[];
}

export type ApplyMigrationResult = ApplyMigrationSuccess | ApplyMigrationFailure;

/**
 * The only function that writes a migration's effects into a real document
 * (decision F7): there is no other path from "source document + migration
 * rules" to an edited document anywhere in this package. The UI (#11)
 * renders `plan.operations` for preview and passes that exact same `plan`
 * object here to execute — never a re-derived one.
 *
 * Always returns a `document` — on failure it is the pre-migration document
 * (same text, not necessarily the same object identity if a partial batch
 * had to be undone), never a partially-migrated one; the caller must use
 * the returned `document`, not assume the input reference is still current.
 */
export async function applyMigration(
  plan: MigrationPlan,
  document: MihomoYamlDocument,
  options: ApplyMigrationOptions,
): Promise<ApplyMigrationResult> {
  if (plan.lossy && options.confirmedLossy !== true) {
    return { ok: false, code: 'MIGRATION_LOSSY_NOT_CONFIRMED', document };
  }

  const moduleRoot = options.moduleRoot ?? [];
  const beforeText = document.toText();

  let signal: SnapshotDegradationSignal;
  try {
    signal = await options.snapshots.record(new TextEncoder().encode(beforeText));
  } catch {
    return { ok: false, code: 'MIGRATION_SNAPSHOT_FAILED', document };
  }
  // 'stopped' means the snapshot ultimately was not stored anywhere (NFR-REL-01):
  // treated the same as a thrown failure, not a soft degradation to proceed past.
  if (signal.level === 'stopped') {
    return { ok: false, code: 'MIGRATION_SNAPSHOT_FAILED', document };
  }

  const warnings: MigrationWarning[] = [];
  for (const operation of plan.operations) {
    try {
      applyOperation(document, moduleRoot, operation, warnings, options.quarantine);
    } catch {
      return {
        ok: false,
        code: 'MIGRATION_OPERATION_FAILED',
        path: operation.path,
        document: MihomoYamlDocument.parse(beforeText).document!,
      };
    }
  }

  return { ok: true, document, warnings };
}

function applyOperation(
  document: MihomoYamlDocument,
  moduleRoot: ConfigPath,
  operation: MigrationOperation,
  warnings: MigrationWarning[],
  quarantine: QuarantineSink | undefined,
): void {
  const path = resolveMigrationPath(document, moduleRoot, operation.path);
  const exists = document.hasIn(path);

  switch (operation.op) {
    case 'rename-field': {
      if (!exists || path.length === 0) return;
      const parent = path.slice(0, -1);
      const oldKey = path[path.length - 1];
      const newKey = lastSegment(operation.to);
      if (typeof oldKey !== 'string' || newKey === undefined) return;
      document.renameKeyIn(parent, oldKey, newKey);
      return;
    }
    case 'move-field': {
      if (!exists) return;
      const value = document.getIn(path);
      const toPath = resolveMigrationPath(document, moduleRoot, operation.to);
      document.setIn(toPath, value);
      document.deleteIn(path);
      return;
    }
    case 'set-default': {
      if (exists) return;
      document.setIn(path, operation.value);
      return;
    }
    case 'deprecate-field': {
      if (!exists) return;
      warnings.push({ code: 'FIELD_DEPRECATED', path: operation.path });
      return;
    }
    case 'remove-field': {
      if (!exists) return;
      document.deleteIn(path);
      return;
    }
    case 'narrow-enum': {
      if (!exists) return;
      const currentValue = document.getIn(path);
      const stillAllowed = operation.allowed.some(
        (allowed) => String(allowed) === String(currentValue),
      );
      // The value is deliberately left in place either way — PRD §9.5's
      // "retain + warn" posture, not additionalProperties:false-style
      // rejection. Narrowing only means the value can no longer be
      // re-selected going forward, not that it is deleted now.
      if (!stillAllowed) {
        warnings.push({ code: 'ENUM_NARROWED', path: operation.path });
      }
      return;
    }
    case 'quarantine-field': {
      if (!exists) return;
      if (!quarantine) {
        // No sink injected: leave the field in the document rather than
        // deleting it with nowhere to put it (PRD §9.5 point 6).
        return;
      }
      const value = document.getIn(path);
      quarantine.quarantine({ path: operation.path, value });
      document.deleteIn(path);
      warnings.push({ code: 'FIELD_QUARANTINED', path: operation.path });
      return;
    }
  }
}

/**
 * `MigrationOperation.path` is relative to the module's own root;
 * array-vs-object-key for a numeric-looking segment can only be decided by
 * walking the live document. Exported for `quarantine.ts`'s
 * `restoreQuarantinedField`, which needs the exact same resolution to write
 * a value back to where it came from.
 */
export function resolveMigrationPath(
  document: MihomoYamlDocument,
  moduleRoot: ConfigPath,
  dotPath: string,
): ConfigPath {
  const segments = dotPath.split('.').filter((segment) => segment !== '');
  const resolved: PathSegment[] = [...moduleRoot];
  for (const segment of segments) {
    const container = document.getIn(resolved);
    if (Array.isArray(container) && /^\d+$/.test(segment)) {
      resolved.push(Number(segment));
    } else {
      resolved.push(segment);
    }
  }
  return resolved;
}

function lastSegment(dotPath: string): string | undefined {
  const segments = dotPath.split('.').filter((segment) => segment !== '');
  return segments[segments.length - 1];
}
