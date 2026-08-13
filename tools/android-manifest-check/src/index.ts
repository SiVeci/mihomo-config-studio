import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkManifestXml } from './check.js';

/** Finds every AndroidManifest.xml under rootDir (recursive). */
export function findManifests(rootDir: string): string[] {
  return readdirSync(rootDir, { recursive: true })
    .map((entry) => entry.toString())
    .filter((entry) => entry.endsWith('AndroidManifest.xml'))
    .map((entry) => join(rootDir, entry));
}

/** Scans every manifest under rootDir; returns a process exit code (0 = clean). */
export function run(rootDir: string): number {
  const manifests = findManifests(rootDir);
  if (manifests.length === 0) {
    console.error(`No AndroidManifest.xml found under ${rootDir}`);
    return 1;
  }

  let exitCode = 0;
  for (const manifestPath of manifests) {
    const xml = readFileSync(manifestPath, 'utf8');
    const result = checkManifestXml(xml);
    if (result.ok) {
      console.log(`OK   ${manifestPath}`);
    } else {
      exitCode = 1;
      console.error(`FAIL ${manifestPath}`);
      for (const violation of result.violations) {
        console.error(`  - ${violation}`);
      }
    }
  }
  return exitCode;
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  const rootDir = process.argv[2] ?? 'apps/android/android/app/src';
  process.exitCode = run(rootDir);
}
