import { describeSensitivity, MCSPROJ_FORMAT_VERSION, writeMcsproj } from '@mcs/project-format';
import type { McsProject, SensitivityFinding, SensitivityKind } from '@mcs/project-format';
import { useMemo, type ReactNode } from 'react';

import { t } from '../i18n/index.js';
import type { TranslationKey } from '../i18n/index.js';
import { DEFAULT_BUNDLE_VERSION } from '../project/model.js';
import type { ProjectRecord } from '../project/model.js';
import { hasBlockingIssues } from '../worker/protocol.js';
import type { ValidationIssue } from '../worker/protocol.js';
import './ExportDialog.css';

/**
 * Injectable so tests can assert on what would have been downloaded
 * (filename, MIME type, content) without needing jsdom to implement
 * `URL.createObjectURL` — it doesn't (see `ExportDialog.test.tsx`).
 */
export type DownloadFile = (
  content: Uint8Array | string,
  filename: string,
  mimeType: string,
) => void;

function defaultDownloadFile(
  content: Uint8Array | string,
  filename: string,
  mimeType: string,
): void {
  // `Blob`'s `BlobPart` wants an `ArrayBuffer`-backed view specifically;
  // `Uint8Array` alone is typed generically over `ArrayBufferLike` (which
  // also covers `SharedArrayBuffer`) since TS 5.7. `writeMcsproj`'s output
  // is always a fresh, plain `ArrayBuffer` at runtime — copy-constructing
  // re-asserts that in the type system rather than casting past it.
  const blobPart = typeof content === 'string' ? content : new Uint8Array(content);
  const blob = new Blob([blobPart], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export interface ExportDialogProps {
  readonly project: ProjectRecord;
  readonly configText: string;
  readonly issues: ValidationIssue[];
  readonly onClose: () => void;
  readonly downloadFile?: DownloadFile;
}

const SENSITIVITY_LABEL_KEY: Record<SensitivityKind, TranslationKey> = {
  'subscription-url': 'export.sensitivity.subscriptionUrl',
  password: 'export.sensitivity.password',
  uuid: 'export.sensitivity.uuid',
  'private-key': 'export.sensitivity.privateKey',
};

/**
 * v0.2.0 has no real Schema Bundle or persisted UI state (#6's own note:
 * nothing concrete to store in `uiState` yet), so those two `McsProject`
 * fields are fixed placeholders here rather than plumbed through from
 * elsewhere that doesn't have real values either. `quarantine` joins them
 * for the same reason (v0.5.0 #9): nothing in `apps/web` produces a
 * quarantined field yet — that lands with the project-upgrade UI (#11).
 */
function buildMcsProject(project: ProjectRecord, configText: string): McsProject {
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
    schemaLock: {
      bundleVersion: DEFAULT_BUNDLE_VERSION,
      compatibilityProfile: project.targetProfile,
    },
    quarantine: { fields: [] },
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
 */
export function ExportDialog({
  project,
  configText,
  issues,
  onClose,
  downloadFile = defaultDownloadFile,
}: ExportDialogProps): ReactNode {
  const blocking = hasBlockingIssues(issues);
  const findings = useMemo(
    () => describeSensitivity(buildMcsProject(project, configText)),
    [project, configText],
  );

  function handleExportYaml(): void {
    downloadFile(configText, `${project.name}.yaml`, 'text/yaml');
  }

  async function handleExportMcsproj(): Promise<void> {
    const bytes = await writeMcsproj(buildMcsProject(project, configText));
    downloadFile(bytes, `${project.name}.mcsproj`, 'application/zip');
  }

  function handleExportDraft(): void {
    downloadFile(configText, `${project.name}.invalid-draft.yaml`, 'text/yaml');
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
        <button type="button" disabled={blocking} onClick={handleExportYaml}>
          {t('export.yamlButton')}
        </button>
        <button type="button" disabled={blocking} onClick={() => void handleExportMcsproj()}>
          {t('export.mcsprojButton')}
        </button>
        {blocking && (
          <button type="button" onClick={handleExportDraft}>
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
