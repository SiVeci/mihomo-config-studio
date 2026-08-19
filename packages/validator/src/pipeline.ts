import { buildFormPlan, evaluateRules, validateValue, type SchemaModule } from '@mcs/schema-core';
import type { ConfigPath, ParseResult } from '@mcs/yaml-engine';

import { fromRuleIssue, fromSchemaIssue, fromYamlIssue } from './issue.js';
import type { ValidationIssue } from './issue.js';
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
}

/**
 * One pluggable step in the validation pipeline. Stages are data, not
 * hardcoded branches: `reference` (v0.4.0) registers here later without this
 * file changing shape — the interface is fixed as of v0.2.0.
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

    for (const module of modules) {
      // A module's own section can be entirely absent (no module here
      // declares any top-level `required`) — `undefined`/`null` would
      // otherwise read as a spurious `schema.type` violation against that
      // module's (always object-shaped) root schema.
      const scope = document.getIn(module.manifest.root);
      if (scope !== undefined && scope !== null) {
        const locator = document;
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

      const plan = buildFormPlan(module, fullValue, { mode: 'advanced' });
      for (const field of plan.fields) {
        if (!field.unknown) knownPaths.add(serializePath(field.path));
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

export const DEFAULT_STAGES: readonly ValidationStage[] = [syntaxStage, schemaStage, securityStage];

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
  return issues;
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
