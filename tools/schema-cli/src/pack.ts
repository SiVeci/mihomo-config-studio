import { readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';

import {
  checkExtension,
  checkJsonContent,
  checkNoUnstableFieldsForChannel,
  sha256Hex,
  type BundleChannel,
  type BundleFileEntry,
  type BundleManifest,
  type BundleManifestMihomoInfo,
  type StaticCheckIssue,
} from '@mcs/schema-registry';

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

export type CheckDirectoryResult =
  | { readonly ok: true; readonly files: ReadonlyMap<string, Uint8Array> }
  | { readonly ok: false; readonly issues: readonly StaticCheckIssue[] };

/**
 * Reads every file under `sourceDir` and static-checks each one (FR-UPD-07)
 * — the read-and-check half `packDirectory` and the CLI's own `check`
 * subcommand both need, factored out so there is exactly one file-walking
 * loop rather than two that could drift. `tools/**` is the only place
 * allowed to touch `node:fs`, so this is also the only place that can see
 * the full file list to check in the first place.
 *
 * `channel` is optional: the standalone `check` subcommand doesn't
 * necessarily know which channel a directory is destined for, so omitting it
 * simply skips the channel-specific "no `x-unstable` field in a Stable
 * Bundle" rule (ADR-031) — `pack` always passes its own `--channel` through.
 */
export function checkDirectoryFiles(
  sourceDir: string,
  channel?: BundleChannel,
): CheckDirectoryResult {
  const relativePaths = listFilesRecursively(sourceDir);

  const issues: StaticCheckIssue[] = [];
  const fileBytes = new Map<string, Uint8Array>();
  const jsonText = new Map<string, string>();
  for (const relativePath of relativePaths) {
    const buffer = readFileSync(join(sourceDir, relativePath));
    fileBytes.set(relativePath, new Uint8Array(buffer));

    const extensionIssue = checkExtension(relativePath);
    if (extensionIssue) {
      issues.push(extensionIssue);
      continue;
    }
    if (extname(relativePath).toLowerCase() === '.json') {
      const text = buffer.toString('utf8');
      jsonText.set(relativePath, text);
      const contentIssue = checkJsonContent(relativePath, text);
      if (contentIssue) issues.push(contentIssue);
    }
  }
  if (channel !== undefined) {
    issues.push(...checkNoUnstableFieldsForChannel(jsonText, channel));
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }
  return { ok: true, files: fileBytes };
}

/**
 * Static-checks `sourceDir` (via `checkDirectoryFiles`) and — only if it
 * passes — hashes the files into an unsigned manifest. Rejects the whole
 * directory on any violation rather than silently dropping the offending
 * files.
 */
export async function packDirectory(options: PackOptions): Promise<PackResult> {
  const checked = checkDirectoryFiles(options.sourceDir, options.channel);
  if (!checked.ok) {
    return checked;
  }

  const files: BundleFileEntry[] = [];
  for (const [path, bytes] of checked.files) {
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

  return { ok: true, manifest, files: checked.files };
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
