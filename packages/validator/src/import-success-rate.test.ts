import { builtinAsStoredBundle, createRegistry } from '@mcs/schema-registry';
import { generateImportCorpus } from '@mcs/test-fixtures';
import { MihomoYamlDocument } from '@mcs/yaml-engine';
import { beforeAll, describe, expect, it } from 'vitest';

import { hasBlockingIssues, runPipeline } from './pipeline.js';

/**
 * §14.1 quality indicator 5 ("1 MB file import success rate >= 99%, legal
 * test corpora") — ADR-037 defines what "legal test corpus" and "import
 * succeeded" mean here and why the judgement below is stricter than the
 * literal "99%" (zero failures, not "at most 1 in 100"). N = 30, chosen and
 * justified in that ADR: real, measured runtime at a sample size large
 * enough to exercise ten modules' worth of different random content, not
 * just one fixed corpus.
 */
const SAMPLE_COUNT = 30;
const BASE_SEED = 20260904;

const modules = createRegistry(builtinAsStoredBundle()).modules();

interface SampleResult {
  readonly seed: number;
  readonly bytes: number;
  readonly ok: boolean;
  readonly failureReason?: string;
}

function checkSample(seed: number): SampleResult {
  const corpus = generateImportCorpus({ seed });
  const bytes = Buffer.byteLength(corpus, 'utf8');
  const parsed = MihomoYamlDocument.parse(corpus);
  const syntaxErrors = parsed.issues.filter((issue) => issue.severity === 'error');
  if (syntaxErrors.length > 0 || !parsed.document) {
    return { seed, bytes, ok: false, failureReason: `syntax error(s): ${syntaxErrors.length}` };
  }

  // Same real path `apps/web/src/worker/protocol.ts`'s `handleParse` uses —
  // not a separate judgement invented for this test (ADR-037 point 2).
  const issues = runPipeline({ parse: parsed, modules });
  if (hasBlockingIssues(issues)) {
    const blockingCodes = issues.filter((issue) => issue.blocking).map((issue) => issue.code);
    return {
      seed,
      bytes,
      ok: false,
      failureReason: `blocking issue(s): ${blockingCodes.join(', ')}`,
    };
  }

  return { seed, bytes, ok: true };
}

describe('1 MB import success rate (§14.1 indicator 5, ADR-037, v1.0.0 #3)', () => {
  // Computed once for the whole file (not per-`it`): both assertions below
  // read the same 30 real results rather than each independently paying the
  // ~2-3s/sample cost a second time.
  let results: SampleResult[] = [];

  beforeAll(async () => {
    const collected: SampleResult[] = [];
    for (let i = 0; i < SAMPLE_COUNT; i++) {
      collected.push(checkSample(BASE_SEED + i));
      // Yields to the event loop between samples — each `checkSample` call
      // is a real, uninterrupted synchronous block (generation + parse +
      // full pipeline). Vitest's own worker <-> main-thread RPC channel
      // (birpc) needs the event loop free to get a heartbeat through within
      // its own ~60s timeout; without this, 30 back-to-back multi-second
      // synchronous calls starve it long enough to throw a spurious
      // "Timeout calling onTaskUpdate" that has nothing to do with whether
      // the samples themselves passed (confirmed empirically: the thrown
      // error appears even on a run where every sample succeeds).
      await new Promise((resolve) => setImmediate(resolve));
    }
    results = collected;
  }, 240_000);

  it(`imports ${String(SAMPLE_COUNT)} distinct ~1 MB legal corpora with zero blocking failures`, () => {
    const failures = results.filter((result) => !result.ok);
    const successCount = results.length - failures.length;
    const successRate = (successCount / results.length) * 100;

    // Printed unconditionally (not just on failure) — this is the real,
    // current-run evidence §12/#12 points to, not a historical claim.
    console.log(
      `import success rate: ${String(successCount)}/${String(results.length)} (${successRate.toFixed(2)}%)`,
    );
    if (failures.length > 0) {
      console.log('failures:', JSON.stringify(failures, null, 2));
    }

    // ADR-037's judgement is stricter than the literal ">= 99%": zero
    // failures, not "at most one in a hundred" — see that ADR for why.
    expect(failures).toEqual([]);
    expect(successRate).toBeGreaterThanOrEqual(99);
  });

  it('every sample is a real ~1 MB corpus, not a degenerate empty/tiny one (sanity, so the success rate above cannot pass vacuously)', () => {
    for (const result of results) {
      expect(result.bytes).toBeGreaterThan(1024 * 1024 * 0.9);
    }
  });
});
