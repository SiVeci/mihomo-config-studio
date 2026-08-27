import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { verifyBundle, type BundleManifest } from '@mcs/schema-registry';
import { afterEach, describe, expect, it } from 'vitest';

import { parseCliArgs, run } from './index.js';

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
