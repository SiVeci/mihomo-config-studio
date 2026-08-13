/**
 * WCAG 2.x relative luminance and contrast ratio. Pure math, no token
 * knowledge — `tokens.ts`'s `COLORS` values feed this, never the reverse.
 * https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
 * https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio
 */

const HEX_COLOR = /^#([0-9a-f]{6})$/i;

function hexToChannels(hex: string): readonly [number, number, number] {
  const match = HEX_COLOR.exec(hex);
  if (!match) {
    throw new Error('Expected a 6-digit hex color of the form "#rrggbb".');
  }
  const value = match[1]!;
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ];
}

function linearize(channel8Bit: number): number {
  const c = channel8Bit / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToChannels(hex);
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

/** WCAG contrast ratio between two colors, order-independent, in the range [1, 21]. */
export function contrastRatio(hexA: string, hexB: string): number {
  const luminanceA = relativeLuminance(hexA);
  const luminanceB = relativeLuminance(hexB);
  const lighter = Math.max(luminanceA, luminanceB);
  const darker = Math.min(luminanceA, luminanceB);
  return (lighter + 0.05) / (darker + 0.05);
}

/** AA threshold for normal-size text (WCAG SC 1.4.3). Large text (≥18pt, or ≥14pt bold) only needs 3:1 — not used anywhere in this codebase yet. */
export const AA_NORMAL_TEXT_RATIO = 4.5;
