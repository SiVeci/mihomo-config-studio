// @vitest-environment jsdom
import { BREAKPOINTS } from '@mcs/ui';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { AppShell } from './AppShell.js';

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

  it('derives the responsive breakpoint from @mcs/ui rather than a hand-copied number', () => {
    const { container } = render(<AppShell sidebar={<p>sidebar</p>}>main</AppShell>);

    const style = container.querySelector('style');
    expect(style?.textContent).toContain(BREAKPOINTS.tablet.value);
  });
});
