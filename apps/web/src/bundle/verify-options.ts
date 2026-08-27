import type { VerifyBundleOptions } from '@mcs/schema-registry';

import { BUNDLE_TRUST_ANCHORS } from './trust-anchors.js';

/** Matches `apps/web/package.json`'s own `version` — the same value every `requiresApp` fixture/test in this repo already assumes (mirrors `BundlePage.tsx`'s own constant). */
export const CURRENT_APP_VERSION = '0.1.0';
export const MIN_FORMAT_VERSION = 1;
export const MAX_FORMAT_VERSION = 1;

/**
 * Shared default `VerifyBundleOptions` for every call site that resolves a
 * Bundle outside the Bundle-management page itself (`ProjectPage`,
 * `UpgradeDialog`, v0.5.0 #11) — `BundlePage.tsx` keeps its own copy since it
 * also needs a per-channel `verifyOptions` shape for its install flow.
 */
export function defaultVerifyOptions(
  trustedPublicKeys?: readonly Uint8Array[],
): VerifyBundleOptions {
  return {
    currentAppVersion: CURRENT_APP_VERSION,
    minFormatVersion: MIN_FORMAT_VERSION,
    maxFormatVersion: MAX_FORMAT_VERSION,
    trustedPublicKeys: trustedPublicKeys ?? BUNDLE_TRUST_ANCHORS.anchors,
  };
}
