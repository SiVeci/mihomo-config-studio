import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkBuildOutput } from './check.js';

/** Reads `<distDir>/index.html` and `<distDir>/_headers` and runs every ADR-032 check against them. Returns a process exit code (0 = clean). */
export function run(distDir: string): number {
  const indexHtml = readFileSync(join(distDir, 'index.html'), 'utf8');
  const headersFile = readFileSync(join(distDir, '_headers'), 'utf8');

  const issues = checkBuildOutput({ indexHtml, headersFile });
  if (issues.length === 0) {
    console.log(`OK: ${distDir}/index.html and ${distDir}/_headers carry the expected strict CSP.`);
    return 0;
  }

  for (const issue of issues) {
    console.error(`${issue.code}: ${issue.detail}`);
  }
  return 1;
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  const distDir = process.argv[2];
  if (!distDir) {
    console.error('Usage: csp-check <dist-dir>');
    process.exitCode = 1;
  } else {
    process.exitCode = run(distDir);
  }
}
