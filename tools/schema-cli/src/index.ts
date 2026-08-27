import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { BundleChannel, BundleManifestMihomoInfo } from '@mcs/schema-registry';

import { packDirectory } from './pack.js';
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

function requireFlag(flags: ReadonlyMap<string, string>, name: string): string {
  const value = flags.get(name);
  if (value === undefined) {
    throw new Error(`Missing required argument: ${name}`);
  }
  return value;
}

/** Pure argument parsing, kept separate from process.argv/stdin so it stays unit-testable. */
export function parseCliArgs(argv: readonly string[]): CliArgs {
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (!flag || value === undefined) {
      throw new Error(`Malformed argument at position ${i}.`);
    }
    flags.set(flag, value);
  }

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
 * Takes the private key as a parameter rather than reading stdin itself, so
 * the whole pack → check → sign → write pipeline is testable against a real
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

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  readStdin()
    .then((privateKeyBase64) => run(process.argv.slice(2), privateKeyBase64))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
