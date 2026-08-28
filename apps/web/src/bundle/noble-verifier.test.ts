import { hexToBytes, SubtleCryptoEd25519Verifier } from '@mcs/schema-registry';
import { getPublicKeyAsync, utils } from '@noble/ed25519';
import { describe, expect, it } from 'vitest';

import { NobleEd25519Verifier } from './noble-verifier.js';

// RFC 8032 §7.1 TEST 1 — the same fixed vector `tools/webcrypto-probe/probe.html`
// and ADR-013 use, independently verified against Node's own Ed25519
// implementation before use there. The message is empty, per TEST 1 itself.
const PUBLIC_KEY = hexToBytes('d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a');
const SIGNATURE = hexToBytes(
  'e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901' +
    '555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b',
);
const MESSAGE = new Uint8Array(0);

describe('NobleEd25519Verifier (ADR-013/ADR-028, v0.6.0 #10)', () => {
  it('verifies a real signature against RFC 8032 §7.1 TEST 1', async () => {
    const verifier = new NobleEd25519Verifier();

    expect(await verifier.verify(PUBLIC_KEY, SIGNATURE, MESSAGE)).toBe(true);
  });

  it('rejects a tampered signature', async () => {
    const verifier = new NobleEd25519Verifier();
    const tampered = new Uint8Array(SIGNATURE);
    tampered[0] = (tampered[0] as number) ^ 0xff;

    expect(await verifier.verify(PUBLIC_KEY, tampered, MESSAGE)).toBe(false);
  });

  it('rejects a tampered message', async () => {
    const verifier = new NobleEd25519Verifier();

    expect(await verifier.verify(PUBLIC_KEY, SIGNATURE, new Uint8Array([0x01]))).toBe(false);
  });

  it('rejects the right signature verified against the wrong public key', async () => {
    const verifier = new NobleEd25519Verifier();
    // A freshly generated, syntactically valid but unrelated key — safer
    // than hand-transcribing a second fixed vector from memory, since a
    // typo there could produce a not-on-curve key that fails for the wrong
    // reason (malformed input) rather than the reason this test wants
    // (right encoding, wrong key).
    const unrelatedKey = await getPublicKeyAsync(utils.randomPrivateKey());

    expect(await verifier.verify(unrelatedKey, SIGNATURE, MESSAGE)).toBe(false);
  });

  it('agrees with SubtleCryptoEd25519Verifier on the same real signature — the two backends must never diverge on a legitimate input, since Node itself supports both (ADR-013)', async () => {
    const noble = new NobleEd25519Verifier();
    const subtle = new SubtleCryptoEd25519Verifier();

    expect(await noble.verify(PUBLIC_KEY, SIGNATURE, MESSAGE)).toBe(
      await subtle.verify(PUBLIC_KEY, SIGNATURE, MESSAGE),
    );
  });

  it('agrees with SubtleCryptoEd25519Verifier on the same tampered signature', async () => {
    const noble = new NobleEd25519Verifier();
    const subtle = new SubtleCryptoEd25519Verifier();
    const tampered = new Uint8Array(SIGNATURE);
    tampered[0] = (tampered[0] as number) ^ 0xff;

    expect(await noble.verify(PUBLIC_KEY, tampered, MESSAGE)).toBe(
      await subtle.verify(PUBLIC_KEY, tampered, MESSAGE),
    );
  });
});
