import { expect, test, type Page } from '@playwright/test';

import { createProject, importYaml } from './fixtures.js';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

/**
 * v0.9.0 #12. Real evidence for three of the version document's PRD §11.6 /
 * WCAG 2.2 requirements that `pnpm run check`'s jsdom suite structurally
 * cannot give (no real layout, no real `:focus-visible`, no real keyboard
 * event path — see ADR-033). The fourth requirement this slice's plan names
 * (Alt+ArrowDown keyboard reorder) already has real-browser proof from
 * `e2e/web.spec.ts`'s "reorders rules with the keyboard, Alt+ArrowDown"
 * (v0.9.0 #7) — this file adds the two operations that test does not cover
 * (Home/End) rather than duplicating ArrowDown.
 */

/** Three rules, distinct enough that a home/end move is visibly different from a simple two-item swap. */
const THREE_RULES_YAML = `mode: rule
rules:
  - DOMAIN,a.example.com,DIRECT
  - DOMAIN,b.example.com,DIRECT
  - MATCH,DIRECT
`;

/**
 * Valid on its own — importing straight to a dangling reference is not
 * possible to test this way: `reference.ts`'s five checks are all
 * `severity: 'error'`, `blocking: true`, and `ImportPanel.tsx`'s
 * `attemptImport` rejects any import with a blocking issue outright (shows
 * "导入失败", never opens the project at all, so its issue panel is never
 * reachable). A shadowed rule (`warning`) and an unrecognized field
 * (`info`) are *not* blocking, so this imports cleanly with two of the
 * three severities already present; the raw-editor edit below adds the
 * third (confirmed directly against the real pipeline before writing this
 * fixture, not assumed).
 */
const TWO_SEVERITY_YAML = `mode: rule
proxies:
  - name: p1
    type: ss
    server: a.example.com
    port: 443
    cipher: aes-128-gcm
    password: "x"
    bogus-field: true
proxy-groups:
  - name: PROXY
    type: select
    proxies: [p1]
rules:
  - DOMAIN-SUFFIX,example.com,PROXY
  - DOMAIN-SUFFIX,example.com,DIRECT
  - MATCH,PROXY
totally-unknown-key: 123
`;

/** Same document, with the proxy-group's reference broken — introduced through an in-project edit (never blocked) rather than an import (blocked). */
const WITH_DANGLING_REFERENCE_YAML = TWO_SEVERITY_YAML.replace(
  'proxies: [p1]',
  'proxies: [p1, ghost]',
);

/** Types the broken text straight into the raw editor (visible on desktop regardless of the mobile bottom-nav page it also belongs to — see `AppShell.responsive.css`'s `@media` scoping) and waits for the debounced re-validation to actually land. */
async function introduceDanglingReference(page: Page): Promise<void> {
  const rawEditor = page.getByRole('textbox', { name: '原文编辑器' });
  await rawEditor.fill(WITH_DANGLING_REFERENCE_YAML);
  await expect(page.locator('.issue-panel__group-title', { hasText: '错误' })).toBeVisible();
}

test('every severity shows a distinct glyph alongside its text, never color alone (PRD §11.6)', async ({
  page,
}) => {
  await createProject(page);
  await importYaml(page, TWO_SEVERITY_YAML);
  await introduceDanglingReference(page);

  // Each severity's own group heading carries a distinct, non-color glyph
  // (`aria-hidden`, decorative — deliberately checked as its own element,
  // not folded into a `getByRole(..., { name })` match: an `aria-hidden`
  // descendant's inclusion in an ancestor's *computed accessible name* is
  // an accname-spec subtlety this assertion should not depend on either
  // way) immediately followed by the translated label — a screen reader
  // announces the text, a sighted user without color vision still sees a
  // different shape per severity.
  for (const [markGlyph, labelText] of [
    ['✕', '错误'],
    ['▲', '警告'],
    ['ℹ', '提示'],
  ] as const) {
    const heading = page.locator('.issue-panel__group-title', { hasText: labelText });
    await expect(heading).toBeVisible();
    await expect(heading.locator('[aria-hidden="true"]')).toHaveText(markGlyph);
  }

  // Every individual issue row repeats its own severity's glyph right next
  // to its message text, not just the group heading — the same signal is
  // never carried by the tint background alone at the row level either.
  const markTexts = await page.locator('.issue-panel__mark').allTextContents();
  expect(markTexts).toContain('✕');
  expect(markTexts).toContain('▲');
  expect(markTexts).toContain('ℹ');
});

test('every visible interactive control is keyboard-reachable with a visible focus indicator (PRD §11.6)', async ({
  page,
}) => {
  await createProject(page);
  await importYaml(page, TWO_SEVERITY_YAML);
  await introduceDanglingReference(page);

  // `[tabindex]` alone over-counts: `tabindex="-1"` is focusable via script
  // but deliberately removed from the natural Tab sequence, so a raw
  // attribute-presence selector would demand this test visit elements the
  // real, correct behavior is to skip. Each surviving candidate is tagged
  // with a unique index up front — identity by truncated `outerHTML` text
  // was tried first and undercounted real distinct visits, because several
  // unrelated elements (e.g. more than one "查看官方文档" link) share
  // identical markup for their first couple hundred characters and only
  // differ past that point.
  const interactiveSelector = 'button, a[href], input, select, textarea, [tabindex]';
  const candidateCount = await page.locator(interactiveSelector).evaluateAll((elements) => {
    let nextIndex = 0;
    for (const el of elements) {
      const rect = el.getBoundingClientRect();
      const disabled = 'disabled' in el && (el as HTMLButtonElement).disabled;
      const explicitlyRemovedFromTabOrder = el.getAttribute('tabindex') === '-1';
      if (rect.width > 0 && rect.height > 0 && !disabled && !explicitlyRemovedFromTabOrder) {
        el.setAttribute('data-a11y-scan-index', String(nextIndex));
        nextIndex++;
      }
    }
    return nextIndex;
  });
  expect(candidateCount).toBeGreaterThan(5); // sanity: this page really has several controls to reach

  // Starts from a known, neutral point (nothing focused) rather than
  // whatever the page happened to focus last during setup above.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

  const visited = new Set<string>();
  let everyStepHadVisibleFocus = true;
  // A generous margin over the real control count: native form controls
  // (e.g. a `<select>`'s options) can consume more than one Tab press
  // apiece in some browsers.
  const tabBudget = candidateCount + 20;
  for (let i = 0; i < tabBudget; i++) {
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const style = getComputedStyle(el);
      const hasVisibleOutline = style.outlineStyle !== 'none' && style.outlineWidth !== '0px';
      return { key: el.getAttribute('data-a11y-scan-index'), hasVisibleOutline };
    });
    if (!focused?.key) continue;
    visited.add(focused.key);
    if (!focused.hasVisibleOutline) everyStepHadVisibleFocus = false;
  }

  expect(everyStepHadVisibleFocus).toBe(true);
  // Real reachability, not just "some Tab stops landed somewhere": the
  // distinct set of tagged candidates actually focused must cover the
  // whole candidate set. This caught a real bug once already (v0.9.0 #12):
  // `UnknownFieldTree.tsx` used to wrap its content in a `<details
  // open={false}>` with no state or click handler ever wired to toggle it,
  // and CSS that never actually hid the "closed" content either — every
  // user always saw it expanded, but a closed `<details>` excludes its own
  // content from the native Tab sequence regardless of any CSS override,
  // so the jump/search-docs controls inside it were visible but not
  // keyboard-reachable at all. Fixed by dropping the non-functional
  // `<details>`/`<summary>` wrapper.
  expect(visited.size).toBe(candidateCount);
});

test('Alt+Home moves the selected rule to the top of the list (NFR-A11Y, keyboard drag alternative)', async ({
  page,
}) => {
  await createProject(page);
  await importYaml(page, THREE_RULES_YAML);
  await page.getByRole('tab', { name: '规则' }).click();

  const thirdRow = page.getByRole('row', { name: /第 3 条/ });
  await expect(thirdRow).toHaveAccessibleName(/MATCH,DIRECT/);
  await thirdRow.click();
  await page.keyboard.press('Alt+Home');

  await expect(page.getByRole('row', { name: /第 1 条/ })).toHaveAccessibleName(/MATCH,DIRECT/);
  await expect(page.getByRole('row', { name: /第 2 条/ })).toHaveAccessibleName(
    /DOMAIN,a\.example\.com,DIRECT/,
  );
  await expect(page.getByRole('row', { name: /第 3 条/ })).toHaveAccessibleName(
    /DOMAIN,b\.example\.com,DIRECT/,
  );
});

test('Alt+End moves the selected rule to the bottom of the list (NFR-A11Y, keyboard drag alternative)', async ({
  page,
}) => {
  await createProject(page);
  await importYaml(page, THREE_RULES_YAML);
  await page.getByRole('tab', { name: '规则' }).click();

  const firstRow = page.getByRole('row', { name: /第 1 条/ });
  await expect(firstRow).toHaveAccessibleName(/DOMAIN,a\.example\.com,DIRECT/);
  await firstRow.click();
  await page.keyboard.press('Alt+End');

  await expect(page.getByRole('row', { name: /第 1 条/ })).toHaveAccessibleName(
    /DOMAIN,b\.example\.com,DIRECT/,
  );
  await expect(page.getByRole('row', { name: /第 2 条/ })).toHaveAccessibleName(/MATCH,DIRECT/);
  await expect(page.getByRole('row', { name: /第 3 条/ })).toHaveAccessibleName(
    /DOMAIN,a\.example\.com,DIRECT/,
  );
});
