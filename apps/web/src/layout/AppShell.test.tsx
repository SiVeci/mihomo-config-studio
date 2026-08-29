// @vitest-environment jsdom
import { BREAKPOINTS } from '@mcs/ui';
import { cleanup, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import { AppShell } from './AppShell.js';

const RESPONSIVE_CSS_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  'AppShell.responsive.css',
);
function readResponsiveCss(): string {
  return readFileSync(RESPONSIVE_CSS_PATH, 'utf8');
}

afterEach(() => {
  cleanup();
});

describe('AppShell', () => {
  it('renders sidebar and main content in their own landmark regions', () => {
    render(
      <AppShell sidebar={<p>sidebar content</p>}>
        <p>main content</p>
      </AppShell>,
    );

    const nav = screen.getByRole('navigation');
    expect(nav.textContent).toContain('sidebar content');

    const main = screen.getByRole('main');
    expect(main.textContent).toContain('main content');
  });

  it('renders a default placeholder in the aside region when none is given', () => {
    render(<AppShell sidebar={<p>sidebar</p>}>main</AppShell>);

    const aside = screen.getByRole('complementary');
    expect(aside.textContent).not.toBe('');
  });

  it('renders custom aside content when given, instead of the placeholder', () => {
    render(
      <AppShell sidebar={<p>sidebar</p>} aside={<p>custom aside</p>}>
        main
      </AppShell>,
    );

    const aside = screen.getByRole('complementary');
    expect(aside.textContent).toContain('custom aside');
  });

  it('ADR-032: no longer renders an inline <style> element (style-src-elem drops unsafe-inline) — the responsive rules moved to a real, imported .css file', () => {
    const { container } = render(<AppShell sidebar={<p>sidebar</p>}>main</AppShell>);

    expect(container.querySelector('style')).toBeNull();
  });

  it("AppShell.responsive.css's literal breakpoint stays equal to @mcs/ui's token — a real .css file cannot read a CSS custom property inside an @media condition, so this literal is checked directly rather than derived at run time", () => {
    expect(readResponsiveCss()).toContain(`max-width: ${BREAKPOINTS.tablet.value}`);
  });

  it('AppShell.responsive.css still carries the narrow-screen rules for StatusBar/BottomNav/mobile paging (PRD §7.3, v0.6.0 #6) — unchanged content, only moved out of the interpolated <style> tag', () => {
    const css = readResponsiveCss();
    expect(css).toContain('.status-bar');
    expect(css).toContain('.bottom-nav');
    expect(css).toContain('.project-mobile-page--active');
  });

  it('defaults to the main column on a narrow screen, not a squeezed sidebar+main split — caught by loading a real build at a 375px viewport, since jsdom never applies @media at all', () => {
    const { container } = render(<AppShell sidebar={<p>sidebar</p>}>main</AppShell>);

    expect(container.querySelector('.app-shell')?.className).toBe('app-shell');
    expect(container.querySelector('.app-shell--narrow-sidebar')).toBeNull();
  });

  it('narrowFocus="sidebar" adds the modifier class that swaps the narrow screen over to the project list (used while nothing is selected yet)', () => {
    const { container } = render(
      <AppShell sidebar={<p>sidebar</p>} narrowFocus="sidebar">
        main
      </AppShell>,
    );

    expect(container.querySelector('.app-shell--narrow-sidebar')).not.toBeNull();
  });
});
