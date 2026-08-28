import type { SnapshotDegradationSignal } from '@mcs/storage';
import type { ReactNode } from 'react';

import { t } from '../i18n/index.js';
import type { TranslationKey } from '../i18n/index.js';
import './StoragePressureNotice.css';

export interface StoragePressureNoticeProps {
  readonly signal: SnapshotDegradationSignal | null;
  readonly onExportClick: () => void;
}

/**
 * NFR-REL-05 (v0.6.0 #9): the two degraded levels read very differently on
 * purpose — `reduced` is low-key (space is tight but nothing the user is
 * doing right now is at risk) while `stopped` is the one that actually
 * needs the user to act (`AutoSaver`'s own single-key write, unaffected by
 * this, is not itself in danger — but the *snapshot history* this project
 * relies on for recovery has genuinely stopped growing). Collapsing both
 * into one notice would either alarm the user during `reduced` or bury the
 * `stopped` warning under a level that already fired earlier and stopped
 * feeling urgent.
 *
 * `signal.messageKey` (from `SnapshotManager.record()`, `@mcs/storage`)
 * carries no config content or value (NFR-SEC-03) — only the degradation
 * level and a retained count, so this component has nothing sensitive to
 * leak even indirectly.
 */
export function StoragePressureNotice({
  signal,
  onExportClick,
}: StoragePressureNoticeProps): ReactNode {
  if (!signal || signal.level === 'normal') {
    return null;
  }
  return (
    <div
      className={`storage-pressure-notice storage-pressure-notice--${signal.level}`}
      role="status"
    >
      <span>{t(signal.messageKey as TranslationKey)}</span>
      {signal.level === 'stopped' && (
        <button type="button" onClick={onExportClick}>
          {t('storage.snapshot.exportNowButton')}
        </button>
      )}
    </div>
  );
}
