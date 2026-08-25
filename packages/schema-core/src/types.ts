/**
 * The declarative vocabulary a Schema Bundle may use.
 *
 * Everything in this file is *data*. There is deliberately no place to put a
 * function, an expression string, or a module specifier: that is what makes
 * "a bundle cannot execute code" checkable rather than aspirational
 * (FR-UPD-07, NFR-SEC-05, ADR-002).
 */

import type { IssueSeverity, MessageParams } from '@mcs/yaml-engine';

export type JsonPrimitive = string | number | boolean | null;

export type JsonSchemaType =
  'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null';

/** The subset of JSON Schema 2020-12 the interpreter supports (ADR-008). */
export interface JsonSchema {
  $id?: string;
  $schema?: string;
  /** Only local `#/$defs/...` references are resolvable. */
  $ref?: string;
  $defs?: Record<string, JsonSchema>;

  title?: string;
  description?: string;
  default?: unknown;
  examples?: unknown[];
  deprecated?: boolean;

  type?: JsonSchemaType | JsonSchemaType[];
  enum?: JsonPrimitive[];
  const?: JsonPrimitive;

  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  propertyNames?: JsonSchema;

  items?: JsonSchema;
  prefixItems?: JsonSchema[];
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;

  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  multipleOf?: number;

  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: KnownFormat;

  oneOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  allOf?: JsonSchema[];
  not?: JsonSchema;
}

/**
 * Formats are a closed set with hand-written checkers. An open `format`
 * vocabulary would be an extension point a bundle could abuse.
 */
export const KNOWN_FORMATS = [
  'uri',
  'hostname',
  'ipv4',
  'ipv6',
  'ip-cidr',
  'port',
  'duration-seconds',
  'uuid',
  'host-port',
] as const;

export type KnownFormat = (typeof KNOWN_FORMATS)[number];

// ---------------------------------------------------------------------------
// Restricted condition DSL
// ---------------------------------------------------------------------------

/**
 * `path` is dot-separated and relative to the object that owns the field, so a
 * sibling reads as `"type"`. Prefix with `$.` to address the module root.
 * There is no regular expression operator on purpose: an attacker-supplied
 * pattern is a denial-of-service vector (NFR-SEC-05).
 */
export type Condition =
  | { op: 'and' | 'or'; of: Condition[] }
  | { op: 'not'; of: Condition }
  | { op: 'exists' | 'empty'; path: string }
  | { op: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte'; path: string; value: JsonPrimitive }
  | { op: 'in' | 'notIn'; path: string; values: JsonPrimitive[] }
  | { op: 'startsWith' | 'endsWith' | 'contains'; path: string; value: string }
  | { op: 'length'; path: string; gte?: number; lte?: number };

// ---------------------------------------------------------------------------
// UI Schema
// ---------------------------------------------------------------------------

export type ControlType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'integer'
  | 'port'
  | 'switch'
  | 'select'
  | 'multi-select'
  | 'tags'
  | 'secret'
  | 'subscription-url'
  | 'key-value'
  | 'object'
  | 'list'
  | 'variant'
  | 'unknown';

export type Platform = 'linux' | 'windows' | 'darwin' | 'android' | 'ios' | 'router';

export type SafetyLevel = 'safe' | 'caution' | 'dangerous';

export interface UiFieldSpec {
  /** Omit to let `inferControl` choose from the JSON Schema (FR-SCHEMA-06). */
  control?: ControlType;
  /** i18n keys, never literal user-facing text. */
  label?: string;
  help?: string;
  placeholder?: string;
  group?: string;
  order?: number;
  /** Hidden in basic mode; never dropped from the document (PRD §7.4). */
  advanced?: boolean;
  /** Masked by default; revealing and copying are explicit actions (NFR-SEC-02). */
  sensitive?: boolean;
  experimental?: boolean;
  visibleWhen?: Condition;
  requiredWhen?: Condition;
  readOnlyWhen?: Condition;
  /** Official documentation URL for this field (FR-SCHEMA-04). */
  docs?: string;
  since?: string;
  deprecatedSince?: string;
  replacedBy?: string;
  platforms?: Platform[];
  safety?: SafetyLevel;
  /** UI spec for array elements. */
  item?: UiFieldSpec;
  /** UI spec for nested object properties. */
  fields?: Record<string, UiFieldSpec>;
  /**
   * i18n keys for a `variant` field's discriminator options, keyed by the
   * discriminator value as a string. Falls back to the raw value when a key
   * is missing (FR-SCHEMA-02).
   */
  variantLabels?: Record<string, string>;
}

export interface UiGroup {
  id: string;
  label: string;
  order?: number;
  advanced?: boolean;
  collapsedByDefault?: boolean;
}

export interface UiSchema {
  groups?: UiGroup[];
  fields?: Record<string, UiFieldSpec>;
}

// ---------------------------------------------------------------------------
// Module definition
// ---------------------------------------------------------------------------

export interface ModuleManifest {
  id: string;
  /** Path in the Mihomo document this module owns, e.g. `["dns"]`. */
  root: string[];
  version: string;
  dependsOn?: string[];
  mihomo?: { minVersion?: string; maxTestedVersion?: string };
}

/**
 * A declarative patch a `ValidationRule` may suggest when it fires. `path`
 * is relative, in the same addressing scheme as `Condition.path` (dot
 * segments, `$.` for the module root) — the evaluator (v0.3.0 #4) resolves
 * it against the document to produce a real issue's `fix`. `value` may only
 * be a JSON primitive the rule already knows about (its own literal), never
 * a value read out of the document being validated (NFR-SEC-03).
 */
export interface RuleFix {
  kind: 'set-scalar' | 'remove' | 'rename' | 'append';
  /** Defaults to the owning rule's own `path` when omitted. */
  path?: string;
  value?: JsonPrimitive;
}

/**
 * A cross-field or cross-object constraint a module declares instead of
 * application code implementing it (PRD §9.3). `when` reuses the existing
 * restricted `Condition` DSL — ADR-002 forbids a Bundle from introducing new
 * operators, so reuse is the only way to add this capability without
 * widening the closed opcode set. The evaluator lives in `rules.ts`
 * (v0.3.0 #4); this type only defines the shape a Bundle may declare.
 */
export interface ValidationRule {
  id: string;
  severity: IssueSeverity;
  when: Condition;
  /** i18n lookup key; the rendered text lives in resource files (NFR-SEC-03). */
  messageKey: string;
  messageParams?: MessageParams;
  /** Relative dot-path (same scheme as `Condition.path`) the issue anchors to. */
  path?: string;
  fix?: RuleFix;
}

/**
 * A named, on-disk sample a module ships for its own use. Content is never
 * read here — `packages/**` forbids `node:fs`, so only test code (and,
 * later, `schema-cli`) opens the file at `path`. `kind` mirrors the four
 * sample categories the exit criteria require per P0 module; a module
 * missing one is a fact `examples[]` can be scanned for mechanically
 * instead of eyeballed (v0.3.0 #22).
 */
export interface ModuleExample {
  name: string;
  kind: 'valid' | 'invalid' | 'edge' | 'unknown-fields';
  /** Path to a `.yaml` file inside the module's own `examples/` directory. */
  path: string;
}

/**
 * The closed vocabulary a rule-type catalog entry's payload can be — drives
 * which control the rule editor renders (#8), the same way `ControlType`
 * drives ordinary field rendering. A payload kind names a *shape*, never a
 * specific rule type: adding a new rule type with an existing shape (e.g. a
 * hypothetical future domain-matching variant) needs no new kind and no
 * application code change (ADR-021, FR-SCHEMA-06 applied to rules).
 */
export type RulePayloadKind =
  | 'domain'
  | 'domain-suffix'
  | 'ipcidr'
  | 'port'
  | 'process'
  | 'geo'
  | 'rule-set'
  | 'sub-rule'
  | 'none';

/**
 * One entry in a declarative rule-type catalog (ADR-021): data describing
 * how a rule line's TYPE token (`config-model/src/rule-line.ts`'s
 * `ParsedRuleLine.type`) should be edited, never a parser — the line itself
 * is already split into fragments by `parseRuleLine`, this only says what
 * those fragments *mean*. A type this app's catalog does not list is not an
 * error: `buildRulePlan` falls back to raw-string editing for it (FR-RULE-05).
 */
export interface RuleTypeSpec {
  /** Upper-case, matching `ParsedRuleLine.type` exactly (e.g. `DOMAIN-SUFFIX`). */
  type: string;
  payloadKind: RulePayloadKind;
  /** False only for types that can be a bare target with no payload segment at all (MATCH, SUB-RULE). */
  needsPayload: boolean;
  /** Documented optional trailing parameters this type accepts (e.g. `no-resolve`, `src`) — empty when none apply. */
  params: string[];
  /** Official documentation URL (FR-SCHEMA-04's rule-side counterpart). */
  docsUrl?: string;
  since?: string;
  safety?: SafetyLevel;
}

/** Locale codes a module's own i18n resources may provide (mirrors ADR-016's fixed set). */
export type ModuleLocale = 'zh-CN' | 'en';

/**
 * A module's own translated strings, one record per locale. Shape
 * validation (`validateModuleShape`) enforces that every locale present has
 * exactly the same key set — the same bidirectional-parity rule
 * `apps/web/src/i18n/i18n.test.ts` applies to the application's own
 * resources — and that no value is empty.
 */
export type ModuleI18n = Record<ModuleLocale, Record<string, string>>;

/**
 * `migrations` is deliberately not part of this shape yet: the version
 * document only requires the first three additions, and a field with no
 * consumer just invites someone to start populating it early. It gets a
 * real meaning — and a real evaluator — when migration lands in v0.5.0.
 */
export interface SchemaModule {
  manifest: ModuleManifest;
  schema: JsonSchema;
  ui: UiSchema;
  rules?: ValidationRule[];
  examples?: ModuleExample[];
  i18n?: ModuleI18n;
  /** A declarative rule-type catalog (ADR-021, v0.4.0 #3) — only `rules`/`sub-rules` carry this. */
  ruleTypes?: RuleTypeSpec[];
}
