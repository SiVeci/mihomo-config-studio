import type {
  JsonSchema,
  ModuleExample,
  ModuleI18n,
  ModuleManifest,
  SchemaModule,
  UiSchema,
  ValidationRule,
} from '@mcs/schema-core';

import dnsConfigSchema from '../modules/dns/config.schema.json';
import dnsEn from '../modules/dns/i18n/en.json';
import dnsZhCN from '../modules/dns/i18n/zh-CN.json';
import dnsManifest from '../modules/dns/module.manifest.json';
import dnsUiSchema from '../modules/dns/ui.schema.json';
import dnsRules from '../modules/dns/validation.rules.json';
import generalConfigSchema from '../modules/general/config.schema.json';
import generalEn from '../modules/general/i18n/en.json';
import generalZhCN from '../modules/general/i18n/zh-CN.json';
import generalManifest from '../modules/general/module.manifest.json';
import generalUiSchema from '../modules/general/ui.schema.json';
import generalRules from '../modules/general/validation.rules.json';
import inboundConfigSchema from '../modules/inbound/config.schema.json';
import inboundEn from '../modules/inbound/i18n/en.json';
import inboundZhCN from '../modules/inbound/i18n/zh-CN.json';
import inboundManifest from '../modules/inbound/module.manifest.json';
import inboundUiSchema from '../modules/inbound/ui.schema.json';
import inboundRules from '../modules/inbound/validation.rules.json';
import proxiesConfigSchema from '../modules/proxies/config.schema.json';
import proxiesEn from '../modules/proxies/i18n/en.json';
import proxiesZhCN from '../modules/proxies/i18n/zh-CN.json';
import proxiesManifest from '../modules/proxies/module.manifest.json';
import proxiesUiSchema from '../modules/proxies/ui.schema.json';
import proxiesRules from '../modules/proxies/validation.rules.json';
import proxyGroupsConfigSchema from '../modules/proxy-groups/config.schema.json';
import proxyGroupsEn from '../modules/proxy-groups/i18n/en.json';
import proxyGroupsZhCN from '../modules/proxy-groups/i18n/zh-CN.json';
import proxyGroupsManifest from '../modules/proxy-groups/module.manifest.json';
import proxyGroupsUiSchema from '../modules/proxy-groups/ui.schema.json';
import proxyGroupsRules from '../modules/proxy-groups/validation.rules.json';
import proxyProvidersConfigSchema from '../modules/proxy-providers/config.schema.json';
import proxyProvidersEn from '../modules/proxy-providers/i18n/en.json';
import proxyProvidersZhCN from '../modules/proxy-providers/i18n/zh-CN.json';
import proxyProvidersManifest from '../modules/proxy-providers/module.manifest.json';
import proxyProvidersUiSchema from '../modules/proxy-providers/ui.schema.json';
import proxyProvidersRules from '../modules/proxy-providers/validation.rules.json';
import ruleProvidersConfigSchema from '../modules/rule-providers/config.schema.json';
import ruleProvidersEn from '../modules/rule-providers/i18n/en.json';
import ruleProvidersZhCN from '../modules/rule-providers/i18n/zh-CN.json';
import ruleProvidersManifest from '../modules/rule-providers/module.manifest.json';
import ruleProvidersUiSchema from '../modules/rule-providers/ui.schema.json';
import ruleProvidersRules from '../modules/rule-providers/validation.rules.json';
import snifferConfigSchema from '../modules/sniffer/config.schema.json';
import snifferEn from '../modules/sniffer/i18n/en.json';
import snifferZhCN from '../modules/sniffer/i18n/zh-CN.json';
import snifferManifest from '../modules/sniffer/module.manifest.json';
import snifferUiSchema from '../modules/sniffer/ui.schema.json';
import snifferRules from '../modules/sniffer/validation.rules.json';

/**
 * Every module lives on disk as the same seven-file set `schema-cli pack`
 * will eventually sign and ship (ADR-020): `module.manifest.json`,
 * `config.schema.json`, `ui.schema.json`, `validation.rules.json`,
 * `i18n/{zh-CN,en}.json`, `examples/*.yaml`. Assembling them here, in code,
 * rather than hand-writing a `SchemaModule` literal is what keeps this
 * package's own content identical in shape to what a downloaded Bundle will
 * carry — writing it as TS would mean converting at release time, and that
 * conversion step is exactly where "a Bundle is only ever data" would stop
 * being checkable. `examples/*.yaml` are not imported here: `packages/**`
 * forbids `node:fs`, and only test code needs their content
 * (`builtin.test.ts`).
 */
const GENERAL_EXAMPLES: ModuleExample[] = [
  { name: 'valid', kind: 'valid', path: 'examples/valid.yaml' },
  { name: 'invalid', kind: 'invalid', path: 'examples/invalid.yaml' },
  { name: 'edge', kind: 'edge', path: 'examples/edge.yaml' },
  { name: 'unknown-fields', kind: 'unknown-fields', path: 'examples/unknown-fields.yaml' },
];

export const GENERAL_MODULE: SchemaModule = {
  manifest: generalManifest as ModuleManifest,
  schema: generalConfigSchema as JsonSchema,
  ui: generalUiSchema as UiSchema,
  rules: generalRules as ValidationRule[],
  examples: GENERAL_EXAMPLES,
  i18n: { 'zh-CN': generalZhCN, en: generalEn } as ModuleI18n,
};

const DNS_EXAMPLES: ModuleExample[] = [
  { name: 'valid', kind: 'valid', path: 'examples/valid.yaml' },
  { name: 'invalid', kind: 'invalid', path: 'examples/invalid.yaml' },
  { name: 'edge', kind: 'edge', path: 'examples/edge.yaml' },
  { name: 'unknown-fields', kind: 'unknown-fields', path: 'examples/unknown-fields.yaml' },
];

export const DNS_MODULE: SchemaModule = {
  manifest: dnsManifest as ModuleManifest,
  schema: dnsConfigSchema as JsonSchema,
  ui: dnsUiSchema as UiSchema,
  rules: dnsRules as ValidationRule[],
  examples: DNS_EXAMPLES,
  i18n: { 'zh-CN': dnsZhCN, en: dnsEn } as ModuleI18n,
};

const SNIFFER_EXAMPLES: ModuleExample[] = [
  { name: 'valid', kind: 'valid', path: 'examples/valid.yaml' },
  { name: 'invalid', kind: 'invalid', path: 'examples/invalid.yaml' },
  { name: 'edge', kind: 'edge', path: 'examples/edge.yaml' },
  { name: 'unknown-fields', kind: 'unknown-fields', path: 'examples/unknown-fields.yaml' },
];

export const SNIFFER_MODULE: SchemaModule = {
  manifest: snifferManifest as ModuleManifest,
  schema: snifferConfigSchema as JsonSchema,
  ui: snifferUiSchema as UiSchema,
  rules: snifferRules as ValidationRule[],
  examples: SNIFFER_EXAMPLES,
  i18n: { 'zh-CN': snifferZhCN, en: snifferEn } as ModuleI18n,
};

const INBOUND_EXAMPLES: ModuleExample[] = [
  { name: 'valid', kind: 'valid', path: 'examples/valid.yaml' },
  { name: 'invalid', kind: 'invalid', path: 'examples/invalid.yaml' },
  { name: 'edge', kind: 'edge', path: 'examples/edge.yaml' },
  { name: 'unknown-fields', kind: 'unknown-fields', path: 'examples/unknown-fields.yaml' },
];

export const INBOUND_MODULE: SchemaModule = {
  manifest: inboundManifest as ModuleManifest,
  schema: inboundConfigSchema as JsonSchema,
  ui: inboundUiSchema as UiSchema,
  rules: inboundRules as ValidationRule[],
  examples: INBOUND_EXAMPLES,
  i18n: { 'zh-CN': inboundZhCN, en: inboundEn } as ModuleI18n,
};

const PROXIES_EXAMPLES: ModuleExample[] = [
  { name: 'valid', kind: 'valid', path: 'examples/valid.yaml' },
  { name: 'invalid', kind: 'invalid', path: 'examples/invalid.yaml' },
  { name: 'edge', kind: 'edge', path: 'examples/edge.yaml' },
  { name: 'unknown-fields', kind: 'unknown-fields', path: 'examples/unknown-fields.yaml' },
];

/**
 * Unlike every other module here, `config.schema.json` describes ONE
 * `proxies[]` array element (the `oneOf` discriminated union itself, at the
 * schema's own root) rather than the array — `buildFormPlan` only detects a
 * union on a *named field* (`planField`'s job), never at the root a module
 * plans directly, and modelling a fake wrapper key just to fit that would
 * make this module's schema stop matching what a real element looks like on
 * disk. `manifest.root: ['proxies']` still records the document path this
 * module owns; turning "one element's plan" into "N rendered forms with
 * `proxies.<i>.` prefixed paths" is left to whichever slice actually
 * iterates the array (#14), same as the `general`/`inbound` shared-root gap.
 */
export const PROXIES_MODULE: SchemaModule = {
  manifest: proxiesManifest as ModuleManifest,
  schema: proxiesConfigSchema as JsonSchema,
  ui: proxiesUiSchema as UiSchema,
  rules: proxiesRules as ValidationRule[],
  examples: PROXIES_EXAMPLES,
  i18n: { 'zh-CN': proxiesZhCN, en: proxiesEn } as ModuleI18n,
};

const PROXY_PROVIDERS_EXAMPLES: ModuleExample[] = [
  { name: 'valid', kind: 'valid', path: 'examples/valid.yaml' },
  { name: 'invalid', kind: 'invalid', path: 'examples/invalid.yaml' },
  { name: 'edge', kind: 'edge', path: 'examples/edge.yaml' },
  { name: 'unknown-fields', kind: 'unknown-fields', path: 'examples/unknown-fields.yaml' },
];

/**
 * Same structural situation as `PROXIES_MODULE`: `proxy-providers:` is a real
 * document map (keyed by arbitrary provider name, e.g. `provider1:`), not an
 * object this module's own schema could declare `properties` for — so
 * `config.schema.json` describes ONE provider entry's discriminated union
 * (`type: http | file | inline`) at its own root. `manifest.root:
 * ['proxy-providers']` still records the path this module owns; turning
 * "one entry's plan" into "N rendered forms keyed by provider name" is left
 * to #14, same as `PROXIES_MODULE`.
 */
export const PROXY_PROVIDERS_MODULE: SchemaModule = {
  manifest: proxyProvidersManifest as ModuleManifest,
  schema: proxyProvidersConfigSchema as JsonSchema,
  ui: proxyProvidersUiSchema as UiSchema,
  rules: proxyProvidersRules as ValidationRule[],
  examples: PROXY_PROVIDERS_EXAMPLES,
  i18n: { 'zh-CN': proxyProvidersZhCN, en: proxyProvidersEn } as ModuleI18n,
};

const PROXY_GROUPS_EXAMPLES: ModuleExample[] = [
  { name: 'valid', kind: 'valid', path: 'examples/valid.yaml' },
  { name: 'invalid', kind: 'invalid', path: 'examples/invalid.yaml' },
  { name: 'edge', kind: 'edge', path: 'examples/edge.yaml' },
  { name: 'unknown-fields', kind: 'unknown-fields', path: 'examples/unknown-fields.yaml' },
];

/**
 * Same structural situation as `PROXIES_MODULE`/`PROXY_PROVIDERS_MODULE`:
 * `proxy-groups:` is a real document *list* (not a map — groups are keyed by
 * their own `name` field, not a document key), so `config.schema.json`
 * describes ONE group entry's discriminated union (`type: select | url-test
 * | fallback | load-balance`) at its own root. `manifest.root:
 * ['proxy-groups']` still records the path this module owns; turning "one
 * entry's plan" into "N rendered forms" is #7's concern (v0.4.0), same as
 * how #14 did it for `proxies`/`proxy-providers` in v0.3.0.
 */
export const PROXY_GROUPS_MODULE: SchemaModule = {
  manifest: proxyGroupsManifest as ModuleManifest,
  schema: proxyGroupsConfigSchema as JsonSchema,
  ui: proxyGroupsUiSchema as UiSchema,
  rules: proxyGroupsRules as ValidationRule[],
  examples: PROXY_GROUPS_EXAMPLES,
  i18n: { 'zh-CN': proxyGroupsZhCN, en: proxyGroupsEn } as ModuleI18n,
};

const RULE_PROVIDERS_EXAMPLES: ModuleExample[] = [
  { name: 'valid', kind: 'valid', path: 'examples/valid.yaml' },
  { name: 'invalid', kind: 'invalid', path: 'examples/invalid.yaml' },
  { name: 'edge', kind: 'edge', path: 'examples/edge.yaml' },
  { name: 'unknown-fields', kind: 'unknown-fields', path: 'examples/unknown-fields.yaml' },
];

/**
 * Same structural situation as `PROXY_PROVIDERS_MODULE`: `rule-providers:` is
 * a document map (keyed by arbitrary rule-set name, e.g. `rule1:`), so
 * `config.schema.json` describes ONE entry's discriminated union (`type:
 * http | file | inline`) at its own root. `manifest.root:
 * ['rule-providers']` still records the path this module owns.
 * `validation.rules.json` carries the `format: mrs` -> `behavior` prereq #0
 * closed (docs/upstream-divergences.md, two independent sources).
 */
export const RULE_PROVIDERS_MODULE: SchemaModule = {
  manifest: ruleProvidersManifest as ModuleManifest,
  schema: ruleProvidersConfigSchema as JsonSchema,
  ui: ruleProvidersUiSchema as UiSchema,
  rules: ruleProvidersRules as ValidationRule[],
  examples: RULE_PROVIDERS_EXAMPLES,
  i18n: { 'zh-CN': ruleProvidersZhCN, en: ruleProvidersEn } as ModuleI18n,
};

/** Every module this package currently ships, keyed by the bundle file path `schema-registry`'s `StoredBundle.files` will use. */
export const BUILTIN_MODULE_FILES: Readonly<Record<string, SchemaModule>> = {
  'modules/general.json': GENERAL_MODULE,
  'modules/dns.json': DNS_MODULE,
  'modules/sniffer.json': SNIFFER_MODULE,
  'modules/inbound.json': INBOUND_MODULE,
  'modules/proxies.json': PROXIES_MODULE,
  'modules/proxy-providers.json': PROXY_PROVIDERS_MODULE,
  'modules/proxy-groups.json': PROXY_GROUPS_MODULE,
  'modules/rule-providers.json': RULE_PROVIDERS_MODULE,
};
