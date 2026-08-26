import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DNS_MODULE,
  GENERAL_MODULE,
  INBOUND_MODULE,
  PROXIES_MODULE,
  PROXY_GROUPS_MODULE,
  PROXY_PROVIDERS_MODULE,
  RULE_PROVIDERS_MODULE,
  RULES_MODULE,
  SNIFFER_MODULE,
  SUB_RULES_MODULE,
} from '@mcs/schema-builtin';
import type { SchemaModule } from '@mcs/schema-core';
import { describeSensitivity } from '@mcs/project-format';
import type { McsProject } from '@mcs/project-format';
import { hasBlockingIssues, runPipeline } from '@mcs/validator';
import { MihomoYamlDocument } from '@mcs/yaml-engine';
import { describe, expect, it } from 'vitest';

import {
  ANDROID_TARGET_TEMPLATE,
  BASIC_PROXY_TEMPLATE,
  BUILTIN_TEMPLATES,
  HOME_ROUTER_TEMPLATE,
  PROVIDER_AUTO_SELECT_TEMPLATE,
  RULE_SET_ROUTING_TEMPLATE,
} from './index.js';
import type { Template } from './index.js';

const TEMPLATES_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates');

function readTemplateConfig(template: Template): string {
  return readFileSync(join(TEMPLATES_ROOT, template.configPath), 'utf8');
}

/** All ten P0 modules (v0.4.0 #0 grew this from six) — every template must clear the full pipeline, not just the six the first two templates were written against. */
const MODULES: readonly SchemaModule[] = [
  GENERAL_MODULE,
  DNS_MODULE,
  SNIFFER_MODULE,
  INBOUND_MODULE,
  PROXIES_MODULE,
  PROXY_PROVIDERS_MODULE,
  PROXY_GROUPS_MODULE,
  RULE_PROVIDERS_MODULE,
  RULES_MODULE,
  SUB_RULES_MODULE,
];

describe.each(BUILTIN_TEMPLATES.map((template) => ({ id: template.id, template })))(
  '$id template (PRD §8.8, v0.3.0 #20 / v0.4.0 #16/#17)',
  ({ template }) => {
    it('declares a Mihomo version range referencing ADR-012’s pinned v1.19.29, not an unrelated literal', () => {
      expect(template.mihomo.minVersion).toBe('1.19.29');
      expect(template.mihomo.maxTestedVersion).toBe('1.19.29');
    });

    it('declares at least one target platform', () => {
      expect(template.platforms.length).toBeGreaterThan(0);
    });

    it('its config.yaml exists on disk and parses with no syntax error', () => {
      const text = readTemplateConfig(template);
      const parsed = MihomoYamlDocument.parse(text);
      expect(parsed.document).not.toBeNull();
      expect(parsed.issues.filter((issue) => issue.severity === 'error')).toEqual([]);
    });

    it('passes this repo’s own validation pipeline with no blocking issue — the gate before core-kernel testing (#21)', () => {
      const text = readTemplateConfig(template);
      const parse = MihomoYamlDocument.parse(text);
      const issues = runPipeline({ parse, modules: MODULES });
      expect(hasBlockingIssues(issues)).toBe(false);
    });

    it('any unrecognised section (still-uncovered P1/P2 fields, if any) reads as info-severity unknown-field, never blocks export', () => {
      const text = readTemplateConfig(template);
      const parse = MihomoYamlDocument.parse(text);
      const issues = runPipeline({ parse, modules: MODULES });
      const unknownFieldIssues = issues.filter((issue) => issue.code === 'unknown-field');
      expect(unknownFieldIssues.every((issue) => issue.severity === 'info')).toBe(true);
      expect(unknownFieldIssues.every((issue) => issue.blocking === false)).toBe(true);
    });

    it('never contains a value shaped like a real UUID or private key — only the field-shape a placeholder legitimately has (project-format’s describeSensitivity, PRD §8.8)', () => {
      const text = readTemplateConfig(template);
      // Only `configText` is read by `describeSensitivity`; the rest of
      // `McsProject` is irrelevant to this check, so it is not worth
      // constructing a full fake container for.
      const findings = describeSensitivity({ configText: text } as McsProject);
      const kinds = findings.map((finding) => finding.kind);
      // `subscription-url`/`password` are expected and tolerated: any
      // realistic proxy config has `url:`/`password:`-*shaped* fields
      // regardless of whether their value is real or a placeholder — that
      // heuristic cannot and is not meant to tell the two apart (see its own
      // doc comment in mcsproj.ts). `uuid`/`private-key` are different: they
      // match on the *value's own shape*, so a hit there would mean a value
      // that actually looks like a real credential slipped in.
      expect(kinds).not.toContain('uuid');
      expect(kinds).not.toContain('private-key');
    });
  },
);

describe('BUILTIN_TEMPLATES (PRD §8.8, v0.3.0 #20 / v0.4.0 #16/#17)', () => {
  it('ships all five PRD §8.8 MVP templates — every one of them automatically joins the kernel test matrix (core-test-runner iterates this array directly)', () => {
    expect(BUILTIN_TEMPLATES.map((template) => template.id)).toEqual([
      'basic-proxy',
      'provider-auto-select',
      'home-router',
      'rule-set-routing',
      'android-target',
    ]);
  });
});

describe('provider-auto-select: editing one field leaves an unrelated section byte-exact (E6, PRD §8.3, v0.3.0 #20)', () => {
  it('editing a real, schema-modelled field leaves proxy-groups byte-exact', () => {
    const original = readTemplateConfig(PROVIDER_AUTO_SELECT_TEMPLATE);
    const groupsIndex = original.indexOf('proxy-groups:');
    expect(groupsIndex).toBeGreaterThan(-1);
    const originalGroupsSection = original.slice(groupsIndex);

    const document = MihomoYamlDocument.parse(original).document!;
    document.setScalarIn(['proxy-providers', 'my-subscription', 'interval'], 7200);
    const edited = document.toText();

    expect(edited).not.toBe(original); // sanity: the edit actually happened
    const editedGroupsIndex = edited.indexOf('proxy-groups:');
    expect(edited.slice(editedGroupsIndex)).toBe(originalGroupsSection);
  });

  it('proxy-groups itself round-trips byte-exact with no edit at all', () => {
    const original = readTemplateConfig(PROVIDER_AUTO_SELECT_TEMPLATE);
    const document = MihomoYamlDocument.parse(original).document!;
    expect(document.toText()).toBe(original);
  });
});

describe('basic-proxy: real P0 proxy fields are correctly modelled (v0.3.0 #20)', () => {
  it('both proxies are recognised (not unknown) — a real regression fence for the shape this template uses', () => {
    const text = readTemplateConfig(BASIC_PROXY_TEMPLATE);
    const parse = MihomoYamlDocument.parse(text);
    const issues = runPipeline({ parse, modules: MODULES });
    const unknownProxyFields = issues.filter(
      (issue) => issue.code === 'unknown-field' && issue.path?.[0] === 'proxies',
    );
    expect(unknownProxyFields).toEqual([]);
  });
});

describe('home-router: TUN + allow-lan + bind-address is the core, with the expected security warning (v0.4.0 #16)', () => {
  it('enables tun and allow-lan — the two fields the version doc names as this template’s core', () => {
    const text = readTemplateConfig(HOME_ROUTER_TEMPLATE);
    const document = MihomoYamlDocument.parse(text).document!;
    expect(document.getIn(['tun', 'enable'])).toBe(true);
    expect(document.getIn(['allow-lan'])).toBe(true);
  });

  it('flags allow-lan + wildcard bind-address as a non-blocking security warning — expected, not something to silence by editing the template or the check', () => {
    const text = readTemplateConfig(HOME_ROUTER_TEMPLATE);
    const parse = MihomoYamlDocument.parse(text);
    const issues = runPipeline({ parse, modules: MODULES });
    const warning = issues.find((issue) => issue.code === 'security.allowLanWildcardBind');
    expect(warning).toMatchObject({ severity: 'warning', blocking: false });
    expect(hasBlockingIssues(issues)).toBe(false);
  });
});

describe('android-target: a plain Mihomo YAML with platforms: ["android"], no new produced format (E9, v0.4.0 #17)', () => {
  it('targets only android — the version doc’s own scoping for this template', () => {
    expect(ANDROID_TARGET_TEMPLATE.platforms).toEqual(['android']);
  });

  it('enables tun — the field this template is built around (E9)', () => {
    const text = readTemplateConfig(ANDROID_TARGET_TEMPLATE);
    const document = MihomoYamlDocument.parse(text).document!;
    expect(document.getIn(['tun', 'enable'])).toBe(true);
  });

  // The plan text for this slice predicted a security warning here (by analogy
  // with #16's home-router template, on the theory that `tun.enable`/
  // `tun.auto-redirect`'s `safety: 'caution'` tag in `inbound/ui.schema.json`
  // implies a `securityStage` check). It does not: `safety: 'caution'` is
  // form-rendering metadata only (a caution icon next to the field), and
  // `packages/validator/src/security.ts`'s five real checks
  // (`checkAllowLanWildcardBind`/`checkControllerWithoutSecret`/
  // `checkSkipCertVerify`/`checkRuleProviderPlaintextUrl`/
  // `checkGroupRiskyFilterPattern`) never look at `tun.*` at all — confirmed
  // by reading the file, not assumed. Corrected in the plan's own "执行时决策"
  // notes rather than writing a test that would either fail or vacuously pass
  // against a check that does not exist.
  it('has zero blocking issues and, unlike home-router, no security warning either — tun fields have no validator-level check today', () => {
    const text = readTemplateConfig(ANDROID_TARGET_TEMPLATE);
    const parse = MihomoYamlDocument.parse(text);
    const issues = runPipeline({ parse, modules: MODULES });
    expect(hasBlockingIssues(issues)).toBe(false);
    expect(issues.filter((issue) => issue.module === 'security')).toEqual([]);
  });
});

describe('rule-set-routing: a real format: mrs + behavior: domain entry (v0.4.0 #16, kernel-test vehicle for #17)', () => {
  it('contains at least one rule-providers entry using format: mrs with behavior: domain', () => {
    const text = readTemplateConfig(RULE_SET_ROUTING_TEMPLATE);
    const value = MihomoYamlDocument.parse(text).document!.toJS() as {
      'rule-providers': Record<string, { format?: string; behavior?: string }>;
    };
    const entries = Object.values(value['rule-providers']);
    expect(entries.some((entry) => entry.format === 'mrs' && entry.behavior === 'domain')).toBe(
      true,
    );
  });

  it('every RULE-SET rule references a real rule-providers entry — no missing-reference issue', () => {
    const text = readTemplateConfig(RULE_SET_ROUTING_TEMPLATE);
    const parse = MihomoYamlDocument.parse(text);
    const issues = runPipeline({ parse, modules: MODULES });
    expect(issues.some((issue) => issue.code.startsWith('reference.missing'))).toBe(false);
  });
});
