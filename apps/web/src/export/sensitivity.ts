import { describeSensitivity, MCSPROJ_FORMAT_VERSION } from '@mcs/project-format';
import type {
  McsProject,
  McsProjQuarantine,
  McsProjSchemaLock,
  SensitivityFinding,
  SensitivityKind,
} from '@mcs/project-format';

import type { TranslationKey } from '../i18n/index.js';
import type { ProjectRecord } from '../project/model.js';

/**
 * Shared between `ExportDialog` and `ShareDialog` (v0.6.0 #5) — NFR-SEC-08's
 * own wording names "项目包导出、剪贴板复制和 Android 分享" as three exits
 * of the *same* judgement, so this is the one place that judgement lives,
 * not a second copy per dialog.
 */
export const SENSITIVITY_LABEL_KEY: Record<SensitivityKind, TranslationKey> = {
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
export function buildMcsProject(
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

export function dedupeSensitivityKinds(findings: readonly SensitivityFinding[]): SensitivityKind[] {
  return [...new Set(findings.map((finding) => finding.kind))];
}

/** Only ever returns `{segment, kind}` pairs (never the matched text) — `describeSensitivity`'s own contract, not re-derived here. */
export function findSensitivity(
  project: ProjectRecord,
  configText: string,
  schemaLock: McsProjSchemaLock,
  quarantine: McsProjQuarantine,
): readonly SensitivityFinding[] {
  return describeSensitivity(buildMcsProject(project, configText, schemaLock, quarantine));
}
