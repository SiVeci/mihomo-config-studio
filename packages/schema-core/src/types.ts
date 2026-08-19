/**
 * The declarative vocabulary a Schema Bundle may use.
 *
 * Everything in this file is *data*. There is deliberately no place to put a
 * function, an expression string, or a module specifier: that is what makes
 * "a bundle cannot execute code" checkable rather than aspirational
 * (FR-UPD-07, NFR-SEC-05, ADR-002).
 */

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

export interface SchemaModule {
  manifest: ModuleManifest;
  schema: JsonSchema;
  ui: UiSchema;
}
