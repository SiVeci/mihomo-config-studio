import { MihomoYamlDocument } from '@mcs/yaml-engine';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_STAGES,
  hasBlockingIssues,
  runPipeline,
  SCHEMA_STAGE_ID,
  schemaStage,
  SYNTAX_STAGE_ID,
  syntaxStage,
  VALIDATION_DEBOUNCE_MS,
} from './pipeline.js';
import type { PipelineContext, ValidationStage } from './pipeline.js';
import type { ValidationIssue } from './issue.js';

function blockingIssue(module: string): ValidationIssue {
  return { severity: 'error', code: 'x', module, messageKey: 'x', blocking: true };
}

describe('syntaxStage (FR-VAL-01)', () => {
  it('widens every YamlIssue from the parse result via fromYamlIssue', () => {
    const parse = MihomoYamlDocument.parse('a: 1\n  b: 2\n');
    const issues = syntaxStage.run({ parse });
    expect(issues.length).toBe(parse.issues.length);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((issue) => issue.module === 'yaml')).toBe(true);
  });

  it('produces no issues for syntactically valid input', () => {
    const parse = MihomoYamlDocument.parse('mode: rule\n');
    expect(syntaxStage.run({ parse })).toEqual([]);
  });
});

describe('schemaStage (placeholder until v0.3.0)', () => {
  it('always produces an empty set, regardless of context', () => {
    const parse = MihomoYamlDocument.parse('mode: rule\n');
    expect(schemaStage.run({ parse })).toEqual([]);
  });
});

describe('runPipeline', () => {
  it('runs the default stages and concatenates their issues', () => {
    const ctx: PipelineContext = { parse: MihomoYamlDocument.parse('mode: rule\n') };
    expect(runPipeline(ctx)).toEqual([]);
  });

  it('defaults to [syntaxStage, schemaStage] in that order', () => {
    expect(DEFAULT_STAGES).toEqual([syntaxStage, schemaStage]);
    expect(DEFAULT_STAGES.map((stage) => stage.id)).toEqual([SYNTAX_STAGE_ID, SCHEMA_STAGE_ID]);
  });

  it('short-circuits after a blocking syntax issue, skipping every later stage entirely', () => {
    let laterStageRan = false;
    const laterStage: ValidationStage = {
      id: 'schema',
      run: () => {
        laterStageRan = true;
        return [];
      },
    };
    const ctx: PipelineContext = { parse: MihomoYamlDocument.parse('a: 1\n  b: 2\n') };

    const issues = runPipeline(ctx, [syntaxStage, laterStage]);

    expect(hasBlockingIssues(issues)).toBe(true);
    expect(laterStageRan).toBe(false);
  });

  it('does not short-circuit for a blocking issue produced by a non-syntax stage', () => {
    let afterStageRan = false;
    const blockingStage: ValidationStage = { id: 'schema', run: () => [blockingIssue('sample')] };
    const afterStage: ValidationStage = {
      id: 'reference',
      run: () => {
        afterStageRan = true;
        return [];
      },
    };
    const ctx: PipelineContext = { parse: MihomoYamlDocument.parse('mode: rule\n') };

    const issues = runPipeline(ctx, [syntaxStage, blockingStage, afterStage]);

    expect(hasBlockingIssues(issues)).toBe(true);
    expect(afterStageRan).toBe(true);
  });

  it('runs every stage and reports no blocking issues when nothing blocks', () => {
    const quietStage: ValidationStage = { id: 'reference', run: () => [] };
    const ctx: PipelineContext = { parse: MihomoYamlDocument.parse('mode: rule\n') };

    const issues = runPipeline(ctx, [syntaxStage, quietStage]);

    expect(issues).toEqual([]);
    expect(hasBlockingIssues(issues)).toBe(false);
  });
});

describe('hasBlockingIssues (FR-YAML-07)', () => {
  it('is false for an empty list', () => {
    expect(hasBlockingIssues([])).toBe(false);
  });

  it('is false when every issue is a warning or info', () => {
    const issues: ValidationIssue[] = [
      { severity: 'warning', code: 'w', module: 'yaml', messageKey: 'w', blocking: false },
      { severity: 'info', code: 'i', module: 'yaml', messageKey: 'i', blocking: false },
    ];
    expect(hasBlockingIssues(issues)).toBe(false);
  });

  it('is true as soon as one issue blocks', () => {
    const issues: ValidationIssue[] = [
      { severity: 'warning', code: 'w', module: 'yaml', messageKey: 'w', blocking: false },
      blockingIssue('sample'),
    ];
    expect(hasBlockingIssues(issues)).toBe(true);
  });
});

describe('VALIDATION_DEBOUNCE_MS (NFR-PERF-03 contract)', () => {
  it('is the 300ms figure the Worker message layer (#10) must implement', () => {
    expect(VALIDATION_DEBOUNCE_MS).toBe(300);
  });
});
