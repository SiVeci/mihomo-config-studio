import { describe, expect, it } from 'vitest';

import {
  BREAKPOINTS,
  COLORS,
  cssVariables,
  DENSITY,
  FILL_ONLY_COLORS,
  FORM_STATE,
  HOVER,
  isFillOnly,
  ROUNDED,
  SEVERITY,
  SPACING,
  THEMES,
  TYPOGRAPHY,
} from './tokens.js';
import type { ColorTokenName, TokenSource } from './tokens.js';

const HEX_COLOR = /^#[0-9a-f]{6}$/;
const VALID_SOURCES: readonly TokenSource[] = ['design-system', 'mcs-extension'];

function expectValidSource(source: TokenSource): void {
  expect(VALID_SOURCES).toContain(source);
}

describe('COLORS (ADR-011 §1/§2, ADR-017)', () => {
  it('gives every color a well-formed 6-digit hex value and a valid source', () => {
    for (const [name, token] of Object.entries(COLORS)) {
      expect(token.value, `${name}.value`).toMatch(HEX_COLOR);
      expectValidSource(token.source);
    }
  });

  it('marks exactly the five fill colors ADR-011 §2/ADR-017 §3 identify as fillOnly', () => {
    expect([...FILL_ONLY_COLORS].sort()).toEqual(
      ['accent-amber', 'accent-teal', 'primary', 'success', 'warning'].sort(),
    );
    for (const name of FILL_ONLY_COLORS) {
      expect(isFillOnly(name), name).toBe(true);
    }
  });

  it('does not mark the text-bearing corrections as fillOnly', () => {
    expect(isFillOnly('primary-active')).toBe(false);
    expect(isFillOnly('error')).toBe(false);
    expect(isFillOnly('surface-dark')).toBe(false);
  });

  it('carries the ADR-011 §2 corrected values for the text-bearing coral and error/dark surfaces', () => {
    expect(COLORS['primary-active'].value).toBe('#a9583e');
    expect(COLORS.error.value).toBe('#c64545');
    expect(COLORS['surface-dark'].value).toBe('#181715');
  });

  it('defines exactly the seven ADR-017 text-bearing roles, sourced as mcs-extension and never fillOnly', () => {
    const expected: Record<string, string> = {
      'text-primary': '#98502f',
      'text-error': '#a63838',
      'text-warning': '#7d5c0d',
      'text-success': '#356b45',
      'text-info': '#33608f',
      'text-muted': '#64625c',
      'text-teal': '#356b61',
    };
    for (const [name, value] of Object.entries(expected)) {
      const key = name as ColorTokenName;
      expect(COLORS[key].value, name).toBe(value);
      expect(COLORS[key].source, name).toBe('mcs-extension');
      expect(isFillOnly(key), name).toBe(false);
    }
  });

  it('defines exactly the four ADR-017 severity tint backgrounds', () => {
    expect(COLORS['error-tint'].value).toBe('#f7e8e5');
    expect(COLORS['warning-tint'].value).toBe('#f7f0dd');
    expect(COLORS['success-tint'].value).toBe('#e8f2e8');
    expect(COLORS['info-tint'].value).toBe('#e7eef7');
  });

  it('introduces text-info as a new role absent from the original DESIGN.md palette', () => {
    // FR-VAL-01 needs Error/Warning/Info; DESIGN.md's semantic colors only cover success/warning/error.
    expect(COLORS['text-info']).toBeDefined();
    expect(Object.keys(COLORS)).not.toContain('info');
  });
});

describe('SPACING / ROUNDED (design-system, ported from DESIGN.md)', () => {
  it('has the eight documented spacing steps', () => {
    expect(Object.keys(SPACING).sort()).toEqual(
      ['xxs', 'xs', 'sm', 'md', 'lg', 'xl', 'xxl', 'section'].sort(),
    );
    expect(SPACING.md.value).toBe('16px');
    expect(SPACING.section.value).toBe('96px');
  });

  it('has the seven documented rounding steps', () => {
    expect(Object.keys(ROUNDED).sort()).toEqual(
      ['xs', 'sm', 'md', 'lg', 'xl', 'pill', 'full'].sort(),
    );
    expect(ROUNDED.md.value).toBe('8px');
  });

  it('sources every spacing and rounding step as design-system', () => {
    for (const token of [...Object.values(SPACING), ...Object.values(ROUNDED)]) {
      expect(token.source).toBe('design-system');
    }
  });
});

describe('DENSITY / BREAKPOINTS (ADR-011 §5 extensions)', () => {
  it('gives density a compact row height distinct from the comfortable default', () => {
    expect(DENSITY.compact.source).toBe('mcs-extension');
    expect(Number.parseInt(DENSITY.compact.value, 10)).toBeLessThan(
      Number.parseInt(DENSITY.comfortable.value, 10),
    );
  });

  it('matches DESIGN.md Responsive Behavior breakpoints', () => {
    expect(BREAKPOINTS.mobile.value).toBe('768px');
    expect(BREAKPOINTS.tablet.value).toBe('1024px');
    expect(BREAKPOINTS.desktop.value).toBe('1440px');
  });
});

describe('TYPOGRAPHY (design-system, fonts substituted per ADR-011 §3)', () => {
  it('has all fourteen documented type steps', () => {
    expect(Object.keys(TYPOGRAPHY)).toHaveLength(14);
  });

  it('uses the documented open-source substitute for display type, never the licensed Copernicus', () => {
    expect(TYPOGRAPHY['display-xl'].fontFamily).toContain('Cormorant Garamond');
    expect(TYPOGRAPHY['display-xl'].fontFamily).not.toContain('Copernicus');
  });

  it('uses Inter for body/title/UI type, never the licensed StyreneB', () => {
    expect(TYPOGRAPHY['body-md'].fontFamily).toContain('Inter');
    expect(TYPOGRAPHY['body-md'].fontFamily).not.toContain('StyreneB');
    expect(TYPOGRAPHY.button.fontFamily).toContain('Inter');
  });

  it('keeps JetBrains Mono for code, already open-source in DESIGN.md', () => {
    expect(TYPOGRAPHY.code.fontFamily).toContain('JetBrains Mono');
  });

  it('never bolds display type past weight 400 (DESIGN.md principle: display stays regular)', () => {
    for (const [name, token] of Object.entries(TYPOGRAPHY)) {
      if (name.startsWith('display-')) expect(token.fontWeight, name).toBe(400);
    }
  });
});

describe('FORM_STATE (ADR-011 §5: error/warning/disabled/readonly beyond default/focused)', () => {
  it('covers exactly the six documented states', () => {
    expect(Object.keys(FORM_STATE).sort()).toEqual(
      ['default', 'focused', 'error', 'warning', 'disabled', 'readonly'].sort(),
    );
  });

  it('every state references color tokens that actually exist', () => {
    for (const [name, state] of Object.entries(FORM_STATE)) {
      expect(COLORS[state.borderColor], `${name}.borderColor`).toBeDefined();
      expect(COLORS[state.backgroundColor], `${name}.backgroundColor`).toBeDefined();
      expect(COLORS[state.textColor], `${name}.textColor`).toBeDefined();
      expect(state.source).toBe('mcs-extension');
    }
  });

  it('the error state uses the text-bearing error color, not the fill-only one', () => {
    expect(FORM_STATE.error.borderColor).toBe('text-error');
    expect(isFillOnly(FORM_STATE.error.borderColor)).toBe(false);
  });
});

describe('THEMES (ADR-011 §5: light/dark theme pairs, not just page-band alternation)', () => {
  it('defines both light and dark with color tokens that actually exist', () => {
    for (const [name, theme] of Object.entries(THEMES)) {
      for (const key of [
        'background',
        'surface',
        'surfaceElevated',
        'textPrimary',
        'textMuted',
        'border',
      ] as const) {
        expect(COLORS[theme[key]], `${name}.${key}`).toBeDefined();
      }
      expect(theme.source).toBe('mcs-extension');
    }
  });

  it('keeps light and dark themes visually distinct', () => {
    expect(THEMES.light.background).not.toBe(THEMES.dark.background);
    expect(COLORS[THEMES.light.background].value).not.toBe(COLORS[THEMES.dark.background].value);
  });
});

describe('HOVER (ADR-011 §5: DESIGN.md documents none)', () => {
  it('every hover treatment references a real color token and a positive transition', () => {
    for (const [name, token] of Object.entries(HOVER)) {
      expect(COLORS[token.backgroundColor], `${name}.backgroundColor`).toBeDefined();
      expect(token.transitionMs).toBeGreaterThan(0);
      expect(token.source).toBe('mcs-extension');
    }
  });
});

describe('SEVERITY (ADR-017: pairs FR-VAL-01 levels with a non-color marker)', () => {
  it('covers exactly error/warning/info/success', () => {
    expect(Object.keys(SEVERITY).sort()).toEqual(['error', 'warning', 'info', 'success'].sort());
  });

  it('every level has a working text/tint color pair and a non-empty icon marker', () => {
    for (const [name, token] of Object.entries(SEVERITY)) {
      expect(COLORS[token.textColor], `${name}.textColor`).toBeDefined();
      expect(COLORS[token.tintColor], `${name}.tintColor`).toBeDefined();
      expect(token.textColor.startsWith('text-'), `${name}.textColor should be a text-* role`).toBe(
        true,
      );
      expect(token.icon.length, `${name}.icon`).toBeGreaterThan(0);
      expect(token.source).toBe('mcs-extension');
    }
  });

  it('gives every severity level a visually distinct icon (PRD §11.6: never color alone)', () => {
    const icons = Object.values(SEVERITY).map((token) => token.icon);
    expect(new Set(icons).size).toBe(icons.length);
  });
});

describe('cssVariables() (single source of truth for CSS custom properties)', () => {
  it('emits a :root block containing every color as --mcs-color-<name>', () => {
    const css = cssVariables();
    expect(css).toMatch(/^:root \{\n/);
    expect(css).toContain('--mcs-color-primary: #cc785c;');
    expect(css).toContain('--mcs-color-text-info: #33608f;');
    expect(css).toContain('--mcs-color-error-tint: #f7e8e5;');
  });

  it('emits spacing, rounding, density and breakpoint variables', () => {
    const css = cssVariables();
    expect(css).toContain('--mcs-spacing-md: 16px;');
    expect(css).toContain('--mcs-rounded-pill: 9999px;');
    expect(css).toContain('--mcs-density-compact: 28px;');
    expect(css).toContain('--mcs-breakpoint-tablet: 1024px;');
  });

  it('emits every typography axis for each type step', () => {
    const css = cssVariables();
    expect(css).toContain('--mcs-font-family-body-md: Inter');
    expect(css).toContain('--mcs-font-size-body-md: 16px;');
    expect(css).toContain('--mcs-font-weight-body-md: 400;');
    expect(css).toContain('--mcs-line-height-body-md: 1.55;');
    expect(css).toContain('--mcs-letter-spacing-display-xl: -1.5px;');
  });

  it('is deterministic across repeated calls', () => {
    expect(cssVariables()).toBe(cssVariables());
  });
});
