import {
  diffSchemas,
  isLossyOperation,
  loadMigrations,
  SchemaDiffError,
  type MigrationPlan,
  type SchemaDiff,
} from '@mcs/migration';
import type { ModuleShapeIssue, SchemaModule } from '@mcs/schema-core';

/** One module's contribution to the upgrade preview — `diff` and `plans` are independent sources (F7/decision table), never derived from one another. */
export interface ModuleUpgradePreview {
  readonly moduleId: string;
  readonly moduleRoot: readonly string[];
  readonly oldVersion: string | null;
  readonly newVersion: string;
  /** `null` when this module has no counterpart in the old bundle (brand new module) — nothing to structurally diff against. */
  readonly diff: SchemaDiff | null;
  /** The ordered chain of migration steps to actually apply, from `oldVersion` to `newVersion` — empty when there is nothing to migrate for this module. */
  readonly plans: readonly MigrationPlan[];
  /** Set when this module's declared `migrations` failed to load (ADR-025 closed opcode set) — its `plans` is empty either way, never a partial/best-effort set. */
  readonly loadIssues: readonly ModuleShapeIssue[];
}

export interface UpgradePreview {
  readonly sameVersion: boolean;
  readonly modules: readonly ModuleUpgradePreview[];
  readonly lossy: boolean;
  /** Set when a module's schema is too deeply nested to diff safely (`SchemaDiffError`, same budget `schema-diff.ts` enforces) — that module's `diff` is `null` and its id lands here instead of throwing out of the whole preview. */
  readonly diffErrors: readonly string[];
}

/**
 * Follows `from → to` links starting at `fromVersion`, greedily — the
 * realistic v0.5.0 case is a single hop, but this handles a project that
 * skipped a release the same way. Stops the moment no plan's `from` matches
 * the current position: no chain found means nothing to migrate for this
 * module, not an error (the module may simply be unchanged).
 */
function resolveMigrationChain(
  plans: readonly MigrationPlan[],
  fromVersion: string,
): MigrationPlan[] {
  const chain: MigrationPlan[] = [];
  const seen = new Set<string>();
  let current = fromVersion;
  for (;;) {
    const next = plans.find((plan) => plan.from === current);
    if (!next || seen.has(next.from)) break; // no further step, or a cycle in authored data
    chain.push(next);
    seen.add(next.from);
    current = next.to;
  }
  return chain;
}

/**
 * Pure, synchronous — both `oldModules`/`newModules` are already-resolved
 * `SchemaModule[]` (ADR-004: `oldModules` is the project's own locked
 * version, never "whatever is active"). Never touches a document; see
 * `apply.ts`'s `applyMigration` for that (decision F7 — this only computes
 * what *would* happen, for the preview).
 */
export function buildUpgradePreview(
  oldModules: readonly SchemaModule[],
  newModules: readonly SchemaModule[],
  oldBundleVersion: string,
  newBundleVersion: string,
): UpgradePreview {
  const oldById = new Map(oldModules.map((module) => [module.manifest.id, module]));
  const moduleIds = [...new Set([...oldById.keys(), ...newModules.map((m) => m.manifest.id)])];

  const modules: ModuleUpgradePreview[] = [];
  const diffErrors: string[] = [];

  for (const moduleId of moduleIds) {
    const oldModule = oldById.get(moduleId);
    const newModule = newModules.find((module) => module.manifest.id === moduleId);
    if (!newModule) continue; // dropped entirely in the new bundle — nothing this UI can preview or migrate

    let diff: SchemaDiff | null = null;
    if (oldModule) {
      try {
        diff = diffSchemas(oldModule.schema, newModule.schema);
      } catch (error) {
        if (error instanceof SchemaDiffError) diffErrors.push(moduleId);
        else throw error;
      }
    }

    const loaded = loadMigrations(newModule);
    const plans =
      loaded.ok && oldModule ? resolveMigrationChain(loaded.plans, oldModule.manifest.version) : [];

    modules.push({
      moduleId,
      moduleRoot: newModule.manifest.root,
      oldVersion: oldModule?.manifest.version ?? null,
      newVersion: newModule.manifest.version,
      diff,
      plans,
      loadIssues: loaded.ok ? [] : loaded.issues,
    });
  }

  return {
    sameVersion: oldBundleVersion === newBundleVersion,
    modules,
    lossy: modules.some((module) => module.plans.some((plan) => plan.lossy)),
    diffErrors,
  };
}

/** Every lossy operation across every module's resolved plan chain, flattened for the confirmation checkbox's own summary. */
export function collectLossyOperationCount(preview: UpgradePreview): number {
  return preview.modules.reduce(
    (total, module) =>
      total +
      module.plans.reduce(
        (subtotal, plan) => subtotal + plan.operations.filter(isLossyOperation).length,
        0,
      ),
    0,
  );
}
