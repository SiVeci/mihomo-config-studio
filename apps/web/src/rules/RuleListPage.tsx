import type { RuleTypeSpec } from '@mcs/schema-core';
import { computeVirtualWindow } from '@mcs/ui';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { t } from '../i18n/index.js';
import type { IssueFix } from '../worker/protocol.js';
import { RuleEditor } from './RuleEditor.js';
import './RuleListPage.css';

const DEFAULT_ROW_HEIGHT = 32;
const DEFAULT_CONTAINER_HEIGHT = 480;
const OVERSCAN = 6;

export interface RuleListPageProps {
  /** The `rules:` array, exactly as it lives in the document — this component never parses or reorders a line itself (that is #9's job). */
  readonly rules: readonly string[];
  readonly rowHeight?: number;
  /**
   * Overrides real-DOM measurement. Real usage leaves this unset and lets
   * the `ResizeObserver` effect below drive it — jsdom has no layout engine
   * (`getBoundingClientRect`/`ResizeObserver` never report a real size), so
   * every test in `RuleListPage.test.tsx` passes this explicitly instead of
   * asserting against a measurement that can never happen in that
   * environment (the same reasoning `ProjectPage`'s injectable `now` clock
   * already applies to timing).
   */
  readonly containerHeight?: number;
  /** Forwarded to `RuleEditor` as-is (v0.4.0 #8) — see its own doc comment. */
  readonly catalog: readonly RuleTypeSpec[];
  readonly proxyTargetNames: readonly string[];
  readonly ruleProviderNames: readonly string[];
  readonly subRuleGroupNames: readonly string[];
  /** Same "apply then refetch value+serialize" contract `ProjectPage.handleDocumentFieldChange` already uses for form edits — rule create/edit reuses it rather than adding a parallel write path. */
  readonly onApplyFix: (fix: IssueFix) => Promise<void>;
}

/**
 * Sequence-numbered, virtualized rule list (ADR-022): renders only the rows
 * near the current scroll position, regardless of how many thousands of
 * rules exist, while every row still shows its true position in the full
 * list (`index + 1`, computed from `computeVirtualWindow`'s `startIndex`,
 * never from DOM order — jsdom or a real browser scrolled to row 9000 shows
 * "9001" on the first rendered row either way).
 *
 * Structured create/edit (#8) opens `RuleEditor` as a single dialog owned
 * here, never inline inside a row: a row can scroll out of the virtualized
 * window (and unmount) mid-edit, so the editor's own state must not live
 * inside one. Drag/keyboard reorder (#9) and batch selection (#10) render
 * through this same virtualized shell later.
 */
export function RuleListPage({
  rules,
  rowHeight = DEFAULT_ROW_HEIGHT,
  containerHeight: containerHeightProp,
  catalog,
  proxyTargetNames,
  ruleProviderNames,
  subRuleGroupNames,
  onApplyFix,
}: RuleListPageProps): ReactNode {
  const containerRef = useRef<HTMLDivElement>(null);
  const [measuredHeight, setMeasuredHeight] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [creating, setCreating] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  useEffect(() => {
    if (containerHeightProp !== undefined) return;
    const element = containerRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setMeasuredHeight(entry.contentRect.height);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [containerHeightProp]);

  const containerHeight =
    containerHeightProp ?? (measuredHeight > 0 ? measuredHeight : DEFAULT_CONTAINER_HEIGHT);

  const window_ = useMemo(
    () =>
      computeVirtualWindow({
        itemCount: rules.length,
        itemHeight: rowHeight,
        containerHeight,
        scrollTop,
        overscan: OVERSCAN,
      }),
    [rules.length, rowHeight, containerHeight, scrollTop],
  );

  /**
   * `rules.length === 0` cannot distinguish "no `rules:` key at all" from
   * "`rules: []`" (`ProjectPage`'s memo collapses both to `[]`), so either
   * way this writes the whole one-item array in a single `set` rather than
   * seeding `[]` and following up with `append`. That two-step form was
   * tried first and reliably threw `YAML_INVALID_OPERATION` on the
   * `append`: `MihomoYamlDocument#setIn` (`yaml-engine/src/document.ts`)
   * stores whatever plain value it is given — `yaml`'s own `Collection#set`
   * wraps it in a `Pair` as-is, with no `createNode` call — so a `[]` just
   * set this way is a plain JS array, not a `YAMLSeq`, and `appendIn`'s own
   * `isSeq` guard rejects it. A single `set` with the full array sidesteps
   * that gap entirely rather than depending on it; `append` below is only
   * ever used against an array that came from parsing real YAML text (a
   * genuine `YAMLSeq`), which does not have this problem. Not a yaml-engine
   * fix — out of #8's file scope, and worth flagging for #9/#10, which do
   * more array manipulation and could hit the same gap another way.
   */
  async function handleCreateSubmit(text: string): Promise<void> {
    if (rules.length === 0) {
      await onApplyFix({ kind: 'set', path: ['rules'], value: [text] });
    } else {
      await onApplyFix({ kind: 'append', path: ['rules'], value: text });
    }
    setCreating(false);
  }

  async function handleEditSubmit(index: number, text: string): Promise<void> {
    await onApplyFix({ kind: 'set', path: ['rules', index], value: text });
    setEditingIndex(null);
  }

  const visibleRules = rules.slice(window_.startIndex, window_.endIndex);
  const editingText = editingIndex !== null ? rules[editingIndex] : undefined;

  return (
    <div className="rule-list-page">
      <div className="rule-list-page__toolbar">
        <button type="button" onClick={() => setCreating(true)}>
          {t('ruleList.addButton')}
        </button>
      </div>

      {rules.length === 0 ? (
        <p className="rule-list__empty">{t('ruleList.emptyState')}</p>
      ) : (
        <div
          ref={containerRef}
          className="rule-list"
          role="grid"
          aria-label={t('ruleList.label')}
          aria-rowcount={rules.length}
          onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
          style={containerHeightProp !== undefined ? { height: containerHeightProp } : undefined}
        >
          <div
            className="rule-list__spacer"
            style={{ height: window_.topPadding }}
            aria-hidden="true"
          />
          {visibleRules.map((rule, offset) => {
            const index = window_.startIndex + offset;
            return (
              <div
                key={index}
                role="row"
                aria-rowindex={index + 1}
                className="rule-list__row"
                style={{ height: rowHeight }}
              >
                <span className="rule-list__index">{index + 1}</span>
                <span className="rule-list__text">{rule}</span>
                <button
                  type="button"
                  className="rule-list__edit-button"
                  onClick={() => setEditingIndex(index)}
                >
                  {t('ruleList.editButton', { index: index + 1 })}
                </button>
              </div>
            );
          })}
          <div
            className="rule-list__spacer"
            style={{ height: window_.bottomPadding }}
            aria-hidden="true"
          />
        </div>
      )}

      {creating && (
        <RuleEditor
          key="create"
          catalog={catalog}
          proxyTargetNames={proxyTargetNames}
          ruleProviderNames={ruleProviderNames}
          subRuleGroupNames={subRuleGroupNames}
          onSubmit={(text) => void handleCreateSubmit(text)}
          onCancel={() => setCreating(false)}
        />
      )}
      {editingIndex !== null && editingText !== undefined && (
        <RuleEditor
          key={`edit-${editingIndex}`}
          catalog={catalog}
          initialText={editingText}
          proxyTargetNames={proxyTargetNames}
          ruleProviderNames={ruleProviderNames}
          subRuleGroupNames={subRuleGroupNames}
          onSubmit={(text) => void handleEditSubmit(editingIndex, text)}
          onCancel={() => setEditingIndex(null)}
        />
      )}
    </div>
  );
}
