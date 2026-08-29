import type { ReactNode } from 'react';

import { t } from '../i18n/index.js';
import './AppShell.css';
import './AppShell.responsive.css';

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
