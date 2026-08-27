import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { BundleChannel, BundleManifest, BundleManifestMihomoInfo } from '@mcs/schema-registry';

import { diffDirectories, formatDiffReport } from './diff.js';
import { checkDirectoryFiles, packDirectory } from './pack.js';
import { decodePrivateKeyBase64, signManifest } from './sign.js';

export interface CliArgs {
  readonly sourceDir: string;
  readonly bundleId: string;
  readonly version: string;
  readonly channel: BundleChannel;
  readonly formatVersion: number;
  readonly requiresApp: string;
  readonly mihomo: BundleManifestMihomoInfo;
  readonly outFile: string;
}

const REQUIRED_FLAGS = [
  '--source',
  '--bundle-id',
  '--version',
  '--channel',
  '--format-version',
  '--requires-app',
  '--mihomo-min-version',
  '--mihomo-max-tested-version',
  '--mihomo-upstream-commit',
  '--mihomo-docs-snapshot',
  '--out',
] as const;

function parseFlags(argv: readonly string[]): Map<string, string> {
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (!flag || value === undefined) {
      throw new Error(`Malformed argument at position ${i}.`);
    }
    flags.set(flag, value);
  }
  return flags;
}

function requireFlag(flags: ReadonlyMap<string, string>, name: string): string {
  const value = flags.get(name);
  if (value === undefined) {
    throw new Error(`Missing required argument: ${name}`);
  }
  return value;
}

/** Pure argument parsing, kept separate from process.argv/stdin so it stays unit-testable. */
export function parseCliArgs(argv: readonly string[]): CliArgs {
  const flags = parseFlags(argv);

  for (const flag of REQUIRED_FLAGS) {
    requireFlag(flags, flag);
  }

  const channel = flags.get('--channel');
  if (channel !== 'stable' && channel !== 'beta') {
    throw new Error('--channel must be "stable" or "beta".');
  }

  const formatVersion = Number(requireFlag(flags, '--format-version'));
  if (!Number.isInteger(formatVersion)) {
    throw new Error('--format-version must be an integer.');
  }

  return {
    sourceDir: requireFlag(flags, '--source'),
    bundleId: requireFlag(flags, '--bundle-id'),
    version: requireFlag(flags, '--version'),
    channel,
    formatVersion,
    requiresApp: requireFlag(flags, '--requires-app'),
    mihomo: {
      minVersion: requireFlag(flags, '--mihomo-min-version'),
      maxTestedVersion: requireFlag(flags, '--mihomo-max-tested-version'),
      upstreamCommit: requireFlag(flags, '--mihomo-upstream-commit'),
      docsSnapshot: requireFlag(flags, '--mihomo-docs-snapshot'),
    },
    outFile: requireFlag(flags, '--out'),
  };
}

/** Reads the whole of stdin as text — this is where the private key comes in (ADR-010 §4: never a CLI argument). */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * `pack` subcommand — unchanged behavior and flag shape from before v0.5.0
 * #13's subcommand split (no breaking rename): pack, static-check, sign and
 * write, all in one step. Takes the private key as a parameter rather than
 * reading stdin itself, so the whole pipeline is testable against a real
 * temp directory without mocking process.stdin.
 */
export async function run(argv: readonly string[], privateKeyBase64: string): Promise<void> {
  const args = parseCliArgs(argv);

  const packed = await packDirectory({
    sourceDir: args.sourceDir,
    bundleId: args.bundleId,
    version: args.version,
    channel: args.channel,
    formatVersion: args.formatVersion,
    requiresApp: args.requiresApp,
    mihomo: args.mihomo,
    signedAt: new Date().toISOString(),
  });

  if (!packed.ok) {
    for (const issue of packed.issues) {
      console.error(`${issue.code}: ${issue.path}`);
    }
    throw new Error(`Static check rejected ${packed.issues.length} file(s).`);
  }

  const privateKey = decodePrivateKeyBase64(privateKeyBase64);
  const signature = await signManifest(packed.manifest, privateKey);

  const signedManifest = { ...packed.manifest, signature };
  writeFileSync(args.outFile, JSON.stringify(signedManifest, null, 2));
  console.log(`Wrote ${args.outFile}`);
}

export interface CheckArgs {
  readonly sourceDir: string;
}

export function parseCheckArgs(argv: readonly string[]): CheckArgs {
  const flags = parseFlags(argv);
  return { sourceDir: requireFlag(flags, '--source') };
}

/**
 * `check` subcommand — only the static-check half of `pack` (FR-UPD-07):
 * no signing, no output file. The local pre-PR gate, and what the release
 * workflow's own "Schema 静态检查" step runs (#14).
 */
export function runCheck(argv: readonly string[]): void {
  const args = parseCheckArgs(argv);
  const result = checkDirectoryFiles(args.sourceDir);
  if (!result.ok) {
    for (const issue of result.issues) {
      console.error(`${issue.code}: ${issue.path}`);
    }
    throw new Error(`Static check rejected ${result.issues.length} file(s).`);
  }
  console.log(`OK: ${result.files.size} file(s) checked, no issues.`);
}

export interface DiffArgs {
  readonly oldDir: string;
  readonly newDir: string;
}

export function parseDiffArgs(argv: readonly string[]): DiffArgs {
  const flags = parseFlags(argv);
  return { oldDir: requireFlag(flags, '--old'), newDir: requireFlag(flags, '--new') };
}

/** `diff` subcommand — a human-readable field-level report between two module-source directories, for pasting into a release PR. Reuses #7's `diffSchemas`, never a second diff algorithm. */
export function runDiff(argv: readonly string[]): void {
  const args = parseDiffArgs(argv);
  const reports = diffDirectories(args);
  console.log(formatDiffReport(reports));
}

export interface SignArgs {
  readonly manifestFile: string;
  readonly outFile: string;
}

export function parseSignArgs(argv: readonly string[]): SignArgs {
  const flags = parseFlags(argv);
  return {
    manifestFile: requireFlag(flags, '--manifest'),
    outFile: requireFlag(flags, '--out'),
  };
}

/**
 * `sign` subcommand — signs an *already-packed, unsigned* manifest, never
 * rebuilding it from source (ADR-010 §1: the signing job only consumes
 * artifacts that already passed the test matrix). The private key is still
 * only ever read from stdin (ADR-010 §4) — no new flag accepts it.
 */
export async function runSign(argv: readonly string[], privateKeyBase64: string): Promise<void> {
  const args = parseSignArgs(argv);
  const manifest = JSON.parse(readFileSync(args.manifestFile, 'utf8')) as BundleManifest;
  const privateKey = decodePrivateKeyBase64(privateKeyBase64);
  const signature = await signManifest(manifest, privateKey);
  const signedManifest = { ...manifest, signature };
  writeFileSync(args.outFile, JSON.stringify(signedManifest, null, 2));
  console.log(`Wrote ${args.outFile}`);
}

async function main(): Promise<void> {
  const [subcommand, ...rest] = process.argv.slice(2);
  switch (subcommand) {
    case 'pack':
      await run(rest, await readStdin());
      return;
    case 'check':
      runCheck(rest);
      return;
    case 'diff':
      runDiff(rest);
      return;
    case 'sign':
      await runSign(rest, await readStdin());
      return;
    default:
      throw new Error(
        `Unknown subcommand "${subcommand ?? ''}". Expected one of: pack, check, diff, sign.`,
      );
  }
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
