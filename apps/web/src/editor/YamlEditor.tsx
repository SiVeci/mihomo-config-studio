import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type UIEvent } from 'react';

import { t } from '../i18n/index.js';
import { hasBlockingIssues, VALIDATION_DEBOUNCE_MS } from '../worker/protocol.js';
import type {
  ParseResponse,
  SerializeOptions,
  SerializeResponse,
  TextRange,
  ValidationIssue,
} from '../worker/protocol.js';
import './YamlEditor.css';

export interface YamlEditorWorkerClient {
  parse(text: string): Promise<ParseResponse>;
  serialize(options?: SerializeOptions): Promise<SerializeResponse>;
}

export interface YamlEditorProps {
  readonly text: string;
  readonly onChange: (text: string) => void;
  readonly client: YamlEditorWorkerClient;
  /** Reports the latest parse's issues upward — the IssuePanel is the consumer. */
  readonly onIssuesChange?: (issues: ValidationIssue[]) => void;
  /** Reports the latest parse's value upward — #14's ModuleFormPage stays in sync with every raw-text edit through this, without a second Worker round trip. */
  readonly onValueChange?: (value: unknown) => void;
}

/** Imperative surface for #14's IssuePanel: jump the raw editor to an issue's range. */
export interface YamlEditorHandle {
  jumpToRange: (range: TextRange) => void;
}

function splitLines(text: string): string[] {
  // `String.prototype.split` never returns an empty array (even `''.split('\n')`
  // is `['']`), and popping only ever runs when at least 2 elements remain, so
  // this is always non-empty — no `lines.length === 0` fallback is reachable.
  const lines = text.split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/**
 * Raw-text editor for FR-YAML-04/05: line numbers, syntax error markers,
 * find, format, and jump — built on a plain `<textarea>` rather than
 * CodeMirror/Monaco (see the plan's #13 notes: a heavyweight editor drags in
 * its own CSP/Worker/theme story that fights #7's tokens and #10's Worker
 * boundary). If this proves insufficient, that is an ADR-worthy decision to
 * revisit, not a silent scope creep here.
 */
export const YamlEditor = forwardRef<YamlEditorHandle, YamlEditorProps>(function YamlEditor(
  { text, onChange, client, onIssuesChange, onValueChange },
  ref,
) {
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchStatus, setSearchStatus] = useState<'idle' | 'not-found'>('idle');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);

  // Debounced re-parse: every text change cancels the pending timer and
  // schedules a fresh one, so a burst of keystrokes triggers one parse
  // covering the latest text — the React-effect equivalent of the
  // trailing-edge contract `WorkerClient.touchValidate`/`pollValidate`
  // implement for non-React callers (NFR-PERF-03). A real `setTimeout` (not
  // an injected clock) is the right tool here specifically because this is a
  // React component: tests drive it with `vi.useFakeTimers()` instead.
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      void client.parse(text).then((response) => {
        setIssues(response.issues);
        onIssuesChange?.(response.issues);
        onValueChange?.(response.value);
      });
    }, VALIDATION_DEBOUNCE_MS);
    return () => clearTimeout(timeoutId);
  }, [text, client]);

  const lines = splitLines(text);
  const errorLines = new Set(
    issues.filter((issue) => issue.range).map((issue) => issue.range!.start.line),
  );
  // Equivalent to "has a syntax error" only because v0.2.0 has no Schema
  // module wired in yet, so the pipeline's schema stage is always empty —
  // every blocking issue a parse() can produce right now is a syntax one.
  // Re-examine this equivalence once a real Schema module can also produce
  // blocking issues (v0.3.0+).
  const frozen = hasBlockingIssues(issues);
  const firstError = issues.find((issue) => issue.blocking && issue.range);

  useImperativeHandle(ref, () => ({ jumpToRange: selectRange }));

  function handleScroll(event: UIEvent<HTMLTextAreaElement>): void {
    if (gutterRef.current) gutterRef.current.scrollTop = event.currentTarget.scrollTop;
  }

  function selectRange(range: TextRange): void {
    // Non-null: reachable only from the frozen banner's onClick or the
    // `jumpToRange` handle exposed to the parent (#14's IssuePanel) — both
    // require this component to have already rendered, textarea included.
    const textarea = textareaRef.current!;
    textarea.focus();
    textarea.setSelectionRange(range.start.offset, range.end.offset);
  }

  function handleFind(): void {
    if (!searchTerm) return;
    const textarea = textareaRef.current;
    const searchFrom = textarea?.selectionEnd ?? 0;
    const index = text.indexOf(searchTerm, searchFrom);
    const foundAt = index === -1 ? text.indexOf(searchTerm) : index; // wrap around once
    if (foundAt === -1) {
      setSearchStatus('not-found');
      return;
    }
    setSearchStatus('idle');
    textarea?.focus();
    textarea?.setSelectionRange(foundAt, foundAt + searchTerm.length);
  }

  async function handleFormat(): Promise<void> {
    // A no-op on a document with no structural edits yet: `toText()` replays
    // the original tokens verbatim in `cst` mode (the mechanism behind M0-1's
    // lossless round-trip) and only honours `SerializeOptions` once some
    // `setIn`/`deleteIn`/`appendIn` call has switched it to `ast` mode. This
    // editor never calls those, so "Format" reflowing a freshly-imported
    // document's whitespace is not yet possible through the current engine
    // API — that is a real, known limitation, not a bug in this wiring.
    await client.parse(text);
    const response = await client.serialize({ lineWidth: 0, indent: 2 });
    onChange(response.text);
  }

  return (
    <section className="yaml-editor">
      <h2 className="yaml-editor__title">{t('editor.title')}</h2>
      <div className="yaml-editor__toolbar">
        <input
          type="text"
          className="yaml-editor__search-input"
          placeholder={t('editor.findPlaceholder')}
          aria-label={t('editor.findPlaceholder')}
          value={searchTerm}
          onChange={(event) => {
            setSearchTerm(event.target.value);
            setSearchStatus('idle');
          }}
        />
        <button type="button" onClick={handleFind}>
          {t('editor.findButton')}
        </button>
        <button type="button" onClick={() => void handleFormat()}>
          {t('editor.formatButton')}
        </button>
      </div>
      {searchStatus === 'not-found' && (
        <p className="yaml-editor__search-status">{t('editor.findNotFound')}</p>
      )}

      <div className="yaml-editor__body">
        <div className="yaml-editor__gutter" ref={gutterRef}>
          {lines.map((_, index) => (
            <div
              key={index}
              className={
                errorLines.has(index + 1)
                  ? 'yaml-editor__gutter-line yaml-editor__gutter-line--error'
                  : 'yaml-editor__gutter-line'
              }
            >
              {index + 1}
            </div>
          ))}
        </div>
        <textarea
          ref={textareaRef}
          className="yaml-editor__textarea"
          aria-label={t('editor.title')}
          value={text}
          onChange={(event) => onChange(event.target.value)}
          onScroll={handleScroll}
          spellCheck={false}
        />
      </div>

      <div className="yaml-editor__structured-section">
        {frozen && firstError?.range && (
          <button
            type="button"
            className="yaml-editor__frozen-banner"
            onClick={() => selectRange(firstError.range!)}
          >
            {t('editor.frozenMessage')}
            {' — '}
            {t('editor.frozenLocation', {
              line: firstError.range.start.line,
              column: firstError.range.start.column,
            })}
          </button>
        )}
        {/*
          `disabled` on the fieldset is deliberately not "hidden": FR-YAML-05
          requires the frozen structured view to stay visible so the user
          never mistakes a freeze for lost data. Today this fieldset only ever
          contains placeholder text (no Schema module exists to render real
          fields yet — see the plan's #13 notes), but any real form fields
          v0.3.0 adds here inherit the disabled behaviour for free.
        */}
        <fieldset
          className="yaml-editor__structured"
          disabled={frozen}
          aria-label={t('editor.structuredViewTitle')}
        >
          <legend>{t('editor.structuredViewTitle')}</legend>
          <p className="yaml-editor__structured-placeholder">
            {t('editor.structuredViewPlaceholder')}
          </p>
        </fieldset>
      </div>
    </section>
  );
});
