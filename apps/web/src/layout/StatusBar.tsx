import type { ReactNode } from 'react';

import { t } from '../i18n/index.js';
import './StatusBar.css';

export interface StatusBarProps {
  readonly projectName: string;
  readonly compatibilityProfile: string;
  /**
   * `'pending'` shortly after an edit, `'saved'` once the autosave window
   * (`DEFAULT_AUTOSAVE_INTERVAL_MS`, `@mcs/storage`) has had time to flush —
   * a display-only mirror of that timing, not a second source of truth for
   * when data actually reaches storage (`ProjectPage`'s own `AutoSaver`
   * wiring, unchanged by this component, still owns that).
   */
  readonly saveStatus: 'saved' | 'pending';
  /**
   * Clears the selection so `AppShell`'s `narrowFocus` swaps back to the
   * project list. On narrow screens the sidebar is fully hidden while a
   * project is open (see `AppShell.tsx`), so without this a phone user could
   * open a project and then have no way back to pick a different one.
   */
  readonly onBack: () => void;
}

/**
 * PRD §7.3: narrow-screen top bar showing project name, compatibility
 * profile, and save status — the three pieces of context a user loses when
 * the three-column desktop shell collapses to one column on Android
 * (`AppShell.css`'s existing breakpoint hides the sidebar's project list
 * and the aside; this replaces the context that would otherwise vanish
 * with it). Visible only under `AppShell`'s narrow-screen media query — see
 * `AppShell.css` — so it renders unconditionally here and CSS decides when
 * it is shown, the same pattern `BottomNav` uses.
 */
export function StatusBar({
  projectName,
  compatibilityProfile,
  saveStatus,
  onBack,
}: StatusBarProps): ReactNode {
  return (
    <div className="status-bar" role="group" aria-label={t('statusBar.label')}>
      <button type="button" className="status-bar__back" onClick={onBack}>
        {t('statusBar.backButton')}
      </button>
      <span className="status-bar__project-name">{projectName}</span>
      <span className="status-bar__profile">{compatibilityProfile}</span>
      <span className="status-bar__save-status">
        {saveStatus === 'saved' ? t('statusBar.saved') : t('statusBar.pending')}
      </span>
    </div>
  );
}
