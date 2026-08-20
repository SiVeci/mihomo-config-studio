import { execFile } from 'node:child_process';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { gunzipSync } from 'node:zlib';

import { BUILTIN_TEMPLATES } from '@mcs/templates';

import {
  currentPlatformKey,
  downloadAndVerifyKernel,
  KERNEL_DIGESTS,
  type FetchBytes,
} from './download.js';
import { allPassed, formatDryRunPreview, formatReport } from './report.js';
import type { TemplateTestResult } from './report.js';

const execFileAsync = promisify(execFile);

/**
 * `@mcs/templates`' own `templates/` directory, reached by relative path
 * from this file rather than through the package's `.` export (which is
 * `src/index.ts`, not a filesystem location) — this monorepo's own layout
 * is the only thing this depends on, the same assumption every other
 * cross-package path in `tools/**`/`*.test.ts` already makes (e.g.
 * `schema-builtin/src/builtin.test.ts`'s `MODULES_ROOT`).
 */
const TEMPLATES_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'packages',
  'templates',
  'templates',
);

const fetchBytes: FetchBytes = async (url) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`download failed: HTTP ${String(response.status)} for ${url}`);
  }
  return new Uint8Array(await response.arrayBuffer());
};

async function runConfigTest(
  binaryPath: string,
  configPath: string,
): Promise<Pick<TemplateTestResult, 'exitCode' | 'stderr'>> {
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
  if (process.argv.includes('--dry-run')) {
    // Independent of the local machine's own platform: this previews what
    // the tool *knows* (the full digest table, and which templates it would
    // run), not what would happen if the real path ran on whichever OS a
    // contributor happens to be developing on. CI always runs this on
    // `ubuntu-latest` (`linux-amd64`, the one pinned row), but `--dry-run`
    // itself needs to stay runnable — and exit 0 — on any contributor's
    // machine, matching how this repo's other acceptance commands work
    // everywhere the same way.
    console.log(
      formatDryRunPreview(
        KERNEL_DIGESTS,
        BUILTIN_TEMPLATES.map((template) => template.id),
      ),
    );
    return;
  }

  const platformKey = currentPlatformKey(process.platform, process.arch);
  const gzipped = await downloadAndVerifyKernel(fetchBytes, platformKey);
  const binary = gunzipSync(gzipped);

  const workDir = mkdtempSync(join(tmpdir(), 'mihomo-core-test-'));
  const binaryPath = join(workDir, 'mihomo');
  writeFileSync(binaryPath, binary);
  chmodSync(binaryPath, 0o755);

  const results: TemplateTestResult[] = [];
  for (const template of BUILTIN_TEMPLATES) {
    const configPath = join(TEMPLATES_ROOT, template.configPath);
    const { exitCode, stderr } = await runConfigTest(binaryPath, configPath);
    results.push({ templateId: template.id, exitCode, stderr });
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
