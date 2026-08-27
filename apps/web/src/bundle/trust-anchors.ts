import { resolveTrustAnchors, type ResolveTrustAnchorsResult } from '@mcs/schema-registry';

/**
 * Vite `define`-injected override (`apps/web/vite.config.ts`), a JSON array
 * of hex-encoded public keys, or the literal `null` when unset. `typeof`
 * (never a direct reference) is what makes this safe outside a Vite build
 * too — under `vitest` nothing defines this global at all, and `typeof` on
 * an unresolved identifier returns `'undefined'` rather than throwing.
 */
declare const __TRUST_ANCHOR_OVERRIDES__: string | null | undefined;

/**
 * Pure parsing logic, kept separate from the module-level global read below
 * so it stays testable with plain string inputs — `__TRUST_ANCHOR_OVERRIDES__`
 * itself is a load-time global no test can parameterize.
 */
export function parseOverride(raw: string | null | undefined): readonly string[] | undefined {
  if (typeof raw !== 'string') return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every((entry) => typeof entry === 'string')
      ? parsed
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolved once at module load (decision F4, ADR-010 §3): the production
 * `[current, next]` public keys once #14 injects them, or the built-in
 * bootstrap anchor until then — `resolveTrustAnchors` already guarantees a
 * non-empty result either way, never an empty array that would make every
 * signature check fail closed.
 */
export const BUNDLE_TRUST_ANCHORS: ResolveTrustAnchorsResult = resolveTrustAnchors(
  parseOverride(
    typeof __TRUST_ANCHOR_OVERRIDES__ === 'string' ? __TRUST_ANCHOR_OVERRIDES__ : undefined,
  ),
);
