import type { Platform } from '@mcs/schema-core';

import basicProxyManifest from '../templates/basic-proxy/template.manifest.json';
import providerAutoSelectManifest from '../templates/provider-auto-select/template.manifest.json';

/**
 * A built-in project template (PRD §8.8): starter project content a user
 * can begin a new project from. Templates are pure data — this package's
 * job is describing what exists and where its own `config.yaml` lives, not
 * loading or applying one; that is a consuming app's concern. `configPath`
 * is a relative path rather than bundled content for the same reason
 * `@mcs/schema-builtin`'s own `ModuleExample.path` is: `packages/**`
 * forbids `node:fs`, and PRD §8.8's last requirement ("模板更新可以随签名
 * Schema Bundle 发布") means this data must stay convertible into a signed
 * Bundle's on-disk shape without a rewrite, the same reasoning
 * `schema-builtin/src/index.ts`'s own doc comment gives for assembling
 * from JSON rather than hand-written TS literals.
 */
export interface Template {
  id: string;
  version: string;
  /** Relative to this package's own `templates/<id>/` directory. */
  configPath: string;
  /** ADR-012: every template targets the same single pinned Mihomo version `@mcs/schema-builtin`'s six P0 modules do — not a per-template choice. */
  mihomo: {
    minVersion: string;
    maxTestedVersion: string;
  };
  platforms: readonly Platform[];
}

export const BASIC_PROXY_TEMPLATE: Template = {
  ...(basicProxyManifest as Omit<Template, 'configPath'>),
  configPath: 'basic-proxy/config.yaml',
};

export const PROVIDER_AUTO_SELECT_TEMPLATE: Template = {
  ...(providerAutoSelectManifest as Omit<Template, 'configPath'>),
  configPath: 'provider-auto-select/config.yaml',
};

/**
 * PRD §8.8 MVP lists five templates; this version ships only the first two
 * (version doc: "本版本 1–2 个"). The remaining three — Android generation
 * target, home router, rule-collection routing — need the `rules`/
 * `rule-providers` modules (v0.4.0) and are deliberately not here yet
 * (`docs/requirements-traceability.md` §8.8 records them as Todo with that
 * dependency, not silently dropped).
 */
export const BUILTIN_TEMPLATES: readonly Template[] = [
  BASIC_PROXY_TEMPLATE,
  PROVIDER_AUTO_SELECT_TEMPLATE,
];
