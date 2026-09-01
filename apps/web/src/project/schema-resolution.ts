import type { McsProjSchemaLock } from '@mcs/project-format';
import type { SchemaModule } from '@mcs/schema-core';
import {
  bundleStoreFrom,
  createRegistry,
  resolveActiveBundle,
  resolveBundleByVersion,
  type BundleTrust,
} from '@mcs/schema-registry';
import type { StorageAdapter } from '@mcs/storage';

import { defaultVerifyOptions } from '../bundle/verify-options.js';
import { getProjectSchemaLock, saveProjectSchemaLock } from './model.js';

export interface ResolvedProjectSchema {
  readonly modules: readonly SchemaModule[];
  readonly schemaLock: McsProjSchemaLock;
  /**
   * FR-UPD-09 (v0.9.0 #17): which Bundle this project's modules actually
   * came from — `'untrusted'` means a manually-imported community Bundle
   * whose signature was never checked against a known trust anchor. The
   * caller shows a persistent warning for that case (ADR-002: the Bundle
   * decides what a form renders, so the user needs to always know whose
   * knowledge that is), not just at the moment it was installed.
   */
  readonly bundleTrust: BundleTrust;
  /**
   * ADR-004 point 6 / PRD §9.5 point 3 (v0.5.0 #12): `true` when the locked
   * version could not be found locally but *some* other Bundle content
   * exists — the caller must open the project read-only and guide recovery,
   * never silently substitute a different version's modules. `false` covers
   * both the normal case (locked version found) and the empty-store case
   * (nothing installed anywhere yet, so falling back to the built-in bundle
   * is `resolveActiveBundle`'s own long-standing behavior, not a surprise).
   */
  readonly readOnly: boolean;
}

/**
 * A project's own locked Bundle version, resolved to real modules (ADR-004,
 * v0.5.0 #11, decision F14) — never "whatever is active right now", so
 * installing an update never changes what an existing, un-upgraded project
 * validates against.
 *
 * A project with no schema-lock yet (created before this slice, or just
 * created this session) is backfilled here with whatever is currently
 * active and persisted immediately — the same content it was always actually
 * validated against, since the Worker had no other source before this slice.
 *
 * Three states (v0.5.0 #12, ADR-004 point 6):
 * 1. Locked version found locally → normal, `readOnly: false`.
 * 2. Locked version not found, but the store is not empty → `readOnly: true`,
 *    resolves to whatever is currently active purely so the caller has
 *    *something* to show read-only (never used to silently keep editing).
 * 3. Store is completely empty (nothing has ever been installed) → falls
 *    back to the built-in bundle, `readOnly: false` — `resolveActiveBundle`'s
 *    own existing behavior, unchanged; blocking a brand-new install for a
 *    project it has no other way to open would break offline-first (FR-UPD-01).
 */
export async function resolveProjectSchema(
  adapter: StorageAdapter,
  projectId: string,
  /** Test-only trust anchor override, same escape hatch `BundlePage` exposes; production code leaves this unset. */
  trustedPublicKeys?: readonly Uint8Array[],
): Promise<ResolvedProjectSchema> {
  const store = bundleStoreFrom(adapter);
  const options = await defaultVerifyOptions(trustedPublicKeys);

  let schemaLock = await getProjectSchemaLock(adapter, projectId);
  if (!schemaLock) {
    const active = await resolveActiveBundle(store, options);
    schemaLock = {
      bundleVersion: active.manifest.version,
      compatibilityProfile: active.manifest.mihomo.minVersion,
    };
    await saveProjectSchemaLock(adapter, projectId, schemaLock);
  }

  const locked = await resolveBundleByVersion(store, schemaLock.bundleVersion, options);
  if (locked) {
    return {
      modules: createRegistry(locked).modules(),
      schemaLock,
      bundleTrust: locked.trust,
      readOnly: false,
    };
  }

  const storeIsEmpty = (await store.list()).length === 0;
  const active = await resolveActiveBundle(store, options);
  return {
    modules: createRegistry(active).modules(),
    schemaLock,
    bundleTrust: active.trust,
    readOnly: !storeIsEmpty,
  };
}
