import { execFile } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { gunzipSync } from 'node:zlib';

import { BUILTIN_MODULE_FILES } from '@mcs/schema-builtin';

import { buildCorpus, type KernelTestCase, type ReadTextFile } from './corpus.js';
import {
  currentPlatformKey,
  downloadAndVerifyKernel,
  KERNEL_DIGESTS,
  type FetchBytes,
} from './download.js';
import { allPassed, formatDryRunPreview, formatReport } from './report.js';
import type { CaseResult } from './report.js';

const execFileAsync = promisify(execFile);

const fetchBytes: FetchBytes = async (url) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`download failed: HTTP ${String(response.status)} for ${url}`);
  }
  return new Uint8Array(await response.arrayBuffer());
};

const readTextFile: ReadTextFile = (path) => readFileSync(path, 'utf8');

/** A `KernelTestCase.id` (e.g. `module-example:proxy-groups:invalid`) turned into a safe cross-platform file name for the temp config file this case is tested through. */
function caseFileName(caseId: string): string {
  return `${caseId.replace(/[^a-zA-Z0-9._-]/g, '-')}.yaml`;
}

async function runConfigTest(
  binaryPath: string,
  workDir: string,
  testCase: KernelTestCase,
): Promise<Pick<CaseResult, 'exitCode' | 'stderr'>> {
  const configPath = join(workDir, caseFileName(testCase.id));
  writeFileSync(configPath, testCase.configText, 'utf8');
  try {
    await execFileAsync(binaryPath, ['-t', '-f', configPath]);
    return { exitCode: 0, stderr: '' };
  } catch (error) {
    const execError = error as { code?: number; stderr?: string };
    return {
      exitCode: typeof execError.code === 'number' ? execError.code : 1,
      stderr: execError.stderr ?? String(error),
    };
  }
}

async function main(): Promise<void> {
  const corpus = await buildCorpus(readTextFile, Object.values(BUILTIN_MODULE_FILES));

  if (process.argv.includes('--dry-run')) {
    // Independent of the local machine's own platform: this previews what
    // the tool *knows* (the full digest table, and the full corpus it would
    // run), not what would happen if the real path ran on whichever OS a
    // contributor happens to be developing on. CI always runs this on
    // `ubuntu-latest` (`linux-amd64`, the one pinned row), but `--dry-run`
    // itself needs to stay runnable — and exit 0 — on any contributor's
    // machine, matching how this repo's other acceptance commands work
    // everywhere the same way.
    console.log(formatDryRunPreview(KERNEL_DIGESTS, corpus));
    return;
  }

  const platformKey = currentPlatformKey(process.platform, process.arch);
  const gzipped = await downloadAndVerifyKernel(fetchBytes, platformKey);
  const binary = gunzipSync(gzipped);

  const workDir = mkdtempSync(join(tmpdir(), 'mihomo-core-test-'));
  const binaryPath = join(workDir, 'mihomo');
  writeFileSync(binaryPath, binary);
  chmodSync(binaryPath, 0o755);

  const results: CaseResult[] = [];
  for (const testCase of corpus) {
    const { exitCode, stderr } = await runConfigTest(binaryPath, workDir, testCase);
    results.push({
      id: testCase.id,
      kind: testCase.kind,
      expect: testCase.expect,
      exitCode,
      stderr,
    });
  }

  console.log(formatReport(results));
  if (!allPassed(results)) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
