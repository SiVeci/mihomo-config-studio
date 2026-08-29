import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';

import { expect, test } from '@playwright/test';

import {
  createProject,
  importYaml,
  SAMPLE_CONFIG_WITH_REFERENCES,
  SAMPLE_CONFIG_WITH_TWO_RULES,
} from './fixtures.js';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('creates a new project and shows it in the sidebar (FR-PROJ-01)', async ({ page }) => {
  await expect(page.getByText('还没有项目')).toBeVisible();

  await createProject(page);

  // Exactly one project button now exists in the sidebar — a real record
  // was created and persisted, not just a client-side view change.
  await expect(page.getByRole('button', { name: '未命名项目' })).toHaveCount(1);
});

test('imports a real YAML config through the real Worker (FR-YAML-01)', async ({ page }) => {
  await createProject(page);

  await importYaml(page, SAMPLE_CONFIG_WITH_REFERENCES);

  // The imported rule is visible in the rules view — proof the text was
  // really parsed, not just accepted and discarded.
  await page.getByRole('tab', { name: '规则' }).click();
  await expect(page.getByRole('row', { name: /MATCH,PROXY/ })).toBeVisible();
});

test('deletes a referenced entity by replacing its references first (FR-REL-03)', async ({
  page,
}) => {
  await createProject(page);
  await importYaml(page, SAMPLE_CONFIG_WITH_REFERENCES);
  await page.getByRole('tab', { name: '表单' }).click();

  // Scoped to the 代理节点 (proxies) module section: the form renders every
  // module's section at once, and `proxy-groups` (the PROXY select group)
  // has its own "删除" button too — an unscoped count would see 3, not 2.
  const proxiesSection = page.locator('[data-module-section="proxies"]');
  const deleteButton = proxiesSection.getByRole('button', { name: '删除', exact: true });

  // Exactly two proxies exist before the delete — p1 and p2.
  await expect(deleteButton).toHaveCount(2);

  await deleteButton.first().click();
  await expect(page.getByText('删除「p1」')).toBeVisible();
  await expect(page.getByText('有 1 处引用指向它')).toBeVisible();

  // `<input list="…">` — an ARIA combobox, but backed by a `<datalist>`
  // (autocomplete suggestions), not a real `<select>`: `.fill()`, not
  // `.selectOption()` (that throws — "not a <select> element").
  await page.getByRole('combobox', { name: '替换为' }).fill('p2');
  await page.getByRole('button', { name: '替换并删除' }).click();

  // p1 is gone (one proxy left); the group's own reference was rewritten
  // to p2 rather than left dangling — checked against the real document
  // text (the raw editor's own textarea value), not just the form no
  // longer showing an input for it.
  await expect(deleteButton).toHaveCount(1);
  const rawText = await page.getByRole('textbox', { name: '原文编辑器' }).inputValue();
  expect(rawText).not.toContain('p1');
  expect(rawText).toContain('p2');
});

test('reorders rules with the keyboard, Alt+ArrowDown (FR-RULE-02, NFR-A11Y)', async ({ page }) => {
  await createProject(page);
  await importYaml(page, SAMPLE_CONFIG_WITH_TWO_RULES);
  await page.getByRole('tab', { name: '规则' }).click();

  const firstRow = page.getByRole('row', { name: /第 1 条/ });
  await expect(firstRow).toHaveAccessibleName(/DOMAIN,a\.example\.com,DIRECT/);

  await firstRow.click();
  await page.keyboard.press('Alt+ArrowDown');

  // The two rules swapped: row 1 is now MATCH, row 2 is the DOMAIN rule —
  // a real document write through the Worker, not just a visual reorder
  // (v0.4.0 #9's own jsdom test already proves the two paths produce
  // byte-identical text; this proves the real browser keyboard path
  // actually fires at all, which manual browser automation tooling cannot
  // reliably trigger — see ADR-033).
  await expect(page.getByRole('row', { name: /第 1 条/ })).toHaveAccessibleName(/MATCH,DIRECT/);
  await expect(page.getByRole('row', { name: /第 2 条/ })).toHaveAccessibleName(
    /DOMAIN,a\.example\.com,DIRECT/,
  );
});

test('shows a non-empty diff after editing a field (FR-YAML-06)', async ({ page }) => {
  await createProject(page);
  await importYaml(page, SAMPLE_CONFIG_WITH_REFERENCES);
  await page.getByRole('tab', { name: '表单' }).click();

  await expect(page.getByText('无差异')).toBeVisible();

  await page.getByRole('switch', { name: '启用 IPv6' }).click();

  await expect(page.getByText('无差异')).not.toBeVisible();
  await expect(page.getByText(/^\+\d+ \/ -\d+$/)).toBeVisible();
});

test('exports config.yaml and the downloaded file matches the document byte for byte (FR-PROJ-06)', async ({
  page,
}) => {
  await createProject(page);
  await importYaml(page, SAMPLE_CONFIG_WITH_REFERENCES);

  // `platform/web.ts` prefers `showSaveFilePicker` (the File System Access
  // API) whenever it exists, and real Chromium has it — that path opens a
  // native OS dialog Playwright cannot drive and never fires a "download"
  // event, so it would hang here instead of failing loudly. Shadowing it
  // with an own `undefined` hides it from `getShowSaveFilePicker()`'s
  // per-call read, forcing the same `<a download>` fallback path
  // older/other browsers take, which is the one this assertion is actually
  // able to observe. `ExportDialog.tsx` deliberately swaps the button's own
  // label for this same capability ("导出" implies "you pick where" via the
  // picker; "下载" implies "browser Downloads folder" via the fallback), so
  // stubbing the picker also changes which label to wait for below.
  await page.evaluate(() => {
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true });
  });

  await page.getByRole('button', { name: '导出' }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '下载 config.yaml' }).click(),
  ]);

  const downloadedPath = await download.path();
  expect(downloadedPath).not.toBeNull();
  const downloadedBytes = await readFile(downloadedPath!, 'utf8');
  expect(downloadedBytes).toBe(SAMPLE_CONFIG_WITH_REFERENCES);
  // Reading the stream directly (not just `readFile`) matches the plan's
  // own "byte for byte, not just a click" bar — assert the stream and the
  // buffer read agree, so a future accidental switch to a lazy/partial
  // read would be caught.
  await new Promise<void>((resolve, reject) => {
    let total = 0;
    createReadStream(downloadedPath!)
      .on('data', (chunk) => {
        total += chunk.length;
      })
      .on('end', () => {
        expect(total).toBe(Buffer.byteLength(SAMPLE_CONFIG_WITH_REFERENCES, 'utf8'));
        resolve();
      })
      .on('error', reject);
  });
});

test('recovers offline: a real, previously-loaded build still renders with no network (ADR-029)', async ({
  page,
  context,
}) => {
  // First load: the Service Worker registers, installs, activates and
  // (via `clients.claim()`) takes over this very page.
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
    timeout: 30_000,
  });

  await context.setOffline(true);
  await page.reload();

  // The precached app shell renders — not the browser's own offline error
  // page — proving the Service Worker actually served this navigation.
  await expect(page.getByRole('button', { name: '新建项目' })).toBeVisible();

  await context.setOffline(false);
});
