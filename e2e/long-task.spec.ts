import { generateLargeCorpus } from '@mcs/test-fixtures';
import { expect, test, type Page } from '@playwright/test';

import { createProject } from './fixtures.js';

/**
 * `Locator.fill()` (what `fixtures.ts`'s `importYaml` uses for every other
 * spec) was measured taking well over 90 real seconds for this file's 1 MB
 * corpus specifically — confirmed by isolating it from everything else in
 * this test, not assumed. `ImportPanel.tsx`'s `onChange` does nothing but
 * `setPasteText(event.target.value)` (verified in source), so this is not
 * the app doing expensive work per keystroke; it is `fill()`'s own
 * post-fill verification/retry loop not scaling to a value this large.
 * Setting the value through the textarea's native setter and dispatching a
 * real `input` event once is the standard workaround for a React-controlled
 * input at this size, and is what a real "paste" does at the DOM level
 * anyway (one value change, one event) — `fill()`'s extra actionability
 * polling was the only thing this bypasses, not any real browser behavior.
 */
async function pasteLargeYaml(page: Page, yaml: string): Promise<void> {
  await page.locator('#import-paste').evaluate((textarea: HTMLTextAreaElement, value: string) => {
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      'value',
    )!.set!;
    nativeSetter.call(textarea, value);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  }, yaml);
  await page.getByRole('button', { name: '导入' }).click();
  // Real timing (confirmed, not guessed): this exact import was measured
  // completing anywhere from ~40s to ~100s across otherwise-identical runs
  // on this machine (v0.9.0 #11) — including on code with none of this
  // slice's changes, so the variance is environmental, not this test's own
  // regression. 120s stays comfortably above the worst observed case
  // without being unboundedly patient.
  await expect(
    page.getByText('导入成功').or(page.getByText('导入失败：内容包含语法错误')),
  ).toBeVisible({ timeout: 120_000 });
}

/**
 * NFR-PERF-05 / v0.2.0 decision D3: `client.test.ts`'s "main-thread module
 * boundary" already proves *structurally* that the YAML engine and
 * validator only ever run inside the Worker (a static import scan) — this
 * spec is the *timing* half D3 deferred to v0.9.0, using the real Long
 * Tasks API in a real browser. jsdom has neither a main thread to block nor
 * a `PerformanceObserver` implementation for `longtask` entries, so this
 * could not have been a vitest test.
 */
test.beforeEach(async ({ page }) => {
  // Installed via `addInitScript` so it is observing before the page's own
  // first script runs — a long task fired between `page.goto` and a
  // post-navigation `page.evaluate` would otherwise be missed.
  await page.addInitScript(() => {
    (window as unknown as { __longTasks: unknown[] }).__longTasks = [];
    new PerformanceObserver((list) => {
      const target = window as unknown as { __longTasks: unknown[] };
      for (const entry of list.getEntries()) {
        // Copied into a plain object — `PerformanceEntry` itself does not
        // reliably survive Playwright's structured-clone back to Node.
        target.__longTasks.push({
          name: entry.name,
          duration: entry.duration,
          startTime: entry.startTime,
        });
      }
    }).observe({ type: 'longtask', buffered: true });
  });
  await page.goto('/');
});

test('importing, validating, and diffing a real 1 MB config produces zero main-thread long tasks (NFR-PERF-05)', async ({
  page,
}) => {
  // Playwright's 30s default test timeout is too tight for this one — see
  // `pasteLargeYaml`'s own comment for the real, measured range this needs
  // to tolerate.
  test.setTimeout(150_000);

  await createProject(page);

  // Only long tasks from this point on count — the window under test is
  // the three real actions a 1 MB import triggers (parse, the debounced
  // full validation pass, and DiffPanel's re-diff against the import
  // baseline), not app boot or project-list rendering.
  await page.evaluate(() => {
    (window as unknown as { __longTasks: unknown[] }).__longTasks = [];
  });

  const corpus = generateLargeCorpus();
  await pasteLargeYaml(page, corpus);

  // `DiffPanel` (`apps/web/src/diff/DiffPanel.tsx`) recomputes on every
  // fresh `issues` array, which only lands once the debounced full-
  // validation pass over the whole 1 MB document actually completes — its
  // own "no changes yet" state rendering is therefore proof that parse,
  // validate, *and* diff have all finished, not just that the paste+click
  // happened. The bench data this test is meant to catch a browser-side
  // echo of (`import.bench.ts`) puts the validation pass alone at several
  // seconds, hence the generous timeout.
  await expect(page.locator('.diff-panel__empty')).toBeVisible({ timeout: 30_000 });

  const longTasks = await page.evaluate(
    () => (window as unknown as { __longTasks: unknown[] }).__longTasks,
  );

  // A non-empty array here is a real finding, not a test bug (v0.9.0 #11).
  // First discovery: `SchemaArrayForm` rendered every array-module entry
  // with a plain `.map()` — no virtualization — so this corpus's 3,182
  // proxies (the form view is the default tab after import) rendered as
  // 3,182 real DOM nodes in one synchronous pass, confirmed the direct
  // cause of an earlier-measured 1.5s long task. Fixed: `SchemaArrayForm`
  // now virtualizes the same way `RuleListPage` does (`packages/ui`'s
  // `computeVariableVirtualWindow`), confirmed at this exact 3,182-entry
  // scale to render under 100 DOM nodes
  // (`proxies-array-form-scale.perf.test.tsx`). NFR-PERF-04 ("长列表必须
  // 虚拟化") had previously only been verified for the *rules* list
  // (v0.4.0 #7/#14/#15); this was the first time the proxies form section
  // was measured at this scale, and the gap was real.
  //
  // That fix alone did not make this assertion pass, though: a long task
  // (~1.5-2s) still appears here even with virtualized rendering. Prime
  // suspect, not yet fixed: `buildArrayFormPlan(module, value, ...)` still
  // plans *every* entry (all 3,182) on every render — this slice only
  // virtualized which planned entries get a DOM node, not the planning
  // pass itself, which measured ~130-140ms per call in isolation and reruns
  // on each of this component's several correction re-renders. Recorded
  // honestly as a known, unresolved gap (not silently downgraded) — see
  // docs/releases/plans/v0.9.0.md #11 and
  // docs/releases/plans/v0.9.0-perf-baseline.md for the full writeup.
  expect(longTasks).toEqual([]);
});
