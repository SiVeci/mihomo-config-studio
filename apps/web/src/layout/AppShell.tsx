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
 */
const RESPONSIVE_STYLE = `
@media (max-width: ${BREAKPOINTS.tablet.value}) {
  .app-shell {
    grid-template-columns: 200px minmax(0, 1fr);
    grid-template-areas: "sidebar main";
  }
  .app-shell__aside {
    display: none;
  }
}
`;

export interface AppShellProps {
  readonly sidebar: ReactNode;
  readonly children: ReactNode;
  readonly aside?: ReactNode;
}

/**
 * Three-column layout shell: project/entity navigation, main content, and a
 * reserved panel for the issue/diff surfaces #14 and #15 add later. Purely
 * structural — no autosave or history wiring lives here, since both are
 * scoped to whatever the main column's content actually is (see
 * `ProjectPage`), not to the shell itself.
 */
export function AppShell({ sidebar, children, aside }: AppShellProps): ReactNode {
  return (
    <div className="app-shell">
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
