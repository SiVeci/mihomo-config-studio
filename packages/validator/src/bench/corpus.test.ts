import { generateLargeCorpus, generateScaleCorpus } from '@mcs/test-fixtures';
import { MihomoYamlDocument } from '@mcs/yaml-engine';
import { describe, expect, it } from 'vitest';

import { hasBlockingIssues, runPipeline, syntaxStage } from '../pipeline.js';
import { referenceStage } from '../reference.js';
import { ruleOrderStage } from '../rule-order.js';
import { securityStage } from '../security.js';

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
  // v0.4.0 #5: on this ~1MB/13k-rule corpus, ruleOrderStage's own shadowing
  // algorithm finishes in <15ms (verified in isolation) — the real cost is
  // MihomoYamlDocument#locate(), called once per issue (this corpus's
  // realistic `10.x.y.0/24` overlap produces ~365 shadowing warnings).
  // `#positionState()` (yaml-engine/src/document.ts) calls `toText()`
  // *before* its cache-hit check, so every `locate()` call re-serialises the
  // whole document from CST tokens regardless of whether a re-parse was
  // actually needed — ~1.7s for 365 calls on a 1MB document. This is a
  // pre-existing `yaml-engine` characteristic (every stage's issue -> range
  // lookup pays it, not something specific to rule-order's algorithm), only
  // exposed here because this is the first stage that produces hundreds of
  // issues on a large, realistic document. Flagged for #14/#15 rather than
  // fixed here — likely fix is a version counter bumped by every mutating
  // method, compared instead of re-serialising to compare by value.
  //
  // v0.9.0 #1: raised 10s -> 60s. The original 10s held on a fast dev box but
  // not on a 2-core shared GitHub runner under v8 coverage instrumentation —
  // this was the last red step of the repo's first-ever real CI run
  // (`Test timed out in 10000ms`, corpus.test.ts:37). v0.6.0's plan already
  // predicted it (risk R2: the 10s margin was "已经不够稳" locally under
  // --coverage, "若 CI 也复现" it should be handled); this is that
  // reproduction.
  //
  // What is relaxed is a *wall-clock guard on a correctness test*, not a
  // performance threshold: the two assertions below are "no syntax issues"
  // and "nothing blocking" — neither says anything about speed, and neither
  // is touched. The genuine slowness is the `#positionState()` characteristic
  // described above, and it gets measured for real, with an actual threshold,
  // by v0.9.0 #10/#11 — not by this timeout. Same reasoning and same value as
  // v0.6.0 #0's fix for `rule-list-scale.perf.test.tsx`.
  const SLOW_STAGE_TIMEOUT_MS = 60_000;

  it(
    'parses with no syntax issues and is not blocking',
    () => {
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
    },
    SLOW_STAGE_TIMEOUT_MS,
  );

  it('round-trips byte for byte, same as any other input (M0-1)', () => {
    const corpus = generateLargeCorpus();

    const { document } = MihomoYamlDocument.parse(corpus);

    expect(document!.toText()).toBe(corpus);
  });
});

/**
 * Same sanity purpose as above, for `scale.bench.ts`'s input — but deliberately
 * runs only `syntax`/`reference`/`ruleOrder`/`security`, never `schemaStage`.
 * `schemaStage` is *the* dominant cost at this corpus's scale (measured
 * ~40s for the 10,000 `unknown-field` issues a `rules:` array item-by-item
 * produces today — see `v0.4.0-perf-baseline.md`), and running it here would
 * turn an ordinary `pnpm run check` test into a 40-second one for a check
 * that has nothing to do with `schemaStage` in the first place: whether the
 * *corpus* is well-formed only depends on whether references/order/security
 * are clean, which `schemaStage`'s findings do not affect either way.
 */
describe('generateScaleCorpus (bench input sanity, v0.4.0 #14)', () => {
  it('parses with no syntax issues and no blocking reference/rule-order/security issues', () => {
    const corpus = generateScaleCorpus();

    const parseResult = MihomoYamlDocument.parse(corpus);
    const issues = runPipeline({ parse: parseResult }, [
      syntaxStage,
      referenceStage,
      ruleOrderStage,
      securityStage,
    ]);

    expect(issues.some((issue) => issue.code.startsWith('reference.'))).toBe(false);
    expect(hasBlockingIssues(issues)).toBe(false);
  });

  it('round-trips byte for byte, same as any other input (M0-1)', () => {
    const corpus = generateScaleCorpus();

    const { document } = MihomoYamlDocument.parse(corpus);

    expect(document!.toText()).toBe(corpus);
  });
});
