import type { ConfigPath } from './path.js';

export type IssueSeverity = 'error' | 'warning' | 'info';

/** 1-based line/column, matching what editors display (FR-VAL-01). */
export interface TextPosition {
  offset: number;
  line: number;
  column: number;
}

export interface TextRange {
  start: TextPosition;
  end: TextPosition;
}

/**
 * Values safe to interpolate into a rendered message: JSON primitives (used
 * for Schema constants such as `default`/`enum`/`const`, and for structural
 * metrics like byte counts), lists of those, and config paths. Deliberately
 * excludes arbitrary objects/`unknown`, so a value read out of the document
 * being validated can never be threaded through into a message (NFR-SEC-03).
 */
export type MessageParamPrimitive = string | number | boolean | null;
export type MessageParamValue =
  MessageParamPrimitive | readonly MessageParamPrimitive[] | ConfigPath;
export type MessageParams = Readonly<Record<string, MessageParamValue>>;

/**
 * A problem produced by the YAML layer. `@mcs/validator` widens this into the
 * cross-cutting `ValidationIssue`; the shape is intentionally compatible.
 */
export interface YamlIssue {
  severity: IssueSeverity;
  code: string;
  /** i18n lookup key; the rendered text lives in resource files, never here. */
  messageKey: string;
  messageParams?: MessageParams;
  path?: ConfigPath;
  range?: TextRange;
}
