import type { MihomoYamlDocument } from '@mcs/yaml-engine';

import type { ValidationIssue } from './issue.js';
import type { ValidationStage } from './pipeline.js';

export const SECURITY_STAGE_ID = 'security';

/**
 * Three checks the version doc names explicitly (PRD §8.7 pipeline stage 6,
 * FR-VAL-04). Each reads Schema-declared `safety` metadata as its
 * *justification* (`allow-lan`/`bind-address`/`external-controller`/`secret`
 * are `general`'s own `caution`-tagged fields; `skip-cert-verify` is
 * `proxies`/`proxy-providers`' only `dangerous`-tagged one — see those
 * modules' `ui.schema.json`), not as a live lookup: `proxies`/`proxy-providers`
 * are array/map-of-discriminated-entries in the real document, and
 * `buildFormPlan` cannot walk that shape yet (the same #9-#12 gap deferred
 * to #14) — so a fully generic "scan every module's `safety`-tagged fields
 * through its own plan" would silently never fire for the one `dangerous`
 * field that exists today. These three checks read the parsed document
 * directly instead, which works regardless of that gap. A more generic,
 * metadata-driven mechanism is a natural extension once #14 makes per-entry
 * planning for array/map-shaped modules a solved problem — not needed for
 * these three, already-concrete checks.
 *
 * Severity is always `warning`: a security concern must never force a user
 * into the invalid-draft export path just to get past it (FR-YAML-07 would
 * otherwise turn a warning into a worse outcome than the risk itself).
 */
export const securityStage: ValidationStage = {
  id: SECURITY_STAGE_ID,
  run: (ctx) => {
    const { document } = ctx.parse;
    if (!document) return [];

    return [
      ...checkAllowLanWildcardBind(document),
      ...checkControllerWithoutSecret(document),
      ...checkSkipCertVerify(document),
    ];
  },
};

function checkAllowLanWildcardBind(document: MihomoYamlDocument): ValidationIssue[] {
  if (document.getIn(['allow-lan']) !== true) return [];
  const bindAddress = document.getIn(['bind-address']);
  // "*" is bind-address's own schema default (general/config.schema.json) —
  // an absent key behaves exactly like an explicit "*".
  if (bindAddress !== undefined && bindAddress !== '*') return [];
  return [securityIssue(document, 'security.allowLanWildcardBind', ['bind-address'])];
}

function checkControllerWithoutSecret(document: MihomoYamlDocument): ValidationIssue[] {
  const hasController =
    isNonEmptyString(document.getIn(['external-controller'])) ||
    isNonEmptyString(document.getIn(['external-controller-tls']));
  if (!hasController) return [];
  if (isNonEmptyString(document.getIn(['secret']))) return [];
  return [securityIssue(document, 'security.controllerWithoutSecret', ['secret'])];
}

function checkSkipCertVerify(document: MihomoYamlDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const proxies = document.getIn(['proxies']);
  if (Array.isArray(proxies)) {
    proxies.forEach((entry, index) => {
      if (isRecord(entry) && entry['skip-cert-verify'] === true) {
        issues.push(
          securityIssue(document, 'security.skipCertVerify', [
            'proxies',
            index,
            'skip-cert-verify',
          ]),
        );
      }
    });
  }

  const providers = document.getIn(['proxy-providers']);
  if (isRecord(providers)) {
    for (const [name, provider] of Object.entries(providers)) {
      if (
        isRecord(provider) &&
        isRecord(provider.override) &&
        provider.override['skip-cert-verify'] === true
      ) {
        issues.push(
          securityIssue(document, 'security.skipCertVerify', [
            'proxy-providers',
            name,
            'override',
            'skip-cert-verify',
          ]),
        );
      }
    }
  }

  return issues;
}

/**
 * Never carries `messageParams` — every one of these three checks would
 * otherwise be tempted to explain itself with the controller address or the
 * node name involved, which is exactly what NFR-SEC-03 forbids. The path
 * alone is enough for the UI to point at the field; the message text itself
 * lives in i18n resources, keyed only by `messageKey`.
 */
function securityIssue(
  document: MihomoYamlDocument,
  messageKey: string,
  path: (string | number)[],
): ValidationIssue {
  const range = document.locate(path) ?? undefined;
  return {
    severity: 'warning',
    code: messageKey,
    module: 'security',
    messageKey,
    path,
    ...(range !== undefined ? { range } : {}),
    blocking: false,
  };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
