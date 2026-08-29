import { expect, type Page } from '@playwright/test';

/**
 * Clicks "新建项目" and waits for the new project's editor to actually mount
 * — the import panel is always present at the top of a project's editor
 * (`ImportPanel.tsx`), so its "导入" button appearing is the most stable
 * signal that we are inside a real project now, not still looking at the
 * empty-state sidebar.
 */
export async function createProject(page: Page): Promise<void> {
  await expect(page.getByText('还没有项目')).toBeVisible();
  await page.getByRole('button', { name: '新建项目' }).click();
  await expect(page.getByRole('button', { name: '导入' })).toBeVisible();
}

/** Pastes `yaml` into the import textarea and waits for the real Worker round-trip to report success (FR-YAML-01). */
export async function importYaml(page: Page, yaml: string): Promise<void> {
  await page.getByRole('textbox', { name: '粘贴 YAML 文本' }).fill(yaml);
  await page.getByRole('button', { name: '导入' }).click();
  await expect(page.getByText('导入成功')).toBeVisible();
}

/**
 * `p1`/`p2` are both real `ss` proxies; `PROXY` is a `select` group whose
 * only members are `p1`/`p2`, and the lone rule routes everything through
 * it — every reference in this fixture resolves to something else in the
 * same document, matching how `tools/core-test-runner`'s own corpus
 * (v0.9.0 #2) treats cross-references, so a delete-impact-analysis test
 * against `p1` has a real, non-trivial "who references this" answer.
 */
export const SAMPLE_CONFIG_WITH_REFERENCES = `mode: rule
proxies:
  - name: p1
    type: ss
    server: a.example.com
    port: 443
    cipher: aes-128-gcm
    password: "x"
  - name: p2
    type: ss
    server: b.example.com
    port: 443
    cipher: aes-128-gcm
    password: "y"
proxy-groups:
  - name: PROXY
    type: select
    proxies: [p1, p2]
rules:
  - MATCH,PROXY
`;

/** Two rules, both using the built-in `DIRECT` target — no proxy/group needed, since this fixture is only ever used to test reordering mechanics, not routing semantics. */
export const SAMPLE_CONFIG_WITH_TWO_RULES = `mode: rule
rules:
  - DOMAIN,a.example.com,DIRECT
  - MATCH,DIRECT
`;
