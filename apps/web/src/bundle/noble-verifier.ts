import type { Ed25519Verifier } from '@mcs/schema-registry';
import { etc, verifyAsync } from '@noble/ed25519';

/**
 * ADR-013/ADR-028: `@noble/ed25519` v2's async API already defaults
 * `etc.sha512Async` to `crypto.subtle.digest('SHA-512')` — but that default
 * is explicitly overridden here rather than relied on, so a future library
 * version changing its default can never silently swap in a different SHA-512
 * implementation underneath a Bundle signature check. Both target WebViews
 * (ADR-013's real-device results) support `subtle.digest('SHA-512')` even
 * though neither supports `subtle.verify` for Ed25519 — the two are
 * independent algorithm registrations in Chromium/Blink.
 */
etc.sha512Async = async (...messages: readonly Uint8Array[]): Promise<Uint8Array> => {
  // Copy-constructed, same reasoning as `platform/web.ts`'s `downloadBlob`:
  // TS 5.7 types `Uint8Array` generically over `ArrayBufferLike` (which also
  // covers `SharedArrayBuffer`), not assignable to `BufferSource`.
  const digest = await crypto.subtle.digest(
    'SHA-512',
    new Uint8Array(etc.concatBytes(...messages)),
  );
  return new Uint8Array(digest);
};

/**
 * The pure-JS fallback ADR-013 deferred to v0.6.0 (#10): used only where
 * `SubtleCryptoEd25519Verifier` doesn't work (`verify-options.ts`'s
 * `resolveEd25519Verifier` probes for that at startup rather than assuming
 * it from platform/UA, per ADR-013's own finding that WebView version is
 * decoupled from Android OS version).
 */
export class NobleEd25519Verifier implements Ed25519Verifier {
  async verify(
    publicKey: Uint8Array,
    signature: Uint8Array,
    message: Uint8Array,
  ): Promise<boolean> {
    // RFC8032 strict mode (`zip215: false`), not noble's ZIP215-permissive
    // default — matches the "RFC 8032" framing the rest of this codebase
    // (ADR-010/ADR-013, `tools/webcrypto-probe`) already uses throughout,
    // and keeps this backend's acceptance criteria for a signature no
    // looser than whatever `crypto.subtle`'s own Ed25519 implementation
    // enforces. Every real signature this app ever verifies comes from
    // `tools/schema-cli`'s own signer (Node's `crypto.sign('ed25519', ...)`),
    // which only ever produces canonical encodings — the stricter mode
    // never rejects a legitimate signature, only a malleable encoding of
    // one that neither backend should have to agree is valid.
    return verifyAsync(signature, message, publicKey, { zip215: false });
  }
}
