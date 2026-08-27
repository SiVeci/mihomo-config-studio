import { readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';

import {
  sha256Hex,
  type BundleChannel,
  type BundleFileEntry,
  type BundleManifest,
  type BundleManifestMihomoInfo,
} from '@mcs/schema-registry';

import { checkExtension, checkJsonContent, type StaticCheckIssue } from './static-check.js';

export interface PackOptions {
  readonly sourceDir: string;
  readonly bundleId: string;
  readonly version: string;
  readonly channel: BundleChannel;
  readonly formatVersion: number;
  readonly requiresApp: string;
  readonly mihomo: BundleManifestMihomoInfo;
  readonly signedAt: string;
}

export type PackResult =
  | {
      readonly ok: true;
      readonly manifest: BundleManifest;
      readonly files: ReadonlyMap<string, Uint8Array>;
    }
  | { readonly ok: false; readonly issues: readonly StaticCheckIssue[] };

/**
 * Reads every file under `sourceDir`, static-checks each one (FR-UPD-07),
 * and — only if all of them pass — hashes them into an unsigned manifest.
 * Rejects the whole directory on any violation rather than silently
 * dropping the offending files: `tools/**` is the only place allowed to
 * touch `node:fs`, so this is also the only place that can see the full
 * file list to check in the first place.
 */
export async function packDirectory(options: PackOptions): Promise<PackResult> {
  const relativePaths = listFilesRecursively(options.sourceDir);

  const issues: StaticCheckIssue[] = [];
  const fileBytes = new Map<string, Uint8Array>();
  for (const relativePath of relativePaths) {
    const buffer = readFileSync(join(options.sourceDir, relativePath));
    fileBytes.set(relativePath, new Uint8Array(buffer));

    const extensionIssue = checkExtension(relativePath);
    if (extensionIssue) {
      issues.push(extensionIssue);
      continue;
    }
    if (extname(relativePath).toLowerCase() === '.json') {
      const contentIssue = checkJsonContent(relativePath, buffer.toString('utf8'));
      if (contentIssue) issues.push(contentIssue);
    }
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  const files: BundleFileEntry[] = [];
  for (const [path, bytes] of fileBytes) {
    files.push({ path, sha256: await sha256Hex(bytes) });
  }
  files.sort((a, b) => a.path.localeCompare(b.path));

  const manifest: BundleManifest = {
    bundleId: options.bundleId,
    version: options.version,
    channel: options.channel,
    formatVersion: options.formatVersion,
    requiresApp: options.requiresApp,
    mihomo: options.mihomo,
    files,
    signature: '',
    signedAt: options.signedAt,
  };

  return { ok: true, manifest, files: fileBytes };
}

function listFilesRecursively(rootDir: string, currentRelative = ''): string[] {
  const absoluteDir = currentRelative ? join(rootDir, currentRelative) : rootDir;
  const entries = readdirSync(absoluteDir, { withFileTypes: true });
  const results: string[] = [];
  for (const entry of entries) {
    const relativePath = currentRelative ? `${currentRelative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      results.push(...listFilesRecursively(rootDir, relativePath));
    } else if (entry.isFile()) {
      results.push(relativePath);
    }
  }
  return results;
}
