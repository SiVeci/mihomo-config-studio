import { useState, type ReactNode } from 'react';

import { t } from '../i18n/index.js';
import type { Entity, Reference } from '../worker/protocol.js';
import './DeleteImpactDialog.css';

export interface DeleteImpactDialogProps {
  /** Shown in the title/prompts (NFR-SEC-03 allows this: an entity name the user themselves named, not a system-derived finding). */
  readonly entityName: string;
  readonly replaceable: readonly Reference[];
  readonly cascading: readonly Entity[];
  /** Autocomplete only — free text is always still accepted. Empty is fine (no suggestions, not an error). */
  readonly targetOptions: readonly string[];
  readonly onReplace: (newTarget: string) => void;
  readonly onCascadeDelete: () => void;
  readonly onCancel: () => void;
}

/**
 * The two exits `analyzeImpact` leaves open when an entity has references
 * (v0.4.0 #11, FR-REL-03 UI) — never both at once, never a third option.
 * Which one this renders is decided by whether `cascading` is empty, not by
 * the caller: replacing a reference can never leave an owner empty (the new
 * name takes the old one's place), so once `cascading` is non-empty a
 * chosen replacement cannot resolve it — only removing the would-be-empty
 * owners can (see `impact-patches.ts`'s own doc comments for exactly what
 * each exit does to `replaceable`/`cascading`).
 *
 * The caller (`ProjectPage`) never renders this at all when both lists are
 * empty — an unreferenced entity deletes directly, no dialog (retro-fitting
 * confirmation friction onto a delete nothing else points at is exactly
 * what exit condition 5 says not to do).
 */
export function DeleteImpactDialog({
  entityName,
  replaceable,
  cascading,
  targetOptions,
  onReplace,
  onCascadeDelete,
  onCancel,
}: DeleteImpactDialogProps): ReactNode {
  const [newTarget, setNewTarget] = useState('');
  const hasCascading = cascading.length > 0;
  const title = t('deleteImpact.title', { name: entityName });

  return (
    <section className="delete-impact-dialog" role="dialog" aria-modal="true" aria-label={title}>
      <h2 className="delete-impact-dialog__title">{title}</h2>

      {hasCascading ? (
        <>
          <p>{t('deleteImpact.cascadeIntro', { count: cascading.length })}</p>
          <ul className="delete-impact-dialog__cascade-list">
            {cascading.map((entity) => (
              <li key={entity.id}>{entity.serializedName}</li>
            ))}
          </ul>
          <div className="delete-impact-dialog__actions">
            <button type="button" onClick={onCascadeDelete}>
              {t('deleteImpact.confirmCascadeButton')}
            </button>
            <button type="button" onClick={onCancel}>
              {t('deleteImpact.cancelButton')}
            </button>
          </div>
        </>
      ) : (
        <>
          <p>{t('deleteImpact.replaceIntro', { count: replaceable.length })}</p>
          <label htmlFor="delete-impact-target">{t('deleteImpact.targetLabel')}</label>
          <input
            id="delete-impact-target"
            type="text"
            list="delete-impact-target-options"
            value={newTarget}
            onChange={(event) => setNewTarget(event.target.value)}
          />
          <datalist id="delete-impact-target-options">
            {targetOptions.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
          <div className="delete-impact-dialog__actions">
            <button
              type="button"
              disabled={newTarget.trim() === ''}
              onClick={() => onReplace(newTarget.trim())}
            >
              {t('deleteImpact.confirmReplaceButton')}
            </button>
            <button type="button" onClick={onCancel}>
              {t('deleteImpact.cancelButton')}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
