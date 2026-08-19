import type {
  JsonSchema,
  ModuleExample,
  ModuleI18n,
  ModuleManifest,
  SchemaModule,
  UiSchema,
  ValidationRule,
} from '@mcs/schema-core';

import generalConfigSchema from '../modules/general/config.schema.json';
import generalEn from '../modules/general/i18n/en.json';
import generalZhCN from '../modules/general/i18n/zh-CN.json';
import generalManifest from '../modules/general/module.manifest.json';
import generalUiSchema from '../modules/general/ui.schema.json';
import generalRules from '../modules/general/validation.rules.json';

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

/** Every module this package currently ships, keyed by the bundle file path `schema-registry`'s `StoredBundle.files` will use. */
export const BUILTIN_MODULE_FILES: Readonly<Record<string, SchemaModule>> = {
  'modules/general.json': GENERAL_MODULE,
};
