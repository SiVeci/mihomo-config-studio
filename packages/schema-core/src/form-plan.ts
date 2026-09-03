import type { ConfigPath, PathSegment } from '@mcs/yaml-engine';

import { evaluateCondition, type ConditionContext } from './condition.ts';
import { resolveRef } from './ref.ts';
import type {
  ControlType,
  JsonPrimitive,
  JsonSchema,
  Platform,
  SchemaModule,
  UiFieldSpec,
  UiGroup,
} from './types.ts';

export type FormMode = 'basic' | 'advanced';

export interface FormPlanOptions {
  mode?: FormMode;
  /** Fields restricted to other platforms are hidden but never removed. */
  platform?: Platform;
  /**
   * Absolute paths (serialized the same way `computeKnownPaths` returns
   * them) that this plan must not flag as `unknown`, even though this
   * module's own schema does not describe them — e.g. a sibling module
   * sharing the same document root (`general`/`inbound`, both `root: []`,
   * v0.3.0 #8/#14). Planning a module never *needs* its own fields listed
   * here: a property the schema does describe is never routed through the
   * "extra key" path this option affects, so passing the full registry-wide
   * set from `computeKnownPaths` back into every module's own plan call is
   * always safe.
   */
  additionalKnownPaths?: ReadonlySet<string>;
}

/** One selectable branch of a `variant` field's discriminator (FR-SCHEMA-02). */
export interface VariantOption {
  value: JsonPrimitive;
  /** i18n key; the renderer falls back to the raw value when absent. */
  label?: string;
}

/**
 * Discriminator metadata for a `control: 'variant'` field: which sibling
 * property picks the branch, what values are possible, and whether the
 * current value matches one of them. Planning never deletes a field to make
 * a branch "fit" (E4) — `matched: false` just means the branch's properties
 * were not planned as children this time, not that the value was dropped.
 */
export interface VariantInfo {
  discriminatorKey: string;
  discriminatorPath: ConfigPath;
  options: VariantOption[];
  selected?: JsonPrimitive;
  matched: boolean;
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
  /** Only set when `control === 'variant'`. */
  variant?: VariantInfo;
  /**
   * Diagnostic-only machine code for why `control` fell back to `'unknown'`
   * instead of a more specific control. Never rendered as user-facing text.
   */
  unknownReason?: 'variant-no-discriminator';
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
    ...(options.additionalKnownPaths !== undefined
      ? { additionalKnownPaths: options.additionalKnownPaths }
      : {}),
    depth: 0,
  });

  const groups = groupFields(module.ui.groups ?? [], fields);
  const flat = flattenFields(fields);

  return {
    moduleId: module.manifest.id,
    groups,
    fields: flat,
    unknownFields: flat.filter((field) => field.unknown),
  };
}

/**
 * Union, across every given module, of every path that module's own plan
 * actually declares (never the `unknown`-flagged fallback rows), *plus*
 * every module's own `manifest.root` itself. Feed the result back in as
 * `additionalKnownPaths` when planning any one of those modules on its own,
 * so two modules sharing a document root — `general`/`inbound`, both
 * `root: []` (v0.3.0 #8) — never flag each other's declared fields as
 * unknown (v0.3.0 #14). A module's own fields are always safe to include
 * here too: a schema-declared property never reaches the "extra key" path
 * this set suppresses, so passing the whole registry-wide result back into
 * every module's own `buildFormPlan` call is always correct, not just for
 * the modules that actually share a root.
 *
 * The added `manifest.root` entries fix a real gap `buildFormPlan`'s own
 * walk cannot close by itself (found while building v0.3.0 #16, not
 * introduced by it — this function has been live since #14): a module whose
 * root scope is a *record* the walk cannot see inside contributes nothing
 * to `plan.fields` at all — `dns`'s own root (`['dns']`) is never itself one
 * of `dns`'s *own* planned field paths (those are `['dns', 'enable']` and
 * so on), and an array-entry module's scope (`proxies`'s `['proxies']`)
 * isn't a record `planObject` can walk into to begin with (confirmed via
 * `GENERAL_MODULE`/`DNS_MODULE`/`SNIFFER_MODULE`/`PROXIES_MODULE` together:
 * `general`'s own plan — `root: []`, so its scope is the whole document —
 * flagged `dns`, `sniffer`, and `proxies` all as `unknown` before this fix,
 * for any document that actually has those sections, which in practice is
 * every real Mihomo config). Adding each module's bare root directly closes
 * this without needing `buildFormPlan` itself to understand array/opaque
 * scopes — nothing else could ever legitimately claim another module's own
 * root path as one of its own fields.
 */
export function computeKnownPaths(
  modules: readonly SchemaModule[],
  documentValue: unknown,
  options: FormPlanOptions = {},
): ReadonlySet<string> {
  const known = new Set<string>();
  for (const module of modules) {
    const plan = buildFormPlan(module, documentValue, options);
    for (const field of plan.fields) {
      if (!field.unknown) known.add(serializePath(field.path));
    }
    if (module.manifest.root.length > 0) known.add(serializePath(module.manifest.root));
  }
  return known;
}

/**
 * True when a module's root schema describes a single discriminated-union
 * *element* (`oneOf`/`anyOf` at the schema's own top level, no `type` or
 * `properties` there) rather than an object — `proxies`/`proxy-providers`
 * (v0.3.0 #9-#11), where `manifest.root` addresses an *array* of such
 * elements in the document. `buildFormPlan` plans one object; a module like
 * this needs `buildArrayFormPlan` instead.
 */
export function isArrayEntryModule(module: SchemaModule): boolean {
  const schema = module.schema;
  return (
    (schema.oneOf !== undefined || schema.anyOf !== undefined) &&
    schema.type === undefined &&
    schema.properties === undefined
  );
}

/**
 * `buildFormPlan`'s counterpart for `isArrayEntryModule` modules: one
 * `PlannedField` per collection entry, in document order, each addressed by
 * its real absolute path (`[...module.manifest.root, key, ...]`).
 *
 * The collection itself can be either shape upstream: `proxies` is a YAML
 * *list* (`key` is the numeric index), but `proxy-providers` is a YAML *map*
 * keyed by provider name (confirmed against the vendored comprehensive
 * sample, `proxy-providers.provider-a`/`provider-b`) — both share the exact
 * same discriminated-union-at-the-root schema shape `isArrayEntryModule`
 * detects, so both must be handled here. Missed until v0.3.0 #17 wired
 * `proxy-providers` into `ModuleFormPage` for the first time: #14's own
 * fixtures only ever exercised the list-shaped case (`proxies`), so a
 * map-shaped module silently planned to `[]` (empty form, no error) instead
 * of failing loudly — `Array.isArray(entries)` was `false` for a real
 * `proxy-providers` document and the function returned early.
 *
 * `buildFormPlan` cannot plan this shape end-to-end — the schema's `oneOf`
 * sits at its own root, and the document value there is a list or map, not a
 * record `planObject` can walk. Each entry is planned by wrapping it as
 * `{ item: entry }` under a synthetic `root: []` probe module (the same
 * technique `schema-builtin`'s `builtin.test.ts` proved out per-protocol as
 * `planOneUnionItem`), then unwrapping: the resulting single `item` field
 * (typically `control: 'variant'`, discriminated on whichever property the
 * union's branches share) has every path in its subtree — its own, its
 * children's, and its `variant.discriminatorPath` — rewritten from a
 * leading `'item'` segment to `[...module.manifest.root, key]`.
 */
/** A half-open index range `[start, end)` into the collection, in document order — not a byte or pixel range. */
export interface ArrayFormWindow {
  readonly start: number;
  readonly end: number;
}

export interface ArrayFormPlanOptions extends FormPlanOptions {
  /**
   * Plans only entries in `[window.start, window.end)`, skipping the
   * per-entry `buildFormPlan` cost for everything outside it (NFR-PERF-05,
   * v1.0.0 #2). Omitted (the default) plans every entry, unchanged from
   * before this option existed — **required** for any caller that needs a
   * complete answer regardless of what is currently on screen, chiefly
   * `collectUnknownFields`: a document-wide "which fields are unknown"
   * answer must see every entry, not just a rendered window, or an unknown
   * field would silently stop being reported the moment its entry scrolls
   * out of view. Only a renderer that owns its own re-render-on-scroll loop
   * (`SchemaArrayForm`) may narrow this — narrowing here only shrinks the
   * *plan*, never touches the underlying document, so no entry's value is
   * ever lost by windowing.
   */
  window?: ArrayFormWindow;
}

/**
 * The collection's entry count without planning any of them — cheap (one
 * array/object walk, no schema validation or UI resolution per entry),
 * letting a virtualized renderer size its window (`computeVariableVirtualWindow`)
 * *before* paying `buildArrayFormPlan`'s per-entry cost, rather than only
 * being able to compute the window from a plan it already fully paid for
 * (NFR-PERF-05, v1.0.0 #2).
 */
export function countArrayFormEntries(module: SchemaModule, documentValue: unknown): number {
  const entries = collectionEntries(readPath(documentValue, module.manifest.root));
  return entries?.length ?? 0;
}

export function buildArrayFormPlan(
  module: SchemaModule,
  documentValue: unknown,
  options: ArrayFormPlanOptions = {},
): PlannedField[] {
  const entries = collectionEntries(readPath(documentValue, module.manifest.root));
  if (entries === null) return [];

  const { window, ...formPlanOptions } = options;
  const windowedEntries = window ? entries.slice(window.start, window.end) : entries;

  const probeModule: SchemaModule = {
    manifest: { id: module.manifest.id, root: [], version: module.manifest.version },
    schema: {
      type: 'object',
      properties: { item: module.schema },
      ...(module.schema.$defs !== undefined ? { $defs: module.schema.$defs } : {}),
    },
    ui: { fields: { item: { fields: module.ui.fields ?? {} } } },
  };

  return windowedEntries.map(([key, entry]) => {
    const plan = buildFormPlan(probeModule, { item: entry }, formPlanOptions);
    // The probe schema always declares exactly one property ('item'), so
    // `planObject` always produces exactly one field for it.
    const itemField = plan.fields[0]!;
    return reprefixField(itemField, [...module.manifest.root, key]);
  });
}

/** `null` when `value` is neither shape a collection-of-entries module can hold. */
function collectionEntries(value: unknown): Array<[PathSegment, unknown]> | null {
  if (Array.isArray(value)) return value.map((entry, index) => [index, entry]);
  if (isRecord(value)) return Object.entries(value);
  return null;
}

/** Rewrites a field (and its children/variant discriminator) planned under a leading `'item'` segment to address `newPrefix` instead — see `buildArrayFormPlan`. */
function reprefixField(field: PlannedField, newPrefix: ConfigPath): PlannedField {
  const suffix = field.path.slice(1);
  const reprefixed: PlannedField = { ...field, path: [...newPrefix, ...suffix] };
  if (field.variant) {
    reprefixed.variant = {
      ...field.variant,
      discriminatorPath: [...newPrefix, ...field.variant.discriminatorPath.slice(1)],
    };
  }
  if (field.children) {
    reprefixed.children = field.children.map((child) => reprefixField(child, newPrefix));
  }
  return reprefixed;
}

/**
 * Every `unknown`-flagged field across every given module, object- and
 * array-shaped alike (v0.3.0 #16's `UnknownFieldTree` — one combined list,
 * not one per module). `buildFormPlan` already flattens and filters this for
 * a single object module (`FormPlan.unknownFields`); `buildArrayFormPlan`
 * has no equivalent of its own, since it returns one field per array element
 * rather than a `FormPlan`, so this walks each element's own children with
 * the same `flatten` helper `buildFormPlan` uses internally.
 *
 * Computes and applies `additionalKnownPaths` itself (ignoring any passed in
 * `options`) — two modules sharing a document root (`general`/`inbound`,
 * both `root: []`, v0.3.0 #8) must not flag each other's declared fields as
 * unknown here either, the exact same false positive `ModuleFormPage`'s own
 * rendering already had to suppress (v0.3.0 #14). Skipped for array-entry
 * modules: their `manifest.root` is never shared with anything, and
 * `additionalKnownPaths` entries — absolute document paths — could never
 * match anything inside `buildArrayFormPlan`'s synthetic per-element `item`
 * namespace regardless.
 *
 * De-duplicated by path (v0.3.0 #17 — a real bug, caught live in a browser,
 * `UnknownFieldTree`'s `key={pointer}` collided): `additionalKnownPaths`
 * only suppresses a leaf that *some* module actually declares as its own
 * field. A leaf *no* installed module recognises — the ordinary case this
 * function exists for — is not in that set either, so every module sharing
 * a document root independently (and correctly, from its own narrow view)
 * reports the exact same path as its own unknown field. One combined list
 * means one entry per real leaf, not one per module that failed to claim it.
 */
export function collectUnknownFields(
  modules: readonly SchemaModule[],
  documentValue: unknown,
  options: FormPlanOptions = {},
): PlannedField[] {
  const additionalKnownPaths = computeKnownPaths(modules, documentValue, options);
  const unknown: PlannedField[] = [];
  const seen = new Set<string>();
  for (const module of modules) {
    const fields = isArrayEntryModule(module)
      ? flattenFields(buildArrayFormPlan(module, documentValue, options)).filter(
          (field) => field.unknown,
        )
      : buildFormPlan(module, documentValue, { ...options, additionalKnownPaths }).unknownFields;
    for (const field of fields) {
      const key = serializePath(field.path);
      if (seen.has(key)) continue;
      seen.add(key);
      unknown.push(field);
    }
  }
  return unknown;
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
  additionalKnownPaths?: ReadonlySet<string>;
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
        ...(args.additionalKnownPaths !== undefined
          ? { additionalKnownPaths: args.additionalKnownPaths }
          : {}),
        depth,
      }),
    );
  }

  // Anything in the document the schema does not describe still gets a row, so
  // the user can find and edit it instead of silently carrying it along —
  // unless a sibling module sharing this same document root already claims
  // it (`additionalKnownPaths`, v0.3.0 #14), in which case it is someone
  // else's known field, not this module's unknown one.
  for (const key of Object.keys(record)) {
    if (Object.hasOwn(properties, key)) continue;
    if (args.additionalKnownPaths?.has(serializePath([...basePath, key]))) continue;
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
  additionalKnownPaths?: ReadonlySet<string>;
  depth: number;
}

function planField(args: FieldArgs): PlannedField {
  const { key, schema, spec, value, context, basePath, mode, platform } = args;
  const path: ConfigPath = [...basePath, key];
  const explicitControl = spec.control !== undefined;
  const control = spec.control ?? inferControl(schema, key, args.rootSchema);

  const platformAllowed =
    platform === undefined || spec.platforms === undefined || spec.platforms.includes(platform);
  const modeAllowed = mode === 'advanced' || spec.advanced !== true;
  const conditionAllowed =
    spec.visibleWhen === undefined || evaluateCondition(spec.visibleWhen, context);

  // A schema-declared union with no discoverable discriminator falls back to
  // `unknown` (never a guess) — this records why, for diagnostics only.
  const isUnresolvedVariant =
    !explicitControl &&
    control === 'unknown' &&
    (schema.oneOf !== undefined || schema.anyOf !== undefined);

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
    ...(isUnresolvedVariant ? { unknownReason: 'variant-no-discriminator' as const } : {}),
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
      ...(args.additionalKnownPaths !== undefined
        ? { additionalKnownPaths: args.additionalKnownPaths }
        : {}),
      depth: args.depth + 1,
    });
  } else if (control === 'variant') {
    planVariantChildren(field, { schema, spec, value, path, context, mode, platform }, args);
  }

  return field;
}

/**
 * Plan a `variant` field's discriminator metadata and, when the current value
 * matches one of the union's branches, that branch's properties as children.
 *
 * Switching branches is not this function's job: it never deletes anything.
 * A property the record carries but the matched branch does not declare
 * still comes out the other end of `planObject`'s own "undeclared property"
 * path as an unknown child — the same guarantee basic/advanced mode gives,
 * applied to union branches (E4).
 */
function planVariantChildren(
  field: PlannedField,
  ctx: {
    schema: JsonSchema;
    spec: UiFieldSpec;
    value: unknown;
    path: ConfigPath;
    context: ConditionContext;
    mode: FormMode;
    /** Required (not optional) so a possibly-`undefined` local can be passed
     * through directly; `exactOptionalPropertyTypes` forbids that for an
     * optional property. */
    platform: Platform | undefined;
  },
  args: FieldArgs,
): void {
  const analysis = analyzeVariant(ctx.schema, args.rootSchema);
  if (!analysis) return;

  const record = isRecord(ctx.value) ? ctx.value : {};
  const rawSelected = record[analysis.discriminatorKey];
  const selected = isJsonPrimitive(rawSelected) ? rawSelected : undefined;
  const matchedBranch = analysis.branches.find((branch) => branch.value === selected);

  field.variant = {
    discriminatorKey: analysis.discriminatorKey,
    discriminatorPath: [...ctx.path, analysis.discriminatorKey],
    options: analysis.branches.map((branch) => {
      const label = ctx.spec.variantLabels?.[String(branch.value)];
      return { value: branch.value, ...(label !== undefined ? { label } : {}) };
    }),
    ...(selected !== undefined ? { selected } : {}),
    matched: matchedBranch !== undefined,
  };

  if (!matchedBranch) return;

  // Plan with the discriminator still among the properties — otherwise
  // `planObject` cannot tell "declared, just represented elsewhere" from
  // "undeclared", and would re-surface it as an unknown field. Drop it from
  // the result instead: it is already represented by `field.variant`.
  const { properties, required } = collectProperties(matchedBranch.schema, args.rootSchema);
  const children = planObject({
    schema: { properties, required: [...required] },
    rootSchema: args.rootSchema,
    ui: ctx.spec.fields ?? {},
    value: ctx.value,
    basePath: ctx.path,
    context: ctx.context,
    mode: ctx.mode,
    ...(ctx.platform !== undefined ? { platform: ctx.platform } : {}),
    ...(args.additionalKnownPaths !== undefined
      ? { additionalKnownPaths: args.additionalKnownPaths }
      : {}),
    depth: args.depth + 1,
  });
  field.children = children.filter((child) => child.key !== analysis.discriminatorKey);
}

/**
 * Pick a control from the JSON Schema alone. This mapping is why a bundle can
 * add a plain field without shipping UI metadata.
 *
 * `rootSchema` defaults to `schema` itself so existing callers that pass a
 * self-contained schema (no local `$ref`) keep working unchanged; planning
 * passes the module's actual root so `oneOf`/`anyOf` branches that reach into
 * `$defs` resolve correctly.
 */
export function inferControl(
  schema: JsonSchema,
  key = '',
  rootSchema: JsonSchema = schema,
): ControlType {
  if (SENSITIVE_KEY.test(key) && isTypeOf(schema, 'string')) return 'secret';
  if (schema.enum) return 'select';

  if (schema.oneOf !== undefined || schema.anyOf !== undefined) {
    return analyzeVariant(schema, rootSchema) !== undefined ? 'variant' : 'unknown';
  }

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

interface VariantBranch {
  /** Branch schema after `$ref` resolution (may still be `allOf`-shaped). */
  schema: JsonSchema;
  value: JsonPrimitive;
}

interface VariantAnalysis {
  discriminatorKey: string;
  branches: VariantBranch[];
}

interface CandidateBranch {
  schema: JsonSchema;
  value: JsonPrimitive | undefined;
}

function candidateHasValue(branch: CandidateBranch): branch is VariantBranch {
  return branch.value !== undefined;
}

/**
 * Find the property that discriminates a `oneOf`/`anyOf` union: a `const` or
 * single-value `enum` present in every branch, preferring the first common
 * candidate in declaration order. This is declarative on purpose — nothing
 * here is specific to Mihomo's `type` field, so any bundle union with a
 * shared literal-valued property gets a working selector (FR-SCHEMA-06
 * applied to unions). Returns `undefined` rather than guessing when no
 * property qualifies in every branch; a synthesized bad schema should not
 * crash the planner.
 */
function analyzeVariant(schema: JsonSchema, rootSchema: JsonSchema): VariantAnalysis | undefined {
  const branches = schema.oneOf ?? schema.anyOf;
  if (!branches || branches.length === 0) return undefined;

  const resolvedBranches = branches.map((branch) => resolveRef(branch, rootSchema));
  const branchProperties = resolvedBranches.map(
    (branchSchema) => collectProperties(branchSchema, rootSchema).properties,
  );
  const firstProperties = branchProperties[0];
  if (!firstProperties) return undefined;

  for (const key of Object.keys(firstProperties)) {
    const candidates: CandidateBranch[] = resolvedBranches.map((branchSchema, index) => ({
      schema: branchSchema,
      value: discriminatorValue(branchProperties[index] ?? {}, key, rootSchema),
    }));
    if (candidates.every(candidateHasValue)) {
      return { discriminatorKey: key, branches: candidates };
    }
  }
  return undefined;
}

function discriminatorValue(
  properties: Record<string, JsonSchema>,
  key: string,
  rootSchema: JsonSchema,
): JsonPrimitive | undefined {
  const propSchema = properties[key];
  if (propSchema === undefined) return undefined;
  const resolved = resolveRef(propSchema, rootSchema);
  if (resolved.const !== undefined) return resolved.const;
  if (resolved.enum !== undefined && resolved.enum.length === 1) return resolved.enum[0];
  return undefined;
}

/**
 * Flatten a schema's own `properties` with everything contributed by its
 * `allOf` members (recursively), resolving `$ref` at each step. This is what
 * lets a union branch declare shared fields via `$defs` + `allOf` (ADR-008)
 * — e.g. `proxies`' common `name`/`server`/`port` — while still being planned
 * as one flat set of properties. Own properties win over `allOf`-contributed
 * ones on a name clash, since they are the more specific declaration.
 */
function collectProperties(
  schema: JsonSchema,
  rootSchema: JsonSchema,
  depth = 0,
): { properties: Record<string, JsonSchema>; required: Set<string> } {
  if (depth > MAX_NESTING) return { properties: {}, required: new Set() };
  const resolved = resolveRef(schema, rootSchema);
  const properties: Record<string, JsonSchema> = {};
  const required = new Set<string>();

  for (const member of resolved.allOf ?? []) {
    const nested = collectProperties(member, rootSchema, depth + 1);
    Object.assign(properties, nested.properties);
    for (const nestedKey of nested.required) required.add(nestedKey);
  }

  Object.assign(properties, resolved.properties ?? {});
  for (const ownKey of resolved.required ?? []) required.add(ownKey);

  return { properties, required };
}

function isJsonPrimitive(value: unknown): value is JsonPrimitive {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
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

/**
 * A `PlannedField` tree flattened to include every nested child, depth-first
 * — the same shape `FormPlan.fields` and `collectUnknownFields` already rely
 * on internally. Exported (v0.3.0 #17) because `@mcs/validator`'s
 * `schemaStage` needs the identical operation for `buildArrayFormPlan`'s
 * per-entry result, which — unlike `FormPlan.fields` — comes back
 * unflattened (one top-level field per collection entry, its own children
 * nested underneath).
 */
export function flattenFields(fields: readonly PlannedField[]): PlannedField[] {
  const out: PlannedField[] = [];
  for (const field of fields) {
    out.push(field);
    if (field.children) out.push(...flattenFields(field.children));
  }
  return out;
}

function serializePath(path: ConfigPath): string {
  return JSON.stringify(path);
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
