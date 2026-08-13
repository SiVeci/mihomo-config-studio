import type { ParseResult } from '@mcs/yaml-engine';

import { fromYamlIssue } from './issue.js';
import type { ValidationIssue } from './issue.js';

/** The context every stage runs against. Grows as later stages need more (v0.3.0+). */
export interface PipelineContext {
  /** The already-computed parse result; the pipeline never re-parses. */
  parse: ParseResult;
}

/**
 * One pluggable step in the validation pipeline. Stages are data, not
 * hardcoded branches: `reference` (v0.4.0) and `security` (v0.3.0) register
 * here later without this file changing shape — the interface is fixed as of
 * v0.2.0.
 */
export interface ValidationStage {
  id: string;
  run(ctx: PipelineContext): ValidationIssue[];
}

/** The pipeline short-circuits after this stage if it produced a blocking issue. */
export const SYNTAX_STAGE_ID = 'syntax';
/** No module is resolved into this stage yet; see `schemaStage`. */
export const SCHEMA_STAGE_ID = 'schema';

export const syntaxStage: ValidationStage = {
  id: SYNTAX_STAGE_ID,
  run: (ctx) => ctx.parse.issues.map((issue) => fromYamlIssue(issue)),
};

/**
 * No schema module is wired into the pipeline yet — resolving which modules
 * apply to a project is `schema-registry` work that lands in v0.3.0.
 * Registering the stage now, rather than adding it later, proves the
 * pipeline shape already accommodates a second stage and lets the
 * short-circuit test below exercise it against something real instead of
 * just the syntax stage in isolation.
 */
export const schemaStage: ValidationStage = {
  id: SCHEMA_STAGE_ID,
  run: () => [],
};

export const DEFAULT_STAGES: readonly ValidationStage[] = [syntaxStage, schemaStage];

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
