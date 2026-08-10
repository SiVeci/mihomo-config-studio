import type { ConfigPath } from '@mcs/yaml-engine';

import { evaluateCondition, type ConditionContext } from './condition.js';
import { resolveRef } from './ref.js';
import type {
  ControlType,
  JsonSchema,
  Platform,
  SchemaModule,
  UiFieldSpec,
  UiGroup,
} from './types.js';

export type FormMode = 'basic' | 'advanced';

export interface FormPlanOptions {
  mode?: FormMode;
  /** Fields restricted to other platforms are hidden but never removed. */
  platform?: Platform;
}

export interface PlannedField {
  key: string;
  /** Absolute path inside the Mihomo document, ready for the YAML engine. */
  path: ConfigPath;
  control: ControlType;
  schema: JsonSchema;
  ui: UiFieldSpec;
  value: unknown;
  /** Present in the document (as opposed to falling back to a schema default). */
  present: boolean;
  visible: boolean;
  required: boolean;
  readOnly: boolean;
  sensitive: boolean;
  deprecated: boolean;
  /** True for a value the schema does not describe (FR-VAL-05, FR-YAML-02). */
  unknown: boolean;
  group: string;
  enumValues?: readonly unknown[];
  children?: PlannedField[];
}

export interface PlannedGroup {
  id: string;
  label: string;
  order: number;
  advanced: boolean;
  collapsedByDefault: boolean;
  fields: PlannedField[];
}

export interface FormPlan {
  moduleId: string;
  groups: PlannedGroup[];
  /** Flattened, in render order, including nested children. */
  fields: PlannedField[];
  unknownFields: PlannedField[];
}

const DEFAULT_GROUP: UiGroup = { id: 'general', label: 'group.general', order: 0 };

/**
 * Credential-shaped names get masked even when a bundle forgets to mark them.
 * A false positive only adds a "reveal" click; a false negative leaks a secret
 * on screen, so this errs toward masking (NFR-SEC-02).
 */
const SENSITIVE_KEY =
  /^(password|passwd|secret|token|uuid|psk|auth-?str|private-?key|client-?secret|credential|ca-?str|certificate|key)$/i;

/**
 * Turn a schema module plus a value into everything the renderer needs.
 *
 * Adding an ordinary field to `config.schema.json` — with or without a UI
 * entry — produces a rendered control here with no page code change. That is
 * the FR-SCHEMA-06 guarantee, and it is what `form-plan.test.ts` asserts.
 */
export function buildFormPlan(
  module: SchemaModule,
  documentValue: unknown,
  options: FormPlanOptions = {},
): FormPlan {
  const mode = options.mode ?? 'basic';
  const rootSchema = module.schema;
  const scope = readPath(documentValue, module.manifest.root);
  const context: ConditionContext = { scope, root: scope };

  const fields = planObject({
    schema: rootSchema,
    rootSchema,
    ui: module.ui.fields ?? {},
    value: scope,
    basePath: module.manifest.root,
    context,
    mode,
    ...(options.platform !== undefined ? { platform: options.platform } : {}),
    depth: 0,
  });

  const groups = groupFields(module.ui.groups ?? [], fields);
  const flat = flatten(fields);

  return {
    moduleId: module.manifest.id,
    groups,
    fields: flat,
    unknownFields: flat.filter((field) => field.unknown),
  };
}

interface PlanArgs {
  schema: JsonSchema;
  rootSchema: JsonSchema;
  ui: Record<string, UiFieldSpec>;
  value: unknown;
  basePath: ConfigPath;
  context: ConditionContext;
  mode: FormMode;
  platform?: Platform;
  depth: number;
}

const MAX_NESTING = 8;

function planObject(args: PlanArgs): PlannedField[] {
  const { schema, rootSchema, ui, value, basePath, mode, depth } = args;
  if (depth > MAX_NESTING) return [];

  const resolved = resolveRef(schema, rootSchema);
  const properties = resolved.properties ?? {};
  const record = isRecord(value) ? value : {};
  // Conditions inside an object are evaluated against that object.
  const context: ConditionContext = { scope: record, root: args.context.root };

  const planned: PlannedField[] = [];

  for (const [key, rawChildSchema] of Object.entries(properties)) {
    const childSchema = resolveRef(rawChildSchema, rootSchema);
    const spec = ui[key] ?? {};
    const present = Object.hasOwn(record, key);
    const childValue = present ? record[key] : childSchema.default;

    planned.push(
      planField({
        key,
        schema: childSchema,
        rootSchema,
        spec,
        value: childValue,
        present,
        basePath,
        context,
        required: (resolved.required ?? []).includes(key),
        mode,
        ...(args.platform !== undefined ? { platform: args.platform } : {}),
        depth,
      }),
    );
  }

  // Anything in the document the schema does not describe still gets a row, so
  // the user can find and edit it instead of silently carrying it along.
  for (const key of Object.keys(record)) {
    if (Object.hasOwn(properties, key)) continue;
    planned.push({
      key,
      path: [...basePath, key],
      control: 'unknown',
      schema: {},
      ui: ui[key] ?? {},
      value: record[key],
      present: true,
      visible: true,
      required: false,
      readOnly: false,
      sensitive: SENSITIVE_KEY.test(key),
      deprecated: false,
      unknown: true,
      group: 'unknown',
    });
  }

  return planned.sort(byOrder(ui));
}

interface FieldArgs {
  key: string;
  schema: JsonSchema;
  rootSchema: JsonSchema;
  spec: UiFieldSpec;
  value: unknown;
  present: boolean;
  basePath: ConfigPath;
  context: ConditionContext;
  required: boolean;
  mode: FormMode;
  platform?: Platform;
  depth: number;
}

function planField(args: FieldArgs): PlannedField {
  const { key, schema, spec, value, context, basePath, mode, platform } = args;
  const path: ConfigPath = [...basePath, key];
  const control = spec.control ?? inferControl(schema, key);

  const platformAllowed =
    platform === undefined || spec.platforms === undefined || spec.platforms.includes(platform);
  const modeAllowed = mode === 'advanced' || spec.advanced !== true;
  const conditionAllowed =
    spec.visibleWhen === undefined || evaluateCondition(spec.visibleWhen, context);

  const field: PlannedField = {
    key,
    path,
    control,
    schema,
    ui: spec,
    value,
    present: args.present,
    visible: platformAllowed && modeAllowed && conditionAllowed,
    required:
      args.required ||
      (spec.requiredWhen !== undefined && evaluateCondition(spec.requiredWhen, context)),
    readOnly: spec.readOnlyWhen !== undefined && evaluateCondition(spec.readOnlyWhen, context),
    sensitive: spec.sensitive ?? SENSITIVE_KEY.test(key),
    deprecated: schema.deprecated === true || spec.deprecatedSince !== undefined,
    unknown: false,
    group: spec.group ?? DEFAULT_GROUP.id,
    ...(schema.enum !== undefined ? { enumValues: schema.enum } : {}),
  };

  if (control === 'object') {
    field.children = planObject({
      schema,
      rootSchema: args.rootSchema,
      ui: spec.fields ?? {},
      value,
      basePath: path,
      context,
      mode,
      ...(platform !== undefined ? { platform } : {}),
      depth: args.depth + 1,
    });
  }

  return field;
}

/**
 * Pick a control from the JSON Schema alone. This mapping is why a bundle can
 * add a plain field without shipping UI metadata.
 */
export function inferControl(schema: JsonSchema, key = ''): ControlType {
  if (SENSITIVE_KEY.test(key) && isTypeOf(schema, 'string')) return 'secret';
  if (schema.enum) return 'select';

  if (isTypeOf(schema, 'boolean')) return 'switch';
  if (isTypeOf(schema, 'integer')) {
    return schema.format === 'port' || /(^|-)port$/.test(key) ? 'port' : 'integer';
  }
  if (isTypeOf(schema, 'number')) return 'number';

  if (isTypeOf(schema, 'array')) {
    const items = schema.items;
    if (items?.enum) return 'multi-select';
    if (items && isTypeOf(items, 'string')) return 'tags';
    return 'list';
  }

  if (isTypeOf(schema, 'object')) {
    // A map with no declared properties is a free-form dictionary (hosts, policy).
    if (!schema.properties && schema.additionalProperties !== false) return 'key-value';
    return 'object';
  }

  if (isTypeOf(schema, 'string')) {
    if (schema.maxLength !== undefined && schema.maxLength > 200) return 'textarea';
    return 'text';
  }

  return 'unknown';
}

function isTypeOf(schema: JsonSchema, type: string): boolean {
  if (schema.type === undefined) return false;
  return Array.isArray(schema.type) ? schema.type.includes(type as never) : schema.type === type;
}

function byOrder(ui: Record<string, UiFieldSpec>) {
  return (a: PlannedField, b: PlannedField): number => {
    const orderA = ui[a.key]?.order ?? (a.unknown ? Number.MAX_SAFE_INTEGER : 1000);
    const orderB = ui[b.key]?.order ?? (b.unknown ? Number.MAX_SAFE_INTEGER : 1000);
    if (orderA !== orderB) return orderA - orderB;
    return a.key.localeCompare(b.key);
  };
}

function groupFields(groups: UiGroup[], fields: PlannedField[]): PlannedGroup[] {
  const known = new Map<string, PlannedGroup>();
  for (const group of [DEFAULT_GROUP, ...groups]) {
    known.set(group.id, {
      id: group.id,
      label: group.label,
      order: group.order ?? 100,
      advanced: group.advanced ?? false,
      collapsedByDefault: group.collapsedByDefault ?? false,
      fields: [],
    });
  }
  known.set('unknown', {
    id: 'unknown',
    label: 'group.unknown',
    order: Number.MAX_SAFE_INTEGER,
    advanced: false,
    collapsedByDefault: true,
    fields: [],
  });

  for (const field of fields) {
    const target = known.get(field.group) ?? known.get(DEFAULT_GROUP.id);
    target?.fields.push(field);
  }

  return [...known.values()]
    .filter((group) => group.fields.length > 0)
    .sort((a, b) => a.order - b.order);
}

function flatten(fields: PlannedField[]): PlannedField[] {
  const out: PlannedField[] = [];
  for (const field of fields) {
    out.push(field);
    if (field.children) out.push(...flatten(field.children));
  }
  return out;
}

function readPath(value: unknown, path: ConfigPath): unknown {
  let current = value;
  for (const segment of path) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string | number, unknown>)[segment];
  }
  return current;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
