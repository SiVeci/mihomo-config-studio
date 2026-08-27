import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { verifyBundle, type BundleManifest } from '@mcs/schema-registry';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  parseCheckArgs,
  parseCliArgs,
  parseDiffArgs,
  parseSignArgs,
  run,
  runCheck,
  runDiff,
  runSign,
} from './index.js';

const VALID_ARGV = [
  '--source',
  './modules',
  '--bundle-id',
  'official',
  '--version',
  '2026.08.0',
  '--channel',
  'stable',
  '--format-version',
  '1',
  '--requires-app',
  '0.1.0',
  '--mihomo-min-version',
  '1.19.29',
  '--mihomo-max-tested-version',
  '1.19.29',
  '--mihomo-upstream-commit',
  'e26714a181ac0e2fa803453c0a8e9a9ce94e31cb',
  '--mihomo-docs-snapshot',
  '2026-08-19',
  '--out',
  './out/manifest.json',
];

describe('parseCliArgs', () => {
  it('parses a full, well-formed argument list', () => {
    expect(parseCliArgs(VALID_ARGV)).toEqual({
      sourceDir: './modules',
      bundleId: 'official',
      version: '2026.08.0',
      channel: 'stable',
      formatVersion: 1,
      requiresApp: '0.1.0',
      mihomo: {
        minVersion: '1.19.29',
        maxTestedVersion: '1.19.29',
        upstreamCommit: 'e26714a181ac0e2fa803453c0a8e9a9ce94e31cb',
        docsSnapshot: '2026-08-19',
      },
      outFile: './out/manifest.json',
    });
  });

  it('accepts the beta channel', () => {
    const argv = VALID_ARGV.map((token) => (token === 'stable' ? 'beta' : token));
    expect(parseCliArgs(argv).channel).toBe('beta');
  });

  it('throws when a required flag is missing', () => {
    // Drop the leading "--source ./modules" pair.
    const argv = VALID_ARGV.slice(2);
    expect(() => parseCliArgs(argv)).toThrow(/--source/);
  });

  it('throws when --channel is neither stable nor beta', () => {
    const argv = VALID_ARGV.map((token) => (token === 'stable' ? 'nightly' : token));
    expect(() => parseCliArgs(argv)).toThrow(/stable.*beta/);
  });

  it('throws when --format-version is not an integer', () => {
    const argv = VALID_ARGV.map((token) => (token === '1' ? 'one' : token));
    expect(() => parseCliArgs(argv)).toThrow(/--format-version/);
  });

  it('throws on a dangling flag with no value', () => {
    expect(() => parseCliArgs(['--source'])).toThrow(/Malformed argument/);
  });
});

describe('run', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function makeWorkDir(): { sourceDir: string; outFile: string } {
    const root = mkdtempSync(join(tmpdir(), 'schema-cli-run-test-'));
    tempDirs.push(root);
    const sourceDir = join(root, 'source');
    mkdirSync(sourceDir, { recursive: true });
    return { sourceDir, outFile: join(root, 'manifest.json') };
  }

  it('packs, signs and writes a manifest that the schema-registry verifier accepts', async () => {
    const { sourceDir, outFile } = makeWorkDir();
    writeFileSync(join(sourceDir, 'general.json'), JSON.stringify({ type: 'object' }));

    const keyPair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
    if (!('publicKey' in keyPair) || !('privateKey' in keyPair)) {
      throw new Error('Ed25519 key generation did not return a key pair');
    }
    const privateKeyBase64 = Buffer.from(
      await crypto.subtle.exportKey('pkcs8', keyPair.privateKey),
    ).toString('base64');
    const publicKeyRaw = new Uint8Array(await crypto.subtle.exportKey('raw', keyPair.publicKey));

    await run(
      [
        '--source',
        sourceDir,
        '--bundle-id',
        'official',
        '--version',
        '2026.08.0',
        '--channel',
        'stable',
        '--format-version',
        '1',
        '--requires-app',
        '0.1.0',
        '--mihomo-min-version',
        '1.19.29',
        '--mihomo-max-tested-version',
        '1.19.29',
        '--mihomo-upstream-commit',
        'e26714a181ac0e2fa803453c0a8e9a9ce94e31cb',
        '--mihomo-docs-snapshot',
        '2026-08-19',
        '--out',
        outFile,
      ],
      privateKeyBase64,
    );

    expect(existsSync(outFile)).toBe(true);
    const manifest = JSON.parse(readFileSync(outFile, 'utf8')) as BundleManifest;
    const files = new Map([
      ['general.json', new TextEncoder().encode(JSON.stringify({ type: 'object' }))],
    ]);

    const result = await verifyBundle(manifest, files, {
      currentAppVersion: '0.1.0',
      minFormatVersion: 1,
      maxFormatVersion: 1,
      trustedPublicKeys: [publicKeyRaw],
    });
    expect(result).toEqual({ ok: true, manifest });
  });

  it('rejects a source directory with disallowed content and never writes the output file', async () => {
    const { sourceDir, outFile } = makeWorkDir();
    writeFileSync(join(sourceDir, 'payload.js'), 'console.log(1)');

    await expect(
      run(
        [
          '--source',
          sourceDir,
          '--bundle-id',
          'official',
          '--version',
          '2026.08.0',
          '--channel',
          'stable',
          '--format-version',
          '1',
          '--requires-app',
          '0.1.0',
          '--mihomo-min-version',
          '1.19.29',
          '--mihomo-max-tested-version',
          '1.19.29',
          '--mihomo-upstream-commit',
          'e26714a181ac0e2fa803453c0a8e9a9ce94e31cb',
          '--mihomo-docs-snapshot',
          '2026-08-19',
          '--out',
          outFile,
        ],
        'irrelevant-base64',
      ),
    ).rejects.toThrow(/Static check rejected/);

    expect(existsSync(outFile)).toBe(false);
  });
});

describe('parseCheckArgs', () => {
  it('parses --source', () => {
    expect(parseCheckArgs(['--source', './modules'])).toEqual({ sourceDir: './modules' });
  });

  it('throws when --source is missing', () => {
    expect(() => parseCheckArgs([])).toThrow(/--source/);
  });
});

describe('runCheck (v0.5.0 #13, FR-UPD-07)', () => {
  const tempDirs: string[] = [];
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function makeSourceDir(): string {
    const root = mkdtempSync(join(tmpdir(), 'schema-cli-check-test-'));
    tempDirs.push(root);
    return root;
  }

  it('does not throw and never writes anything for a clean directory', () => {
    const sourceDir = makeSourceDir();
    writeFileSync(join(sourceDir, 'general.json'), JSON.stringify({ type: 'object' }));

    expect(() => runCheck(['--source', sourceDir])).not.toThrow();
  });

  it('throws, listing every violation, for a directory with disallowed content — same static check pack uses, without signing or writing', () => {
    const sourceDir = makeSourceDir();
    writeFileSync(join(sourceDir, 'payload.js'), 'console.log(1)');

    expect(() => runCheck(['--source', sourceDir])).toThrow(/Static check rejected/);
  });

  it('rejects a migration file with an unknown opcode (ADR-025) — the real gap this slice closes', () => {
    const sourceDir = makeSourceDir();
    writeFileSync(
      join(sourceDir, 'general.json'),
      JSON.stringify({
        migrations: [{ from: '1.0.0', to: '2.0.0', operations: [{ op: 'run-script', path: 'x' }] }],
      }),
    );

    expect(() => runCheck(['--source', sourceDir])).toThrow(/Static check rejected/);
  });

  it("accepts the real, shipping built-in modules directory (exit condition 7 acceptance, plan's own manual command) — plain `node dist/index.js` cannot run this repo's multi-file source-only `packages/**` exports (ADR-007) without a TS-aware loader, so this exercises the identical `checkDirectoryFiles` code path through vitest instead, against the real directory rather than a synthetic one", () => {
    const modulesDir = join(
      dirname(fileURLToPath(import.meta.url)),
      '../../../packages/schema-builtin/modules',
    );

    expect(() => runCheck(['--source', modulesDir])).not.toThrow();
  });
});

describe('parseDiffArgs', () => {
  it('parses --old and --new', () => {
    expect(parseDiffArgs(['--old', './a', '--new', './b'])).toEqual({
      oldDir: './a',
      newDir: './b',
    });
  });

  it('throws when --old is missing', () => {
    expect(() => parseDiffArgs(['--new', './b'])).toThrow(/--old/);
  });
});

describe('runDiff (v0.5.0 #13, FR-UPD-06)', () => {
  const tempDirs: string[] = [];
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('prints a human-readable report to stdout', () => {
    const root = mkdtempSync(join(tmpdir(), 'schema-cli-diff-cmd-test-'));
    tempDirs.push(root);
    const oldDir = join(root, 'old');
    const newDir = join(root, 'new');
    mkdirSync(join(oldDir, 'general'), { recursive: true });
    mkdirSync(join(newDir, 'general'), { recursive: true });
    writeFileSync(
      join(oldDir, 'general', 'config.schema.json'),
      JSON.stringify({ properties: { mode: {} } }),
    );
    writeFileSync(
      join(newDir, 'general', 'config.schema.json'),
      JSON.stringify({ properties: { mode: {}, 'new-field': {} } }),
    );
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    runDiff(['--old', oldDir, '--new', newDir]);

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('added $.new-field'));
    logSpy.mockRestore();
  });
});

describe('parseSignArgs', () => {
  it('parses --manifest and --out', () => {
    expect(parseSignArgs(['--manifest', './m.json', '--out', './signed.json'])).toEqual({
      manifestFile: './m.json',
      outFile: './signed.json',
    });
  });

  it('throws when --manifest is missing', () => {
    expect(() => parseSignArgs(['--out', './x'])).toThrow(/--manifest/);
  });
});

describe('runSign (ADR-010 §1/§4, v0.5.0 #13)', () => {
  const tempDirs: string[] = [];
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('signs an already-packed unsigned manifest without rebuilding it, and the result verifies', async () => {
    const root = mkdtempSync(join(tmpdir(), 'schema-cli-sign-test-'));
    tempDirs.push(root);
    const sourceDir = join(root, 'source');
    mkdirSync(sourceDir, { recursive: true });
    const generalContent = JSON.stringify({ type: 'object' });
    writeFileSync(join(sourceDir, 'general.json'), generalContent);

    const keyPair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
    if (!('publicKey' in keyPair) || !('privateKey' in keyPair)) {
      throw new Error('Ed25519 key generation did not return a key pair');
    }
    const privateKeyBase64 = Buffer.from(
      await crypto.subtle.exportKey('pkcs8', keyPair.privateKey),
    ).toString('base64');
    const publicKeyRaw = new Uint8Array(await crypto.subtle.exportKey('raw', keyPair.publicKey));

    // An already-packed, unsigned manifest — as if produced by an earlier,
    // untrusted CI step (ADR-010 §1: the signing job never rebuilds).
    const unsignedManifest: BundleManifest = {
      bundleId: 'official',
      version: '2026.08.0',
      channel: 'stable',
      formatVersion: 1,
      requiresApp: '0.1.0',
      mihomo: {
        minVersion: '1.19.29',
        maxTestedVersion: '1.19.29',
        upstreamCommit: 'e26714a181ac0e2fa803453c0a8e9a9ce94e31cb',
        docsSnapshot: '2026-08-19',
      },
      files: [
        {
          path: 'general.json',
          sha256: Buffer.from(
            await crypto.subtle.digest('SHA-256', new TextEncoder().encode(generalContent)),
          ).toString('hex'),
        },
      ],
      signature: '',
      signedAt: '2026-08-27T00:00:00Z',
    };
    const manifestFile = join(root, 'unsigned-manifest.json');
    const outFile = join(root, 'signed-manifest.json');
    writeFileSync(manifestFile, JSON.stringify(unsignedManifest));

    await runSign(['--manifest', manifestFile, '--out', outFile], privateKeyBase64);

    expect(existsSync(outFile)).toBe(true);
    const signed = JSON.parse(readFileSync(outFile, 'utf8')) as BundleManifest;
    const files = new Map([['general.json', new TextEncoder().encode(generalContent)]]);
    const result = await verifyBundle(signed, files, {
      currentAppVersion: '0.1.0',
      minFormatVersion: 1,
      maxFormatVersion: 1,
      trustedPublicKeys: [publicKeyRaw],
    });
    expect(result).toEqual({ ok: true, manifest: signed });
  });
});
