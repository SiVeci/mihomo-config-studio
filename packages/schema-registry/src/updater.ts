import { compareVersions, type BundleVerifyErrorCode } from './verify.js';
import { validateBundleManifest, type BundleChannel, type BundleManifest } from './manifest.js';
import { installBundle, type BundleInstallResult, type BundleStore } from './store.js';
import type { VerifyBundleOptions } from './verify.js';

/**
 * This file is `packages/**`'s one permitted network boundary (decision
 * F4/F5, enforced by `tools/egress-check`): `defaultFetchBytes` below is the
 * only place in `packages/**` that calls the real `fetch(`, always `GET`,
 * never a `body`. Everything else here — `planUpdate`, `applyUpdate` — is
 * pure and takes the network result as a plain value, so it is unit-testable
 * without ever touching the network (this is also why `pnpm run test` stays
 * fully offline: every test injects a fake `FetchBytes`).
 */
export type FetchBytes = (url: string) => Promise<Uint8Array>;

export type UpdaterErrorCode = BundleVerifyErrorCode | 'UPDATER_FETCH_FAILED';

/** Never carries a message, a response body, a URL, or an HTTP status text — only a stable code and a structural path (NFR-SEC-03). */
export interface UpdaterFailure {
  readonly ok: false;
  readonly code: UpdaterErrorCode;
  readonly path: string;
}

export interface FetchBundleSuccess {
  readonly ok: true;
  readonly manifest: BundleManifest;
  readonly files: ReadonlyMap<string, Uint8Array>;
}

export type FetchBundleResult = FetchBundleSuccess | UpdaterFailure;

/**
 * Where a candidate Bundle comes from: two caller-supplied, build-time
 * constants, never a value read out of Bundle content itself — letting a
 * Bundle name the URL for its own files (or the next manifest to fetch)
 * would hand redirect capability to data that might be poisoned in transit,
 * the same reasoning ADR-010 §3 already applies to trust anchors.
 */
export interface BundleSource {
  readonly manifestUrl: string;
  /** File `path` values from the manifest are appended to this, joined by `/`. */
  readonly fileBaseUrl: string;
}

/** The real, `fetch`-backed `FetchBytes`: `GET` only, never a `body`. */
async function defaultFetchBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url, { method: 'GET' });
  if (!response.ok) {
    throw new Error('updater: fetch did not return a successful response');
  }
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * Fetches a manifest and every file it declares, from a fixed source.
 * `fetchBytes` defaults to the real network (`defaultFetchBytes`); tests
 * always inject a fake one, so this function never makes a real request in
 * `pnpm run test`. Only a cheap *shape* check (`validateBundleManifest`) runs
 * here, just enough to know which files to fetch next — the authoritative
 * hash + signature check happens later, inside `applyUpdate` /
 * `installBundle`, exactly once, never duplicated here.
 */
export async function fetchBundle(
  source: BundleSource,
  fetchBytes: FetchBytes = defaultFetchBytes,
): Promise<FetchBundleResult> {
  let manifestBytes: Uint8Array;
  try {
    manifestBytes = await fetchBytes(source.manifestUrl);
  } catch {
    return { ok: false, code: 'UPDATER_FETCH_FAILED', path: 'manifest' };
  }

  let manifestValue: unknown;
  try {
    manifestValue = JSON.parse(new TextDecoder().decode(manifestBytes));
  } catch {
    return { ok: false, code: 'UPDATER_FETCH_FAILED', path: 'manifest' };
  }

  const shapeIssues = validateBundleManifest(manifestValue);
  const [firstShapeIssue] = shapeIssues;
  if (firstShapeIssue) {
    return { ok: false, code: firstShapeIssue.code, path: firstShapeIssue.path };
  }
  const manifest = manifestValue as BundleManifest;

  const files = new Map<string, Uint8Array>();
  for (const entry of manifest.files) {
    try {
      files.set(entry.path, await fetchBytes(`${source.fileBaseUrl}/${entry.path}`));
    } catch {
      return { ok: false, code: 'UPDATER_FETCH_FAILED', path: entry.path };
    }
  }

  return { ok: true, manifest, files };
}

export type PlanUpdateReason = 'NOT_NEWER' | 'CHANNEL_MISMATCH' | 'FORMAT_UNSUPPORTED';

export type PlanUpdateResult =
  | { readonly shouldUpdate: true }
  | { readonly shouldUpdate: false; readonly reason: PlanUpdateReason };

export interface PlanUpdateOptions {
  /** The channel this update check is running for; a candidate for a different channel is never "worth it" here. */
  readonly channel: BundleChannel;
  readonly minFormatVersion: number;
  readonly maxFormatVersion: number;
}

/**
 * Pure judgement of "is this candidate worth installing" — never touches the
 * network or the store. `current: null` means no bundle is installed for
 * this channel yet, which always counts as newer (nothing to compare
 * against).
 */
export function planUpdate(
  current: BundleManifest | null,
  candidate: BundleManifest,
  options: PlanUpdateOptions,
): PlanUpdateResult {
  if (candidate.channel !== options.channel) {
    return { shouldUpdate: false, reason: 'CHANNEL_MISMATCH' };
  }
  if (
    candidate.formatVersion < options.minFormatVersion ||
    candidate.formatVersion > options.maxFormatVersion
  ) {
    return { shouldUpdate: false, reason: 'FORMAT_UNSUPPORTED' };
  }
  if (current && compareVersions(candidate.version, current.version) <= 0) {
    return { shouldUpdate: false, reason: 'NOT_NEWER' };
  }
  return { shouldUpdate: true };
}

/**
 * Installs a fetched candidate through the existing verify-then-switch path
 * (`installBundle`, v0.5.0 #2) — this function adapts `FetchBundleSuccess`'s
 * shape into that call, it does not re-implement any of its guarantees.
 * NFR-REL-03 ("update failure never affects the current project or the most
 * recent usable Bundle") already holds because `installBundle` already holds
 * it; this is not a new promise, just this module's own entry point to the
 * same one.
 */
export async function applyUpdate(
  store: BundleStore,
  candidate: FetchBundleSuccess,
  options: VerifyBundleOptions,
): Promise<BundleInstallResult> {
  return installBundle(store, candidate.manifest, candidate.files, options);
}
