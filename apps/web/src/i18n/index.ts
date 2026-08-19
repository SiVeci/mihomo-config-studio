import en from './en.json';
import zhCN from './zh-CN.json';

/**
 * Self-built, not i18next: this app only ever needed `t(key, params)` lookup
 * plus a locale switch — i18next's feature set (plurals, namespacing,
 * backends, React bindings) buys nothing here that ~40 lines doesn't already
 * cover, and ADR-016 asks for the *resource structure* being complete, not
 * for a particular library.
 */

export type Locale = 'zh-CN' | 'en';

export type TranslationKey = keyof typeof zhCN;

/**
 * Typing `en` against `Record<TranslationKey, string>` makes a key missing
 * from `en.json` a type error, not just a test failure — `i18n.test.ts`
 * still asserts the same thing at runtime (JSON content the type system
 * can't see, like an accidentally-empty value) but this catches the more
 * common case (a forgotten key) at `pnpm run typecheck` time.
 */
const RESOURCES: Record<Locale, Record<TranslationKey, string>> = { 'zh-CN': zhCN, en };

/** ADR-016: v1.0 ships a Chinese-only UI; the English resource exists so nothing needs rewriting later. */
const DEFAULT_LOCALE: Locale = 'zh-CN';

let currentLocale: Locale = DEFAULT_LOCALE;

export function setLocale(locale: Locale): void {
  currentLocale = locale;
}

export function getLocale(): Locale {
  return currentLocale;
}

/**
 * Looks up `key` in the current locale, substituting `{param}` placeholders.
 * Falls back to the default locale and then the raw key if somehow missing —
 * `i18n.test.ts`'s key-set parity check is what should actually keep that
 * fallback from ever firing in practice.
 */
export function t(key: TranslationKey, params?: Readonly<Record<string, string | number>>): string {
  const template = RESOURCES[currentLocale][key] ?? RESOURCES[DEFAULT_LOCALE][key] ?? key;
  return interpolate(template, params);
}

/**
 * Translate a key that might belong to a Schema module's own `i18n` bundle
 * (field/group labels — v0.3.0 #6-#11) rather than this app's own resource
 * files: check `moduleI18n` first, then fall back to the app's own `t()`.
 *
 * `key` is `string`, not `TranslationKey`: a rendered `PlannedField`'s
 * `ui.label`/group label is data from a Schema module, not a literal this
 * app authored, so it can never be a member of the closed `TranslationKey`
 * union at compile time. The cast below is safe only because `t()`'s own
 * fallback chain (`RESOURCES[locale][key] ?? RESOURCES[DEFAULT_LOCALE][key]
 * ?? key`) never throws for an unregistered key — it degrades to the raw
 * key text, exactly like every other unregistered lookup in this file.
 */
export function translateModuleAware(
  key: string,
  moduleI18n: Record<string, string> | undefined,
  params?: Readonly<Record<string, string | number>>,
): string {
  const fromModule = moduleI18n?.[key];
  if (fromModule !== undefined) return interpolate(fromModule, params);
  return t(key as TranslationKey, params);
}

function interpolate(template: string, params?: Readonly<Record<string, string | number>>): string {
  if (!params) return template;
  let result = template;
  for (const [paramKey, value] of Object.entries(params)) {
    result = result.replaceAll(`{${paramKey}}`, String(value));
  }
  return result;
}
