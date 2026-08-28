import { writeMcsproj } from '@mcs/project-format';
import type { McsProjQuarantine, McsProjSchemaLock } from '@mcs/project-format';
import { useMemo, useState, type ReactNode } from 'react';

import { t } from '../i18n/index.js';
import { resolvePlatformFileService } from '../platform/index.js';
import type {
  PlatformCapabilities,
  SaveDocumentOptions,
  SaveDocumentOutcome,
  ShareDocumentOptions,
  ShareDocumentOutcome,
} from '../platform/index.js';
import type { ProjectRecord } from '../project/model.js';
import { hasBlockingIssues } from '../worker/protocol.js';
import type { ValidationIssue } from '../worker/protocol.js';
import { ShareDialog } from './ShareDialog.js';
import {
  buildMcsProject,
  dedupeSensitivityKinds,
  findSensitivity,
  SENSITIVITY_LABEL_KEY,
} from './sensitivity.js';
import './ExportDialog.css';

export type SaveDocument = (options: SaveDocumentOptions) => Promise<SaveDocumentOutcome>;
export type ShareDocument = (options: ShareDocumentOptions) => Promise<ShareDocumentOutcome>;

/** Production default: the real platform port (ADR-026) — `showSaveFilePicker` when available, Blob + `<a download>` otherwise, chosen inside `saveDocument` itself, never here. */
async function defaultSaveDocument(options: SaveDocumentOptions): Promise<SaveDocumentOutcome> {
  return resolvePlatformFileService().saveDocument(options);
}

async function defaultShareDocument(options: ShareDocumentOptions): Promise<ShareDocumentOutcome> {
  return resolvePlatformFileService().shareDocument(options);
}

export interface ExportDialogProps {
  readonly project: ProjectRecord;
  readonly configText: string;
  readonly issues: ValidationIssue[];
  readonly schemaLock: McsProjSchemaLock;
  readonly quarantine: McsProjQuarantine;
  readonly onClose: () => void;
  /** Test-only override; production code leaves this unset so every export goes through the real platform port. */
  readonly saveDocument?: SaveDocument;
  /** Test-only override, forwarded to `ShareDialog`; production code leaves this unset. */
  readonly shareDocument?: ShareDocument;
  /** Test-only override; production code leaves this unset so the "分享" button's visibility reflects the real platform (FR-AND-03 is Android-only — `capabilities.canShare` is false on Web). */
  readonly capabilities?: PlatformCapabilities;
}

/**
 * FR-YAML-07's two export paths are mutually exclusive: a blocking issue
 * disables the normal exports (`config.yaml` and `.mcsproj`, both writing
 * `configText` verbatim — never through the Worker's `serialize()`, so
 * export never silently reformats what the user is looking at) and exposes
 * a single "invalid draft" export instead, marked by a filename suffix so
 * it can't be mistaken for a usable configuration.
 *
 * All three exports go through `saveDocument` (ADR-026) rather than a
 * direct download — the same UI code this dialog already is works
 * unmodified once Android's SAF implementation lands in #3. This dialog
 * does not yet branch its own copy on `saved`/`downloaded`/`cancelled`
 * (v0.6.0 #7 adds the button-label distinction, PRD §11.4); today it only
 * needs the port to keep working on every platform, silently.
 *
 * The "分享" entry (v0.6.0 #5, FR-AND-03) only renders when
 * `capabilities.canShare` is true — Android-only, never on Web — and opens
 * `ShareDialog` rather than sharing directly, so the sensitivity warning
 * (NFR-SEC-08) and failure/retry handling (PRD §12) live in one place
 * shared with nothing to duplicate against.
 */
export function ExportDialog({
  project,
  configText,
  issues,
  schemaLock,
  quarantine,
  onClose,
  saveDocument = defaultSaveDocument,
  shareDocument = defaultShareDocument,
  capabilities = resolvePlatformFileService().capabilities,
}: ExportDialogProps): ReactNode {
  const [showShareDialog, setShowShareDialog] = useState(false);
  const blocking = hasBlockingIssues(issues);
  const findings = useMemo(
    () => findSensitivity(project, configText, schemaLock, quarantine),
    [project, configText, schemaLock, quarantine],
  );

  async function handleExportYaml(): Promise<void> {
    await saveDocument({
      suggestedName: `${project.name}.yaml`,
      content: configText,
      mimeType: 'text/yaml',
    });
  }

  async function handleExportMcsproj(): Promise<void> {
    const bytes = await writeMcsproj(buildMcsProject(project, configText, schemaLock, quarantine));
    await saveDocument({
      suggestedName: `${project.name}.mcsproj`,
      content: bytes,
      mimeType: 'application/zip',
    });
  }

  async function handleExportDraft(): Promise<void> {
    await saveDocument({
      suggestedName: `${project.name}.invalid-draft.yaml`,
      content: configText,
      mimeType: 'text/yaml',
    });
  }

  if (showShareDialog) {
    return (
      <ShareDialog
        project={project}
        configText={configText}
        schemaLock={schemaLock}
        quarantine={quarantine}
        onClose={() => setShowShareDialog(false)}
        shareDocument={shareDocument}
        saveDocument={saveDocument}
      />
    );
  }

  return (
    <section className="export-dialog" role="dialog" aria-label={t('export.title')}>
      <h2 className="export-dialog__title">{t('export.title')}</h2>

      {findings.length > 0 && (
        <div className="export-dialog__sensitivity">
          <p className="export-dialog__sensitivity-title">{t('export.sensitivityTitle')}</p>
          <ul className="export-dialog__sensitivity-list">
            {dedupeSensitivityKinds(findings).map((kind) => (
              <li key={kind}>{t(SENSITIVITY_LABEL_KEY[kind])}</li>
            ))}
          </ul>
        </div>
      )}

      {blocking && <p className="export-dialog__draft-notice">{t('export.draftNotice')}</p>}

      <div className="export-dialog__actions">
        <button type="button" disabled={blocking} onClick={() => void handleExportYaml()}>
          {t('export.yamlButton')}
        </button>
        <button type="button" disabled={blocking} onClick={() => void handleExportMcsproj()}>
          {t('export.mcsprojButton')}
        </button>
        {blocking && (
          <button type="button" onClick={() => void handleExportDraft()}>
            {t('export.draftButton')}
          </button>
        )}
        {capabilities.canShare && (
          <button type="button" disabled={blocking} onClick={() => setShowShareDialog(true)}>
            {t('export.shareButton')}
          </button>
        )}
        <button type="button" onClick={onClose}>
          {t('export.closeButton')}
        </button>
      </div>
    </section>
  );
}
