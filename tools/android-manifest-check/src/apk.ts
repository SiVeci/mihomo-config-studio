export interface ApkPermissionCheckResult {
  readonly ok: boolean;
  readonly violations: readonly string[];
}

/** Exact permission names this app is known to legitimately request. */
const ALLOWED_EXACT = new Set(['android.permission.INTERNET']);
/** AndroidX auto-generates one of these per app (package-name-prefixed) for its own broadcast-receiver export declaration — not storage/VPN related. */
const ALLOWED_SUFFIX_PATTERN = /\.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION$/;

const USES_PERMISSION_LINE = /^uses-permission(?:-sdk-23)?:\s*name='([^']+)'/;

/**
 * Parses `aapt2 dump permissions <apk>`'s text output — a pure function;
 * this package never calls `aapt2` itself (`index.ts`'s `--apk-dump` mode
 * reads an already-captured dump file). Only `uses-permission`/
 * `uses-permission-sdk-23` lines are read: a bare `permission:` line
 * declares a *custom* permission this app defines for other apps to
 * request, not one it asks for itself, so it carries no risk this check
 * cares about.
 */
export function extractUsesPermissions(dumpOutput: string): readonly string[] {
  const names: string[] = [];
  for (const rawLine of dumpOutput.split(/\r?\n/)) {
    const match = USES_PERMISSION_LINE.exec(rawLine.trim());
    if (match?.[1]) names.push(match[1]);
  }
  return names;
}

/**
 * Whitelist, not blocklist — deliberately the opposite policy from
 * `checkManifestXml` (FR-AND-06, produced-artifact level). The source-level
 * scan has to tolerate arbitrary manifest content someone might add later,
 * so it blocklists specific known-bad tokens; the APK this app actually
 * ships has a small, fully-known permission set (source manifest + every
 * dependency's own merged-in permissions), so a whitelist here also catches
 * anything unexpected that no blocklist token would have anticipated —
 * exactly the gap source-level scanning cannot close (Capacitor plugins and
 * AndroidX libraries can each contribute permissions the checked-in
 * manifest never mentions). Input shape taken from a real
 * `aapt2 dump permissions` run against this app's own debug APK
 * (v0.1.0-android-evidence.md, re-confirmed against the product shell in
 * v0.6.0 #4).
 */
export function checkApkPermissions(dumpOutput: string): ApkPermissionCheckResult {
  const violations = extractUsesPermissions(dumpOutput).filter(
    (name) => !ALLOWED_EXACT.has(name) && !ALLOWED_SUFFIX_PATTERN.test(name),
  );
  return { ok: violations.length === 0, violations };
}
