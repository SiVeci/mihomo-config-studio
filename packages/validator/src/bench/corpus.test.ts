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

    expect(issues).toEqual([]);
    expect(hasBlockingIssues(issues)).toBe(false);
  });

  it('round-trips byte for byte, same as any other input (M0-1)', () => {
    const corpus = generateLargeCorpus();

    const { document } = MihomoYamlDocument.parse(corpus);

    expect(document!.toText()).toBe(corpus);
  });
});
