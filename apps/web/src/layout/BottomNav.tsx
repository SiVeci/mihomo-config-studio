import type { ReactNode } from 'react';

import { t } from '../i18n/index.js';
import type { TranslationKey } from '../i18n/index.js';
import './BottomNav.css';

/**
 * The four destinations PRD §7.3 names exactly ("配置、关系、YAML、问题").
 * `'config'` covers both the existing form and rules sub-tabs (`ProjectPage`'s
 * `mainView` tablist, v0.4.0 #7) — the version document lists four top-level
 * items, not five, so rules stays reachable *through* 配置 rather than
 * becoming its own bottom-nav destination.
 */
export type BottomNavPage = 'config' | 'graph' | 'yaml' | 'issues';

const NAV_ITEMS: ReadonlyArray<{ readonly id: BottomNavPage; readonly labelKey: TranslationKey }> =
  [
    { id: 'config', labelKey: 'bottomNav.configTab' },
    { id: 'graph', labelKey: 'bottomNav.graphTab' },
    { id: 'yaml', labelKey: 'bottomNav.yamlTab' },
    { id: 'issues', labelKey: 'bottomNav.issuesTab' },
  ];

export interface BottomNavProps {
  readonly active: BottomNavPage;
  readonly onNavigate: (page: BottomNavPage) => void;
}

/**
 * Rendered unconditionally by `ProjectPage`; `AppShell.css`'s narrow-screen
 * media query is what actually shows it — this component has no viewport
 * logic of its own, matching `StatusBar`'s same split (component = content,
 * `AppShell.css` = when).
 */
export function BottomNav({ active, onNavigate }: BottomNavProps): ReactNode {
  return (
    <nav className="bottom-nav" aria-label={t('bottomNav.label')}>
      {NAV_ITEMS.map((item) => (
        <button
          key={item.id}
          type="button"
          className="bottom-nav__item"
          aria-current={active === item.id ? 'page' : undefined}
          onClick={() => onNavigate(item.id)}
        >
          {t(item.labelKey)}
        </button>
      ))}
    </nav>
  );
}
