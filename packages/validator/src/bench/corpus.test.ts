import { generateLargeCorpus } from '@mcs/test-fixtures';
import { MihomoYamlDocument } from '@mcs/yaml-engine';
import { describe, expect, it } from 'vitest';

import { hasBlockingIssues, runPipeline } from '../pipeline.js';

/**
 * `generate-large.ts` lives in `@mcs/test-fixtures`, which cannot depend on
 * `@mcs/yaml-engine` (the reverse dependency already exists — yaml-engine's
 * own tests use `readFixture` — and TypeScript project references don't
 * tolerate a cycle). So the "does the benchmark's own corpus actually parse
 * cleanly" check lives here instead, alongside the benchmark that consumes
 * it: both packages are already valid, non-circular dependencies of
 * `@mcs/validator`. If this ever goes red, `import.bench.ts`'s numbers are
 * measuring the blocked-short-circuit path, not the happy path NFR-PERF-02 is about.
 */
describe('generateLargeCorpus (bench input sanity)', () => {
  it('parses with no syntax issues and is not blocking', () => {
    const corpus = generateLargeCorpus();

    const parseResult = MihomoYamlDocument.parse(corpus);
    const issues = runPipeline({ parse: parseResult });

    // Not `toEqual([])`: the corpus deliberately includes realistic-but-risky
    // defaults (`allow-lan: true` + wildcard `bind-address`, an
    // `external-controller` with no `secret`) to be a representative sample
    // — v0.3.0 #13's securityStage correctly flags those as non-blocking
    // warnings. What this benchmark-sanity check actually needs is exactly
    // what its name says: no syntax issues, nothing blocking.
    expect(issues.some((issue) => issue.module === 'yaml')).toBe(false);
    expect(hasBlockingIssues(issues)).toBe(false);
  });

  it('round-trips byte for byte, same as any other input (M0-1)', () => {
    const corpus = generateLargeCorpus();

    const { document } = MihomoYamlDocument.parse(corpus);

    expect(document!.toText()).toBe(corpus);
  });
});
