import { describe, expect, it } from 'vitest';

import { AA_NORMAL_TEXT_RATIO, contrastRatio } from './contrast.js';
import { COLORS, isFillOnly } from './tokens.js';
import type { ColorTokenName } from './tokens.js';

describe('contrastRatio() (WCAG 2.x formula)', () => {
  it('matches the WCAG worked extreme: black on white is exactly 21:1', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
  });

  it('is 1:1 for identical colors', () => {
    expect(contrastRatio('#5db872', '#5db872')).toBeCloseTo(1, 5);
  });

  it('is order-independent', () => {
    expect(contrastRatio('#3d3d3a', '#faf9f5')).toBeCloseTo(
      contrastRatio('#faf9f5', '#3d3d3a'),
      10,
    );
  });

  it('reproduces the ADR-011 §2 figure for body on canvas', () => {
    expect(contrastRatio(COLORS.body.value, COLORS.canvas.value)).toBeCloseTo(10.34, 2);
  });

  it('reproduces the ADR-017 figure for text-primary on canvas', () => {
    expect(contrastRatio(COLORS['text-primary'].value, COLORS.canvas.value)).toBeCloseTo(5.66, 2);
  });

  it('rejects a malformed hex value rather than silently misreading it', () => {
    expect(() => contrastRatio('not-a-color', '#ffffff')).toThrow();
    expect(() => contrastRatio('#fff', '#ffffff')).toThrow(); // 3-digit shorthand not supported
  });
});

// ---------------------------------------------------------------------------
// Token contrast table: the single (foreground, background, minRatio) source
// of truth for every AA claim ADR-011 §2 and ADR-017 make. A row here failing
// is what "CI 对比度断言通过" (the version doc's exit condition) means in
// practice — this file, not a human recalculation, is authoritative from
// here on.
// ---------------------------------------------------------------------------

interface ContrastCase {
  readonly description: string;
  readonly foreground: ColorTokenName;
  readonly background: ColorTokenName;
  readonly minRatio: number;
}

const TEXT_ROLES: readonly ColorTokenName[] = [
  'text-primary',
  'text-error',
  'text-warning',
  'text-success',
  'text-info',
  'text-muted',
  'text-teal',
];

const SEVERITY_TINTS: readonly ColorTokenName[] = [
  'error-tint',
  'warning-tint',
  'success-tint',
  'info-tint',
];

const TEXT_ROLE_BY_TINT: Readonly<Record<string, ColorTokenName>> = {
  'error-tint': 'text-error',
  'warning-tint': 'text-warning',
  'success-tint': 'text-success',
  'info-tint': 'text-info',
};

const CASES: readonly ContrastCase[] = [
  // --- ADR-011 §2: the original palette's passing claims, now CI-enforced. ---
  {
    description: 'body on canvas',
    foreground: 'body',
    background: 'canvas',
    minRatio: AA_NORMAL_TEXT_RATIO,
  },
  {
    description: 'muted on canvas',
    foreground: 'muted',
    background: 'canvas',
    minRatio: AA_NORMAL_TEXT_RATIO,
  },
  {
    description: 'primary-active on canvas (the text-bearing coral)',
    foreground: 'primary-active',
    background: 'canvas',
    minRatio: AA_NORMAL_TEXT_RATIO,
  },
  {
    description: 'on-dark on surface-dark',
    foreground: 'on-dark',
    background: 'surface-dark',
    minRatio: AA_NORMAL_TEXT_RATIO,
  },
  {
    description: 'on-dark-soft on surface-dark',
    foreground: 'on-dark-soft',
    background: 'surface-dark',
    minRatio: AA_NORMAL_TEXT_RATIO,
  },

  // --- ADR-017 §3: white text on the fill colors confirmed NOT fillOnly. ---
  // The five FILL_ONLY_COLORS are deliberately absent — they are known to
  // fail this exact check, which is why they carry the flag.
  {
    description: 'white text (on-primary) on primary-active',
    foreground: 'on-primary',
    background: 'primary-active',
    minRatio: AA_NORMAL_TEXT_RATIO,
  },
  {
    description: 'white text (on-primary) on error',
    foreground: 'on-primary',
    background: 'error',
    minRatio: AA_NORMAL_TEXT_RATIO,
  },
  {
    description: 'white text (on-primary) on surface-dark',
    foreground: 'on-primary',
    background: 'surface-dark',
    minRatio: AA_NORMAL_TEXT_RATIO,
  },

  // --- ADR-017 §1: every text-* role against both real text backgrounds. ---
  ...TEXT_ROLES.flatMap((role) => [
    {
      description: `${role} on canvas`,
      foreground: role,
      background: 'canvas' as ColorTokenName,
      minRatio: AA_NORMAL_TEXT_RATIO,
    },
    {
      description: `${role} on surface-card`,
      foreground: role,
      background: 'surface-card' as ColorTokenName,
      minRatio: AA_NORMAL_TEXT_RATIO,
    },
  ]),

  // --- ADR-017 §2: each severity tint against its matching text-* role, and
  // against body/text-muted (a badge can carry secondary text too). ---
  ...SEVERITY_TINTS.flatMap((tint) => [
    {
      description: `${TEXT_ROLE_BY_TINT[tint]} on ${tint}`,
      foreground: TEXT_ROLE_BY_TINT[tint]!,
      background: tint,
      minRatio: AA_NORMAL_TEXT_RATIO,
    },
    {
      description: `body on ${tint}`,
      foreground: 'body' as ColorTokenName,
      background: tint,
      minRatio: AA_NORMAL_TEXT_RATIO,
    },
    {
      description: `text-muted on ${tint}`,
      foreground: 'text-muted' as ColorTokenName,
      background: tint,
      minRatio: AA_NORMAL_TEXT_RATIO,
    },
  ]),
];

describe('token contrast table (ADR-011 §2, ADR-017)', () => {
  it.each(CASES)('$description is at least $minRatio:1', ({ foreground, background, minRatio }) => {
    const ratio = contrastRatio(COLORS[foreground].value, COLORS[background].value);
    expect(ratio).toBeGreaterThanOrEqual(minRatio);
  });

  it('never asserts a fillOnly color as a passing foreground (would contradict ADR-017 §3)', () => {
    for (const testCase of CASES) {
      expect(isFillOnly(testCase.foreground), testCase.description).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Coverage guard: a new text-* role or tint added to COLORS without a
// matching table entry above must fail loudly here, not silently ship
// unverified. This is the mechanism ADR-017 relies on to stop the table from
// quietly falling out of sync with the token data.
// ---------------------------------------------------------------------------

describe('coverage guard: COLORS and the table above must stay in sync', () => {
  it('covers every text-* role currently declared in COLORS — not a hardcoded count', () => {
    const declaredTextRoles = Object.keys(COLORS).filter((name) => name.startsWith('text-'));
    expect([...declaredTextRoles].sort()).toEqual([...TEXT_ROLES].sort());
  });

  it('covers every *-tint currently declared in COLORS — not a hardcoded count', () => {
    const declaredTints = Object.keys(COLORS).filter((name) => name.endsWith('-tint'));
    expect([...declaredTints].sort()).toEqual([...SEVERITY_TINTS].sort());
  });

  it('gives every declared text-* role a canvas and a surface-card row', () => {
    for (const role of TEXT_ROLES) {
      const onCanvas = CASES.some((c) => c.foreground === role && c.background === 'canvas');
      const onSurfaceCard = CASES.some(
        (c) => c.foreground === role && c.background === 'surface-card',
      );
      expect(onCanvas, `${role} on canvas`).toBe(true);
      expect(onSurfaceCard, `${role} on surface-card`).toBe(true);
    }
  });

  it('gives every declared severity tint a matching text-* row', () => {
    for (const tint of SEVERITY_TINTS) {
      const covered = CASES.some(
        (c) => c.background === tint && c.foreground === TEXT_ROLE_BY_TINT[tint],
      );
      expect(covered, `${TEXT_ROLE_BY_TINT[tint]} on ${tint}`).toBe(true);
    }
  });
});
