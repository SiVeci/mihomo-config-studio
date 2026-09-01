import {
  buildArrayFormPlan,
  buildFormPlan,
  evaluateRules,
  flattenFields,
  isArrayEntryModule,
  validateValue,
  type JsonSchema,
  type SchemaModule,
} from '@mcs/schema-core';
import type { ConfigPath, ParseResult } from '@mcs/yaml-engine';

import { fromRuleIssue, fromSchemaIssue, fromYamlIssue } from './issue.js';
import type { ValidationIssue } from './issue.js';
import { referenceStage } from './reference.js';
import { ruleOrderStage } from './rule-order.js';
import { securityStage } from './security.js';

/** The context every stage runs against. Grows as later stages need more (v0.3.0+). */
export interface PipelineContext {
  /** The already-computed parse result; the pipeline never re-parses. */
  parse: ParseResult;
  /**
   * Modules resolved for this project (v0.3.0 #12), typically
   * `SchemaRegistry.modules()` — dependency order does not matter here,
   * `schemaStage` validates every module independently. Omitted or empty:
   * `schemaStage` produces nothing, preserving v0.2.0's "closed loop with no
   * Schema module installed" guarantee (`apps/web/src/closed-loop.test.tsx`)
   * — "unknown field" is only a meaningful finding relative to *some*
   * installed schema; with none installed there is nothing to compare
   * against, so nothing is flagged.
   */
  modules?: readonly SchemaModule[];
  /**
   * Rule ids (matching `ValidationIssue.code`, see `rule-toggles.ts`) a user
   * has chosen to mute (FR-VAL-06). Applied once, after every stage has run
   * (`runPipeline`'s own job, not any one stage's) — a stage never sees this
   * at all, so a stage can never accidentally special-case it. Never applied
   * to a `blocking: true` issue: FR-YAML-07's "a blocking issue disables the
   * normal export path" is decided solely by `hasBlockingIssues`, and that
   * invariant would break the moment a blocking issue could be filtered away
   * by anything other than fixing it.
   */
  disabledRuleIds?: ReadonlySet<string>;
}

/**
 * One pluggable step in the validation pipeline. Stages are data, not
 * hardcoded branches: `referenceStage` (v0.4.0 #4) registered without this
 * interface changing shape — fixed as of v0.2.0.
 */
export interface ValidationStage {
  id: string;
  run(ctx: PipelineContext): ValidationIssue[];
}

/** The pipeline short-circuits after this stage if it produced a blocking issue. */
export const SYNTAX_STAGE_ID = 'syntax';
export const SCHEMA_STAGE_ID = 'schema';

export const syntaxStage: ValidationStage = {
  id: SYNTAX_STAGE_ID,
  run: (ctx) => ctx.parse.issues.map((issue) => fromYamlIssue(issue)),
};

/**
 * For every resolved module: run `validateValue` (structural checks) and
 * `evaluateRules` (cross-field checks, v0.3.0 #4) against that module's own
 * document subtree, both with `basePath: module.manifest.root` so reported
 * paths address the whole document, not just the module's scope. Then a
 * second pass flags every document leaf (`document.leafPaths()`) that no
 * resolved module's plan recognises as an `info`-severity `unknown-field`
 * issue (FR-VAL-05) — never `error`, never blocking, no matter how many.
 *
 * "Recognises" is computed via `buildFormPlan`, not a bespoke walk: a leaf a
 * module's plan does *not* mark `unknown` is claimed, even when that module
 * only reaches the leaf because it shares a document root with another
 * module (`general`/`inbound`, both `root: []` — v0.3.0 #8's deferred
 * cross-module gap is a *rendering*-layer concern for `buildFormPlan`
 * consumers; checked against the *union* of every module's own claims here,
 * it is not a problem for validation at all: a field either belongs to one
 * of the installed modules or it does not).
 *
 * `isArrayEntryModule` modules (`proxies`/`proxy-providers`) get a different
 * treatment (v0.3.0 #17 — a real bug found and fixed): `module.schema`
 * describes one *entry* of a list-or-map collection, never the collection
 * itself, so validating `document.getIn(module.manifest.root)` directly
 * against it (as every other module correctly does) always failed with a
 * spurious blocking `schema.oneOf` error for *any* document with so much as
 * one proxy or provider — the whole collection could never match a schema
 * that describes a single entry. `buildArrayFormPlan` already does the real
 * per-entry discriminator matching for rendering (v0.3.0 #14); reused here
 * so an entry matching no branch (a P1/P2 protocol, deliberately out of this
 * module's P0 scope) is skipped rather than treated as a violation — its
 * fields still surface through the unknown-field pass below, same as any
 * other unrecognised leaf.
 */
export const schemaStage: ValidationStage = {
  id: SCHEMA_STAGE_ID,
  run: (ctx) => {
    const { document } = ctx.parse;
    const modules = ctx.modules ?? [];
    if (!document || modules.length === 0) return [];

    const issues: ValidationIssue[] = [];
    const knownPaths = new Set<string>();
    const fullValue = document.toJS();
    const locator = document;

    for (const module of modules) {
      if (isArrayEntryModule(module)) {
        for (const field of buildArrayFormPlan(module, fullValue, { mode: 'advanced' })) {
          if (field.variant?.matched) {
            for (const schemaIssue of validateValue(field.value, module.schema, {
              basePath: field.path,
            })) {
              issues.push(fromSchemaIssue(schemaIssue, { module: module.manifest.id, locator }));
            }
            for (const ruleIssue of evaluateRules(module.rules ?? [], field.value, {
              basePath: field.path,
            })) {
              issues.push(fromRuleIssue(ruleIssue, { module: module.manifest.id, locator }));
            }
          }
          for (const flattened of flattenFields([field])) {
            if (!flattened.unknown) {
              registerKnownPath(knownPaths, flattened.path, flattened.schema, flattened.value);
            }
          }
          // The discriminator itself (e.g. `type`) is deliberately excluded
          // from `.children` by `planVariantChildren` — it is represented by
          // `field.variant` instead, not re-listed as a child — so without
          // this it would never enter `knownPaths` and would misread as an
          // unrecognised leaf on every single entry, matched or not.
          if (field.variant) knownPaths.add(serializePath(field.variant.discriminatorPath));
        }
        continue;
      }

      // A module's own section can be entirely absent (no module here
      // declares any top-level `required`) — `undefined`/`null` would
      // otherwise read as a spurious `schema.type` violation against that
      // module's (always object-shaped) root schema.
      const scope = document.getIn(module.manifest.root);
      if (scope !== undefined && scope !== null) {
        for (const schemaIssue of validateValue(scope, module.schema, {
          basePath: module.manifest.root,
        })) {
          issues.push(fromSchemaIssue(schemaIssue, { module: module.manifest.id, locator }));
        }
        for (const ruleIssue of evaluateRules(module.rules ?? [], scope, {
          basePath: module.manifest.root,
        })) {
          issues.push(fromRuleIssue(ruleIssue, { module: module.manifest.id, locator }));
        }
      }

      if (scope !== undefined && scope !== null) {
        registerDictionaryKnownPaths(knownPaths, module.manifest.root, module.schema, scope);
      }

      const plan = buildFormPlan(module, fullValue, { mode: 'advanced' });
      for (const field of plan.fields) {
        if (!field.unknown) registerKnownPath(knownPaths, field.path, field.schema, field.value);
      }
    }

    for (const leaf of document.leafPaths()) {
      if (knownPaths.has(serializePath(leaf))) continue;
      const range = document.locate(leaf) ?? undefined;
      issues.push({
        severity: 'info',
        code: 'unknown-field',
        module: 'schema',
        messageKey: 'unknown-field',
        path: leaf,
        ...(range !== undefined ? { range } : {}),
        blocking: false,
      });
    }

    return issues;
  },
};

function serializePath(path: ConfigPath): string {
  return JSON.stringify(path);
}

const SCALAR_ITEM_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'null']);

/**
 * Registers a known field's own path and, when it is a scalar-item array
 * (e.g. `dns.nameserver: string[]`), every element's path too.
 *
 * `buildFormPlan`/`buildArrayFormPlan` only ever produce one `PlannedField`
 * per *array-valued* property — array items are a single field's value, not
 * individually planned children, unlike an object field's own nested
 * properties (each of *those* already gets its own `knownPaths` entry via
 * `planObject`'s recursion). But `document.leafPaths()` walks *into* every
 * sequence node regardless, producing one leaf per array element
 * (`['dns','nameserver',0]`, `['dns','nameserver',1]`, ...) — an exact-match
 * lookup against `knownPaths` (which only ever held `['dns','nameserver']`)
 * therefore flagged every element of every scalar-array field as
 * `unknown-field`, pre-existing since `schemaStage` first shipped (v0.3.0
 * #12) and only caught here because a 10,000-entry `rules:` array (v0.4.0
 * #3) makes the gap impossible to miss instead of a one-or-two-item false
 * positive most real configs would never surface loudly.
 *
 * Deliberately scoped to *scalar* item types only, not a blanket "cover
 * every descendant of a known path" rule: an `isArrayEntryModule` module's
 * own per-entry path (e.g. `['proxies', 1]`) is also "known" in the sense
 * used here, but its *children* still need independent unknown-field
 * checking when the entry matches no discriminator branch (a P1/P2
 * protocol, v0.3.0 #17) — covering descendants unconditionally would wrongly
 * suppress that. An array of scalars has no such nested structure to check.
 */
function registerKnownPath(
  knownPaths: Set<string>,
  path: ConfigPath,
  schema: JsonSchema,
  value: unknown,
): void {
  knownPaths.add(serializePath(path));
  const itemType = schema.type === 'array' ? schema.items?.type : undefined;
  const isScalarArray =
    itemType !== undefined &&
    (Array.isArray(itemType)
      ? itemType.every((t) => SCALAR_ITEM_TYPES.has(t))
      : SCALAR_ITEM_TYPES.has(itemType));
  if (isScalarArray && Array.isArray(value)) {
    value.forEach((_, index) => knownPaths.add(serializePath([...path, index])));
  }
}

/**
 * `planObject` (via `buildFormPlan`) only ever recognises *named*
 * `schema.properties` — a root schema shaped as an arbitrary-key dictionary
 * (`{type:'object', additionalProperties: {...}}`, no `.properties` at all,
 * e.g. `sub-rules:`'s `name -> rule-line[]` map, v0.4.0 #3) has no named
 * property for any real key to match, so every single key in the document
 * reads as "undeclared" and falls through `planObject`'s own unknown-key
 * loop — the dictionary-shaped counterpart to `registerKnownPath`'s
 * scalar-array gap above, same root cause (a collection form `form-plan.ts`
 * was never taught to recognise), same fix shape: register what the schema
 * *does* promise to own before asking whether anything was actually
 * covered.
 */
function registerDictionaryKnownPaths(
  knownPaths: Set<string>,
  root: ConfigPath,
  schema: JsonSchema,
  scope: unknown,
): void {
  const additionalProperties = schema.additionalProperties;
  const hasNamedProperties = Object.keys(schema.properties ?? {}).length > 0;
  if (
    schema.type !== 'object' ||
    hasNamedProperties ||
    typeof additionalProperties !== 'object' ||
    additionalProperties === null ||
    !isPlainObject(scope)
  ) {
    return;
  }
  for (const [key, value] of Object.entries(scope)) {
    registerKnownPath(knownPaths, [...root, key], additionalProperties, value);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export const DEFAULT_STAGES: readonly ValidationStage[] = [
  syntaxStage,
  schemaStage,
  referenceStage,
  ruleOrderStage,
  securityStage,
];

/**
 * Run every stage in order and concatenate their issues, short-circuiting
 * after `syntax` if it produced a blocking issue: with the document unparsed
 * there is no JS value or path structure for later stages to work with, so
 * running them would validate nothing — and on a large adversarial input, do
 * so at real cost for no benefit.
 */
export function runPipeline(
  ctx: PipelineContext,
  stages: readonly ValidationStage[] = DEFAULT_STAGES,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const stage of stages) {
    const stageIssues = stage.run(ctx);
    issues.push(...stageIssues);
    if (stage.id === SYNTAX_STAGE_ID && hasBlockingIssues(stageIssues)) break;
  }
  const disabled = ctx.disabledRuleIds;
  if (!disabled || disabled.size === 0) return issues;
  return issues.filter((issue) => issue.blocking || !disabled.has(issue.code));
}

/**
 * The single place FR-YAML-07's "a blocking issue exists -> only an invalid
 * draft can be exported" is decided. Callers (the export UI in #15) must use
 * this rather than re-deriving the rule from individual issues.
 */
export function hasBlockingIssues(issues: readonly ValidationIssue[]): boolean {
  return issues.some((issue) => issue.blocking);
}

/**
 * Contract for #10's Worker message layer (NFR-PERF-03): consecutive edits
 * within this window collapse into a single validation run, and the last
 * edit in a burst must still trigger one. The pipeline above is a
 * synchronous pure function with no timer of its own — scheduling is the
 * caller's concern, not this package's.
 */
export const VALIDATION_DEBOUNCE_MS = 300;
