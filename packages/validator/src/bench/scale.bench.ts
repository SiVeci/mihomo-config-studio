import { HistoryStack } from '@mcs/config-model';
import { builtinAsStoredBundle, createRegistry } from '@mcs/schema-registry';
import { generateScaleCorpus } from '@mcs/test-fixtures';
import { MihomoYamlDocument } from '@mcs/yaml-engine';
import { bench, describe } from 'vitest';

import { runPipeline } from '../pipeline.js';

/**
 * NFR-PERF-04: three baseline numbers for a "1,000 entities + 10,000 rules"
 * corpus — sort, batch replace, full validation (the version document's own
 * three-item list). Measurement only (v0.4.0 #14); optimizing based on what
 * these numbers show is #15's job, kept in a separate slice so the
 * measurement is not shaped by already knowing the fix (same reasoning
 * `import.bench.ts` documents for NFR-PERF-02).
 */

const ENTITY_COUNT = 1_000;
const RULE_COUNT = 10_000;
const BATCH_SIZE = 1_000;
const CONSECUTIVE_MOVES = 100;

const corpus = generateScaleCorpus({ entityCount: ENTITY_COUNT, ruleCount: RULE_COUNT });
const modules = createRegistry(builtinAsStoredBundle()).modules();

function parsedDocument(): MihomoYamlDocument {
  const document = MihomoYamlDocument.parse(corpus).document;
  if (!document) throw new Error('generateScaleCorpus produced an unparseable fixture');
  return document;
}

// `iterations` caps how many samples a fast bench collects within the 3s
// window — `single moveSeqItem` alone was measured collecting ~500,000
// samples uncapped (each call costs microseconds), and tinybench reports the
// full raw sample array back to the main vitest process over the worker RPC
// channel. 2,000 is already far more than needed for a stable, low-RME mean
// on an operation this cheap; capping it is a reasonable reduction in RPC
// payload size regardless of the note below, even though testing showed it
// alone does not eliminate that issue.
const BENCH_OPTIONS = { time: 3000, iterations: 2000 };

/**
 * `tinybench`'s own default `iterations`/`warmupIterations` (10 and 5) are
 * a *minimum* sample floor — its loop condition is `elapsed < time OR
 * samples < iterations`, so it keeps sampling until **both** the time
 * budget is spent **and** the iteration floor is met, not either one
 * alone. That is invisible for `import.bench.ts`-style benches (each
 * sample is milliseconds), but `schemaStage` alone measured ~40s on this
 * corpus (see `v0.4.0-perf-baseline.md`) — left at the defaults, warmup
 * (5 samples) plus the main run (10 more) would demand fifteen full ~40s
 * passes, around ten minutes for one `describe` block. `iterations: 1,
 * warmupIterations: 0` takes exactly the one real sample this scale
 * actually affords per process; the baseline doc's "5 independent process
 * calls" is what supplies statistical robustness instead, the same
 * methodology `v0.2.0-perf-baseline.md`/`v0.3.0-perf-baseline.md` already
 * use for expensive, coarse-grained measurements.
 */
const EXPENSIVE_BENCH_OPTIONS = { time: 1, iterations: 1, warmupTime: 1, warmupIterations: 0 };

/**
 * Known flake under system load, not fixed by anything above: vitest's
 * worker-to-main-process RPC (`birpc`, 60s default timeout per call) can
 * throw `[vitest-worker]: Timeout calling "onTaskUpdate"` and make the whole
 * `vitest bench --run` process exit non-zero, even though every `bench()`
 * block above it already completed and printed valid numbers — confirmed by
 * re-running under lighter load, which passes cleanly. This is inherent to
 * "benchmarking" something whose own single sample takes double-digit
 * seconds (an unusual shape for `tinybench`, which is built around many fast
 * samples) combined with an experimental vitest feature — no config knob
 * exposes `birpc`'s timeout through `vitest.config.ts`, and this file's own
 * measured numbers are unaffected either way (the failure surfaces only
 * after the real results are already reported). If this reproduces, re-run
 * once; the recorded baseline in `v0.4.0-perf-baseline.md` came from a clean
 * run.
 */

describe('10,000-rule sort (NFR-PERF-04)', () => {
  const singleMoveDoc = parsedDocument();
  bench(
    'single moveSeqItem',
    () => {
      singleMoveDoc.moveSeqItem(['rules'], 0, RULE_COUNT - 1);
    },
    BENCH_OPTIONS,
  );

  const consecutiveMoveDoc = parsedDocument();
  bench(
    `${CONSECUTIVE_MOVES} consecutive moves`,
    () => {
      for (let i = 0; i < CONSECUTIVE_MOVES; i += 1) {
        consecutiveMoveDoc.moveSeqItem(['rules'], i % RULE_COUNT, (i + 1) % RULE_COUNT);
      }
    },
    BENCH_OPTIONS,
  );
});

describe('10,000-rule batch replace (NFR-PERF-04)', () => {
  const batchDoc = parsedDocument();
  bench(
    `applyBatch-equivalent replacing ${BATCH_SIZE} rule targets`,
    () => {
      // Mirrors `handleApplyBatch` (`apps/web/src/worker/protocol.ts`) —
      // every patch inside one `HistoryStack.record()` call, which is what
      // makes the whole batch a single undo step (ADR-023). A fresh stack
      // per sample avoids piling up thousands of history entries across the
      // many samples one `bench()` run collects.
      const stack = new HistoryStack();
      stack.record(batchDoc, 'bench-batch', () => {
        for (let i = 0; i < BATCH_SIZE; i += 1) {
          batchDoc.setIn(['rules', i], `MATCH,BENCH-${i}`);
        }
      });
    },
    BENCH_OPTIONS,
  );
});

describe(`${ENTITY_COUNT} entities + ${RULE_COUNT} rules full validation (NFR-PERF-04)`, () => {
  bench(
    'runPipeline, all stages',
    () => {
      const parseResult = MihomoYamlDocument.parse(corpus);
      runPipeline({ parse: parseResult, modules });
    },
    EXPENSIVE_BENCH_OPTIONS,
  );
});
