import { afterEach, describe, expect, it } from 'vitest';

import en from './en.json';
import zhCN from './zh-CN.json';
import { getLocale, setLocale, t } from './index.js';
import type { TranslationKey } from './index.js';

afterEach(() => {
  setLocale('zh-CN'); // tests must not leak locale state into one another
});

describe('i18n resource parity (ADR-016)', () => {
  it('has exactly the same key set in zh-CN.json and en.json', () => {
    const zhKeys = new Set(Object.keys(zhCN));
    const enKeys = new Set(Object.keys(en));

    const missingInEn = [...zhKeys].filter((key) => !enKeys.has(key));
    const missingInZh = [...enKeys].filter((key) => !zhKeys.has(key));

    expect(missingInEn, 'keys present in zh-CN.json but missing from en.json').toEqual([]);
    expect(missingInZh, 'keys present in en.json but missing from zh-CN.json').toEqual([]);
  });

  it('has no empty string values in zh-CN.json', () => {
    for (const [key, value] of Object.entries(zhCN)) {
      expect(value, `zh-CN.json["${key}"]`).not.toBe('');
    }
  });

  it('has no empty string values in en.json', () => {
    for (const [key, value] of Object.entries(en)) {
      expect(value, `en.json["${key}"]`).not.toBe('');
    }
  });
});

describe('t() / setLocale() / getLocale()', () => {
  it('defaults to zh-CN (ADR-016: v1.0 ships a Chinese-only UI)', () => {
    expect(getLocale()).toBe('zh-CN');
    expect(t('app.title')).toBe(zhCN['app.title']);
  });

  it('switches locale and looks up the new locale afterward', () => {
    setLocale('en');

    expect(getLocale()).toBe('en');
    expect(t('app.title')).toBe(en['app.title']);
  });

  it('substitutes a {param} placeholder', () => {
    expect(t('app.notFoundPath', { path: '/nope' })).toBe(
      zhCN['app.notFoundPath'].replace('{path}', '/nope'),
    );
  });

  it('substitutes a numeric param by stringifying it', () => {
    expect(t('app.notFoundPath', { path: 404 })).toContain('404');
  });

  it('leaves a template with no matching param untouched', () => {
    expect(t('app.notFoundPath', { unrelated: 'x' })).toBe(zhCN['app.notFoundPath']);
  });

  it('falls back to the key itself for a key present in neither locale (defensive: should not happen given the parity test above)', () => {
    const bogusKey = 'this.key.does.not.exist' as TranslationKey;
    expect(t(bogusKey)).toBe(bogusKey);
  });
});
