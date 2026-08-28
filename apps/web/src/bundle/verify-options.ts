import type { Ed25519Verifier, VerifyBundleOptions } from '@mcs/schema-registry';
import { hexToBytes, SubtleCryptoEd25519Verifier } from '@mcs/schema-registry';

import { NobleEd25519Verifier } from './noble-verifier.js';
import { BUNDLE_TRUST_ANCHORS } from './trust-anchors.js';

/** Matches `apps/web/package.json`'s own `version` — the same value every `requiresApp` fixture/test in this repo already assumes (mirrors `BundlePage.tsx`'s own constant). */
export const CURRENT_APP_VERSION = '0.1.0';
export const MIN_FORMAT_VERSION = 1;
export const MAX_FORMAT_VERSION = 1;

// RFC 8032 §7.1 TEST 1 — same fixed vector `tools/webcrypto-probe/probe.html`
// and ADR-013 use, independently verified against Node's own Ed25519
// implementation before use there.
// Copy-constructed, same reasoning as `platform/web.ts`'s `downloadBlob`: TS
// 5.7 types `hexToBytes`'s return generically over `ArrayBufferLike`, not
// assignable to the `BufferSource` `crypto.subtle` calls below expect.
const PROBE_PUBLIC_KEY = new Uint8Array(
  hexToBytes('d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a'),
);
const PROBE_SIGNATURE = new Uint8Array(
  hexToBytes(
    'e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901' +
      '555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b',
  ),
);
const PROBE_MESSAGE = new Uint8Array(0);

/**
 * Detects, not assumes (ADR-013's own finding: WebView version is decoupled
 * from Android OS version, so branching on platform/UA would be wrong). A
 * working `crypto.subtle.importKey` does not imply `verify` works — this
 * calls both, against a known-good signature, the same discipline
 * `tools/webcrypto-probe/probe.html` used to reach ADR-013's conclusion.
 */
async function subtleEd25519Works(): Promise<boolean> {
  try {
    if (typeof crypto === 'undefined' || !crypto.subtle) return false;
    const key = await crypto.subtle.importKey('raw', PROBE_PUBLIC_KEY, { name: 'Ed25519' }, false, [
      'verify',
    ]);
    return await crypto.subtle.verify({ name: 'Ed25519' }, key, PROBE_SIGNATURE, PROBE_MESSAGE);
  } catch {
    return false;
  }
}

// Probed once per session, not once per call — `defaultVerifyOptions`/
// `BundlePage.tsx`'s own `verifyOptions` can both be called many times
// (once per Bundle operation), and the answer cannot change mid-session.
let cachedVerifierPromise: Promise<Ed25519Verifier> | undefined;

/** ADR-013/ADR-028 (v0.6.0 #10): the one place that decides `SubtleCryptoEd25519Verifier` vs. the pure-JS `NobleEd25519Verifier` fallback — every `VerifyBundleOptions` builder in `apps/web` (this file's `defaultVerifyOptions`, `BundlePage.tsx`'s own `verifyOptions`) calls this rather than picking a backend itself. */
export function resolveEd25519Verifier(): Promise<Ed25519Verifier> {
  if (!cachedVerifierPromise) {
    cachedVerifierPromise = subtleEd25519Works().then((supported) =>
      supported ? new SubtleCryptoEd25519Verifier() : new NobleEd25519Verifier(),
    );
  }
  return cachedVerifierPromise;
}

/**
 * Shared default `VerifyBundleOptions` for every call site that resolves a
 * Bundle outside the Bundle-management page itself (`ProjectPage`,
 * `UpgradeDialog`, v0.5.0 #11) — `BundlePage.tsx` keeps its own copy since it
 * also needs a per-channel `verifyOptions` shape for its install flow.
 */
export async function defaultVerifyOptions(
  trustedPublicKeys?: readonly Uint8Array[],
): Promise<VerifyBundleOptions> {
  return {
    currentAppVersion: CURRENT_APP_VERSION,
    minFormatVersion: MIN_FORMAT_VERSION,
    maxFormatVersion: MAX_FORMAT_VERSION,
    trustedPublicKeys: trustedPublicKeys ?? BUNDLE_TRUST_ANCHORS.anchors,
    verifier: await resolveEd25519Verifier(),
  };
}
