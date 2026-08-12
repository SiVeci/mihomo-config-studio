import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { verifyBundle } from '@mcs/schema-registry';
import { afterEach, describe, expect, it } from 'vitest';

import { packDirectory, type PackOptions } from './pack.js';
import { signManifest } from './sign.js';

const BASE_OPTIONS: Omit<PackOptions, 'sourceDir'> = {
  bundleId: 'test-bundle',
  version: '1.0.0',
  channel: 'stable',
  formatVersion: 1,
  requiresApp: '0.1.0',
  signedAt: '2026-08-12T00:00:00Z',
};

const tempDirs: string[] = [];

function makeSourceDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'schema-cli-pack-test-'));
  tempDirs.push(dir);
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = join(dir, relativePath);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, content);
  }
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('packDirectory (FR-UPD-07)', () => {
  it('rejects a directory containing a .js file', async () => {
    const sourceDir = makeSourceDir({
      'schemas/general.json': JSON.stringify({ type: 'object' }),
      'payload.js': 'console.log(1)',
    });

    const result = await packDirectory({ ...BASE_OPTIONS, sourceDir });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toContainEqual({
        code: 'SCHEMA_CLI_DISALLOWED_EXTENSION',
        path: 'payload.js',
      });
    }
  });

  it('rejects a directory containing a .wasm or .so file', async () => {
    const sourceDir = makeSourceDir({
      'schemas/general.json': JSON.stringify({ type: 'object' }),
      'lib.wasm': 'binary-ish',
      'native.so': 'binary-ish',
    });

    const result = await packDirectory({ ...BASE_OPTIONS, sourceDir });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const paths = result.issues.map((issue) => issue.path).sort();
      expect(paths).toEqual(['lib.wasm', 'native.so']);
    }
  });

  it('rejects a JSON file containing a function body', async () => {
    const sourceDir = makeSourceDir({
      'schemas/general.json': JSON.stringify({ validate: 'function (v) { return true; }' }),
    });

    const result = await packDirectory({ ...BASE_OPTIONS, sourceDir });

    expect(result).toEqual({
      ok: false,
      issues: [{ code: 'SCHEMA_CLI_EXECUTABLE_CONTENT', path: 'schemas/general.json.validate' }],
    });
  });

  it('rejects a JSON file containing an expression string', async () => {
    const sourceDir = makeSourceDir({
      'schemas/general.json': JSON.stringify({ handler: "eval('1+1')" }),
    });

    const result = await packDirectory({ ...BASE_OPTIONS, sourceDir });

    expect(result).toEqual({
      ok: false,
      issues: [{ code: 'SCHEMA_CLI_EXECUTABLE_CONTENT', path: 'schemas/general.json.handler' }],
    });
  });

  it('packs a clean, nested directory into a manifest with sorted, hashed files', async () => {
    const sourceDir = makeSourceDir({
      'schemas/general.json': JSON.stringify({ type: 'object' }),
      'schemas/dns.json': JSON.stringify({ type: 'object' }),
      'README.md': '# Bundle',
    });

    const result = await packDirectory({ ...BASE_OPTIONS, sourceDir });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.bundleId).toBe('test-bundle');
    expect(result.manifest.signature).toBe('');
    expect(result.manifest.files.map((f) => f.path)).toEqual([
      'README.md',
      'schemas/dns.json',
      'schemas/general.json',
    ]);
    expect(result.manifest.files.every((f) => /^[0-9a-f]{64}$/.test(f.sha256))).toBe(true);
    expect(result.files.size).toBe(3);
  });

  it('produces a bundle that the schema-registry verifier accepts end to end', async () => {
    const sourceDir = makeSourceDir({
      'schemas/general.json': JSON.stringify({
        type: 'object',
        properties: { mode: { type: 'string' } },
      }),
    });
    const packed = await packDirectory({ ...BASE_OPTIONS, sourceDir });
    expect(packed.ok).toBe(true);
    if (!packed.ok) return;

    const keyPair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
    if (!('publicKey' in keyPair) || !('privateKey' in keyPair)) {
      throw new Error('Ed25519 key generation did not return a key pair');
    }
    const privateKeyPkcs8 = new Uint8Array(
      await crypto.subtle.exportKey('pkcs8', keyPair.privateKey),
    );
    const publicKeyRaw = new Uint8Array(await crypto.subtle.exportKey('raw', keyPair.publicKey));

    const signature = await signManifest(packed.manifest, privateKeyPkcs8);
    const signedManifest = { ...packed.manifest, signature };

    const verifyResult = await verifyBundle(signedManifest, packed.files, {
      currentAppVersion: '0.1.0',
      minFormatVersion: 1,
      maxFormatVersion: 1,
      trustedPublicKeys: [publicKeyRaw],
    });

    expect(verifyResult).toEqual({ ok: true, manifest: signedManifest });
  });
});
