import { generateLargeCorpus } from '@mcs/test-fixtures';
import { MihomoYamlDocument } from '@mcs/yaml-engine';
import { bench, describe } from 'vitest';

import { runPipeline } from '../pipeline.js';

/**
 * NFR-PERF-02: 1 MB import + parse + first validation pass must complete in
 * under 2 seconds. `vitest bench` runs this file (`pnpm vitest bench --run`)
 * — CI runs it too, but only to record numbers, never to fail the build (see
 * `.github/workflows/ci.yml`: runner performance varies too much for a hard
 * gate at this stage; a real threshold is v0.9.0 scope). The three benches
 * below measure parse, first-validation, and total separately — the total
 * is what the exit condition is actually about, but the split is the only
 * thing that tells a future optimizer where time is actually going.
 */

const corpus = generateLargeCorpus();
// A second, independent parse purely to hand `runPipeline` an already-parsed
// document — this isolates "first validation pass" from parsing time, since
// the pipeline itself never re-parses.
const preParsed = MihomoYamlDocument.parse(corpus);

// Each parse takes several hundred ms, so vitest's default ~500ms time
// budget only fits ~10 samples — too few for a stable mean (large RME). 3s
// per bench trades a longer run for numbers worth recording in the baseline doc.
const BENCH_OPTIONS = { time: 3000 };

describe('1 MB corpus import (NFR-PERF-02)', () => {
  bench(
    'parse',
    () => {
      MihomoYamlDocument.parse(corpus);
    },
    BENCH_OPTIONS,
  );

  bench(
    'first validation pass (pre-parsed document)',
    () => {
      runPipeline({ parse: preParsed });
    },
    BENCH_OPTIONS,
  );

  bench(
    'parse + first validation pass (total)',
    () => {
      const parseResult = MihomoYamlDocument.parse(corpus);
      runPipeline({ parse: parseResult });
    },
    BENCH_OPTIONS,
  );
});
