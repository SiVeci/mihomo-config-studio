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
  downloadAndVerifyLatestKernel,
  KERNEL_DIGESTS,
  type FetchBytes,
  type FetchJson,
} from './download.js';
import { allPassed, formatDryRunPreview, formatReport } from './report.js';
import type { CaseResult } from './report.js';

const execFileAsync = promisify(execFile);

/** GitHub's REST API rejects an unauthenticated request with no `User-Agent` header. */
const GITHUB_FETCH_HEADERS = { 'User-Agent': 'mihomo-config-studio-core-test-runner' };

const fetchBytes: FetchBytes = async (url) => {
  const response = await fetch(url, { headers: GITHUB_FETCH_HEADERS });
  if (!response.ok) {
    throw new Error(`download failed: HTTP ${String(response.status)} for ${url}`);
  }
  return new Uint8Array(await response.arrayBuffer());
};

const fetchJson: FetchJson = async (url) => {
  const response = await fetch(url, { headers: GITHUB_FETCH_HEADERS });
  if (!response.ok) {
    throw new Error(`GitHub API request failed: HTTP ${String(response.status)} for ${url}`);
  }
  return response.json();
};

const readTextFile: ReadTextFile = (path) => readFileSync(path, 'utf8');

/** A `KernelTestCase.id` (e.g. `module-example:proxy-groups:invalid`) turned into a safe cross-platform file name for the temp config file this case is tested through. */
function caseFileName(caseId: string): string {
  return `${caseId.replace(/[^a-zA-Z0-9._-]/g, '-')}.yaml`;
}

/**
 * Stable pins a known-good digest in advance; Beta (ADR-031) follows
 * upstream's own `latest` release and only learns the digest to verify
 * against at run time. The resolved tag and digest are always logged
 * (ADR-031 point (a)) — for Beta this is the only record of exactly which
 * upstream build a given run exercised.
 */
async function acquireKernel(beta: boolean, platformKey: ReturnType<typeof currentPlatformKey>) {
  if (!beta) {
    return downloadAndVerifyKernel(fetchBytes, platformKey);
  }
  const { bytes, resolved } = await downloadAndVerifyLatestKernel(
    fetchJson,
    fetchBytes,
    platformKey,
  );
  console.log(
    `[beta] resolved upstream release ${resolved.tag}: ${resolved.asset} (sha256:${resolved.sha256})`,
  );
  return bytes;
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
  const beta = process.argv.includes('--beta');
  console.log(
    `[track: ${beta ? 'beta' : 'stable'}] running ${String(corpus.length)} kernel test case(s)`,
  );
  const gzipped = await acquireKernel(beta, platformKey);
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
