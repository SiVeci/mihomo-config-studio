import type { ReactNode } from 'react';

import { t } from '../i18n/index.js';
import './ReadOnlyGuard.css';

export interface ReadOnlyGuardProps {
  /** The project's own locked Bundle version — not locally available, which is why this is showing at all (ADR-004 point 6). */
  readonly lockedVersion: string;
  readonly onUpgradeClick: () => void;
  /** The read-only content this wraps (raw text view) — export stays reachable inside it; the mutable editing surface (form/rules/graph/undo/redo) is simply never mounted while this is showing (v0.5.0 #12). */
  readonly children: ReactNode;
}

/**
 * PRD §9.5 point 3 / ADR-004 point 6: shown when a project's locked Bundle
 * version cannot be found locally but something else is installed —
 * guides the user toward the Bundle page (to try restoring that version) or
 * an explicit upgrade to whatever is currently active, rather than silently
 * opening the project against the wrong Schema.
 */
export function ReadOnlyGuard({
  lockedVersion,
  onUpgradeClick,
  children,
}: ReadOnlyGuardProps): ReactNode {
  return (
    <div className="read-only-guard">
      <div className="read-only-guard__banner" role="status">
        <p className="read-only-guard__message">
          {t('readonly.banner', { version: lockedVersion })}
        </p>
        <div className="read-only-guard__actions">
          <a className="read-only-guard__bundle-link" href="#/bundle">
            {t('readonly.goToBundlePage')}
          </a>
          <button type="button" onClick={onUpgradeClick}>
            {t('readonly.upgradeButton')}
          </button>
        </div>
      </div>
      {children}
    </div>
  );
}
