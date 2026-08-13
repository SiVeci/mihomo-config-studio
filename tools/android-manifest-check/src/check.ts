export interface ManifestCheckResult {
  readonly ok: boolean;
  readonly violations: readonly string[];
}

const FORBIDDEN_TOKENS: ReadonlyArray<{ readonly pattern: RegExp; readonly reason: string }> = [
  {
    pattern: /BIND_VPN_SERVICE/,
    reason: 'declares BIND_VPN_SERVICE (VPN service binding permission)',
  },
  {
    pattern: /android\.net\.VpnService/,
    reason: 'declares an android.net.VpnService intent-filter action',
  },
  {
    pattern: /FOREGROUND_SERVICE\w*/,
    reason: 'declares a FOREGROUND_SERVICE* permission',
  },
];

/**
 * Source-level scan for FR-AND-06 / NG-02 (PRD §13.5 release blocker): the
 * manifest must never gain VPN capability, in any form. Plain substring/regex
 * matching is deliberate — this is a release gate, so a false positive on a
 * stray comment is preferable to missing a real declaration.
 */
export function checkManifestXml(xml: string): ManifestCheckResult {
  const violations = FORBIDDEN_TOKENS.filter(({ pattern }) => pattern.test(xml)).map(
    ({ reason }) => reason,
  );
  return { ok: violations.length === 0, violations };
}
