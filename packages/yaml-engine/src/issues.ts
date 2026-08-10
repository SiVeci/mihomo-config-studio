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
 * A problem produced by the YAML layer. `@mcs/validator` widens this into the
 * cross-cutting `ValidationIssue`; the shape is intentionally compatible.
 */
export interface YamlIssue {
  severity: IssueSeverity;
  code: string;
  /** Already-localised or i18n key; never contains configuration values. */
  message: string;
  path?: ConfigPath;
  range?: TextRange;
}
