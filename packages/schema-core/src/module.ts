import type { MessageParams } from '@mcs/yaml-engine';

import type { ModuleExample, ModuleI18n, SchemaModule, ValidationRule } from './types.js';

/**
 * A problem found in a `SchemaModule`'s own structure — not in a Mihomo
 * document. Returned instead of thrown so a caller (a CI check in
 * `schema-builtin`, `schema-registry` discovery, ...) can collect every
 * problem in one pass. `location` is a structural pointer into the module
 * object (e.g. `rules[0].id`, `i18n.en`), never a value: `messageParams`
 * only ever carries identifiers (a rule id, a locale code, an i18n key
 * name), the same "names not values" line `SchemaIssue` already draws
 * (NFR-SEC-03).
 */
export interface ModuleShapeIssue {
  severity: 'error';
  code: string;
  location: string;
  messageKey: string;
  messageParams?: MessageParams;
}

const EXAMPLE_KINDS = ['valid', 'invalid', 'edge', 'unknown-fields'] as const;

/**
 * Check the three optional v0.3.0 additions (`rules`, `examples`, `i18n`).
 * The original `{ manifest, schema, ui }` shape is unchecked here: it is
 * already TS-required, and nothing about it changed in this slice.
 */
export function validateModuleShape(module: SchemaModule): ModuleShapeIssue[] {
  const issues: ModuleShapeIssue[] = [];

  if (module.rules) checkRules(module.rules, issues);
  if (module.examples) checkExamples(module.examples, issues);
  if (module.i18n) checkI18n(module.i18n, issues);

  return issues;
}

function checkRules(rules: ValidationRule[], issues: ModuleShapeIssue[]): void {
  const seenIds = new Set<string>();

  rules.forEach((rule, index) => {
    const location = `rules[${index}]`;

    if (rule.id === '') {
      issues.push({
        severity: 'error',
        code: 'module.rule.emptyId',
        location: `${location}.id`,
        messageKey: 'module.rule.emptyId',
      });
    } else if (seenIds.has(rule.id)) {
      issues.push({
        severity: 'error',
        code: 'module.rule.duplicateId',
        location: `${location}.id`,
        messageKey: 'module.rule.duplicateId',
        messageParams: { id: rule.id },
      });
    } else {
      seenIds.add(rule.id);
    }

    if (rule.messageKey === '') {
      issues.push({
        severity: 'error',
        code: 'module.rule.emptyMessageKey',
        location: `${location}.messageKey`,
        messageKey: 'module.rule.emptyMessageKey',
      });
    }
  });
}

function checkExamples(examples: ModuleExample[], issues: ModuleShapeIssue[]): void {
  examples.forEach((example, index) => {
    const location = `examples[${index}]`;

    if (example.name === '') {
      issues.push({
        severity: 'error',
        code: 'module.example.emptyName',
        location: `${location}.name`,
        messageKey: 'module.example.emptyName',
      });
    }
    if (!(EXAMPLE_KINDS as readonly string[]).includes(example.kind)) {
      issues.push({
        severity: 'error',
        code: 'module.example.invalidKind',
        location: `${location}.kind`,
        messageKey: 'module.example.invalidKind',
      });
    }
    if (example.path === '') {
      issues.push({
        severity: 'error',
        code: 'module.example.emptyPath',
        location: `${location}.path`,
        messageKey: 'module.example.emptyPath',
      });
    }
  });
}

function checkI18n(i18n: ModuleI18n, issues: ModuleShapeIssue[]): void {
  const locales = Object.keys(i18n);
  const keysByLocale = new Map<string, Set<string>>(
    locales.map((locale) => [locale, new Set(Object.keys(i18n[locale as keyof ModuleI18n]))]),
  );

  const allKeys = new Set<string>();
  for (const keys of keysByLocale.values()) {
    for (const key of keys) allKeys.add(key);
  }

  for (const locale of locales) {
    const keys = keysByLocale.get(locale) ?? new Set<string>();

    for (const key of allKeys) {
      if (!keys.has(key)) {
        issues.push({
          severity: 'error',
          code: 'module.i18n.missingKey',
          location: `i18n.${locale}`,
          messageKey: 'module.i18n.missingKey',
          messageParams: { locale, key },
        });
      }
    }

    for (const key of keys) {
      if (i18n[locale as keyof ModuleI18n][key] === '') {
        issues.push({
          severity: 'error',
          code: 'module.i18n.emptyValue',
          location: `i18n.${locale}.${key}`,
          messageKey: 'module.i18n.emptyValue',
          messageParams: { locale, key },
        });
      }
    }
  }
}
