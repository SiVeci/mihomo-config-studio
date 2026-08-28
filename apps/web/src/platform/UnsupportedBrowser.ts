import type { CapabilityName } from './capabilities.js';

/**
 * Deliberately NOT a `.tsx` file, and deliberately not using `i18n` (ADR-027):
 * this renders exactly when one or more of `capabilities.ts`'s checks fail,
 * so it must not itself depend on React, `i18n` (which calls
 * `String.prototype.replaceAll`), or any other module reachable only
 * through a modern runtime API. Only `document.createElement`,
 * `.textContent`, `.appendChild`, and template literals (syntax, not a
 * runtime method) are used below. Bilingual copy is inlined rather than
 * routed through `i18n` keys — the one intentional exception to this
 * repo's i18n convention, for the same reason.
 *
 * No "continue anyway" escape hatch: a missing `indexedDB` or `Worker`
 * would only surface as a *less* diagnosable crash one interaction later.
 */
export function renderUnsupportedBrowser(
  container: HTMLElement,
  missing: readonly CapabilityName[],
): void {
  const heading = document.createElement('h1');
  heading.textContent = '浏览器版本过旧 / Browser Version Too Old';

  const bodyZh = document.createElement('p');
  bodyZh.textContent =
    'Mihomo 配置工坊需要较新的浏览器内核才能运行，当前环境缺少以下能力：' +
    missing.join('、') +
    '。';

  const bodyEn = document.createElement('p');
  bodyEn.textContent =
    'Mihomo Config Studio requires a newer browser engine to run. The current environment is missing: ' +
    missing.join(', ') +
    '.';

  const actionZh = document.createElement('p');
  actionZh.textContent =
    '请在系统应用商店中更新「Android System WebView」，或使用最新版本的 Chrome、Firefox 或 Safari 重新打开本页面。';

  const actionEn = document.createElement('p');
  actionEn.textContent =
    'Please update the "Android System WebView" app from your system app store, or reopen this page in a recent version of Chrome, Firefox, or Safari.';

  // `ChildNode.replaceChildren()` itself postdates Chrome 74 (shipped in
  // Chrome 86) — exactly the kind of accidentally-too-new DOM method this
  // whole file exists to avoid. `textContent = ''` + `appendChild` has been
  // supported since long before any WebView version this app could ever
  // encounter.
  container.textContent = '';
  container.appendChild(heading);
  container.appendChild(bodyZh);
  container.appendChild(bodyEn);
  container.appendChild(actionZh);
  container.appendChild(actionEn);
}
