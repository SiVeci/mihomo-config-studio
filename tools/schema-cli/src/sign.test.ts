import { canonicalManifestJson, type BundleManifest } from '@mcs/schema-registry';
import { describe, expect, it } from 'vitest';

import { decodePrivateKeyBase64, signManifest } from './sign.js';

const MANIFEST: BundleManifest = {
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
  files: [{ path: 'a.json', sha256: '0'.repeat(64) }],
  signature: 'placeholder-ignored-by-canonicalManifestJson',
  signedAt: '2026-08-12T00:00:00Z',
};

async function generateKeyPair() {
  const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  if (!('publicKey' in pair) || !('privateKey' in pair)) {
    throw new Error('Ed25519 key generation did not return a key pair');
  }
  return pair;
}

describe('decodePrivateKeyBase64', () => {
  it('base64-decodes stdin content, trimming surrounding whitespace', () => {
    const original = new Uint8Array([1, 2, 3, 250, 251, 252]);
    const base64 = `\n${Buffer.from(original).toString('base64')}\n`;

    expect(decodePrivateKeyBase64(base64)).toEqual(original);
  });
});

describe('signManifest (ADR-010 §1)', () => {
  it('produces a signature verifiable with the matching public key', async () => {
    const pair = await generateKeyPair();
    const privateKeyPkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));

    const signatureHex = await signManifest(MANIFEST, privateKeyPkcs8);

    const signatureBytes = Uint8Array.from(Buffer.from(signatureHex, 'hex'));
    const message = new TextEncoder().encode(canonicalManifestJson(MANIFEST));
    const verified = await crypto.subtle.verify(
      { name: 'Ed25519' },
      pair.publicKey,
      signatureBytes,
      message,
    );
    expect(verified).toBe(true);
  });

  it('ignores whatever signature value the manifest already carries', async () => {
    const pair = await generateKeyPair();
    const privateKeyPkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));

    const signatureA = await signManifest({ ...MANIFEST, signature: 'aaaa' }, privateKeyPkcs8);
    const signatureB = await signManifest({ ...MANIFEST, signature: 'bbbb' }, privateKeyPkcs8);

    expect(signatureA).toBe(signatureB);
  });
});
