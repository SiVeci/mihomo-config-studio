import { BREAKPOINTS } from '@mcs/ui';
import type { ReactNode } from 'react';

import { t } from '../i18n/index.js';
import './AppShell.css';

/**
 * The `@media` breakpoint below is generated from `@mcs/ui`'s token value
 * rather than a hand-copied number, so it cannot drift from the source of
 * truth `packages/ui` owns — CSS custom properties cannot be read inside a
 * media-query condition, so a plain `.css` file has no way to reference the
 * token directly; interpolating it into a `<style>` tag is the workaround.
 *
 * The same breakpoint also drives PRD §7.3's narrow-screen layout
 * (`StatusBar`/`BottomNav`/the `.project-mobile-page` content paging,
 * `ProjectPage.tsx`, v0.6.0 #6): those components render unconditionally in
 * the DOM and stay `display: none` by default (their own `.css` files) —
 * this is the one place, alongside the aside/sidebar rules it already owned,
 * that turns them on. Keeping every breakpoint-gated rule in this single
 * interpolated block means there is exactly one number to keep in sync with
 * the token, regardless of which component's class it styles.
 */
const RESPONSIVE_STYLE = `
@media (max-width: ${BREAKPOINTS.tablet.value}) {
  .app-shell {
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas: "main";
  }
  .app-shell__sidebar {
    display: none;
  }
  .app-shell__aside {
    display: none;
  }
  .app-shell--narrow-sidebar {
    grid-template-areas: "sidebar";
  }
  .app-shell--narrow-sidebar .app-shell__sidebar {
    display: block;
  }
  .app-shell--narrow-sidebar .app-shell__main {
    display: none;
  }
  .status-bar {
    display: flex;
  }
  .bottom-nav {
    display: flex;
  }
  .app-shell__main {
    padding-bottom: calc(var(--mcs-spacing-lg) + 56px);
  }
  .project-mobile-page {
    display: none;
  }
  .project-mobile-page--active {
    display: block;
  }
}
`;

export interface AppShellProps {
  readonly sidebar: ReactNode;
  readonly children: ReactNode;
  readonly aside?: ReactNode;
  /**
   * PRD §7.3: on a narrow screen only one of the sidebar (project switcher)
   * or the main column can be full-width at a time — a 200px sidebar next
   * to a ~175px main column (the first cut of this layout, caught by
   * actually loading a real build at a 375px viewport rather than trusting
   * jsdom, which never applies `@media` at all) is too cramped to hold any
   * of the four `BottomNav` pages. `'sidebar'` is for when there is nothing
   * selected yet (the project list doubles as the mobile "home" screen);
   * `'main'` (the default) is for once a project is open. Ignored above the
   * breakpoint, where both columns already render side by side.
   */
  readonly narrowFocus?: 'sidebar' | 'main';
}

/**
 * Three-column layout shell: project/entity navigation, main content, and a
 * reserved panel for the issue/diff surfaces #14 and #15 add later. Purely
 * structural — no autosave or history wiring lives here, since both are
 * scoped to whatever the main column's content actually is (see
 * `ProjectPage`), not to the shell itself.
 */
export function AppShell({
  sidebar,
  children,
  aside,
  narrowFocus = 'main',
}: AppShellProps): ReactNode {
  const className = narrowFocus === 'sidebar' ? 'app-shell app-shell--narrow-sidebar' : 'app-shell';
  return (
    <div className={className}>
      <style>{RESPONSIVE_STYLE}</style>
      <nav className="app-shell__sidebar" aria-label={t('appShell.sidebarLabel')}>
        {sidebar}
      </nav>
      <main className="app-shell__main">{children}</main>
      <aside className="app-shell__aside" aria-label={t('appShell.asideLabel')}>
        {aside ?? <p className="app-shell__aside-placeholder">{t('appShell.asidePlaceholder')}</p>}
      </aside>
    </div>
  );
}
