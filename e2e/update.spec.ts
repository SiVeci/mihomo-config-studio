import { BUILTIN_MANIFEST } from '@mcs/schema-registry';
import { expect, test } from '@playwright/test';

import { loadBundleFixtureSet, serveBundleAt, type BundleFixtureSet } from './bundle-fixtures.js';
import { createProject, importYaml, SAMPLE_CONFIG_WITH_REFERENCES } from './fixtures.js';

/**
 * This test needs the raw text (for the round-trip check below) to also
 * produce exactly one real issue, to prove the issues panel survives the
 * bundle swap unchanged — not just the raw text. `SAMPLE_CONFIG_WITH_REFERENCES`
 * alone resolves cleanly with zero issues (fixed by the v1.0.0 #3
 * `schemaStage` root-scope-array registration fix, which correctly stopped
 * flagging every `rules:` entry as `unknown-field`), so a deliberate unknown
 * top-level field — same `unknown-field-probe` device `protocol.test.ts`
 * uses — is added here to keep a real, non-coincidental "1" for the panel to
 * assert against.
 */
const SAMPLE_CONFIG_WITH_ONE_ISSUE = `${SAMPLE_CONFIG_WITH_REFERENCES}unknown-field-probe: true\n`;

/**
 * `playwright.config.ts`'s top-level await already generated (or reused —
 * see `loadOrGenerateBundleFixtureSet`'s own doc comment) this run's
 * fixture set and baked its trusted public key into
 * `MCS_TRUST_ANCHOR_OVERRIDES_JSON` before `vite build` ran; this file only
 * ever reads the already-written result back.
 */
let fixtures: BundleFixtureSet;
test.beforeAll(() => {
  fixtures = loadBundleFixtureSet();
});

test.beforeEach(async ({ page }) => {
  // Once `sw.ts` (ADR-029) claims the page, it intercepts every `fetch`
  // (`handleStaticAsset`'s catch-all) and re-issues its own from inside the
  // Service Worker's own execution context — invisible to `page.route()`,
  // which only sees requests the page itself makes. A test that installs
  // twice, or installs after enough setup for the SW to activate in the
  // background, would have its second `fetchBundle()` call silently bypass
  // `serveBundleAt`'s interception and hit `vite preview` for real (a
  // genuine 404, surfacing as `UPDATER_FETCH_FAILED`) — this spec is about
  // the update mechanism, not offline/SW behavior (that's `web.spec.ts`'s
  // ADR-029 scenario), so disabling registration here is the right layer
  // for the fix, not a workaround for a product bug.
  await page.addInitScript(() => {
    Object.defineProperty(navigator.serviceWorker, 'register', {
      value: () => Promise.reject(new Error('e2e: Service Worker disabled for update.spec.ts')),
    });
  });
  await page.goto('/#/bundle');
  // `activeBundle` starts `undefined` until the mount effect's
  // `resolveActiveBundle` resolves — the install button stays disabled
  // until then, and every scenario below needs a real baseline to compare
  // against anyway (the built-in Bundle — `BUILTIN_MANIFEST.version`, read
  // live rather than hardcoded, since `builtin.ts` gets re-issued to a new
  // version routinely; a hardcoded literal here silently went stale the
  // moment v0.9.0 #13 bumped it and would have kept "passing" against the
  // wrong assumption if this suite had been run at the time).
  await expect(page.getByText(BUILTIN_MANIFEST.version)).toBeVisible();
});

test('installs a validly-signed newer Bundle (FR-UPD-01/02)', async ({ page }) => {
  await serveBundleAt(page, fixtures.install);

  await page.getByRole('button', { name: '检查并安装' }).click();

  await expect(page.getByText('安装成功，已切换到新版本')).toBeVisible();
  await expect(page.getByText(fixtures.install.manifest.version)).toBeVisible();
});

test('rejects a Bundle signed by an untrusted key (签名失败)', async ({ page }) => {
  await serveBundleAt(page, fixtures.wrongSignature);

  await page.getByRole('button', { name: '检查并安装' }).click();

  await expect(page.getByText('签名校验失败，Bundle 可能不是受信任来源')).toBeVisible();
  // NFR-REL-03: a failed install must never touch the active Bundle.
  await expect(page.getByText(BUILTIN_MANIFEST.version)).toBeVisible();
});

test('rejects a Bundle whose requiresApp exceeds the current app version (应用版本不足)', async ({
  page,
}) => {
  await serveBundleAt(page, fixtures.appTooOld);

  await page.getByRole('button', { name: '检查并安装' }).click();

  await expect(page.getByText('当前应用版本过低，无法安装该 Bundle')).toBeVisible();
  await expect(page.getByText(BUILTIN_MANIFEST.version)).toBeVisible();
});

test('rolls back to the previous version after two installs (回滚)', async ({ page }) => {
  const route = await serveBundleAt(page, fixtures.install);
  await expect(page.getByText('没有可回滚的历史版本')).toBeVisible();

  await page.getByRole('button', { name: '检查并安装' }).click();
  await expect(page.getByText('安装成功，已切换到新版本')).toBeVisible();
  await expect(page.getByText(fixtures.install.manifest.version)).toBeVisible();

  route.setBundle(fixtures.rollbackNext);
  await page.getByRole('button', { name: '检查并安装' }).click();
  await expect(page.getByText(fixtures.rollbackNext.manifest.version)).toBeVisible();

  await page.getByRole('button', { name: '回滚到上一版本' }).click();

  await expect(page.getByText('已回滚到上一版本')).toBeVisible();
  await expect(page.getByText(fixtures.install.manifest.version)).toBeVisible();
});

test('an existing project stays locked to its own Bundle version after a newer one is installed elsewhere (ADR-004, 项目锁定)', async ({
  page,
}) => {
  // The project side of this scenario needs the real project UI, not the
  // Bundle page this file's `beforeEach` starts every other test from.
  await page.goto('/');
  await createProject(page);
  await importYaml(page, SAMPLE_CONFIG_WITH_ONE_ISSUE);

  const rawEditor = page.getByRole('textbox', { name: '原文编辑器' });
  const issuesPanel = page.getByRole('complementary', { name: '辅助面板' });
  const rawTextBefore = await rawEditor.inputValue();
  await expect(page.getByText('提示 (1)')).toBeVisible();
  const issuesTextBefore = await issuesPanel.innerText();

  await page.goto('/#/bundle');
  await expect(page.getByText(BUILTIN_MANIFEST.version)).toBeVisible();
  await serveBundleAt(page, fixtures.install);
  await page.getByRole('button', { name: '检查并安装' }).click();
  await expect(page.getByText('安装成功，已切换到新版本')).toBeVisible();

  // Back to the project: `ProjectPage` unmounts on route change, so
  // `selectedId` is gone — re-selecting from the sidebar is what a real
  // user would do too, not a test-only shortcut.
  await page.goto('/');
  await page.getByRole('button', { name: '未命名项目' }).click();

  await expect(rawEditor).toHaveValue(rawTextBefore);
  await expect(page.getByText('提示 (1)')).toBeVisible();
  expect(await issuesPanel.innerText()).toBe(issuesTextBefore);
});
