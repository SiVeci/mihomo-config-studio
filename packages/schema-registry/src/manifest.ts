/**
 * A Bundle packages several `@mcs/schema-core` modules together for
 * distribution. This is a distinct, outer layer from `ModuleManifest`
 * (one module's own id/root/version) — a `BundleManifest` never embeds a
 * module manifest directly, it only lists the files a bundle carries and
 * lets the Bundle installer verify them before any module is read.
 */
export type BundleChannel = 'stable' | 'beta';

export interface BundleFileEntry {
  readonly path: string;
  readonly sha256: string;
}

/**
 * The Mihomo core version range this Bundle's content was authored and
 * verified against (PRD §8.9 reference structure, ADR-012). Required, not
 * optional: a Bundle with no declared upstream basis has no way for the
 * installer or a maintainer to know what it was checked against.
 */
export interface BundleManifestMihomoInfo {
  readonly minVersion: string;
  readonly maxTestedVersion: string;
  /** Commit SHA of the upstream tag this Bundle's content was verified against. */
  readonly upstreamCommit: string;
  /** Date the upstream docs/source were checked, `YYYY-MM-DD`. */
  readonly docsSnapshot: string;
}

export interface BundleManifest {
  readonly bundleId: string;
  readonly version: string;
  readonly channel: BundleChannel;
  readonly formatVersion: number;
  readonly requiresApp: string;
  readonly mihomo: BundleManifestMihomoInfo;
  readonly files: readonly BundleFileEntry[];
  readonly signature: string;
  readonly signedAt: string;
}

export type BundleManifestIssueCode =
  'BUNDLE_MANIFEST_MISSING_FIELD' | 'BUNDLE_MANIFEST_INVALID_TYPE';

/** Never carries a message: only a stable code and where it happened (NFR-SEC-03). */
export interface BundleManifestIssue {
  readonly code: BundleManifestIssueCode;
  readonly path: string;
}

const CHANNELS: readonly BundleChannel[] = ['stable', 'beta'];

/**
 * Structural validation only: are the required fields present and of the
 * right shape? Whether `formatVersion`/`requiresApp` are within a range this
 * build actually supports is a business-rule check made against the running
 * app, not a shape fact — that belongs to the installer (#8), not here.
 */
export function validateBundleManifest(value: unknown): BundleManifestIssue[] {
  if (!isRecord(value)) {
    return [{ code: 'BUNDLE_MANIFEST_INVALID_TYPE', path: '$' }];
  }

  const issues: BundleManifestIssue[] = [];
  checkString(value.bundleId, 'bundleId', issues);
  checkString(value.version, 'version', issues);
  checkChannel(value.channel, issues);
  checkFormatVersion(value.formatVersion, issues);
  checkString(value.requiresApp, 'requiresApp', issues);
  checkMihomo(value.mihomo, issues);
  checkFiles(value.files, issues);
  checkString(value.signature, 'signature', issues);
  checkString(value.signedAt, 'signedAt', issues);
  return issues;
}

export function isBundleManifest(value: unknown): value is BundleManifest {
  return validateBundleManifest(value).length === 0;
}

function checkString(value: unknown, path: string, issues: BundleManifestIssue[]): void {
  if (value === undefined) {
    issues.push({ code: 'BUNDLE_MANIFEST_MISSING_FIELD', path });
    return;
  }
  if (typeof value !== 'string' || value === '') {
    issues.push({ code: 'BUNDLE_MANIFEST_INVALID_TYPE', path });
  }
}

function checkChannel(value: unknown, issues: BundleManifestIssue[]): void {
  if (value === undefined) {
    issues.push({ code: 'BUNDLE_MANIFEST_MISSING_FIELD', path: 'channel' });
    return;
  }
  if (typeof value !== 'string' || !CHANNELS.includes(value as BundleChannel)) {
    issues.push({ code: 'BUNDLE_MANIFEST_INVALID_TYPE', path: 'channel' });
  }
}

function checkFormatVersion(value: unknown, issues: BundleManifestIssue[]): void {
  if (value === undefined) {
    issues.push({ code: 'BUNDLE_MANIFEST_MISSING_FIELD', path: 'formatVersion' });
    return;
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    issues.push({ code: 'BUNDLE_MANIFEST_INVALID_TYPE', path: 'formatVersion' });
  }
}

function checkMihomo(value: unknown, issues: BundleManifestIssue[]): void {
  if (value === undefined) {
    issues.push({ code: 'BUNDLE_MANIFEST_MISSING_FIELD', path: 'mihomo' });
    return;
  }
  if (!isRecord(value)) {
    issues.push({ code: 'BUNDLE_MANIFEST_INVALID_TYPE', path: 'mihomo' });
    return;
  }
  checkString(value.minVersion, 'mihomo.minVersion', issues);
  checkString(value.maxTestedVersion, 'mihomo.maxTestedVersion', issues);
  checkString(value.upstreamCommit, 'mihomo.upstreamCommit', issues);
  checkString(value.docsSnapshot, 'mihomo.docsSnapshot', issues);
}

function checkFiles(value: unknown, issues: BundleManifestIssue[]): void {
  if (value === undefined) {
    issues.push({ code: 'BUNDLE_MANIFEST_MISSING_FIELD', path: 'files' });
    return;
  }
  if (!Array.isArray(value)) {
    issues.push({ code: 'BUNDLE_MANIFEST_INVALID_TYPE', path: 'files' });
    return;
  }
  value.forEach((entry, index) => {
    if (!isRecord(entry)) {
      issues.push({ code: 'BUNDLE_MANIFEST_INVALID_TYPE', path: `files[${index}]` });
      return;
    }
    checkString(entry.path, `files[${index}].path`, issues);
    checkString(entry.sha256, `files[${index}].sha256`, issues);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
