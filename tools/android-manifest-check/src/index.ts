import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkApkPermissions } from './apk.js';
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

/**
 * Produced-artifact level (FR-AND-06): reads an already-captured
 * `aapt2 dump permissions <apk>` text file — this tool never shells out to
 * `aapt2` itself (no Android SDK dependency here), the caller (a human
 * locally, or the release workflow once an APK exists, v0.6.0 #12) captures
 * the dump and passes its path.
 */
export function runApkDump(dumpFilePath: string): number {
  const dumpOutput = readFileSync(dumpFilePath, 'utf8');
  const result = checkApkPermissions(dumpOutput);
  if (result.ok) {
    console.log(`OK   ${dumpFilePath}`);
    return 0;
  }
  console.error(`FAIL ${dumpFilePath}`);
  for (const violation of result.violations) {
    console.error(`  - unexpected permission: ${violation}`);
  }
  return 1;
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const apkDumpFlagIndex = args.indexOf('--apk-dump');
  if (apkDumpFlagIndex !== -1) {
    const dumpFilePath = args[apkDumpFlagIndex + 1];
    if (!dumpFilePath) {
      console.error('--apk-dump requires a file path argument');
      process.exitCode = 1;
    } else {
      process.exitCode = runApkDump(dumpFilePath);
    }
  } else {
    const rootDir = args[0] ?? 'apps/android/android/app/src';
    process.exitCode = run(rootDir);
  }
}
