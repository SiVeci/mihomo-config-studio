import { describeSensitivity, MCSPROJ_FORMAT_VERSION, writeMcsproj } from '@mcs/project-format';
import type {
  McsProject,
  McsProjQuarantine,
  McsProjSchemaLock,
  SensitivityFinding,
  SensitivityKind,
} from '@mcs/project-format';
import { useMemo, type ReactNode } from 'react';

import { t } from '../i18n/index.js';
import type { TranslationKey } from '../i18n/index.js';
import { resolvePlatformFileService } from '../platform/index.js';
import type { SaveDocumentOptions, SaveDocumentOutcome } from '../platform/index.js';
import type { ProjectRecord } from '../project/model.js';
import { hasBlockingIssues } from '../worker/protocol.js';
import type { ValidationIssue } from '../worker/protocol.js';
import './ExportDialog.css';

export type SaveDocument = (options: SaveDocumentOptions) => Promise<SaveDocumentOutcome>;

/** Production default: the real platform port (ADR-026) — `showSaveFilePicker` when available, Blob + `<a download>` otherwise, chosen inside `saveDocument` itself, never here. */
async function defaultSaveDocument(options: SaveDocumentOptions): Promise<SaveDocumentOutcome> {
  return resolvePlatformFileService().saveDocument(options);
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
}

const SENSITIVITY_LABEL_KEY: Record<SensitivityKind, TranslationKey> = {
  'subscription-url': 'export.sensitivity.subscriptionUrl',
  password: 'export.sensitivity.password',
  uuid: 'export.sensitivity.uuid',
  'private-key': 'export.sensitivity.privateKey',
};

/**
 * v0.2.0 has no persisted UI state (#6's own note: nothing concrete to store
 * in `uiState` yet), so that one `McsProject` field is still a fixed
 * placeholder. `schemaLock`/`quarantine` are real as of v0.5.0 #11 — the
 * project's own persisted lock and quarantine, not derived here.
 */
function buildMcsProject(
  project: ProjectRecord,
  configText: string,
  schemaLock: McsProjSchemaLock,
  quarantine: McsProjQuarantine,
): McsProject {
  return {
    manifest: {
      formatVersion: MCSPROJ_FORMAT_VERSION,
      id: project.id,
      name: project.name,
      description: project.description,
      targetProfile: project.targetProfile,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    },
    configText,
    uiState: {},
    schemaLock,
    quarantine,
  };
}

function dedupeKinds(findings: readonly SensitivityFinding[]): SensitivityKind[] {
  return [...new Set(findings.map((finding) => finding.kind))];
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
 */
export function ExportDialog({
  project,
  configText,
  issues,
  schemaLock,
  quarantine,
  onClose,
  saveDocument = defaultSaveDocument,
}: ExportDialogProps): ReactNode {
  const blocking = hasBlockingIssues(issues);
  const findings = useMemo(
    () => describeSensitivity(buildMcsProject(project, configText, schemaLock, quarantine)),
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

  return (
    <section className="export-dialog" role="dialog" aria-label={t('export.title')}>
      <h2 className="export-dialog__title">{t('export.title')}</h2>

      {findings.length > 0 && (
        <div className="export-dialog__sensitivity">
          <p className="export-dialog__sensitivity-title">{t('export.sensitivityTitle')}</p>
          <ul className="export-dialog__sensitivity-list">
            {dedupeKinds(findings).map((kind) => (
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
        <button type="button" onClick={onClose}>
          {t('export.closeButton')}
        </button>
      </div>
    </section>
  );
}
