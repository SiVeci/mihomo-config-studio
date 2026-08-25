import { isRiskyPattern } from '@mcs/schema-core';
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
 * v0.4.0 #6 adds two more, same technique, covering the two modules that
 * landed after this stage first shipped (#1 `proxy-groups`, #2
 * `rule-providers`): a plaintext `rule-providers` download URL, and a
 * catastrophic-backtracking `proxy-groups` filter/exclude-filter pattern.
 * Deliberately **not** added: `proxy-groups[].url` (the health-check probe
 * address) in plain `http://` — real upstream samples themselves use
 * `http://cp.cloudflare.com/generate_204` as the canonical probe endpoint
 * (vendored v1.19.29 sample, `packages/schema-builtin/modules/proxy-groups/`
 * examples), so flagging it would be a false positive on the single most
 * common value the field ever holds, not a real risk surface.
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
      ...checkRuleProviderPlaintextUrl(document),
      ...checkGroupRiskyFilterPattern(document),
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
 * `type: http` rule-providers fetch a rule file over the network — that file
 * directly drives routing decisions, so a `http://` (not `https://`) URL is
 * a real man-in-the-middle surface: a tampered rule file can silently
 * redirect traffic. Mirrors the `type: file`/`type: inline` exclusion
 * `checkSkipCertVerify`'s own precedent already sets for provider-shaped
 * modules — those two source types have no URL to check at all.
 */
function checkRuleProviderPlaintextUrl(document: MihomoYamlDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const providers = document.getIn(['rule-providers']);
  if (!isRecord(providers)) return issues;

  for (const [name, provider] of Object.entries(providers)) {
    if (!isRecord(provider) || provider.type !== 'http') continue;
    if (typeof provider.url !== 'string' || !provider.url.startsWith('http://')) continue;
    issues.push(
      securityIssue(document, 'security.ruleProviderPlaintextUrl', ['rule-providers', name, 'url']),
    );
  }
  return issues;
}

/**
 * `filter`/`exclude-filter` are regular expressions the Mihomo *kernel*
 * evaluates against every candidate node name — this app never evaluates
 * them itself (NFR-SEC-05), the same boundary `proxy-providers`' own filter
 * fields already established (v0.3.0 #11). `isRiskyPattern()` is a cheap
 * shape heuristic (nested quantifiers/alternation), not a real regex
 * engine, so calling it here carries none of the risk it is warning about.
 */
function checkGroupRiskyFilterPattern(document: MihomoYamlDocument): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const groups = document.getIn(['proxy-groups']);
  if (!Array.isArray(groups)) return issues;

  groups.forEach((group, index) => {
    if (!isRecord(group)) return;
    for (const field of ['filter', 'exclude-filter'] as const) {
      const pattern = group[field];
      if (typeof pattern === 'string' && isRiskyPattern(pattern)) {
        issues.push(
          securityIssue(document, 'security.groupRiskyFilterPattern', [
            'proxy-groups',
            index,
            field,
          ]),
        );
      }
    }
  });
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
