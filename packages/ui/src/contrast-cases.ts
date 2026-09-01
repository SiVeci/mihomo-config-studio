import { AA_NORMAL_TEXT_RATIO } from './contrast.js';
import type { ColorTokenName } from './tokens.js';

/**
 * The single (foreground, background, minRatio) source of truth for every
 * AA claim ADR-011 §2 and ADR-017 make — moved out of `contrast.test.ts`
 * (v0.9.0 #12) so `contrast-usage.test.ts` can check real CSS usage against
 * the same table without importing test-only code. A row here failing is
 * what "CI 对比度断言通过" (the version doc's exit condition) means in
 * practice — this file, not a human recalculation, is authoritative.
 */
export interface ContrastCase {
  readonly description: string;
  readonly foreground: ColorTokenName;
  readonly background: ColorTokenName;
  readonly minRatio: number;
}

export const TEXT_ROLES: readonly ColorTokenName[] = [
  'text-primary',
  'text-error',
  'text-warning',
  'text-success',
  'text-info',
  'text-muted',
  'text-teal',
];

export const SEVERITY_TINTS: readonly ColorTokenName[] = [
  'error-tint',
  'warning-tint',
  'success-tint',
  'info-tint',
];

export const TEXT_ROLE_BY_TINT: Readonly<Record<string, ColorTokenName>> = {
  'error-tint': 'text-error',
  'warning-tint': 'text-warning',
  'success-tint': 'text-success',
  'info-tint': 'text-info',
};

export const CASES: readonly ContrastCase[] = [
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

  // --- v0.9.0 #12: real usage `contrast-usage.test.ts` found with no prior
  // row, reviewed and added here (not silently passed over). ---
  {
    description: 'text-muted on surface-soft (YamlEditor.tsx 工具栏区域)',
    foreground: 'text-muted',
    background: 'surface-soft',
    minRatio: AA_NORMAL_TEXT_RATIO,
  },
  {
    description:
      'ink on canvas (index.css 的 body 基础文字色，与 body/text-primary 这两个 mcs-extension 角色是不同的 design-system 令牌)',
    foreground: 'ink',
    background: 'canvas',
    minRatio: AA_NORMAL_TEXT_RATIO,
  },
];

/**
 * v0.9.0 #12: pairs real CSS usage was found to combine, deliberately below
 * `AA_NORMAL_TEXT_RATIO` — WCAG 2.2 SC 1.4.3 sets no contrast requirement
 * for "text that is part of an inactive user interface component". Kept
 * separate from `CASES` (not just given a lower `minRatio` there) so a
 * *new* sub-AA pairing can never slip in by copying this shape — each entry
 * here needs its own reviewed exemption reason, not a number.
 */
export interface ContrastExemption {
  readonly description: string;
  readonly foreground: ColorTokenName;
  readonly background: ColorTokenName;
  readonly reason: string;
}

export const EXEMPTIONS: readonly ContrastExemption[] = [
  {
    description: 'muted on primary-disabled (ImportPanel.tsx 的 :disabled 粘贴按钮)',
    foreground: 'muted',
    background: 'primary-disabled',
    reason:
      'WCAG 2.2 SC 1.4.3 对"处于非激活状态的用户界面组件"的文字不设对比度要求。这是一个 :disabled 按钮，用户此刻不能与它交互；实测 4.10:1，低于 4.5:1，故意不按 AA 断言，也不该被误改成看起来"通过"的数字。',
  },
];
