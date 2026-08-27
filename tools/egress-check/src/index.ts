import { readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkEgress, type EgressSourceFile } from './check.js';

const SCANNED_EXTENSIONS = new Set(['.ts', '.tsx']);
// Build output, never hand-authored source: a compiled `dist/` can carry a
// source comment's prose (e.g. this very tool's own doc comments mentioning
// "fetch(") into a `.d.ts` file, which would otherwise false-positive here
// the moment anyone runs `tsc -b` locally before this tool.
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
  const files: EgressSourceFile[] = relativePaths.map((relativePath) => ({
    path: `${rootDir}/${relativePath}`,
    content: readFileSync(join(rootDir, relativePath), 'utf8'),
  }));

  const result = checkEgress(files);
  if (result.ok) {
    console.log(`No network egress found outside the allowlist in ${rootDir}/.`);
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
