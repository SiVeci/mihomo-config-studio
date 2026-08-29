import { readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkLogRedaction, type LogRedactionSourceFile } from './check.js';

const SCANNED_EXTENSIONS = new Set(['.ts', '.tsx']);
// Build output, never hand-authored source — same reasoning tools/egress-check
// already documents: a compiled `dist/` can carry a source comment's prose
// (e.g. this very tool's own doc comments mentioning "console.") into a
// `.d.ts` file, which would otherwise false-positive the moment anyone runs
// `tsc -b` locally before this tool.
const SKIPPED_DIRECTORY_NAMES = new Set(['dist', 'node_modules']);

function isSourceFile(name: string): boolean {
  return SCANNED_EXTENSIONS.has(extname(name)) && !name.endsWith('.d.ts');
}

function listFilesRecursively(rootDir: string, currentRelative = ''): string[] {
  const absoluteDir = currentRelative ? join(rootDir, currentRelative) : rootDir;
  const entries = readdirSync(absoluteDir, { withFileTypes: true });
  const results: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory() && SKIPPED_DIRECTORY_NAMES.has(entry.name)) continue;
    const relativePath = currentRelative ? `${currentRelative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      results.push(...listFilesRecursively(rootDir, relativePath));
    } else if (entry.isFile() && isSourceFile(entry.name)) {
      results.push(relativePath);
    }
  }
  return results;
}

/** Scans every `.ts`/`.tsx` file under rootDir; returns a process exit code (0 = clean). */
export function run(rootDir: string): number {
  const relativePaths = listFilesRecursively(rootDir);
  const files: LogRedactionSourceFile[] = relativePaths.map((relativePath) => ({
    path: `${rootDir}/${relativePath}`,
    content: readFileSync(join(rootDir, relativePath), 'utf8'),
  }));

  const result = checkLogRedaction(files);
  if (result.ok) {
    console.log(
      `No direct console.* call found outside the log-redaction allowlist in ${rootDir}/.`,
    );
    return 0;
  }

  for (const violation of result.violations) {
    console.error(`${violation.path}: ${violation.reason}`);
  }
  return 1;
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  const rootDir = process.argv[2] ?? 'packages';
  process.exitCode = run(rootDir);
}
