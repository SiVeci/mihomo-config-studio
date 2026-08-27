// @vitest-environment jsdom
import { bundleStoreFrom, createRegistry, installBundle } from '@mcs/schema-registry';
import type { SchemaModule } from '@mcs/schema-core';
import { MemoryStorageAdapter } from '@mcs/storage';
import { SnapshotManager } from '@mcs/storage';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { defaultVerifyOptions } from '../bundle/verify-options.js';
import { t } from '../i18n/index.js';
import { projectSnapshotPrefix } from '../project/model.js';
import { buildSignedBundle, generateTestKeyPair } from '../testing/signed-bundle.js';
import { UpgradeDialog, type UpgradeResult } from './UpgradeDialog.js';

afterEach(() => {
  cleanup();
});

/** Builds a real `modules/general.json` entry with an explicit version, matching `createRegistry`'s `isModuleShape` shape. */
function generalModuleAt(version: string, schema: unknown, migrations?: unknown[]): unknown {
  return {
    manifest: { id: 'general', root: [], version },
    schema,
    ui: {},
    ...(migrations ? { migrations } : {}),
  };
}

async function oldModulesFor(bundle: {
  manifest: Awaited<ReturnType<typeof buildSignedBundle>>['manifest'];
  files: Map<string, Uint8Array>;
}): Promise<readonly SchemaModule[]> {
  return createRegistry(bundle).modules();
}

describe('UpgradeDialog — up to date (v0.5.0 #11)', () => {
  it('shows the up-to-date message and never calls onUpgraded when the locked version already matches active', async () => {
    const adapter = new MemoryStorageAdapter();
    const store = bundleStoreFrom(adapter);
    const keyPair = await generateTestKeyPair();
    const trustedPublicKeys = [keyPair.publicKeyRaw];
    const options = defaultVerifyOptions(trustedPublicKeys);

    const v1 = await buildSignedBundle({
      keyPair,
      bundleId: 'v1',
      version: '1.0.0',
      modules: new Map([['general', generalModuleAt('1.0.0', { properties: { mode: {} } })]]),
    });
    await installBundle(store, v1.manifest, v1.files, options);
    const oldModules = await oldModulesFor(v1);

    const onUpgraded = vi.fn();
    render(
      <UpgradeDialog
        adapter={adapter}
        projectId="p1"
        configText="mode: rule\n"
        schemaLock={{ bundleVersion: '1.0.0', compatibilityProfile: '1.19.29' }}
        quarantine={{ fields: [] }}
        oldModules={oldModules}
        onUpgraded={onUpgraded}
        onClose={vi.fn()}
        trustedPublicKeys={trustedPublicKeys}
      />,
    );

    await screen.findByText(t('migration.upgradeDialog.upToDate'));
    expect(onUpgraded).not.toHaveBeenCalled();
  });

  it('closing calls onClose', async () => {
    const adapter = new MemoryStorageAdapter();
    const onClose = vi.fn();
    render(
      <UpgradeDialog
        adapter={adapter}
        projectId="p1"
        configText="mode: rule\n"
        schemaLock={{ bundleVersion: '0.5.0', compatibilityProfile: '1.19.29' }}
        quarantine={{ fields: [] }}
        oldModules={[]}
        onUpgraded={vi.fn()}
        onClose={onClose}
      />,
    );

    await screen.findByText(t('migration.upgradeDialog.upToDate'));
    fireEvent.click(screen.getByRole('button', { name: t('migration.upgradeDialog.closeButton') }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('UpgradeDialog — real upgrade preview and execution', () => {
  it('previews an added field and a rename migration, and applying it renames the key in the resulting text (non-lossy, no confirmation checkbox needed)', async () => {
    const adapter = new MemoryStorageAdapter();
    const store = bundleStoreFrom(adapter);
    const keyPair = await generateTestKeyPair();
    const trustedPublicKeys = [keyPair.publicKeyRaw];
    const options = defaultVerifyOptions(trustedPublicKeys);

    const v1 = await buildSignedBundle({
      keyPair,
      bundleId: 'v1',
      version: '1.0.0',
      modules: new Map([['general', generalModuleAt('1.0.0', { properties: { mode: {} } })]]),
    });
    await installBundle(store, v1.manifest, v1.files, options);
    const oldModules = await oldModulesFor(v1);

    const v2 = await buildSignedBundle({
      keyPair,
      bundleId: 'v2',
      version: '2.0.0',
      modules: new Map([
        [
          'general',
          generalModuleAt('2.0.0', { properties: { mode: {}, 'kernel-mode': {} } }, [
            {
              from: '1.0.0',
              to: '2.0.0',
              operations: [{ op: 'rename-field', path: 'mode', to: 'kernel-mode' }],
            },
          ]),
        ],
      ]),
    });
    await installBundle(store, v2.manifest, v2.files, options);

    const onUpgraded = vi.fn<(result: UpgradeResult) => void>();
    render(
      <UpgradeDialog
        adapter={adapter}
        projectId="p1"
        configText={'mode: rule\n'}
        schemaLock={{ bundleVersion: '1.0.0', compatibilityProfile: '1.19.29' }}
        quarantine={{ fields: [] }}
        oldModules={oldModules}
        onUpgraded={onUpgraded}
        onClose={vi.fn()}
        trustedPublicKeys={trustedPublicKeys}
      />,
    );

    await screen.findByText(t('migration.upgradeDialog.addedFields', { count: 1 }));
    expect(screen.getByText('$.kernel-mode')).toBeDefined();
    await screen.findByText(t('migration.op.renameField', { path: 'mode' }));

    const confirmButton = screen.getByRole<HTMLButtonElement>('button', {
      name: t('migration.upgradeDialog.confirmButton'),
    });
    expect(confirmButton.disabled).toBe(false);
    fireEvent.click(confirmButton);

    await waitFor(() => expect(onUpgraded).toHaveBeenCalled());
    const result = onUpgraded.mock.calls[0]?.[0];
    expect(result?.configText).toBe('kernel-mode: rule\n');
    expect(result?.schemaLock).toEqual({ bundleVersion: '2.0.0', compatibilityProfile: '1.19.29' });

    // applyMigration's own snapshot gate (NFR-REL-01) really ran — a snapshot
    // of the pre-migration text was recorded, not just conceptually promised.
    const snapshots = await new SnapshotManager({
      adapter,
      prefix: projectSnapshotPrefix('p1'),
    }).list();
    expect(snapshots).toHaveLength(1);
    expect(new TextDecoder().decode(snapshots[0]?.content)).toBe('mode: rule\n');
  });

  it('disables confirm until the lossy checkbox is checked, and the field is genuinely removed once confirmed', async () => {
    const adapter = new MemoryStorageAdapter();
    const store = bundleStoreFrom(adapter);
    const keyPair = await generateTestKeyPair();
    const trustedPublicKeys = [keyPair.publicKeyRaw];
    const options = defaultVerifyOptions(trustedPublicKeys);

    const v1 = await buildSignedBundle({
      keyPair,
      bundleId: 'v1',
      version: '1.0.0',
      modules: new Map([
        ['general', generalModuleAt('1.0.0', { properties: { mode: {}, doomed: {} } })],
      ]),
    });
    await installBundle(store, v1.manifest, v1.files, options);
    const oldModules = await oldModulesFor(v1);

    const v2 = await buildSignedBundle({
      keyPair,
      bundleId: 'v2',
      version: '2.0.0',
      modules: new Map([
        [
          'general',
          generalModuleAt('2.0.0', { properties: { mode: {} } }, [
            { from: '1.0.0', to: '2.0.0', operations: [{ op: 'remove-field', path: 'doomed' }] },
          ]),
        ],
      ]),
    });
    await installBundle(store, v2.manifest, v2.files, options);

    const onUpgraded = vi.fn<(result: UpgradeResult) => void>();
    render(
      <UpgradeDialog
        adapter={adapter}
        projectId="p1"
        configText={'mode: rule\ndoomed: yes\n'}
        schemaLock={{ bundleVersion: '1.0.0', compatibilityProfile: '1.19.29' }}
        quarantine={{ fields: [] }}
        oldModules={oldModules}
        onUpgraded={onUpgraded}
        onClose={vi.fn()}
        trustedPublicKeys={trustedPublicKeys}
      />,
    );

    await screen.findByText(t('migration.op.removeField', { path: 'doomed' }));
    const confirmButton = screen.getByRole<HTMLButtonElement>('button', {
      name: t('migration.upgradeDialog.confirmButton'),
    });
    expect(confirmButton.disabled).toBe(true);

    fireEvent.click(screen.getByRole('checkbox'));
    expect(confirmButton.disabled).toBe(false);

    fireEvent.click(confirmButton);
    await waitFor(() => expect(onUpgraded).toHaveBeenCalled());
    expect(onUpgraded.mock.calls[0]?.[0].configText).toBe('mode: rule\n');
  });

  it('a quarantine-field operation moves the field into the returned quarantine rather than deleting it', async () => {
    const adapter = new MemoryStorageAdapter();
    const store = bundleStoreFrom(adapter);
    const keyPair = await generateTestKeyPair();
    const trustedPublicKeys = [keyPair.publicKeyRaw];
    const options = defaultVerifyOptions(trustedPublicKeys);

    const v1 = await buildSignedBundle({
      keyPair,
      bundleId: 'v1',
      version: '1.0.0',
      modules: new Map([
        ['general', generalModuleAt('1.0.0', { properties: { mode: {}, 'legacy-secret': {} } })],
      ]),
    });
    await installBundle(store, v1.manifest, v1.files, options);
    const oldModules = await oldModulesFor(v1);

    const v2 = await buildSignedBundle({
      keyPair,
      bundleId: 'v2',
      version: '2.0.0',
      modules: new Map([
        [
          'general',
          generalModuleAt('2.0.0', { properties: { mode: {} } }, [
            {
              from: '1.0.0',
              to: '2.0.0',
              operations: [{ op: 'quarantine-field', path: 'legacy-secret' }],
            },
          ]),
        ],
      ]),
    });
    await installBundle(store, v2.manifest, v2.files, options);

    const onUpgraded = vi.fn<(result: UpgradeResult) => void>();
    render(
      <UpgradeDialog
        adapter={adapter}
        projectId="p1"
        configText={'mode: rule\nlegacy-secret: hunter2\n'}
        schemaLock={{ bundleVersion: '1.0.0', compatibilityProfile: '1.19.29' }}
        quarantine={{ fields: [] }}
        oldModules={oldModules}
        onUpgraded={onUpgraded}
        onClose={vi.fn()}
        trustedPublicKeys={trustedPublicKeys}
      />,
    );

    const confirmButton = await screen.findByRole<HTMLButtonElement>('button', {
      name: t('migration.upgradeDialog.confirmButton'),
    });
    expect(confirmButton.disabled).toBe(false); // quarantine-field is not lossy — the value survives
    fireEvent.click(confirmButton);

    await waitFor(() => expect(onUpgraded).toHaveBeenCalled());
    const result = onUpgraded.mock.calls[0]?.[0];
    expect(result?.configText).not.toContain('legacy-secret');
    expect(result?.quarantine.fields).toHaveLength(1);
    expect(result?.quarantine.fields[0]).toMatchObject({
      path: 'legacy-secret',
      value: 'hunter2',
      moduleId: 'general',
    });
    expect(typeof result?.quarantine.fields[0]?.quarantinedAt).toBe('string');
  });
});
