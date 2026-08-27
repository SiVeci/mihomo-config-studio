import { BUILTIN_TRUST_ANCHORS_HEX } from './builtin.js';
import { hexToBytes } from './verify.js';

/**
 * Build-time injection point for the trust anchor array (ADR-010 §3). The
 * default is the bootstrap key baked into `builtin.ts`; `apps/web` injects
 * the production `[current, next]` public keys via a Vite `define` at build
 * time once v0.5.0 #14 has real keys to inject. Both the default and the
 * override are hex-encoded raw 32-byte Ed25519 public keys — the shape
 * `verifyBundle`'s `trustedPublicKeys` already expects (`Uint8Array[]`).
 */
export type ResolveTrustAnchorsWarningCode =
  'TRUST_ANCHOR_INVALID_HEX' | 'TRUST_ANCHOR_INVALID_LENGTH' | 'TRUST_ANCHOR_OVERRIDE_FALLBACK';

export interface ResolveTrustAnchorsWarning {
  readonly code: ResolveTrustAnchorsWarningCode;
  /** Index into the source hex array this warning refers to; absent for a whole-override fallback. */
  readonly index?: number;
}

export interface ResolveTrustAnchorsResult {
  readonly anchors: readonly Uint8Array[];
  readonly warnings: readonly ResolveTrustAnchorsWarning[];
}

const HEX_PATTERN = /^[0-9a-fA-F]+$/;
const PUBLIC_KEY_BYTE_LENGTH = 32;

function parseHexAnchors(hexEntries: readonly string[]): ResolveTrustAnchorsResult {
  const anchors: Uint8Array[] = [];
  const warnings: ResolveTrustAnchorsWarning[] = [];

  hexEntries.forEach((hex, index) => {
    if (hex.length % 2 !== 0 || !HEX_PATTERN.test(hex)) {
      warnings.push({ code: 'TRUST_ANCHOR_INVALID_HEX', index });
      return;
    }
    const bytes = hexToBytes(hex);
    if (bytes.length !== PUBLIC_KEY_BYTE_LENGTH) {
      warnings.push({ code: 'TRUST_ANCHOR_INVALID_LENGTH', index });
      return;
    }
    anchors.push(bytes);
  });

  return { anchors, warnings };
}

/**
 * Resolves the trust anchor array `verifyBundle` should check a signature
 * against. `overrides` (when provided) takes priority over the built-in
 * bootstrap anchor; a malformed or fully-invalid override falls back to the
 * built-in array plus a structured warning rather than an empty array — an
 * empty trust anchor list means no signature can ever verify, which is
 * strictly worse than falling back to the bootstrap key. A single bad entry
 * inside an otherwise-valid array is skipped and warned about, not treated
 * as failure of the whole array.
 */
export function resolveTrustAnchors(overrides?: readonly string[]): ResolveTrustAnchorsResult {
  if (overrides === undefined) {
    return parseHexAnchors(BUILTIN_TRUST_ANCHORS_HEX);
  }

  const parsedOverrides = parseHexAnchors(overrides);
  if (parsedOverrides.anchors.length > 0) {
    return parsedOverrides;
  }

  const fallback = parseHexAnchors(BUILTIN_TRUST_ANCHORS_HEX);
  return {
    anchors: fallback.anchors,
    warnings: [
      ...parsedOverrides.warnings,
      ...fallback.warnings,
      { code: 'TRUST_ANCHOR_OVERRIDE_FALLBACK' },
    ],
  };
}
