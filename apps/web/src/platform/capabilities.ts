/**
 * Runtime capabilities this app actually calls, checked by existence rather
 * than by parsing a User-Agent string (ADR-027): WebView UA strings can be
 * frozen or altered by vendor ROMs, while asking "does this method exist"
 * never lies. Each entry is something the app already relies on somewhere —
 * not a speculative "modern browser" checklist — so a missing entry is a
 * guaranteed crash site, not a hypothetical one.
 */
export type CapabilityName =
  | 'indexedDB'
  | 'Worker'
  | 'crypto.subtle'
  | 'String.prototype.replaceAll'
  | 'Array.prototype.at'
  | 'Object.hasOwn';

/**
 * Structural subset of `typeof globalThis` this module reads — narrow on
 * purpose so tests can pass plain objects with individual branches missing,
 * instead of having to stub out the entire global object.
 */
export interface CapabilityProbeGlobal {
  readonly indexedDB?: unknown;
  readonly Worker?: unknown;
  readonly crypto?: { readonly subtle?: unknown };
  readonly String?: { readonly prototype?: { readonly replaceAll?: unknown } };
  readonly Array?: { readonly prototype?: { readonly at?: unknown } };
  readonly Object?: { readonly hasOwn?: unknown };
}

/**
 * Pure, dependency-free by design (ADR-027): called before any other module
 * in the app's real import graph is allowed to render, so it must not rely
 * on anything it might itself be reporting as missing — including, it turns
 * out, its OWN syntax. This function deliberately avoids optional chaining
 * (`?.`) and nullish coalescing (`??`): confirmed on a real Chrome 74 AVD
 * that `build.target: chrome107` (ADR-027) leaves `?.` untranspiled in the
 * output, which Chrome 74's parser rejects outright — a SyntaxError that
 * fails the whole containing script/chunk before a single statement in it
 * runs, silently producing the exact white screen this file exists to
 * prevent. `main.tsx` isolates this file (and `UnsupportedBrowser.ts`) into
 * a separately-loaded entry chunk for the same reason: syntax safety here
 * is necessary but not sufficient if a modern-syntax sibling shares the
 * same parsed file.
 */
export function detectMissingCapabilities(
  global: CapabilityProbeGlobal,
): readonly CapabilityName[] {
  const missing: CapabilityName[] = [];
  if (typeof global.indexedDB === 'undefined') missing.push('indexedDB');
  if (typeof global.Worker === 'undefined') missing.push('Worker');

  const subtle = global.crypto && global.crypto.subtle;
  if (typeof subtle === 'undefined') missing.push('crypto.subtle');

  const replaceAllMethod =
    global.String && global.String.prototype && global.String.prototype.replaceAll;
  if (typeof replaceAllMethod !== 'function') missing.push('String.prototype.replaceAll');

  const atMethod = global.Array && global.Array.prototype && global.Array.prototype.at;
  if (typeof atMethod !== 'function') missing.push('Array.prototype.at');

  const hasOwnMethod = global.Object && global.Object.hasOwn;
  if (typeof hasOwnMethod !== 'function') missing.push('Object.hasOwn');

  return missing;
}
