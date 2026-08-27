import { BUILTIN_BUNDLE, bundleStoreFrom, installBundle } from '@mcs/schema-registry';
import { MemoryStorageAdapter } from '@mcs/storage';
import { describe, expect, it } from 'vitest';

import { defaultVerifyOptions } from '../bundle/verify-options.js';
import { buildSignedBundle, generateTestKeyPair } from '../testing/signed-bundle.js';
import { getProjectSchemaLock, saveProjectSchemaLock } from './model.js';
import { resolveProjectSchema } from './schema-resolution.js';

describe('resolveProjectSchema (ADR-004, v0.5.0 #11, decision F14)', () => {
  it('backfills a schema-lock pointing at the built-in bundle for a project that has never had one', async () => {
    const adapter = new MemoryStorageAdapter();

    const result = await resolveProjectSchema(adapter, 'p1');

    expect(result.schemaLock).toEqual({
      bundleVersion: BUILTIN_BUNDLE.manifest.version,
      compatibilityProfile: BUILTIN_BUNDLE.manifest.mihomo.minVersion,
    });
    expect(result.modules.map((module) => module.manifest.id).sort()).toContain('general');
    // The backfill is persisted, not just returned — a second read sees it too.
    expect(await getProjectSchemaLock(adapter, 'p1')).toEqual(result.schemaLock);
  });

  it('does not touch an existing schema-lock — a project already locked to the built-in version keeps it as-is', async () => {
    const adapter = new MemoryStorageAdapter();
    const first = await resolveProjectSchema(adapter, 'p1');

    const second = await resolveProjectSchema(adapter, 'p1');

    expect(second.schemaLock).toEqual(first.schemaLock);
  });

  it('resolves a project locked to an installed (non-built-in) version to that version’s own modules, even after a newer version becomes active', async () => {
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
        [
          'general',
          {
            manifest: { id: 'general', root: [], version: '1.0.0' },
            schema: { title: 'v1' },
            ui: {},
          },
        ],
      ]),
    });
    expect((await installBundle(store, v1.manifest, v1.files, options)).ok).toBe(true);
    await saveProjectSchemaLock(adapter, 'p1', {
      bundleVersion: '1.0.0',
      compatibilityProfile: 'v1.19.29',
    });

    // Install v2 as an update — v1 slides into the previous slot, v2 becomes active.
    const v2 = await buildSignedBundle({ keyPair, bundleId: 'v2', version: '2.0.0' });
    expect((await installBundle(store, v2.manifest, v2.files, options)).ok).toBe(true);

    const result = await resolveProjectSchema(adapter, 'p1', trustedPublicKeys);

    expect(result.schemaLock).toEqual({ bundleVersion: '1.0.0', compatibilityProfile: 'v1.19.29' });
    const general = result.modules.find((module) => module.manifest.id === 'general');
    expect(general?.schema).toEqual({ title: 'v1' });
  });

  it('falls back to the active bundle when the locked version is not available from any local slot (documented interim behavior, decision F14 — #12 replaces this with real read-only protection)', async () => {
    const adapter = new MemoryStorageAdapter();
    await saveProjectSchemaLock(adapter, 'p1', {
      bundleVersion: 'never-installed',
      compatibilityProfile: 'v1.19.29',
    });

    const result = await resolveProjectSchema(adapter, 'p1');

    // Falls back to the built-in bundle (nothing else is installed) rather
    // than throwing or resolving an empty module set.
    expect(result.modules.map((module) => module.manifest.id).sort()).toContain('general');
    // The lock itself is left untouched — falling back to serve the project
    // must not silently rewrite what it is actually locked to.
    expect(await getProjectSchemaLock(adapter, 'p1')).toEqual({
      bundleVersion: 'never-installed',
      compatibilityProfile: 'v1.19.29',
    });
  });

  it('a bundle whose only copy fails re-verification is treated the same as not being available at all', async () => {
    const adapter = new MemoryStorageAdapter();
    const store = bundleStoreFrom(adapter);
    const keyPair = await generateTestKeyPair();
    const { manifest } = await buildSignedBundle({ keyPair, bundleId: 'v1', version: '1.0.0' });
    // Corrupt the stored copy directly, bypassing installBundle's verification gate.
    await store.write('stable/active', {
      manifest,
      files: new Map([['modules/general.json', new TextEncoder().encode('{"corrupted":true}')]]),
    });
    await saveProjectSchemaLock(adapter, 'p1', {
      bundleVersion: '1.0.0',
      compatibilityProfile: 'v1.19.29',
    });

    const result = await resolveProjectSchema(adapter, 'p1', [keyPair.publicKeyRaw]);

    expect(result.modules.map((module) => module.manifest.id).sort()).toContain('general');
  });
});
