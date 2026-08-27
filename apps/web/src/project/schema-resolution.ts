import type { McsProjSchemaLock } from '@mcs/project-format';
import type { SchemaModule } from '@mcs/schema-core';
import {
  bundleStoreFrom,
  createRegistry,
  resolveActiveBundle,
  resolveBundleByVersion,
} from '@mcs/schema-registry';
import type { StorageAdapter } from '@mcs/storage';

import { defaultVerifyOptions } from '../bundle/verify-options.js';
import { getProjectSchemaLock, saveProjectSchemaLock } from './model.js';

export interface ResolvedProjectSchema {
  readonly modules: readonly SchemaModule[];
  readonly schemaLock: McsProjSchemaLock;
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
 * When the locked version is not available from any local slot, this falls
 * back to the active bundle rather than failing — v0.5.0 #12's read-only
 * protection replaces this fallback with a real three-state guard; this
 * slice does not yet detect or block that case, and says so rather than
 * pretending otherwise.
 */
export async function resolveProjectSchema(
  adapter: StorageAdapter,
  projectId: string,
  /** Test-only trust anchor override, same escape hatch `BundlePage` exposes; production code leaves this unset. */
  trustedPublicKeys?: readonly Uint8Array[],
): Promise<ResolvedProjectSchema> {
  const store = bundleStoreFrom(adapter);
  const options = defaultVerifyOptions(trustedPublicKeys);

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
  const resolved = locked ?? (await resolveActiveBundle(store, options));
  return { modules: createRegistry(resolved).modules(), schemaLock };
}
