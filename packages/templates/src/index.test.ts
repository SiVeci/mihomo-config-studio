import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DNS_MODULE,
  GENERAL_MODULE,
  INBOUND_MODULE,
  PROXIES_MODULE,
  PROXY_PROVIDERS_MODULE,
  SNIFFER_MODULE,
} from '@mcs/schema-builtin';
import type { SchemaModule } from '@mcs/schema-core';
import { describeSensitivity } from '@mcs/project-format';
import type { McsProject } from '@mcs/project-format';
import { hasBlockingIssues, runPipeline } from '@mcs/validator';
import { MihomoYamlDocument } from '@mcs/yaml-engine';
import { describe, expect, it } from 'vitest';

import { BASIC_PROXY_TEMPLATE, BUILTIN_TEMPLATES, PROVIDER_AUTO_SELECT_TEMPLATE } from './index.js';
import type { Template } from './index.js';

const TEMPLATES_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates');

function readTemplateConfig(template: Template): string {
  return readFileSync(join(TEMPLATES_ROOT, template.configPath), 'utf8');
}

const MODULES: readonly SchemaModule[] = [
  GENERAL_MODULE,
  DNS_MODULE,
  SNIFFER_MODULE,
  INBOUND_MODULE,
  PROXIES_MODULE,
  PROXY_PROVIDERS_MODULE,
];

describe.each(BUILTIN_TEMPLATES.map((template) => ({ id: template.id, template })))(
  '$id template (PRD §8.8, v0.3.0 #20)',
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

    it('any unrecognised (P1/P2, e.g. proxy-groups) section reads as info-severity unknown-field, never blocks export', () => {
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

describe('BUILTIN_TEMPLATES (PRD §8.8, v0.3.0 #20)', () => {
  it('ships exactly the two templates this version commits to — the version doc says "1–2 个", not all five MVP templates', () => {
    expect(BUILTIN_TEMPLATES.map((template) => template.id)).toEqual([
      'basic-proxy',
      'provider-auto-select',
    ]);
  });
});

describe('provider-auto-select: proxy-groups is unmodelled data, preserved losslessly (E6, PRD §8.3, v0.3.0 #20)', () => {
  it('editing a real, schema-modelled field leaves the unmodelled proxy-groups section byte-exact', () => {
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
