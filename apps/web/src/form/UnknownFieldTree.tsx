import type { PlannedField } from '@mcs/schema-core';
import type { ReactNode } from 'react';

import { t } from '../i18n/index.js';
import type { ConfigPath, LocateResponse, TextRange } from '../worker/protocol.js';
import { toPointer } from '../worker/protocol.js';
import './UnknownFieldTree.css';

export interface UnknownFieldTreeWorkerClient {
  locate(path: ConfigPath): Promise<LocateResponse>;
}

export interface UnknownFieldTreeProps {
  /** `collectUnknownFields`'s result — this component never walks a document or a `FormPlan` itself (FR-VAL-05 UI side, v0.3.0 #16). */
  readonly fields: readonly PlannedField[];
  readonly client: UnknownFieldTreeWorkerClient;
  /** Called once a range has been resolved via `client.locate` — typically wired to `YamlEditorHandle.jumpToRange`, same as `IssuePanel`. */
  readonly onJump: (range: TextRange) => void;
}

/** A field the schema does not describe is never wrong — Unknown, not Error; this must never borrow error styling (PRD §8.3/§12). */
function readableValue(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return String(value);
  }
  return JSON.stringify(value);
}

/**
 * `q=` carries only the field's own key (the last path segment) — never a
 * value from the document, never the full path (which can itself contain
 * document structure like array indices tied to real content). Scoped to
 * the upstream wiki via `site:` rather than assuming that site exposes its
 * own working `/search` endpoint (NFR-SEC-01: a link the browser opens, not
 * a fetch this app makes — see this component's own tests for the
 * no-network-egress angle `apps/web`'s CI job cannot catch on its own).
 */
function docsSearchUrl(fieldKey: string): string {
  const query = `site:wiki.metacubex.one ${fieldKey}`;
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

/**
 * v0.9.0 #12: was `<details open={false}>`/`<summary>` with no state or
 * click handler ever wired to toggle `open` — the list's own CSS
 * (`UnknownFieldTree.css`) never hides it either, so every user always saw
 * it expanded regardless. Harmless-looking on screen, but a closed
 * `<details>`'s content is excluded from the browser's own Tab sequence
 * *natively*, independent of any CSS `display` override — confirmed live
 * (`e2e/a11y.spec.ts`'s keyboard-reachability scan) that the jump/search-docs
 * controls inside it were visible but not Tab-reachable at all. Since
 * nothing here ever made this genuinely collapsible, the fix is a plain
 * always-shown section, not building out real expand/collapse behaviour
 * nobody asked for.
 */
export function UnknownFieldTree({ fields, client, onJump }: UnknownFieldTreeProps): ReactNode {
  if (fields.length === 0) return null;

  async function handleJumpToLine(path: ConfigPath): Promise<void> {
    const response = await client.locate(path);
    if (response.range) onJump(response.range);
  }

  return (
    <section
      className="unknown-field-tree"
      aria-label={`${t('unknownFields.title')} (${fields.length})`}
    >
      <h2 className="unknown-field-tree__summary">
        {t('unknownFields.title')} ({fields.length})
      </h2>
      <ul className="unknown-field-tree__list">
        {fields.map((field) => {
          const pointer = toPointer(field.path);
          const fieldKey = field.path.at(-1);
          return (
            <li key={pointer} className="unknown-field-tree__item" data-unknown-field={pointer}>
              <span className="unknown-field-tree__path">{pointer}</span>
              <output className="unknown-field-tree__value">{readableValue(field.value)}</output>
              <button
                type="button"
                className="unknown-field-tree__jump-button"
                onClick={() => void handleJumpToLine(field.path)}
              >
                {t('unknownFields.jumpToLineButton')}
              </button>
              {typeof fieldKey === 'string' ? (
                <a
                  className="unknown-field-tree__docs-link"
                  href={docsSearchUrl(fieldKey)}
                  rel="noreferrer noopener"
                  target="_blank"
                >
                  {t('unknownFields.docsSearchLink')}
                </a>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
