import { describe, expect, it } from 'vitest';

import { BUILTIN_BUNDLE, BUILTIN_TRUST_ANCHORS_HEX } from './builtin.js';
import type { BundleManifest } from './manifest.js';
import { generateTestKeyPair, type TestKeyPair } from './testing/keys.js';
import {
  bytesToHex,
  canonicalManifestJson,
  hexToBytes,
  sha256Hex,
  SubtleCryptoEd25519Verifier,
  verifyBundle,
  type Ed25519Verifier,
} from './verify.js';

const DEFAULT_OPTIONS = {
  currentAppVersion: '0.1.0',
  minFormatVersion: 1,
  maxFormatVersion: 1,
};

interface BuildOptions {
  readonly keyPair: TestKeyPair;
  readonly manifestOverrides?: Partial<BundleManifest>;
  readonly fileContent?: Uint8Array;
  readonly omitFileFromMap?: boolean;
}

async function buildSignedBundle(
  options: BuildOptions,
): Promise<{ manifest: BundleManifest; files: Map<string, Uint8Array> }> {
  const path = 'modules/general.json';
  const fileContent = options.fileContent ?? new TextEncoder().encode('{"hello":"world"}');
  const sha256 = await sha256Hex(fileContent);
  const unsigned: BundleManifest = {
    bundleId: 'test-bundle',
    version: '1.0.0',
    channel: 'stable',
    formatVersion: 1,
    requiresApp: '0.1.0',
    mihomo: {
      minVersion: '1.19.29',
      maxTestedVersion: '1.19.29',
      upstreamCommit: 'e26714a181ac0e2fa803453c0a8e9a9ce94e31cb',
      docsSnapshot: '2026-08-19',
    },
    files: [{ path, sha256 }],
    signature: '',
    signedAt: '2026-08-12T00:00:00Z',
    ...options.manifestOverrides,
  };
  const message = new TextEncoder().encode(canonicalManifestJson(unsigned));
  const signature = await options.keyPair.sign(message);
  const manifest: BundleManifest = { ...unsigned, signature: bytesToHex(signature) };

  const files = new Map<string, Uint8Array>();
  if (!options.omitFileFromMap) files.set(path, fileContent);
  return { manifest, files };
}

describe('SubtleCryptoEd25519Verifier (ADR-013 port)', () => {
  it('verifies a signature it produced and rejects a tampered one', async () => {
    const keyPair = await generateTestKeyPair();
    const verifier: Ed25519Verifier = new SubtleCryptoEd25519Verifier();
    const message = new TextEncoder().encode('hello bundle');
    const signature = await keyPair.sign(message);

    await expect(verifier.verify(keyPair.publicKeyRaw, signature, message)).resolves.toBe(true);

    const tampered = new Uint8Array(message);
    tampered[0] = (tampered[0]! + 1) % 256;
    await expect(verifier.verify(keyPair.publicKeyRaw, signature, tampered)).resolves.toBe(false);
  });
});

describe('verifyBundle (FR-UPD-03, NFR-SEC-04)', () => {
  it('accepts a well-formed, correctly-signed, correctly-hashed bundle', async () => {
    const keyPair = await generateTestKeyPair();
    const { manifest, files } = await buildSignedBundle({ keyPair });

    const result = await verifyBundle(manifest, files, {
      ...DEFAULT_OPTIONS,
      trustedPublicKeys: [keyPair.publicKeyRaw],
    });

    expect(result).toEqual({ ok: true, manifest });
  });

  it('accepts the actual built-in bundle against its bootstrap trust anchor', async () => {
    const files = new Map(
      Object.entries(BUILTIN_BUNDLE.modules).map(([path, module]) => [
        path,
        new TextEncoder().encode(JSON.stringify(module)),
      ]),
    );

    const result = await verifyBundle(BUILTIN_BUNDLE.manifest, files, {
      ...DEFAULT_OPTIONS,
      currentAppVersion: BUILTIN_BUNDLE.manifest.requiresApp,
      trustedPublicKeys: BUILTIN_TRUST_ANCHORS_HEX.map(hexToBytes),
    });

    expect(result).toEqual({ ok: true, manifest: BUILTIN_BUNDLE.manifest });
  });

  it('treats a shorter version string as zero-padded when comparing segment counts', async () => {
    const keyPair = await generateTestKeyPair();
    const { manifest, files } = await buildSignedBundle({
      keyPair,
      manifestOverrides: { requiresApp: '0.1' },
    });

    const result = await verifyBundle(manifest, files, {
      ...DEFAULT_OPTIONS,
      currentAppVersion: '0.1.0',
      trustedPublicKeys: [keyPair.publicKeyRaw],
    });

    expect(result.ok).toBe(true);
  });

  it('treats a shorter current app version as zero-padded too', async () => {
    const keyPair = await generateTestKeyPair();
    const { manifest, files } = await buildSignedBundle({
      keyPair,
      manifestOverrides: { requiresApp: '0.1.0' },
    });

    const result = await verifyBundle(manifest, files, {
      ...DEFAULT_OPTIONS,
      currentAppVersion: '0.1',
      trustedPublicKeys: [keyPair.publicKeyRaw],
    });

    expect(result.ok).toBe(true);
  });

  it('accepts a bundle whose requiresApp is lower than the current app version', async () => {
    const keyPair = await generateTestKeyPair();
    const { manifest, files } = await buildSignedBundle({
      keyPair,
      manifestOverrides: { requiresApp: '0.0.1' },
    });

    const result = await verifyBundle(manifest, files, {
      ...DEFAULT_OPTIONS,
      trustedPublicKeys: [keyPair.publicKeyRaw],
    });

    expect(result.ok).toBe(true);
  });

  it('checks every declared file, not just the first, in a multi-file bundle', async () => {
    const keyPair = await generateTestKeyPair();
    const goodContent = new TextEncoder().encode('{"a":1}');
    const badContent = new TextEncoder().encode('{"b":2}');
    const goodHash = await sha256Hex(goodContent);
    const badHash = await sha256Hex(badContent);

    const unsigned: BundleManifest = {
      bundleId: 'multi-file',
      version: '1.0.0',
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
        { path: 'a.json', sha256: goodHash },
        { path: 'b.json', sha256: badHash },
      ],
      signature: '',
      signedAt: '2026-08-12T00:00:00Z',
    };
    const message = new TextEncoder().encode(canonicalManifestJson(unsigned));
    const manifest: BundleManifest = {
      ...unsigned,
      signature: bytesToHex(await keyPair.sign(message)),
    };
    const files = new Map([
      ['a.json', goodContent],
      // Second file's actual bytes do not match its declared hash.
      ['b.json', new TextEncoder().encode('{"tampered":true}')],
    ]);

    const result = await verifyBundle(manifest, files, {
      ...DEFAULT_OPTIONS,
      trustedPublicKeys: [keyPair.publicKeyRaw],
    });

    expect(result).toEqual({ ok: false, code: 'BUNDLE_HASH_MISMATCH', path: 'b.json' });
  });

  it('rejects a bundle whose declared manifest shape is invalid, before touching hashes or signature', async () => {
    const result = await verifyBundle({}, new Map(), {
      ...DEFAULT_OPTIONS,
      trustedPublicKeys: [],
    });

    expect(result).toEqual({ code: 'BUNDLE_MANIFEST_MISSING_FIELD', ok: false, path: 'bundleId' });
  });

  it('rejects a tampered file with BUNDLE_HASH_MISMATCH naming the offending path', async () => {
    const keyPair = await generateTestKeyPair();
    const { manifest, files } = await buildSignedBundle({ keyPair });
    files.set('modules/general.json', new TextEncoder().encode('{"hello":"tampered"}'));

    const result = await verifyBundle(manifest, files, {
      ...DEFAULT_OPTIONS,
      trustedPublicKeys: [keyPair.publicKeyRaw],
    });

    expect(result).toEqual({
      ok: false,
      code: 'BUNDLE_HASH_MISMATCH',
      path: 'modules/general.json',
    });
  });

  it('rejects a bundle with a declared file missing from the supplied content', async () => {
    const keyPair = await generateTestKeyPair();
    const { manifest, files } = await buildSignedBundle({ keyPair, omitFileFromMap: true });

    const result = await verifyBundle(manifest, files, {
      ...DEFAULT_OPTIONS,
      trustedPublicKeys: [keyPair.publicKeyRaw],
    });

    expect(result).toEqual({
      ok: false,
      code: 'BUNDLE_HASH_MISMATCH',
      path: 'modules/general.json',
    });
  });

  it('rejects a bundle re-signed with a different private key', async () => {
    const signer = await generateTestKeyPair();
    const impostor = await generateTestKeyPair();
    const { manifest, files } = await buildSignedBundle({ keyPair: signer });

    const result = await verifyBundle(manifest, files, {
      ...DEFAULT_OPTIONS,
      trustedPublicKeys: [impostor.publicKeyRaw],
    });

    expect(result).toEqual({ ok: false, code: 'BUNDLE_SIGNATURE_INVALID', path: 'signature' });
  });

  it('accepts a signature verified by the second key in the trust anchor array', async () => {
    const current = await generateTestKeyPair();
    const next = await generateTestKeyPair();
    const { manifest, files } = await buildSignedBundle({ keyPair: next });

    const result = await verifyBundle(manifest, files, {
      ...DEFAULT_OPTIONS,
      trustedPublicKeys: [current.publicKeyRaw, next.publicKeyRaw],
    });

    expect(result.ok).toBe(true);
  });

  it('rejects a formatVersion outside the supported range', async () => {
    const keyPair = await generateTestKeyPair();
    const { manifest, files } = await buildSignedBundle({
      keyPair,
      manifestOverrides: { formatVersion: 99 },
    });

    const result = await verifyBundle(manifest, files, {
      ...DEFAULT_OPTIONS,
      trustedPublicKeys: [keyPair.publicKeyRaw],
    });

    expect(result).toEqual({ ok: false, code: 'BUNDLE_FORMAT_UNSUPPORTED', path: 'formatVersion' });
  });

  it('rejects a requiresApp higher than the current app version', async () => {
    const keyPair = await generateTestKeyPair();
    const { manifest, files } = await buildSignedBundle({
      keyPair,
      manifestOverrides: { requiresApp: '99.0.0' },
    });

    const result = await verifyBundle(manifest, files, {
      ...DEFAULT_OPTIONS,
      trustedPublicKeys: [keyPair.publicKeyRaw],
    });

    expect(result).toEqual({ ok: false, code: 'BUNDLE_APP_TOO_OLD', path: 'requiresApp' });
  });

  it('stops at the first failing step: an unsupported format wins over a bad hash further down the pipeline', async () => {
    const keyPair = await generateTestKeyPair();
    const { manifest, files } = await buildSignedBundle({
      keyPair,
      manifestOverrides: { formatVersion: 99 },
    });
    files.set('modules/general.json', new TextEncoder().encode('{"also":"tampered"}'));

    const result = await verifyBundle(manifest, files, {
      ...DEFAULT_OPTIONS,
      trustedPublicKeys: [keyPair.publicKeyRaw],
    });

    expect(result).toEqual({ ok: false, code: 'BUNDLE_FORMAT_UNSUPPORTED', path: 'formatVersion' });
  });

  it('uses the injected verifier instead of the SubtleCrypto default', async () => {
    const keyPair = await generateTestKeyPair();
    const { manifest, files } = await buildSignedBundle({ keyPair });
    const impostor = await generateTestKeyPair();

    const alwaysTrue: Ed25519Verifier = { verify: async () => true };
    const passing = await verifyBundle(manifest, files, {
      ...DEFAULT_OPTIONS,
      // Wrong public key — would fail against the real signature, but the
      // fake verifier below never actually checks it.
      trustedPublicKeys: [impostor.publicKeyRaw],
      verifier: alwaysTrue,
    });
    expect(passing.ok).toBe(true);

    const alwaysFalse: Ed25519Verifier = { verify: async () => false };
    const failing = await verifyBundle(manifest, files, {
      ...DEFAULT_OPTIONS,
      trustedPublicKeys: [keyPair.publicKeyRaw],
      verifier: alwaysFalse,
    });
    expect(failing).toEqual({ ok: false, code: 'BUNDLE_SIGNATURE_INVALID', path: 'signature' });
  });
});

describe('canonicalManifestJson', () => {
  it('produces the same bytes regardless of key order, and excludes the signature field', () => {
    const base: BundleManifest = {
      bundleId: 'a',
      version: '1.0.0',
      channel: 'stable',
      formatVersion: 1,
      requiresApp: '0.1.0',
      mihomo: {
        minVersion: '1.19.29',
        maxTestedVersion: '1.19.29',
        upstreamCommit: 'e26714a181ac0e2fa803453c0a8e9a9ce94e31cb',
        docsSnapshot: '2026-08-19',
      },
      files: [{ path: 'x.json', sha256: 'abc' }],
      signature: 'irrelevant',
      signedAt: '2026-08-12T00:00:00Z',
    };
    const reordered: BundleManifest = {
      signedAt: base.signedAt,
      files: base.files,
      requiresApp: base.requiresApp,
      formatVersion: base.formatVersion,
      channel: base.channel,
      version: base.version,
      bundleId: base.bundleId,
      mihomo: base.mihomo,
      signature: 'a-completely-different-signature',
    };

    const canonicalA = canonicalManifestJson(base);
    const canonicalB = canonicalManifestJson(reordered);

    expect(canonicalA).toBe(canonicalB);
    expect(canonicalA).not.toContain('irrelevant');
    expect(canonicalA).not.toContain('signature');
  });
});
