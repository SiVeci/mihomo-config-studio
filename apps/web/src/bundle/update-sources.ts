import type { BundleChannel, BundleSource } from '@mcs/schema-registry';

/**
 * Vite `define`-injected override (`apps/web/vite.config.ts`), a JSON object
 * keyed by channel, or the literal `null` when unset. Same `typeof`-guard
 * reasoning as `trust-anchors.ts`'s `__TRUST_ANCHOR_OVERRIDES__`: safe to
 * reference outside a Vite build too, since `vitest` never defines this
 * global at all.
 */
declare const __BUNDLE_UPDATE_SOURCES__: string | null | undefined;

const CHANNELS: readonly BundleChannel[] = ['stable', 'beta'];

function isBundleSource(value: unknown): value is BundleSource {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>).manifestUrl === 'string' &&
    typeof (value as Record<string, unknown>).fileBaseUrl === 'string'
  );
}

/**
 * Parses the build-time Bundle update source override. `raw` defaults to
 * the real `__BUNDLE_UPDATE_SOURCES__` global so production call sites need
 * no argument, while tests pass a string directly to exercise specific
 * shapes (the global itself is a load-time constant no test can
 * parameterize).
 *
 * Never throws and never guesses a URL: a missing/malformed top-level value
 * returns `{}`, and a per-channel entry with the wrong shape is dropped
 * rather than failing the whole result — this is what lets "only stable is
 * configured, beta is not" round-trip correctly. `BundlePage` already
 * renders "not configured" for any channel absent from the result, so both
 * cases degrade to that same, already-covered UI state.
 */
export function resolveUpdateSources(
  raw: string | null | undefined = typeof __BUNDLE_UPDATE_SOURCES__ === 'string'
    ? __BUNDLE_UPDATE_SOURCES__
    : undefined,
): Partial<Record<BundleChannel, BundleSource>> {
  if (typeof raw !== 'string') return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};

  const result: Partial<Record<BundleChannel, BundleSource>> = {};
  for (const channel of CHANNELS) {
    const candidate = (parsed as Record<string, unknown>)[channel];
    if (isBundleSource(candidate)) {
      result[channel] = candidate;
    }
  }
  return result;
}
