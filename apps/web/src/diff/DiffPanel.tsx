import { useEffect, useState, type ReactNode } from 'react';

import { t } from '../i18n/index.js';
import type { DiffOp, DiffResponse, TextDiff, ValidationIssue } from '../worker/protocol.js';
import './DiffPanel.css';

export interface DiffPanelWorkerClient {
  diff(baseline: string): Promise<DiffResponse>;
}

export interface DiffPanelProps {
  /** Text as of the last import (or the default template, for a never-imported project). */
  readonly importBaseline: string;
  /**
   * Text as of when this project was opened this session — a fixed
   * snapshot, not continuously updated as autosave flushes land, so the
   * diff answers "what have I changed since I opened this" rather than
   * chasing a moving target that would converge to empty a few seconds
   * after every pause in typing.
   */
  readonly savedBaseline: string;
  readonly client: DiffPanelWorkerClient;
  /**
   * `YamlEditor`'s latest parse result — never rendered here, only used as a
   * re-diff trigger. The Worker computes the diff against whatever document
   * it currently holds (`document.toText()`), which only exists *and* only
   * stays current after each of `YamlEditor`'s own debounced `parse()`
   * calls; without a dependency on something that changes then, `diff()`
   * would race the very first parse (rejecting with `NO_DOCUMENT`) and,
   * having lost that race once, never retry — and even past that first
   * race, would go stale on every subsequent edit. A fresh `issues` array
   * reference is produced on every parse regardless of whether its content
   * changed, which makes it a reliable "the document just changed" signal.
   */
  readonly issues: ValidationIssue[];
}

type BaselineChoice = 'imported' | 'saved';

const OP_MARK: Record<DiffOp, string> = { add: '+', remove: '-', context: ' ' };

export function DiffPanel({
  importBaseline,
  savedBaseline,
  client,
  issues,
}: DiffPanelProps): ReactNode {
  // "Imported" defaults first: reviewing everything changed across the whole
  // session is the more useful pre-export sanity check than the narrower
  // "since it was last saved" window, which autosave (#5) keeps close to
  // empty in the common case anyway.
  const [baselineChoice, setBaselineChoice] = useState<BaselineChoice>('imported');
  const [diff, setDiff] = useState<TextDiff | null>(null);

  useEffect(() => {
    const baseline = baselineChoice === 'imported' ? importBaseline : savedBaseline;
    let cancelled = false;
    client
      .diff(baseline)
      .then((response) => {
        if (!cancelled) setDiff(response.diff);
      })
      .catch(() => {
        // No document parsed yet (raced the first `parse()`) — the `issues`
        // dependency below retries this once that parse lands.
        if (!cancelled) setDiff(null);
      });
    return () => {
      cancelled = true;
    };
  }, [baselineChoice, importBaseline, savedBaseline, client, issues]);

  return (
    <section className="diff-panel" aria-label={t('diff.title')}>
      <h2 className="diff-panel__title">{t('diff.title')}</h2>

      <label className="diff-panel__baseline-label" htmlFor="diff-baseline-select">
        {t('diff.baselineLabel')}
      </label>
      <select
        id="diff-baseline-select"
        className="diff-panel__baseline-select"
        value={baselineChoice}
        onChange={(event) => setBaselineChoice(event.target.value as BaselineChoice)}
      >
        <option value="imported">{t('diff.baselineImported')}</option>
        <option value="saved">{t('diff.baselineSaved')}</option>
      </select>

      {diff && renderDiffBody(diff)}
    </section>
  );
}

function renderDiffBody(diff: TextDiff): ReactNode {
  if (diff.hunks.length === 0) {
    return (
      <p className="diff-panel__empty">
        {diff.trailingNewlineChanged ? t('diff.trailingNewlineNote') : t('diff.emptyState')}
      </p>
    );
  }
  return (
    <>
      <p className="diff-panel__summary">
        {t('diff.summary', { added: diff.added, removed: diff.removed })}
      </p>
      <pre className="diff-panel__body">
        {diff.hunks.map((hunk, hunkIndex) => (
          <div key={hunkIndex} className="diff-panel__hunk">
            {hunk.lines.map((line, lineIndex) => (
              <div key={lineIndex} className={`diff-panel__line diff-panel__line--${line.op}`}>
                <span className="diff-panel__marker">{OP_MARK[line.op]}</span>
                <span>{line.text}</span>
              </div>
            ))}
          </div>
        ))}
      </pre>
    </>
  );
}
