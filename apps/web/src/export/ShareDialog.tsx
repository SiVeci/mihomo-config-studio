import { writeMcsproj } from '@mcs/project-format';
import type {
  McsProjDisabledRules,
  McsProjQuarantine,
  McsProjSchemaLock,
} from '@mcs/project-format';
import { useMemo, useState, type ReactNode } from 'react';

import { t } from '../i18n/index.js';
import { resolvePlatformFileService } from '../platform/index.js';
import type {
  SaveDocumentOptions,
  SaveDocumentOutcome,
  ShareDocumentOptions,
  ShareDocumentOutcome,
} from '../platform/index.js';
import type { ProjectRecord } from '../project/model.js';
import {
  buildMcsProject,
  dedupeSensitivityKinds,
  findSensitivity,
  SENSITIVITY_LABEL_KEY,
} from './sensitivity.js';
import './ShareDialog.css';

export type SaveDocument = (options: SaveDocumentOptions) => Promise<SaveDocumentOutcome>;
export type ShareDocument = (options: ShareDocumentOptions) => Promise<ShareDocumentOutcome>;

async function defaultSaveDocument(options: SaveDocumentOptions): Promise<SaveDocumentOutcome> {
  return resolvePlatformFileService().saveDocument(options);
}

async function defaultShareDocument(options: ShareDocumentOptions): Promise<ShareDocumentOutcome> {
  return resolvePlatformFileService().shareDocument(options);
}

export interface ShareDialogProps {
  readonly project: ProjectRecord;
  readonly configText: string;
  readonly schemaLock: McsProjSchemaLock;
  readonly quarantine: McsProjQuarantine;
  readonly disabledRules: McsProjDisabledRules;
  readonly onClose: () => void;
  /** Test-only override; production code leaves this unset so sharing goes through the real platform port. */
  readonly shareDocument?: ShareDocument;
  /** Test-only override for the "另存为" fallback; production code leaves this unset. */
  readonly saveDocument?: SaveDocument;
}

type Phase =
  | { readonly kind: 'idle' }
  | { readonly kind: 'sharing' }
  | { readonly kind: 'shared' }
  | { readonly kind: 'failed'; readonly pending: ShareDocumentOptions }
  | { readonly kind: 'saved-instead'; readonly name: string };

/**
 * PRD §12's failure handling for the Android share exit (FR-AND-03): a
 * failed share never loses the project (it already lives in IndexedDB —
 * `saveDocument`, ADR-026 — untouched by this dialog either way) and always
 * offers both "save instead" and "retry" against the exact same pending
 * share, not a generic "try again" that has forgotten what was being shared.
 *
 * Cancelling the system share sheet is not a failure (PRD §12):
 * `shareDocument` only ever resolves `failed` for a genuine native error
 * (`capacitor.ts`'s own doc comment explains why `ACTION_SEND` cannot
 * reliably distinguish "user picked a target" from "user backed out" —
 * both currently resolve `shared`, since launching the chooser is the only
 * thing the calling app can verify). Both `cancelled` and `shared` land here
 * as "not an error", never the failure banner.
 *
 * Sensitivity findings reuse the exact same judgement `ExportDialog` renders
 * (`sensitivity.ts`, NFR-SEC-08) — never re-derived, and this dialog never
 * renders the matched text itself, only the category label (NFR-SEC-03),
 * same as `ExportDialog.test.tsx`'s existing assertion for that guarantee.
 */
export function ShareDialog({
  project,
  configText,
  schemaLock,
  quarantine,
  disabledRules,
  onClose,
  shareDocument = defaultShareDocument,
  saveDocument = defaultSaveDocument,
}: ShareDialogProps): ReactNode {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const findings = useMemo(
    () => findSensitivity(project, configText, schemaLock, quarantine, disabledRules),
    [project, configText, schemaLock, quarantine, disabledRules],
  );
  const busy = phase.kind === 'sharing';

  async function share(options: ShareDocumentOptions): Promise<void> {
    setPhase({ kind: 'sharing' });
    const outcome = await shareDocument(options);
    switch (outcome.kind) {
      case 'shared':
        setPhase({ kind: 'shared' });
        break;
      case 'cancelled':
        setPhase({ kind: 'idle' });
        break;
      case 'failed':
        setPhase({ kind: 'failed', pending: options });
        break;
    }
  }

  async function handleShareYaml(): Promise<void> {
    await share({
      suggestedName: `${project.name}.yaml`,
      content: configText,
      mimeType: 'text/yaml',
    });
  }

  async function handleShareMcsproj(): Promise<void> {
    const bytes = await writeMcsproj(
      buildMcsProject(project, configText, schemaLock, quarantine, disabledRules),
    );
    await share({
      suggestedName: `${project.name}.mcsproj`,
      content: bytes,
      mimeType: 'application/zip',
    });
  }

  async function handleRetry(pending: ShareDocumentOptions): Promise<void> {
    await share(pending);
  }

  async function handleSaveInstead(pending: ShareDocumentOptions): Promise<void> {
    const outcome = await saveDocument(pending);
    if (outcome.kind !== 'cancelled') {
      setPhase({ kind: 'saved-instead', name: outcome.name });
    }
  }

  return (
    <section className="share-dialog" role="dialog" aria-label={t('share.title')}>
      <h2 className="share-dialog__title">{t('share.title')}</h2>

      {findings.length > 0 && (
        <div className="share-dialog__sensitivity">
          <p className="share-dialog__sensitivity-title">{t('export.sensitivityTitle')}</p>
          <ul className="share-dialog__sensitivity-list">
            {dedupeSensitivityKinds(findings).map((kind) => (
              <li key={kind}>{t(SENSITIVITY_LABEL_KEY[kind])}</li>
            ))}
          </ul>
        </div>
      )}

      {phase.kind === 'shared' && (
        <p role="status" className="share-dialog__status">
          {t('share.sharedNotice')}
        </p>
      )}

      {phase.kind === 'failed' && (
        <div className="share-dialog__failure" role="alert">
          <p className="share-dialog__failure-notice">{t('share.failedNotice')}</p>
          <div className="share-dialog__failure-actions">
            <button type="button" onClick={() => void handleSaveInstead(phase.pending)}>
              {t('share.saveInsteadButton')}
            </button>
            <button type="button" onClick={() => void handleRetry(phase.pending)}>
              {t('share.retryButton')}
            </button>
          </div>
        </div>
      )}

      {phase.kind === 'saved-instead' && (
        <p role="status" className="share-dialog__status">
          {t('share.savedInsteadNotice', { name: phase.name })}
        </p>
      )}

      <div className="share-dialog__actions">
        <button type="button" disabled={busy} onClick={() => void handleShareYaml()}>
          {t('share.yamlButton')}
        </button>
        <button type="button" disabled={busy} onClick={() => void handleShareMcsproj()}>
          {t('share.mcsprojButton')}
        </button>
        <button type="button" onClick={onClose}>
          {t('share.closeButton')}
        </button>
      </div>
    </section>
  );
}
