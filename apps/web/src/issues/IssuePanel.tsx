import { useState, type ReactNode } from 'react';

import { t } from '../i18n/index.js';
import type { TranslationKey } from '../i18n/index.js';
import type {
  ConfigPath,
  IssueSeverity,
  LocateResponse,
  MessageParams,
  TextRange,
  ValidationIssue,
} from '../worker/protocol.js';
import './IssuePanel.css';

export interface IssuePanelWorkerClient {
  locate(path: ConfigPath): Promise<LocateResponse>;
}

export interface IssuePanelProps {
  readonly issues: ValidationIssue[];
  readonly client: IssuePanelWorkerClient;
  /** Called once a range has been resolved (directly, or via `client.locate`) — typically wired to `YamlEditorHandle.jumpToRange`. */
  readonly onJump: (range: TextRange) => void;
}

const SEVERITY_ORDER: readonly IssueSeverity[] = ['error', 'warning', 'info'];

/** PRD §11.6: severity must never be color-only. Plain glyphs work for sighted *and* screen-reader users alike, unlike a bare CSS color. */
const SEVERITY_MARK: Record<IssueSeverity, string> = {
  error: '✕',
  warning: '▲',
  info: 'ℹ',
};

const SEVERITY_LABEL_KEY: Record<IssueSeverity, TranslationKey> = {
  error: 'issues.severityError',
  warning: 'issues.severityWarning',
  info: 'issues.severityInfo',
};

/**
 * `messageParams` values are restricted to `ConfigPath | primitives | primitive
 * arrays` (NFR-SEC-03 — never a raw value from the document), but `t()`'s
 * template interpolation only accepts `string | number`; non-primitive values
 * (paths, arrays, booleans, null) are stringified rather than dropped.
 */
function toTemplateParams(params?: MessageParams): Record<string, string | number> | undefined {
  if (!params) return undefined;
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(params)) {
    out[key] =
      typeof value === 'string' || typeof value === 'number' ? value : JSON.stringify(value);
  }
  return out;
}

/**
 * `messageKey` includes an open-ended set of codes owned by the third-party
 * `yaml` library (e.g. `yaml.syntax.BAD_INDENT`), so not every key has a
 * translated resource entry — this is the first real consumer of that
 * mapping (ADR-016), and `t()`'s existing fallback-to-the-raw-key behaviour
 * degrades gracefully for the ones that aren't in the resource files yet.
 */
function translateIssueMessage(issue: ValidationIssue): string {
  return t(issue.messageKey as TranslationKey, toTemplateParams(issue.messageParams));
}

/**
 * Unified problem list for FR-VAL-02: groups by severity, filters by module,
 * and jumps the raw editor (#13) to an issue's location on click. Consumes
 * whatever `ValidationIssue[]` `YamlEditor` last parsed (passed down from
 * `ProjectPage`) rather than parsing independently — a second independent
 * parse of the same text would risk the two panels disagreeing.
 */
export function IssuePanel({ issues, client, onJump }: IssuePanelProps): ReactNode {
  const [moduleFilter, setModuleFilter] = useState('all');

  const modules = [...new Set(issues.map((issue) => issue.module))].sort();
  const filtered =
    moduleFilter === 'all' ? issues : issues.filter((issue) => issue.module === moduleFilter);
  const groups = SEVERITY_ORDER.map((severity) => ({
    severity,
    items: filtered.filter((issue) => issue.severity === severity),
  })).filter((group) => group.items.length > 0);

  async function handleJump(issue: ValidationIssue): Promise<void> {
    if (issue.range) {
      onJump(issue.range);
      return;
    }
    // "跳转到表单字段" (jumping straight to a form field) is v0.3.0 scope; this
    // is still a YAML-line jump, just located indirectly via the Worker
    // instead of a range already sitting on the issue. The `!` is safe: this
    // function only ever runs from the `jumpable` button below, which is
    // only rendered when `issue.range ?? issue.path` is truthy — having
    // fallen through the `issue.range` branch above, `issue.path` is it.
    const response = await client.locate(issue.path!);
    if (response.range) onJump(response.range);
  }

  return (
    <section className="issue-panel" aria-label={t('issues.title')}>
      <h2 className="issue-panel__title">{t('issues.title')}</h2>

      {modules.length > 1 && (
        <>
          <label className="issue-panel__filter-label" htmlFor="issue-module-filter">
            {t('issues.moduleFilterLabel')}
          </label>
          <select
            id="issue-module-filter"
            className="issue-panel__filter-select"
            value={moduleFilter}
            onChange={(event) => setModuleFilter(event.target.value)}
          >
            <option value="all">{t('issues.moduleFilterAll')}</option>
            {modules.map((module) => (
              <option key={module} value={module}>
                {module}
              </option>
            ))}
          </select>
        </>
      )}

      {issues.length === 0 ? (
        <p className="issue-panel__empty">{t('issues.emptyState')}</p>
      ) : (
        groups.map(({ severity, items }) => (
          <div key={severity} className="issue-panel__group">
            <h3 className={`issue-panel__group-title issue-panel__group-title--${severity}`}>
              <span aria-hidden="true">{SEVERITY_MARK[severity]}</span>{' '}
              {t(SEVERITY_LABEL_KEY[severity])} ({items.length})
            </h3>
            <ul className="issue-panel__list">
              {items.map((issue, index) => {
                const jumpable = Boolean(issue.range ?? issue.path);
                const label = `${t(SEVERITY_LABEL_KEY[severity])}: ${translateIssueMessage(issue)}`;
                return (
                  <li key={index}>
                    {jumpable ? (
                      <button
                        type="button"
                        className={`issue-panel__item issue-panel__item--${severity}`}
                        aria-label={label}
                        onClick={() => void handleJump(issue)}
                      >
                        <span aria-hidden="true" className="issue-panel__mark">
                          {SEVERITY_MARK[severity]}
                        </span>
                        {translateIssueMessage(issue)}
                      </button>
                    ) : (
                      <span
                        className={`issue-panel__item issue-panel__item--${severity} issue-panel__item--static`}
                        aria-label={label}
                      >
                        <span aria-hidden="true" className="issue-panel__mark">
                          {SEVERITY_MARK[severity]}
                        </span>
                        {translateIssueMessage(issue)}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}
