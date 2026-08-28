// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { renderUnsupportedBrowser } from './UnsupportedBrowser.js';

describe('renderUnsupportedBrowser (ADR-027)', () => {
  it('renders a bilingual heading and lists every missing capability by name', () => {
    const container = document.createElement('div');
    renderUnsupportedBrowser(container, ['indexedDB', 'Worker']);

    expect(container.textContent).toContain('Browser Version Too Old');
    expect(container.textContent).toContain('浏览器版本过旧');
    expect(container.textContent).toContain('indexedDB');
    expect(container.textContent).toContain('Worker');
  });

  it('gives an actionable next step in both languages, and no "continue anyway" control', () => {
    const container = document.createElement('div');
    renderUnsupportedBrowser(container, ['crypto.subtle']);

    expect(container.textContent).toContain('Android System WebView');
    expect(container.textContent).toContain('更新');
    expect(container.querySelector('button')).toBeNull();
    expect(container.querySelector('a')).toBeNull();
  });

  it('replaces whatever content the container already had, rather than appending to it', () => {
    const container = document.createElement('div');
    const stale = document.createElement('p');
    stale.textContent = 'stale content from a previous render';
    container.appendChild(stale);

    renderUnsupportedBrowser(container, ['Object.hasOwn']);

    expect(container.textContent).not.toContain('stale content');
  });

  it('uses only createElement/textContent/appendChild — no template-literal-only surprises in output', () => {
    const container = document.createElement('div');
    renderUnsupportedBrowser(container, ['Array.prototype.at', 'String.prototype.replaceAll']);

    expect(container.children.length).toBe(5);
    expect(container.textContent).toContain('Array.prototype.at');
    expect(container.textContent).toContain('String.prototype.replaceAll');
  });
});
