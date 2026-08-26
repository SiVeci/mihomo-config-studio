import type { Platform } from '@mcs/schema-core';

import basicProxyManifest from '../templates/basic-proxy/template.manifest.json' with { type: 'json' };
import homeRouterManifest from '../templates/home-router/template.manifest.json' with { type: 'json' };
import providerAutoSelectManifest from '../templates/provider-auto-select/template.manifest.json' with { type: 'json' };
import ruleSetRoutingManifest from '../templates/rule-set-routing/template.manifest.json' with { type: 'json' };

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
  /** ADR-012: every template targets the same single pinned Mihomo version `@mcs/schema-builtin`'s P0 modules do — not a per-template choice. */
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

export const HOME_ROUTER_TEMPLATE: Template = {
  ...(homeRouterManifest as Omit<Template, 'configPath'>),
  configPath: 'home-router/config.yaml',
};

export const RULE_SET_ROUTING_TEMPLATE: Template = {
  ...(ruleSetRoutingManifest as Omit<Template, 'configPath'>),
  configPath: 'rule-set-routing/config.yaml',
};

/**
 * PRD §8.8 MVP lists five templates; this version adds two more (v0.4.0
 * #16) now that `rules`/`rule-providers`/`proxy-groups` exist to build them
 * on. The remaining one — Android generation target — needs no new module
 * (E9: a plain Mihomo YAML with `platforms: ["android"]`, not a new produced
 * format), it is scoped to #17 alongside wiring all five into the kernel
 * test matrix.
 */
export const BUILTIN_TEMPLATES: readonly Template[] = [
  BASIC_PROXY_TEMPLATE,
  PROVIDER_AUTO_SELECT_TEMPLATE,
  HOME_ROUTER_TEMPLATE,
  RULE_SET_ROUTING_TEMPLATE,
];
