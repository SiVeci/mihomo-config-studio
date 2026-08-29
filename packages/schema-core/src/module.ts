import type { MessageParams } from '@mcs/yaml-engine';

import type {
  MigrationSpec,
  ModuleExample,
  ModuleI18n,
  RuleTypeSpec,
  SchemaModule,
  ValidationRule,
} from './types.ts';

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
const RULE_PAYLOAD_KINDS = [
  'domain',
  'domain-suffix',
  'ipcidr',
  'port',
  'process',
  'geo',
  'rule-set',
  'sub-rule',
  'none',
] as const;
/**
 * Mirrors `packages/migration/src/plan.ts`'s `MIGRATION_OPERATION_KINDS`
 * (ADR-025). `schema-core` cannot depend on `@mcs/migration` — the
 * dependency runs the other way — so this closed set is intentionally
 * duplicated here rather than imported; `module.test.ts` and
 * `packages/migration/src/plan.test.ts` both assert the exact seven-item
 * list, so a drift between the two surfaces as a failing test in at least
 * one package.
 */
const MIGRATION_OPCODES = [
  'rename-field',
  'move-field',
  'set-default',
  'deprecate-field',
  'remove-field',
  'narrow-enum',
  'quarantine-field',
] as const;

/**
 * Check the optional additions (`rules`/`examples`/`i18n` from v0.3.0,
 * `ruleTypes` from v0.4.0 #3, `migrations` from v0.5.0 #6). The original
 * `{ manifest, schema, ui }` shape is unchecked here: it is already
 * TS-required, and nothing about it changed in this slice.
 */
export function validateModuleShape(module: SchemaModule): ModuleShapeIssue[] {
  const issues: ModuleShapeIssue[] = [];

  if (module.rules) checkRules(module.rules, issues);
  if (module.examples) checkExamples(module.examples, issues);
  if (module.i18n) checkI18n(module.i18n, issues);
  if (module.ruleTypes) checkRuleTypes(module.ruleTypes, issues);
  if (module.migrations) checkMigrations(module.migrations, issues);

  return issues;
}

/**
 * Shallow, structural only: is `op` one of the seven closed opcodes, and are
 * the fields every opcode needs regardless of its own kind (`from`/`to` on
 * the spec, `path` on each operation) non-empty. Per-opcode fields (a
 * `rename-field`'s `to`, a `narrow-enum`'s `allowed`, ...) are
 * `@mcs/migration`'s `loadMigrations` concern, which has the richer,
 * fully-typed `MigrationOperation` union to validate against — duplicating
 * that here would be the same shape twice, validated two different ways.
 */
function checkMigrations(migrations: MigrationSpec[], issues: ModuleShapeIssue[]): void {
  migrations.forEach((spec, specIndex) => {
    const location = `migrations[${specIndex}]`;

    if (spec.from === '') {
      issues.push({
        severity: 'error',
        code: 'module.migration.emptyFrom',
        location: `${location}.from`,
        messageKey: 'module.migration.emptyFrom',
      });
    }
    if (spec.to === '') {
      issues.push({
        severity: 'error',
        code: 'module.migration.emptyTo',
        location: `${location}.to`,
        messageKey: 'module.migration.emptyTo',
      });
    }

    spec.operations.forEach((operation, opIndex) => {
      const opLocation = `${location}.operations[${opIndex}]`;

      if (!(MIGRATION_OPCODES as readonly string[]).includes(operation.op)) {
        issues.push({
          severity: 'error',
          code: 'module.migration.unknownOp',
          location: `${opLocation}.op`,
          messageKey: 'module.migration.unknownOp',
          messageParams: { op: operation.op },
        });
      }
      if (operation.path === '') {
        issues.push({
          severity: 'error',
          code: 'module.migration.emptyPath',
          location: `${opLocation}.path`,
          messageKey: 'module.migration.emptyPath',
        });
      }
    });
  });
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

/**
 * A malformed Bundle's `rule-types.json` is untrusted JSON at runtime, same
 * as `examples[].kind` — `payloadKind` is checked against the closed set
 * here rather than trusted from the TS type, which only guards
 * hand-authored `SchemaModule` literals, not what a downloaded Bundle
 * actually deserialises to (ADR-002).
 */
function checkRuleTypes(ruleTypes: RuleTypeSpec[], issues: ModuleShapeIssue[]): void {
  const seenTypes = new Set<string>();

  ruleTypes.forEach((entry, index) => {
    const location = `ruleTypes[${index}]`;

    if (entry.type === '') {
      issues.push({
        severity: 'error',
        code: 'module.ruleType.emptyType',
        location: `${location}.type`,
        messageKey: 'module.ruleType.emptyType',
      });
    } else if (seenTypes.has(entry.type)) {
      issues.push({
        severity: 'error',
        code: 'module.ruleType.duplicateType',
        location: `${location}.type`,
        messageKey: 'module.ruleType.duplicateType',
        messageParams: { type: entry.type },
      });
    } else {
      seenTypes.add(entry.type);
    }

    if (!(RULE_PAYLOAD_KINDS as readonly string[]).includes(entry.payloadKind)) {
      issues.push({
        severity: 'error',
        code: 'module.ruleType.invalidPayloadKind',
        location: `${location}.payloadKind`,
        messageKey: 'module.ruleType.invalidPayloadKind',
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
