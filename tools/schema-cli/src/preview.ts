import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildFormPlan,
  type ControlType,
  type JsonPrimitive,
  type JsonSchema,
  type ModuleManifest,
  type PlannedField,
  type SchemaModule,
  type UiSchema,
} from '@mcs/schema-core';
import { formatPath, pathsEqual, type ConfigPath } from '@mcs/yaml-engine';

const MANIFEST_FILE = 'module.manifest.json';
const CONFIG_SCHEMA_FILE = 'config.schema.json';
const UI_SCHEMA_FILE = 'ui.schema.json';

export type LoadModuleResult =
  | { readonly ok: true; readonly module: SchemaModule }
  | { readonly ok: false; readonly error: string };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readJsonFile(
  dir: string,
  fileName: string,
): { ok: true; value: unknown } | { ok: false; error: string } {
  let text: string;
  try {
    text = readFileSync(join(dir, fileName), 'utf8');
  } catch (error) {
    return { ok: false, error: `failed to read ${fileName}: ${errorMessage(error)}` };
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (error) {
    return { ok: false, error: `${fileName} is not valid JSON: ${errorMessage(error)}` };
  }
}

/**
 * Reads a module's three source files off disk — the same
 * `module.manifest.json`/`config.schema.json`/`ui.schema.json` layout
 * `packages/schema-builtin/modules/*` and `diff.ts` already use — into a
 * real `SchemaModule`. Deliberately does not read `validation.rules.json`,
 * `examples/` or `i18n/`: `buildFormPlan` never looks at them, and this
 * tool only ever calls that one function.
 */
export function loadModuleFromDirectory(moduleDir: string): LoadModuleResult {
  const manifestResult = readJsonFile(moduleDir, MANIFEST_FILE);
  if (!manifestResult.ok) return manifestResult;
  const schemaResult = readJsonFile(moduleDir, CONFIG_SCHEMA_FILE);
  if (!schemaResult.ok) return schemaResult;
  const uiResult = readJsonFile(moduleDir, UI_SCHEMA_FILE);
  if (!uiResult.ok) return uiResult;

  return {
    ok: true,
    module: {
      manifest: manifestResult.value as ModuleManifest,
      schema: schemaResult.value as JsonSchema,
      ui: uiResult.value as UiSchema,
    },
  };
}

export interface PreviewVariantBranch {
  readonly value: JsonPrimitive;
  readonly label?: string;
  readonly fields: readonly PreviewFieldReport[];
}

export interface PreviewFieldReport {
  readonly path: string;
  readonly type: string;
  readonly control: ControlType;
  readonly required: boolean;
  readonly sensitive: boolean;
  readonly visible: boolean;
  readonly deprecated: boolean;
  readonly children?: readonly PreviewFieldReport[];
  readonly variantBranches?: readonly PreviewVariantBranch[];
}

export interface ModulePreview {
  readonly moduleId: string;
  readonly fields: readonly PreviewFieldReport[];
}

function schemaTypeLabel(schema: JsonSchema): string {
  if (Array.isArray(schema.type)) return schema.type.join('|');
  return schema.type ?? 'unknown';
}

/** Immutable "set a value at a path", for building the synthetic per-branch documents below — a plain-object equivalent of the YAML engine's own surgical patch, not a YAML concern here since preview never touches real document text. */
function setAtPath(root: unknown, path: ConfigPath, value: unknown): unknown {
  if (path.length === 0) return value;
  const [head, ...rest] = path;
  if (head === undefined) return value;
  if (typeof head === 'number') {
    const array = Array.isArray(root) ? [...root] : [];
    array[head] = setAtPath(array[head], rest, value);
    return array;
  }
  const record =
    root !== null && typeof root === 'object' && !Array.isArray(root)
      ? { ...(root as Record<string, unknown>) }
      : {};
  record[head] = setAtPath(record[head], rest, value);
  return record;
}

function findFieldByPath(
  fields: readonly PlannedField[],
  path: ConfigPath,
): PlannedField | undefined {
  return fields.find((field) => pathsEqual(field.path, path));
}

/**
 * `buildFormPlan` never invents data to make an unmatched variant branch
 * "fit" (E4) — a single plan only ever shows the currently-selected branch's
 * children, if any. So each of a `variant` field's own declared options is
 * separately re-planned with the discriminator set to that option's value,
 * and that branch's children recurse from *that* plan — never a
 * hand-rolled second interpretation of the schema. This is also why nested
 * variants work: the branch's own synthetic document carries its ancestor's
 * discriminator choice forward into the next `buildFormPlan` call.
 */
function expandField(
  module: SchemaModule,
  document: unknown,
  field: PlannedField,
): PreviewFieldReport {
  const base: PreviewFieldReport = {
    path: formatPath(field.path),
    type: schemaTypeLabel(field.schema),
    control: field.control,
    required: field.required,
    sensitive: field.sensitive,
    visible: field.visible,
    deprecated: field.deprecated,
  };

  if (field.control === 'variant' && field.variant) {
    const variant = field.variant;
    const variantBranches: PreviewVariantBranch[] = variant.options.map((option) => {
      const branchDocument = setAtPath(document, variant.discriminatorPath, option.value);
      const branchPlan = buildFormPlan(module, branchDocument);
      const branchField = findFieldByPath(branchPlan.fields, field.path);
      const branchChildren = branchField?.children ?? [];
      return {
        value: option.value,
        ...(option.label !== undefined ? { label: option.label } : {}),
        fields: branchChildren.map((child) => expandField(module, branchDocument, child)),
      };
    });
    return { ...base, variantBranches };
  }

  if (field.children && field.children.length > 0) {
    return {
      ...base,
      children: field.children.map((child) => expandField(module, document, child)),
    };
  }

  return base;
}

/**
 * Renders exactly what the real app would render for this module against a
 * blank document — a contributor previewing a Schema wants to know what a
 * field becomes structurally (control/required/masked/visible), not one
 * project's data. Reuses the top-level, still-nested field list
 * `buildFormPlan`'s own `groups` already carry (not `FormPlan.fields`, which
 * is deliberately re-flattened for the renderer and would double-report
 * every child here).
 */
export function buildModulePreview(module: SchemaModule): ModulePreview {
  const basePlan = buildFormPlan(module, {});
  const topLevelFields = basePlan.groups.flatMap((group) => group.fields);
  return {
    moduleId: module.manifest.id,
    fields: topLevelFields.map((field) => expandField(module, {}, field)),
  };
}

function fieldFlags(field: PreviewFieldReport): string {
  const flags: string[] = [];
  if (field.required) flags.push('required');
  if (field.sensitive) flags.push('sensitive');
  if (field.deprecated) flags.push('deprecated');
  if (!field.visible) flags.push('hidden');
  return flags.length > 0 ? ` [${flags.join(', ')}]` : '';
}

function renderFieldLines(field: PreviewFieldReport, depth: number, lines: string[]): void {
  const indent = '  '.repeat(depth);
  lines.push(
    `${indent}${field.path}  type=${field.type} control=${field.control}${fieldFlags(field)}`,
  );
  for (const child of field.children ?? []) renderFieldLines(child, depth + 1, lines);
  for (const branch of field.variantBranches ?? []) {
    lines.push(`${indent}  variant: ${branch.label ?? JSON.stringify(branch.value)}`);
    for (const child of branch.fields) renderFieldLines(child, depth + 2, lines);
  }
}

/** Plain text to stdout, one field per line (FR-SCHEMA-07) — no HTML, no server: a contributor reading a terminal already has everything this needs. */
export function renderModulePreviewText(preview: ModulePreview): string {
  const lines: string[] = [`module: ${preview.moduleId}`];
  for (const field of preview.fields) renderFieldLines(field, 0, lines);
  return lines.join('\n');
}
