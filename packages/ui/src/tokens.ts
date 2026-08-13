/**
 * Design tokens for `packages/ui`. Two sources feed this file:
 *
 * - `design-system`: ported from `DESIGN.md`'s YAML frontmatter, with the
 *   contrast corrections ADR-011 §2 requires already applied (`primary` is
 *   fill-only; `primary-active` is the text-bearing coral). Fonts are
 *   substituted per ADR-011 §3 (Copernicus/StyreneB are non-public).
 * - `mcs-extension`: not in `DESIGN.md` at all — defined here per ADR-011 §5
 *   (density scale, form state set, light/dark theme pairs, hover spec) and
 *   ADR-017 (the text-bearing color layer, severity tints and markers).
 *
 * Every exported token carries `source` so contributors can tell which ones
 * are safe to restyle freely (`mcs-extension`) versus which ones changing
 * means diverging from the adopted design system (`design-system`).
 *
 * Contrast ratios referenced in comments are verified in ADR-011 §2 and
 * ADR-017; the authoritative, CI-enforced check is `contrast.ts` (#8) — this
 * file is data, not the verifier.
 */

export type TokenSource = 'design-system' | 'mcs-extension';

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

export interface ColorToken {
  readonly value: string;
  readonly source: TokenSource;
}

export const COLORS = {
  // Fill layer (design-system, from DESIGN.md; ADR-011 §2 corrections applied).
  primary: { value: '#cc785c', source: 'design-system' },
  'primary-active': { value: '#a9583e', source: 'design-system' },
  'primary-disabled': { value: '#e6dfd8', source: 'design-system' },
  ink: { value: '#141413', source: 'design-system' },
  body: { value: '#3d3d3a', source: 'design-system' },
  'body-strong': { value: '#252523', source: 'design-system' },
  muted: { value: '#6c6a64', source: 'design-system' },
  /** Decorative/non-text use only (ADR-011 §2): fails AA at 13px on `canvas`. */
  'muted-soft': { value: '#8e8b82', source: 'design-system' },
  hairline: { value: '#e6dfd8', source: 'design-system' },
  'hairline-soft': { value: '#ebe6df', source: 'design-system' },
  canvas: { value: '#faf9f5', source: 'design-system' },
  'surface-soft': { value: '#f5f0e8', source: 'design-system' },
  'surface-card': { value: '#efe9de', source: 'design-system' },
  'surface-cream-strong': { value: '#e8e0d2', source: 'design-system' },
  'surface-dark': { value: '#181715', source: 'design-system' },
  'surface-dark-elevated': { value: '#252320', source: 'design-system' },
  'surface-dark-soft': { value: '#1f1e1b', source: 'design-system' },
  'on-primary': { value: '#ffffff', source: 'design-system' },
  'on-dark': { value: '#faf9f5', source: 'design-system' },
  'on-dark-soft': { value: '#a09d96', source: 'design-system' },
  'accent-teal': { value: '#5db8a6', source: 'design-system' },
  'accent-amber': { value: '#e8a55a', source: 'design-system' },
  success: { value: '#5db872', source: 'design-system' },
  warning: { value: '#d4a017', source: 'design-system' },
  error: { value: '#c64545', source: 'design-system' },

  // Text-bearing layer (mcs-extension, ADR-017 §1): ≥4.5:1 on both `canvas`
  // and `surface-card`, unlike the fill layer above.
  'text-primary': { value: '#98502f', source: 'mcs-extension' },
  'text-error': { value: '#a63838', source: 'mcs-extension' },
  'text-warning': { value: '#7d5c0d', source: 'mcs-extension' },
  'text-success': { value: '#356b45', source: 'mcs-extension' },
  /** New role: the original palette has no info color, but FR-VAL-01 needs Error/Warning/Info. */
  'text-info': { value: '#33608f', source: 'mcs-extension' },
  'text-muted': { value: '#64625c', source: 'mcs-extension' },
  'text-teal': { value: '#356b61', source: 'mcs-extension' },

  // Severity tint backgrounds (mcs-extension, ADR-017 §2): pairs with the
  // matching `text-*` role at ≥4.5:1.
  'error-tint': { value: '#f7e8e5', source: 'mcs-extension' },
  'warning-tint': { value: '#f7f0dd', source: 'mcs-extension' },
  'success-tint': { value: '#e8f2e8', source: 'mcs-extension' },
  'info-tint': { value: '#e7eef7', source: 'mcs-extension' },
} as const satisfies Record<string, ColorToken>;

export type ColorTokenName = keyof typeof COLORS;

/**
 * Colors whose contrast against white text fails AA (ADR-011 §2, ADR-017
 * §3): safe for large-area fills and non-text surfaces, never as a text
 * foreground — use a `text-*` token instead. Deliberately a short, explicit
 * list rather than a `fillOnly` field on every `ColorToken`: only these five
 * were ever candidates for text use in the first place (saturated brand/
 * semantic accents), and `primary-active` / `error` / `surface-dark` are the
 * confirmed-safe near neighbors this list must NOT include (5.06:1 / 4.84:1
 * / 17.91:1 with white text). Structural surfaces (`canvas`, `hairline`,
 * `surface-*`) were never text-color candidates, so this list makes no claim
 * about them either way.
 */
export const FILL_ONLY_COLORS: readonly ColorTokenName[] = [
  'primary',
  'warning',
  'success',
  'accent-teal',
  'accent-amber',
];

export function isFillOnly(name: ColorTokenName): boolean {
  return (FILL_ONLY_COLORS as readonly string[]).includes(name);
}

// ---------------------------------------------------------------------------
// Spacing, rounding, density, breakpoints — all a bare {value, source} shape.
// ---------------------------------------------------------------------------

export interface ScaleToken {
  readonly value: string;
  readonly source: TokenSource;
}

/** DESIGN.md's spacing scale (base unit 4px). */
export const SPACING = {
  xxs: { value: '4px', source: 'design-system' },
  xs: { value: '8px', source: 'design-system' },
  sm: { value: '12px', source: 'design-system' },
  md: { value: '16px', source: 'design-system' },
  lg: { value: '24px', source: 'design-system' },
  xl: { value: '32px', source: 'design-system' },
  xxl: { value: '48px', source: 'design-system' },
  section: { value: '96px', source: 'design-system' },
} as const satisfies Record<string, ScaleToken>;

/** DESIGN.md's border-radius scale. */
export const ROUNDED = {
  xs: { value: '4px', source: 'design-system' },
  sm: { value: '6px', source: 'design-system' },
  md: { value: '8px', source: 'design-system' },
  lg: { value: '12px', source: 'design-system' },
  xl: { value: '16px', source: 'design-system' },
  pill: { value: '9999px', source: 'design-system' },
  full: { value: '9999px', source: 'design-system' },
} as const satisfies Record<string, ScaleToken>;

/**
 * Row-height density scale (mcs-extension, ADR-011 §5): `DESIGN.md` is
 * marketing-page layout with one comfortable rhythm; a 10,000-row rule table
 * (NFR-PERF-04) needs an independently-set compact height rather than
 * shrinking the comfortable one arbitrarily.
 */
export const DENSITY = {
  compact: { value: '28px', source: 'mcs-extension' },
  comfortable: { value: '40px', source: 'mcs-extension' },
  spacious: { value: '48px', source: 'mcs-extension' },
} as const satisfies Record<string, ScaleToken>;

/** Min-width breakpoints from DESIGN.md's Responsive Behavior section (not in its token frontmatter). */
export const BREAKPOINTS = {
  mobile: { value: '768px', source: 'design-system' },
  tablet: { value: '1024px', source: 'design-system' },
  desktop: { value: '1440px', source: 'design-system' },
} as const satisfies Record<string, ScaleToken>;

// ---------------------------------------------------------------------------
// Typography
// ---------------------------------------------------------------------------

export interface TypographyToken {
  readonly fontFamily: string;
  readonly fontSize: string;
  readonly fontWeight: number;
  readonly lineHeight: number;
  readonly letterSpacing: string;
  readonly source: TokenSource;
}

/** ADR-011 §3: Copernicus/Tiempos Headline are non-public; Cormorant Garamond is DESIGN.md's own documented substitute, EB Garamond its fallback. */
const DISPLAY_FONT = '"Cormorant Garamond", "EB Garamond", Georgia, serif';
/** ADR-011 §3: StyreneB is non-public; Inter is DESIGN.md's own documented substitute. */
const BODY_FONT = 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
const CODE_FONT = '"JetBrains Mono", ui-monospace, monospace';

export const TYPOGRAPHY = {
  'display-xl': {
    fontFamily: DISPLAY_FONT,
    fontSize: '64px',
    fontWeight: 400,
    lineHeight: 1.05,
    letterSpacing: '-1.5px',
    source: 'design-system',
  },
  'display-lg': {
    fontFamily: DISPLAY_FONT,
    fontSize: '48px',
    fontWeight: 400,
    lineHeight: 1.1,
    letterSpacing: '-1px',
    source: 'design-system',
  },
  'display-md': {
    fontFamily: DISPLAY_FONT,
    fontSize: '36px',
    fontWeight: 400,
    lineHeight: 1.15,
    letterSpacing: '-0.5px',
    source: 'design-system',
  },
  'display-sm': {
    fontFamily: DISPLAY_FONT,
    fontSize: '28px',
    fontWeight: 400,
    lineHeight: 1.2,
    letterSpacing: '-0.3px',
    source: 'design-system',
  },
  'title-lg': {
    fontFamily: BODY_FONT,
    fontSize: '22px',
    fontWeight: 500,
    lineHeight: 1.3,
    letterSpacing: '0',
    source: 'design-system',
  },
  'title-md': {
    fontFamily: BODY_FONT,
    fontSize: '18px',
    fontWeight: 500,
    lineHeight: 1.4,
    letterSpacing: '0',
    source: 'design-system',
  },
  'title-sm': {
    fontFamily: BODY_FONT,
    fontSize: '16px',
    fontWeight: 500,
    lineHeight: 1.4,
    letterSpacing: '0',
    source: 'design-system',
  },
  'body-md': {
    fontFamily: BODY_FONT,
    fontSize: '16px',
    fontWeight: 400,
    lineHeight: 1.55,
    letterSpacing: '0',
    source: 'design-system',
  },
  'body-sm': {
    fontFamily: BODY_FONT,
    fontSize: '14px',
    fontWeight: 400,
    lineHeight: 1.55,
    letterSpacing: '0',
    source: 'design-system',
  },
  caption: {
    fontFamily: BODY_FONT,
    fontSize: '13px',
    fontWeight: 500,
    lineHeight: 1.4,
    letterSpacing: '0',
    source: 'design-system',
  },
  'caption-uppercase': {
    fontFamily: BODY_FONT,
    fontSize: '12px',
    fontWeight: 500,
    lineHeight: 1.4,
    letterSpacing: '1.5px',
    source: 'design-system',
  },
  code: {
    fontFamily: CODE_FONT,
    fontSize: '14px',
    fontWeight: 400,
    lineHeight: 1.6,
    letterSpacing: '0',
    source: 'design-system',
  },
  button: {
    fontFamily: BODY_FONT,
    fontSize: '14px',
    fontWeight: 500,
    lineHeight: 1,
    letterSpacing: '0',
    source: 'design-system',
  },
  'nav-link': {
    fontFamily: BODY_FONT,
    fontSize: '14px',
    fontWeight: 500,
    lineHeight: 1.4,
    letterSpacing: '0',
    source: 'design-system',
  },
} as const satisfies Record<string, TypographyToken>;

// ---------------------------------------------------------------------------
// Form state set (mcs-extension, ADR-011 §5): DESIGN.md only has
// text-input/-focused; a Schema-driven form needs error/warning/disabled/
// readonly as first-class states.
// ---------------------------------------------------------------------------

export interface FormStateToken {
  readonly borderColor: ColorTokenName;
  readonly backgroundColor: ColorTokenName;
  readonly textColor: ColorTokenName;
  readonly source: TokenSource;
}

export const FORM_STATE = {
  default: {
    borderColor: 'hairline',
    backgroundColor: 'canvas',
    textColor: 'ink',
    source: 'mcs-extension',
  },
  focused: {
    borderColor: 'primary-active',
    backgroundColor: 'canvas',
    textColor: 'ink',
    source: 'mcs-extension',
  },
  error: {
    borderColor: 'text-error',
    backgroundColor: 'error-tint',
    textColor: 'ink',
    source: 'mcs-extension',
  },
  warning: {
    borderColor: 'text-warning',
    backgroundColor: 'warning-tint',
    textColor: 'ink',
    source: 'mcs-extension',
  },
  disabled: {
    borderColor: 'hairline',
    backgroundColor: 'surface-soft',
    textColor: 'muted',
    source: 'mcs-extension',
  },
  readonly: {
    borderColor: 'hairline-soft',
    backgroundColor: 'surface-card',
    textColor: 'body',
    source: 'mcs-extension',
  },
} as const satisfies Record<string, FormStateToken>;

// ---------------------------------------------------------------------------
// Light/dark theme pairs (mcs-extension, ADR-011 §5): DESIGN.md's dark
// surface is a page-band accent, not a whole-app theme switch.
// ---------------------------------------------------------------------------

export interface ThemeTokens {
  readonly background: ColorTokenName;
  readonly surface: ColorTokenName;
  readonly surfaceElevated: ColorTokenName;
  readonly textPrimary: ColorTokenName;
  readonly textMuted: ColorTokenName;
  readonly border: ColorTokenName;
  readonly source: TokenSource;
}

export const THEMES = {
  light: {
    background: 'canvas',
    surface: 'surface-card',
    surfaceElevated: 'surface-cream-strong',
    textPrimary: 'ink',
    textMuted: 'muted',
    border: 'hairline',
    source: 'mcs-extension',
  },
  dark: {
    background: 'surface-dark',
    surface: 'surface-dark-elevated',
    surfaceElevated: 'surface-dark-soft',
    textPrimary: 'on-dark',
    textMuted: 'on-dark-soft',
    border: 'surface-dark-elevated',
    source: 'mcs-extension',
  },
} as const satisfies Record<'light' | 'dark', ThemeTokens>;

// ---------------------------------------------------------------------------
// Hover spec (mcs-extension, ADR-011 §5): DESIGN.md explicitly documents no
// hover states ("Never document hover"); a desktop editor needs feedback for
// row actions, drag handles and icon buttons.
// ---------------------------------------------------------------------------

export interface HoverToken {
  readonly backgroundColor: ColorTokenName;
  readonly transitionMs: number;
  readonly source: TokenSource;
}

export const HOVER = {
  row: { backgroundColor: 'surface-soft', transitionMs: 100, source: 'mcs-extension' },
  iconButton: { backgroundColor: 'surface-card', transitionMs: 100, source: 'mcs-extension' },
  dragHandle: {
    backgroundColor: 'surface-cream-strong',
    transitionMs: 100,
    source: 'mcs-extension',
  },
} as const satisfies Record<string, HoverToken>;

// ---------------------------------------------------------------------------
// Severity markers (mcs-extension, ADR-017): pairs each FR-VAL-01 severity
// with its text color, tint background, AND a non-color icon marker — PRD
// §11.6 requires severity never be conveyed by color alone.
// ---------------------------------------------------------------------------

export type Severity = 'error' | 'warning' | 'info' | 'success';

export interface SeverityToken {
  readonly textColor: ColorTokenName;
  readonly tintColor: ColorTokenName;
  /** Non-color marker (PRD §11.6); an icon identifier, not a rendered component. */
  readonly icon: string;
  readonly source: TokenSource;
}

export const SEVERITY = {
  error: {
    textColor: 'text-error',
    tintColor: 'error-tint',
    icon: 'circle-x',
    source: 'mcs-extension',
  },
  warning: {
    textColor: 'text-warning',
    tintColor: 'warning-tint',
    icon: 'triangle-alert',
    source: 'mcs-extension',
  },
  info: { textColor: 'text-info', tintColor: 'info-tint', icon: 'info', source: 'mcs-extension' },
  success: {
    textColor: 'text-success',
    tintColor: 'success-tint',
    icon: 'circle-check',
    source: 'mcs-extension',
  },
} as const satisfies Record<Severity, SeverityToken>;

// ---------------------------------------------------------------------------
// CSS custom properties — generated from the tables above, never hand-written
// a second time (otherwise the two representations drift).
// ---------------------------------------------------------------------------

/** Renders every token above as a `:root { --mcs-... }` CSS custom-property block. */
export function cssVariables(): string {
  const lines: string[] = [];

  for (const [name, token] of Object.entries(COLORS)) {
    lines.push(`  --mcs-color-${name}: ${token.value};`);
  }
  for (const [name, token] of Object.entries(SPACING)) {
    lines.push(`  --mcs-spacing-${name}: ${token.value};`);
  }
  for (const [name, token] of Object.entries(ROUNDED)) {
    lines.push(`  --mcs-rounded-${name}: ${token.value};`);
  }
  for (const [name, token] of Object.entries(DENSITY)) {
    lines.push(`  --mcs-density-${name}: ${token.value};`);
  }
  for (const [name, token] of Object.entries(BREAKPOINTS)) {
    lines.push(`  --mcs-breakpoint-${name}: ${token.value};`);
  }
  for (const [name, token] of Object.entries(TYPOGRAPHY)) {
    lines.push(`  --mcs-font-family-${name}: ${token.fontFamily};`);
    lines.push(`  --mcs-font-size-${name}: ${token.fontSize};`);
    lines.push(`  --mcs-font-weight-${name}: ${token.fontWeight};`);
    lines.push(`  --mcs-line-height-${name}: ${token.lineHeight};`);
    lines.push(`  --mcs-letter-spacing-${name}: ${token.letterSpacing};`);
  }

  return `:root {\n${lines.join('\n')}\n}\n`;
}
