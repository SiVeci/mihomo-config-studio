import {
  validateBundleManifest,
  type BundleManifest,
  type BundleManifestIssueCode,
} from './manifest.js';

/**
 * Verifies a raw Ed25519 signature against a message. The concrete backend
 * is pluggable (ADR-013): Android WebView was measured to not support
 * `crypto.subtle`'s Ed25519 algorithm as of this version, so callers that
 * need to work there must supply an alternative implementation. The pure-JS
 * fallback ADR-013 deferred to v0.6.0 has landed (#10, ADR-028) —
 * `apps/web/src/bundle/noble-verifier.ts`'s `NobleEd25519Verifier`, selected
 * over this file's own `SubtleCryptoEd25519Verifier` by a startup capability
 * probe (`apps/web/src/bundle/verify-options.ts`'s `resolveEd25519Verifier`).
 * This package stays the single coupling point either way: it depends only
 * on the interface below, never on a concrete backend or on `@noble/ed25519`
 * itself (`packages/**` stays free of that dependency by design, ADR-028).
 */
export interface Ed25519Verifier {
  verify(publicKey: Uint8Array, signature: Uint8Array, message: Uint8Array): Promise<boolean>;
}

/** The only backend v0.1.0 ships: works today in Node and desktop/mobile Web, not yet in Android WebView. */
export class SubtleCryptoEd25519Verifier implements Ed25519Verifier {
  async verify(
    publicKey: Uint8Array,
    signature: Uint8Array,
    message: Uint8Array,
  ): Promise<boolean> {
    const key = await crypto.subtle.importKey('raw', publicKey, { name: 'Ed25519' }, false, [
      'verify',
    ]);
    return crypto.subtle.verify({ name: 'Ed25519' }, key, signature, message);
  }
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return bytesToHex(new Uint8Array(digest));
}

/**
 * Deterministic JSON of everything a manifest's signature covers (ADR-010
 * §1): sorted keys, no incidental whitespace, `signature` itself excluded
 * (it cannot sign itself). The signing side (`tools/schema-cli`, #10) must
 * import this exact function rather than reimplement it — any byte
 * difference between signer and verifier is a false-negative waiting to
 * happen.
 */
export function canonicalManifestJson(manifest: BundleManifest): string {
  const { signature: _signature, ...signable } = manifest;
  return JSON.stringify(sortKeysDeep(signable));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

/** MAJOR.MINOR.PATCH only; positive when `a` is newer than `b`. */
export function compareVersions(a: string, b: string): number {
  const partsA = a.split('.').map(Number);
  const partsB = b.split('.').map(Number);
  const length = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (partsA[i] ?? 0) - (partsB[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export type BundleVerifyErrorCode =
  | BundleManifestIssueCode
  | 'BUNDLE_FORMAT_UNSUPPORTED'
  | 'BUNDLE_APP_TOO_OLD'
  | 'BUNDLE_HASH_MISMATCH'
  | 'BUNDLE_SIGNATURE_INVALID';

/** Never carries a message, and never the hash/signature/key values themselves (NFR-SEC-03). */
export interface BundleVerifyFailure {
  readonly ok: false;
  readonly code: BundleVerifyErrorCode;
  readonly path: string;
}

export interface BundleVerifySuccess {
  readonly ok: true;
  readonly manifest: BundleManifest;
}

export type BundleVerifyResult = BundleVerifySuccess | BundleVerifyFailure;

export interface VerifyBundleOptions {
  /** This build's own version, compared against `manifest.requiresApp`. */
  readonly currentAppVersion: string;
  readonly minFormatVersion: number;
  readonly maxFormatVersion: number;
  /** Trust anchor array (ADR-010 §3): verifying against any one is enough. */
  readonly trustedPublicKeys: readonly Uint8Array[];
  /** Defaults to `SubtleCryptoEd25519Verifier`; inject a fake in tests or a future pure-JS backend. */
  readonly verifier?: Ed25519Verifier;
}

/**
 * Fixed, short-circuiting order (cheapest checks first, signature last):
 * manifest shape → formatVersion → requiresApp → per-file SHA-256 →
 * manifest signature. A failure at any step stops immediately; later steps
 * would be meaningless (or, for the signature, needlessly expensive) once
 * an earlier one has already failed.
 */
export async function verifyBundle(
  manifestValue: unknown,
  files: ReadonlyMap<string, Uint8Array>,
  options: VerifyBundleOptions,
): Promise<BundleVerifyResult> {
  const shapeIssues = validateBundleManifest(manifestValue);
  const [firstShapeIssue] = shapeIssues;
  if (firstShapeIssue) {
    return { ok: false, code: firstShapeIssue.code, path: firstShapeIssue.path };
  }
  const manifest = manifestValue as BundleManifest;

  if (
    manifest.formatVersion < options.minFormatVersion ||
    manifest.formatVersion > options.maxFormatVersion
  ) {
    return { ok: false, code: 'BUNDLE_FORMAT_UNSUPPORTED', path: 'formatVersion' };
  }

  if (compareVersions(manifest.requiresApp, options.currentAppVersion) > 0) {
    return { ok: false, code: 'BUNDLE_APP_TOO_OLD', path: 'requiresApp' };
  }

  for (const file of manifest.files) {
    const content = files.get(file.path);
    if (!content) {
      return { ok: false, code: 'BUNDLE_HASH_MISMATCH', path: file.path };
    }
    const actualHash = await sha256Hex(content);
    if (actualHash.toLowerCase() !== file.sha256.toLowerCase()) {
      return { ok: false, code: 'BUNDLE_HASH_MISMATCH', path: file.path };
    }
  }

  const verifier = options.verifier ?? new SubtleCryptoEd25519Verifier();
  const message = new TextEncoder().encode(canonicalManifestJson(manifest));
  const signature = hexToBytes(manifest.signature);

  let signatureValid = false;
  for (const publicKey of options.trustedPublicKeys) {
    if (await verifier.verify(publicKey, signature, message)) {
      signatureValid = true;
      break;
    }
  }
  if (!signatureValid) {
    return { ok: false, code: 'BUNDLE_SIGNATURE_INVALID', path: 'signature' };
  }

  return { ok: true, manifest };
}
