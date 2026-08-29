// @vitest-environment jsdom
import { cssVariables } from '@mcs/ui';
import { describe, expect, it } from 'vitest';

import { applyCssVariables, parseCssVariables } from './apply-css-variables.js';

describe('parseCssVariables', () => {
  it('parses a simple :root block into name/value pairs', () => {
    const css = ':root {\n  --mcs-color-primary: #cc785c;\n  --mcs-spacing-md: 16px;\n}\n';
    expect(parseCssVariables(css)).toEqual([
      ['--mcs-color-primary', '#cc785c'],
      ['--mcs-spacing-md', '16px'],
    ]);
  });

  it('ignores non-custom-property declarations and empty lines', () => {
    const css = ':root {\n  color: red;\n\n  --mcs-x: 1;\n}\n';
    expect(parseCssVariables(css)).toEqual([['--mcs-x', '1']]);
  });

  it('returns an empty list for a string with no :root block', () => {
    expect(parseCssVariables('')).toEqual([]);
  });

  it('parses every real @mcs/ui token without dropping or corrupting any of them', () => {
    const real = cssVariables();
    const pairs = parseCssVariables(real);
    // The real block always has at least one line per token category
    // (colors/spacing/rounded/density/breakpoints/typography) — a parser
    // regression that returns too few pairs would slip past a test that
    // only checks a handful of hand-picked names.
    expect(pairs.length).toBeGreaterThan(20);
    expect(pairs).toContainEqual(['--mcs-color-primary', '#cc785c']);
    expect(pairs.every(([name, value]) => name.startsWith('--mcs-') && value.length > 0)).toBe(
      true,
    );
  });
});

describe('applyCssVariables', () => {
  it('sets every parsed custom property on the target element via the style attribute, not a <style> element', () => {
    const target = document.createElement('div');
    applyCssVariables(target, ':root {\n  --mcs-color-primary: #cc785c;\n}\n');

    expect(target.style.getPropertyValue('--mcs-color-primary').trim()).toBe('#cc785c');
    expect(document.querySelectorAll('style')).toHaveLength(0);
  });

  it('applies the real, full @mcs/ui token set onto document.documentElement', () => {
    applyCssVariables(document.documentElement, cssVariables());
    expect(document.documentElement.style.getPropertyValue('--mcs-color-primary').trim()).toBe(
      '#cc785c',
    );
  });
});
