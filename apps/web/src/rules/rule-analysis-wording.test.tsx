// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import en from '../i18n/en.json';
import zhCN from '../i18n/zh-CN.json';
import { IssuePanel } from '../issues/IssuePanel.js';
import type { ValidationIssue } from '../worker/protocol.js';

afterEach(() => {
  cleanup();
});

/**
 * FR-RULE-04 wording audit (v0.4.0 #18): PRD §8.6's closing line and NG-07
 * both require this app to never claim its static rule-order analysis
 * (MATCH position, obvious shadowing — `packages/validator/src/
 * rule-order.ts`) is equivalent to what the real mihomo kernel does at
 * match time. This is a machine assertion, not a one-time read-through —
 * per the plan's own "退出条件用测试代码固化" precedent (v0.3.0 #22), a
 * *future* `ruleOrder.*` key that slips in assertive wording fails this
 * test automatically, the same way a missing translation already fails
 * `i18n.test.ts`'s key-set parity check.
 *
 * File extension is `.tsx`, not the plan text's literal `.test.ts` — this
 * file renders `IssuePanel` (JSX), which `.ts` cannot parse at all; every
 * other React-rendering test in this codebase is already `.tsx` (e.g.
 * `IssuePanel.test.tsx` itself), so this follows existing convention rather
 * than diverging from it.
 */
const RULE_ORDER_KEY_PREFIX = 'ruleOrder.';

function ruleOrderKeys(resource: Record<string, string>): string[] {
  return Object.keys(resource).filter((key) => key.startsWith(RULE_ORDER_KEY_PREFIX));
}

/**
 * Deliberately over-inclusive rather than exhaustive: each entry is a
 * pattern that asserts a *kernel-runtime outcome* ("this will/won't match",
 * "this is unreachable") rather than describing the rule *list's own text*
 * (position, overlap) — the distinction PRD §8.6/NG-07 draw. English is
 * checked case-insensitively since the same claim can appear capitalised at
 * a sentence's start.
 */
const FORBIDDEN_PATTERNS_ZH: readonly string[] = [
  '一定',
  '必然',
  '绝对',
  '肯定',
  '保证',
  '永远不会',
  '不会生效',
  '无法匹配',
  '不会匹配',
  '始终',
];
const FORBIDDEN_PATTERNS_EN: readonly RegExp[] = [
  /\bwill never\b/i,
  /\bwill always\b/i,
  /\balways matches?\b/i,
  /\bnever matches?\b/i,
  /\bguaranteed\b/i,
  /\bdefinitely\b/i,
  /\bcertainly\b/i,
  /\bmust not\b/i,
  /\bcannot match\b/i,
  /\bunreachable\b/i,
];

describe('ruleOrder.* i18n wording never asserts kernel-runtime equivalence (FR-RULE-04, PRD §8.6, NG-07, v0.4.0 #18)', () => {
  it('zh-CN: no ruleOrder.* value contains an assertive/absolute claim word', () => {
    const keys = ruleOrderKeys(zhCN);
    expect(keys.length).toBeGreaterThan(0); // sanity: the audit is actually covering something
    for (const key of keys) {
      const value = zhCN[key as keyof typeof zhCN];
      for (const pattern of FORBIDDEN_PATTERNS_ZH) {
        expect(value, `zh-CN["${key}"] = "${value}" contains forbidden "${pattern}"`).not.toContain(
          pattern,
        );
      }
    }
  });

  it('en: no ruleOrder.* value contains an assertive/absolute claim phrase', () => {
    const keys = ruleOrderKeys(en);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      const value = en[key as keyof typeof en];
      for (const pattern of FORBIDDEN_PATTERNS_EN) {
        expect(pattern.test(value), `en["${key}"] = "${value}" matches forbidden ${pattern}`).toBe(
          false,
        );
      }
    }
  });

  it('zh-CN and en cover exactly the same ruleOrder.* keys (i18n.test.ts already enforces this globally; re-asserted narrowly here so this file is self-contained)', () => {
    expect(ruleOrderKeys(zhCN).sort()).toEqual(ruleOrderKeys(en).sort());
  });
});

const NO_OP_CLIENT = {
  locate: vi.fn().mockResolvedValue({ type: 'locate', requestId: 'x', range: null }),
};

function ruleOrderIssue(
  messageKey: string,
  messageParams?: Record<string, string | number>,
): ValidationIssue {
  return {
    severity: 'warning',
    code: messageKey,
    module: 'rule-order',
    messageKey,
    ...(messageParams ? { messageParams } : {}),
    path: ['rules', 0],
    blocking: false,
  };
}

describe('IssuePanel always renders the static-analysis caveat alongside a rule-order issue (v0.4.0 #18)', () => {
  it.each([
    ['ruleOrder.noMatch', undefined],
    ['ruleOrder.afterMatch', { ruleIndex: 3 }],
    ['ruleOrder.domainShadowed', { ruleIndex: 3, shadowedByIndex: 1, type: 'DOMAIN-SUFFIX' }],
    ['ruleOrder.cidrShadowed', { ruleIndex: 3, shadowedByIndex: 1, type: 'IP-CIDR' }],
  ] as const)(
    'shows the caveat for a real %s issue, not conditionally on its message text',
    (key, params) => {
      render(
        <IssuePanel
          issues={[ruleOrderIssue(key, params)]}
          client={NO_OP_CLIENT}
          onJump={vi.fn()}
          onJumpToField={vi.fn()}
        />,
      );
      expect(screen.getByText(zhCN['ruleOrder.staticAnalysisCaveat'])).not.toBeNull();
    },
  );

  it('never shows the caveat next to an issue from an unrelated module', () => {
    render(
      <IssuePanel
        issues={[
          {
            severity: 'warning',
            code: 'security.allowLanWildcardBind',
            module: 'security',
            messageKey: 'security.allowLanWildcardBind',
            path: ['allow-lan'],
            blocking: false,
          },
        ]}
        client={NO_OP_CLIENT}
        onJump={vi.fn()}
        onJumpToField={vi.fn()}
      />,
    );
    expect(screen.queryByText(zhCN['ruleOrder.staticAnalysisCaveat'])).toBeNull();
  });
});
