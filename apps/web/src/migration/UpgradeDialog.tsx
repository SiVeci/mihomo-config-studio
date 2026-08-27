import {
  applyMigration,
  type ApplyMigrationErrorCode,
  type QuarantinedField,
} from '@mcs/migration';
import type {
  McsProjQuarantine,
  McsProjQuarantinedField,
  McsProjSchemaLock,
} from '@mcs/project-format';
import type { SchemaModule } from '@mcs/schema-core';
import { bundleStoreFrom, createRegistry, resolveActiveBundle } from '@mcs/schema-registry';
import { SnapshotManager, type StorageAdapter } from '@mcs/storage';
import { MihomoYamlDocument } from '@mcs/yaml-engine';
import { useEffect, useState, type ReactNode } from 'react';

import { defaultVerifyOptions } from '../bundle/verify-options.js';
import { t, type TranslationKey } from '../i18n/index.js';
import { projectSnapshotPrefix } from '../project/model.js';
import {
  buildUpgradePreview,
  collectLossyOperationCount,
  type ModuleUpgradePreview,
  type UpgradePreview,
} from './upgrade-preview.js';
import './UpgradeDialog.css';

export interface UpgradeResult {
  readonly configText: string;
  readonly schemaLock: McsProjSchemaLock;
  readonly quarantine: McsProjQuarantine;
  /** The new active bundle's modules, already resolved — the caller feeds this straight into `client.configureModules`, no second resolution needed. */
  readonly modules: readonly SchemaModule[];
}

export interface UpgradeDialogProps {
  readonly adapter: StorageAdapter;
  readonly projectId: string;
  readonly configText: string;
  readonly schemaLock: McsProjSchemaLock;
  readonly quarantine: McsProjQuarantine;
  /** The project's own currently-active modules (`ProjectPage`'s already-resolved state, ADR-004) — the preview's "old" side, never re-resolved here. */
  readonly oldModules: readonly SchemaModule[];
  readonly onUpgraded: (result: UpgradeResult) => void;
  readonly onClose: () => void;
  /** Test-only trust anchor override, same escape hatch `BundlePage`/`ProjectPage` expose; production code leaves this unset. */
  readonly trustedPublicKeys?: readonly Uint8Array[];
}

const OPERATION_LABEL_KEY: Record<string, TranslationKey> = {
  'rename-field': 'migration.op.renameField',
  'move-field': 'migration.op.moveField',
  'set-default': 'migration.op.setDefault',
  'deprecate-field': 'migration.op.deprecateField',
  'remove-field': 'migration.op.removeField',
  'narrow-enum': 'migration.op.narrowEnum',
  'quarantine-field': 'migration.op.quarantineField',
};

const ERROR_KEY: Record<ApplyMigrationErrorCode, TranslationKey> = {
  MIGRATION_LOSSY_NOT_CONFIRMED: 'migration.error.lossyNotConfirmed',
  MIGRATION_SNAPSHOT_FAILED: 'migration.error.snapshotFailed',
  MIGRATION_OPERATION_FAILED: 'migration.error.operationFailed',
};

interface ActiveTarget {
  readonly modules: readonly SchemaModule[];
  readonly schemaLock: McsProjSchemaLock;
}

export function UpgradeDialog({
  adapter,
  projectId,
  configText,
  schemaLock,
  quarantine,
  oldModules,
  onUpgraded,
  onClose,
  trustedPublicKeys,
}: UpgradeDialogProps): ReactNode {
  const [target, setTarget] = useState<ActiveTarget | undefined>(undefined);
  const [preview, setPreview] = useState<UpgradePreview | undefined>(undefined);
  const [confirmedLossy, setConfirmedLossy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorCode, setErrorCode] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    const store = bundleStoreFrom(adapter);
    const options = defaultVerifyOptions(trustedPublicKeys);
    void resolveActiveBundle(store, options).then((active) => {
      if (cancelled) return;
      const newModules = createRegistry(active).modules();
      const newLock: McsProjSchemaLock = {
        bundleVersion: active.manifest.version,
        compatibilityProfile: active.manifest.mihomo.minVersion,
      };
      setTarget({ modules: newModules, schemaLock: newLock });
      setPreview(
        buildUpgradePreview(
          oldModules,
          newModules,
          schemaLock.bundleVersion,
          newLock.bundleVersion,
        ),
      );
    });
    return () => {
      cancelled = true;
    };
    // `oldModules`/`schemaLock` are the project's state at the moment this
    // dialog opened — deliberately not re-run if they change while open
    // (there is no code path that would change them while this is up).
  }, [adapter, trustedPublicKeys]);

  async function handleConfirm(): Promise<void> {
    if (!preview || !target) return;
    setBusy(true);
    setErrorCode(undefined);

    const parsed = MihomoYamlDocument.parse(configText);
    if (!parsed.document) {
      setErrorCode('PARSE_FAILED');
      setBusy(false);
      return;
    }
    let document = parsed.document;
    const snapshots = new SnapshotManager({ adapter, prefix: projectSnapshotPrefix(projectId) });
    const quarantinedAt = new Date().toISOString();
    const newQuarantineFields: McsProjQuarantinedField[] = [];

    for (const moduleUpgrade of preview.modules) {
      for (const plan of moduleUpgrade.plans) {
        const result = await applyMigration(plan, document, {
          confirmedLossy,
          snapshots,
          moduleRoot: moduleUpgrade.moduleRoot,
          quarantine: {
            quarantine: (field: QuarantinedField) => {
              newQuarantineFields.push({
                ...field,
                moduleId: moduleUpgrade.moduleId,
                quarantinedAt,
              });
            },
          },
        });
        if (!result.ok) {
          setErrorCode(result.code);
          setBusy(false);
          return;
        }
        document = result.document;
      }
    }

    onUpgraded({
      configText: document.toText(),
      schemaLock: target.schemaLock,
      quarantine: { fields: [...quarantine.fields, ...newQuarantineFields] },
      modules: target.modules,
    });
  }

  const title = t('migration.upgradeDialog.title');

  if (!preview) {
    return (
      <section className="upgrade-dialog" role="dialog" aria-modal="true" aria-label={title}>
        <h2 className="upgrade-dialog__title">{title}</h2>
        <p>{t('migration.upgradeDialog.loading')}</p>
      </section>
    );
  }

  if (preview.sameVersion) {
    return (
      <section className="upgrade-dialog" role="dialog" aria-modal="true" aria-label={title}>
        <h2 className="upgrade-dialog__title">{title}</h2>
        <p>{t('migration.upgradeDialog.upToDate')}</p>
        <div className="upgrade-dialog__actions">
          <button type="button" onClick={onClose}>
            {t('migration.upgradeDialog.closeButton')}
          </button>
        </div>
      </section>
    );
  }

  const lossyOperationCount = collectLossyOperationCount(preview);
  const confirmDisabled = busy || (preview.lossy && !confirmedLossy);

  return (
    <section className="upgrade-dialog" role="dialog" aria-modal="true" aria-label={title}>
      <h2 className="upgrade-dialog__title">{title}</h2>
      <p>
        {t('migration.upgradeDialog.targetVersion', {
          version: target?.schemaLock.bundleVersion ?? '',
        })}
      </p>

      {preview.modules.every((module) => isModulePreviewEmpty(module)) && (
        <p>{t('migration.upgradeDialog.noChanges')}</p>
      )}

      {preview.modules
        .filter((module) => !isModulePreviewEmpty(module))
        .map((module) => (
          <div key={module.moduleId} className="upgrade-dialog__module">
            <h3 className="upgrade-dialog__module-title">{module.moduleId}</h3>

            {module.loadIssues.length > 0 && (
              <p className="upgrade-dialog__module-error">
                {t('migration.upgradeDialog.migrationLoadFailed')}
              </p>
            )}

            {module.diff && module.diff.added.length > 0 && (
              <FieldList
                headingKey="migration.upgradeDialog.addedFields"
                paths={module.diff.added.map((entry) => entry.path)}
              />
            )}
            {module.diff && module.diff.deprecated.length > 0 && (
              <FieldList
                headingKey="migration.upgradeDialog.deprecatedFields"
                paths={module.diff.deprecated.map((entry) => entry.path)}
              />
            )}
            {module.diff && module.diff.defaultChanged.length > 0 && (
              <ul className="upgrade-dialog__field-list">
                {module.diff.defaultChanged.map((entry) => (
                  <li key={entry.path}>
                    {t('migration.upgradeDialog.defaultChanged', {
                      path: entry.path,
                      oldDefault: JSON.stringify(entry.oldDefault),
                      newDefault: JSON.stringify(entry.newDefault),
                    })}
                  </li>
                ))}
              </ul>
            )}
            {module.plans.length > 0 && (
              <ul className="upgrade-dialog__field-list">
                {module.plans.flatMap((plan) =>
                  plan.operations.map((operation, index) => (
                    <li key={`${plan.from}-${plan.to}-${index}`}>
                      {t(OPERATION_LABEL_KEY[operation.op] ?? 'migration.op.unknown', {
                        path: operation.path,
                      })}
                    </li>
                  )),
                )}
              </ul>
            )}
          </div>
        ))}

      {preview.lossy && (
        <div className="upgrade-dialog__lossy-warning">
          <p>{t('migration.upgradeDialog.lossyWarning', { count: lossyOperationCount })}</p>
          <label>
            <input
              type="checkbox"
              checked={confirmedLossy}
              onChange={(event) => setConfirmedLossy(event.target.checked)}
            />
            {t('migration.upgradeDialog.confirmLossyLabel')}
          </label>
        </div>
      )}

      {errorCode && (
        <p className="upgrade-dialog__error" role="alert">
          {t((ERROR_KEY as Record<string, TranslationKey>)[errorCode] ?? 'migration.error.unknown')}
        </p>
      )}

      <div className="upgrade-dialog__actions">
        <button type="button" disabled={confirmDisabled} onClick={() => void handleConfirm()}>
          {t('migration.upgradeDialog.confirmButton')}
        </button>
        <button type="button" onClick={onClose} disabled={busy}>
          {t('migration.upgradeDialog.cancelButton')}
        </button>
      </div>
    </section>
  );
}

function isModulePreviewEmpty(module: ModuleUpgradePreview): boolean {
  const diff = module.diff;
  const diffEmpty =
    !diff ||
    (diff.added.length === 0 && diff.deprecated.length === 0 && diff.defaultChanged.length === 0);
  return diffEmpty && module.plans.length === 0 && module.loadIssues.length === 0;
}

function FieldList({
  headingKey,
  paths,
}: {
  headingKey: TranslationKey;
  paths: readonly string[];
}): ReactNode {
  return (
    <div>
      <p className="upgrade-dialog__field-heading">{t(headingKey, { count: paths.length })}</p>
      <ul className="upgrade-dialog__field-list">
        {paths.map((path) => (
          <li key={path}>{path}</li>
        ))}
      </ul>
    </div>
  );
}
