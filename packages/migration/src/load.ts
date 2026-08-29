import type {
  JsonPrimitive,
  MigrationOperationSpec,
  ModuleShapeIssue,
  SchemaModule,
} from '@mcs/schema-core';

import {
  buildMigrationPlan,
  MIGRATION_OPERATION_KINDS,
  type MigrationOperation,
  type MigrationOperationKind,
  type MigrationPlan,
} from './plan.ts';

export type LoadMigrationsResult =
  | { readonly ok: true; readonly plans: readonly MigrationPlan[] }
  | { readonly ok: false; readonly issues: readonly ModuleShapeIssue[] };

/**
 * Converts a `SchemaModule`'s raw, loosely-typed `migrations`
 * (`@mcs/schema-core`'s `MigrationSpec[]`, Bundle content) into real,
 * evaluable `MigrationPlan[]` (this package's own `MigrationOperation`
 * union). All-or-nothing: an unknown opcode or a malformed operation-specific
 * field rejects the *whole module's* migration set, not just the offending
 * operation — a half-usable migration plan is more dangerous than none
 * (PRD §9.5). Independent of `checkMigrations`
 * (`@mcs/schema-core`'s `validateModuleShape`): this function does not
 * assume that check already ran, so it stays correct when called on its own.
 */
export function loadMigrations(module: SchemaModule): LoadMigrationsResult {
  const specs = module.migrations ?? [];
  const issues: ModuleShapeIssue[] = [];
  const plans: MigrationPlan[] = [];

  specs.forEach((spec, specIndex) => {
    const location = `migrations[${specIndex}]`;
    if (spec.from === '') {
      issues.push(missingField(`${location}.from`));
    }
    if (spec.to === '') {
      issues.push(missingField(`${location}.to`));
    }

    const operations: MigrationOperation[] = [];
    spec.operations.forEach((raw, opIndex) => {
      const operation = parseOperation(raw, `${location}.operations[${opIndex}]`, issues);
      if (operation) operations.push(operation);
    });

    plans.push(buildMigrationPlan({ from: spec.from, to: spec.to, operations, warnings: [] }));
  });

  if (issues.length > 0) {
    return { ok: false, issues };
  }
  return { ok: true, plans };
}

function parseOperation(
  raw: MigrationOperationSpec,
  location: string,
  issues: ModuleShapeIssue[],
): MigrationOperation | null {
  if (raw.path === '') {
    issues.push(missingField(`${location}.path`));
    return null;
  }
  if (!(MIGRATION_OPERATION_KINDS as readonly string[]).includes(raw.op)) {
    issues.push(unknownOpcode(`${location}.op`, raw.op));
    return null;
  }
  const op = raw.op as MigrationOperationKind;
  const path = raw.path;

  switch (op) {
    case 'rename-field':
    case 'move-field': {
      if (typeof raw.to !== 'string' || raw.to === '') {
        issues.push(missingField(`${location}.to`));
        return null;
      }
      return { op, path, to: raw.to };
    }
    case 'set-default': {
      if (!isJsonPrimitive(raw.value)) {
        issues.push(invalidValue(`${location}.value`));
        return null;
      }
      return { op, path, value: raw.value };
    }
    case 'deprecate-field': {
      if (typeof raw.sinceVersion !== 'string' || raw.sinceVersion === '') {
        issues.push(missingField(`${location}.sinceVersion`));
        return null;
      }
      if (raw.replacement !== undefined && typeof raw.replacement !== 'string') {
        issues.push(invalidValue(`${location}.replacement`));
        return null;
      }
      return {
        op,
        path,
        sinceVersion: raw.sinceVersion,
        ...(raw.replacement !== undefined ? { replacement: raw.replacement } : {}),
      };
    }
    case 'remove-field':
    case 'quarantine-field':
      return { op, path };
    case 'narrow-enum': {
      if (!Array.isArray(raw.allowed) || !raw.allowed.every(isJsonPrimitive)) {
        issues.push(invalidValue(`${location}.allowed`));
        return null;
      }
      return { op, path, allowed: raw.allowed };
    }
  }
}

function isJsonPrimitive(value: unknown): value is JsonPrimitive {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

function missingField(location: string): ModuleShapeIssue {
  return {
    severity: 'error',
    code: 'migration.load.missingField',
    location,
    messageKey: 'migration.load.missingField',
  };
}

function invalidValue(location: string): ModuleShapeIssue {
  return {
    severity: 'error',
    code: 'migration.load.invalidValue',
    location,
    messageKey: 'migration.load.invalidValue',
  };
}

function unknownOpcode(location: string, op: string): ModuleShapeIssue {
  return {
    severity: 'error',
    code: 'migration.load.unknownOpcode',
    location,
    messageKey: 'migration.load.unknownOpcode',
    messageParams: { op },
  };
}
