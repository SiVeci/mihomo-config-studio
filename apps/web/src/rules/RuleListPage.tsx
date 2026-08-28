import type { RuleTypeSpec } from '@mcs/schema-core';
import { computeVirtualWindow } from '@mcs/ui';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';

import { t } from '../i18n/index.js';
import type { IssueFix } from '../worker/protocol.js';
import {
  buildBatchCopyPatches,
  buildBatchDeletePatches,
  buildBatchMovePatches,
  buildBatchReplaceTargetPatches,
} from './batch.js';
import { RuleEditor } from './RuleEditor.js';
import { computeReorderTarget, type ReorderOperation } from './reorder.js';
import './RuleListPage.css';

const DEFAULT_ROW_HEIGHT = 32;
const DEFAULT_CONTAINER_HEIGHT = 480;
const OVERSCAN = 6;

/** Alt+Arrow/Home/End — the equivalent keyboard path to dragging a row (NFR-A11Y, PRD §11.6). */
const KEY_TO_REORDER_OPERATION: Record<string, ReorderOperation> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  Home: 'home',
  End: 'end',
};

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
  /** One atomic, single-undo-step write for a whole batch of patches (v0.4.0 #10, ADR-023) — the multi-select action bar's only write path. */
  readonly onApplyBatch: (patches: IssueFix[]) => Promise<void>;
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
 * inside one. Drag/keyboard reorder (#9) render through this same
 * virtualized shell; batch selection (#10) renders through it later.
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
  onApplyBatch,
}: RuleListPageProps): ReactNode {
  const containerRef = useRef<HTMLDivElement>(null);
  const [measuredHeight, setMeasuredHeight] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [creating, setCreating] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [checkedIndices, setCheckedIndices] = useState<ReadonlySet<number>>(new Set());
  const [replaceTargetInput, setReplaceTargetInput] = useState('');

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

  /** Scrolls the minimum amount needed to bring `index` into the visible window — a moved row must stay visible, not vanish off the currently-rendered range. */
  function ensureRowVisible(index: number): void {
    const rowTop = index * rowHeight;
    const rowBottom = rowTop + rowHeight;
    setScrollTop((current) => {
      if (rowTop < current) return rowTop;
      if (rowBottom > current + containerHeight) return rowBottom - containerHeight;
      return current;
    });
  }

  /**
   * Shared by the keyboard path and drag-and-drop: both end up calling this
   * with a `from`/`to` pair, so the two are guaranteed to produce the exact
   * same document write for the exact same logical move rather than two
   * hand-kept-in-sync code paths.
   */
  async function handleMove(from: number, to: number): Promise<void> {
    if (from === to) return;
    await onApplyFix({ kind: 'move', path: ['rules'], from, to });
    setSelectedIndex(to);
    ensureRowVisible(to);
    setAnnouncement(t('ruleList.movedAnnouncement', { index: to + 1 }));
  }

  /** Alt+↑/↓/Home/End on a selected row — the full keyboard-equivalent of dragging it (NFR-A11Y). Handled on the grid, not per-row, so it keeps working across virtualization's mount/unmount churn. */
  function handleGridKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (!event.altKey || selectedIndex === null) return;
    const operation = KEY_TO_REORDER_OPERATION[event.key];
    if (!operation) return;
    event.preventDefault();
    const target = computeReorderTarget({
      itemCount: rules.length,
      index: selectedIndex,
      operation,
    });
    void handleMove(selectedIndex, target);
  }

  function handleDragStart(index: number) {
    return (event: ReactDragEvent<HTMLDivElement>): void => {
      setDraggedIndex(index);
      event.dataTransfer.effectAllowed = 'move';
    };
  }

  function handleDragOver(index: number) {
    return (event: ReactDragEvent<HTMLDivElement>): void => {
      if (draggedIndex === null) return;
      // Required for this element to become a valid drop target at all
      // (native HTML5 drag-and-drop, E2 — no library).
      event.preventDefault();
      if (dragOverIndex !== index) setDragOverIndex(index);
    };
  }

  function handleDrop(index: number) {
    return (event: ReactDragEvent<HTMLDivElement>): void => {
      event.preventDefault();
      if (draggedIndex !== null) void handleMove(draggedIndex, index);
      setDraggedIndex(null);
      setDragOverIndex(null);
    };
  }

  function handleDragEnd(): void {
    setDraggedIndex(null);
    setDragOverIndex(null);
  }

  function toggleChecked(index: number): void {
    setCheckedIndices((previous) => {
      const next = new Set(previous);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  /**
   * Every batch action clears the selection afterward: a batch can change
   * array length (copy) or shift positions (move, delete), so whatever the
   * checked indices meant before no longer reliably names the same rows —
   * clearing is safer than trying to remap them.
   */
  async function runBatch(patches: IssueFix[]): Promise<void> {
    if (patches.length === 0) return;
    await onApplyBatch(patches);
    setCheckedIndices(new Set());
  }

  async function handleBatchMove(direction: 'up' | 'down'): Promise<void> {
    await runBatch(buildBatchMovePatches([...checkedIndices], rules.length, direction));
  }

  async function handleBatchCopy(): Promise<void> {
    await runBatch(buildBatchCopyPatches([...checkedIndices], rules));
  }

  async function handleBatchDelete(): Promise<void> {
    await runBatch(buildBatchDeletePatches([...checkedIndices]));
  }

  async function handleBatchReplaceTarget(): Promise<void> {
    const newTarget = replaceTargetInput.trim();
    if (!newTarget) return;
    await runBatch(buildBatchReplaceTargetPatches([...checkedIndices], rules, catalog, newTarget));
    setReplaceTargetInput('');
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

      {checkedIndices.size > 0 && (
        <div
          className="rule-list-page__batch-bar"
          role="toolbar"
          aria-label={t('ruleList.batchToolbarLabel')}
        >
          <span className="rule-list-page__batch-count">
            {t('ruleList.batchSelectedCount', { count: checkedIndices.size })}
          </span>
          <button type="button" onClick={() => void handleBatchMove('up')}>
            {t('ruleList.batchMoveUpButton')}
          </button>
          <button type="button" onClick={() => void handleBatchMove('down')}>
            {t('ruleList.batchMoveDownButton')}
          </button>
          <button type="button" onClick={() => void handleBatchCopy()}>
            {t('ruleList.batchCopyButton')}
          </button>
          <button type="button" onClick={() => void handleBatchDelete()}>
            {t('ruleList.batchDeleteButton')}
          </button>
          <label className="rule-list-page__batch-replace">
            {t('ruleList.batchReplaceTargetLabel')}
            <input
              type="text"
              list="rule-list-batch-targets"
              value={replaceTargetInput}
              onChange={(event) => setReplaceTargetInput(event.target.value)}
            />
          </label>
          <button
            type="button"
            disabled={replaceTargetInput.trim() === ''}
            onClick={() => void handleBatchReplaceTarget()}
          >
            {t('ruleList.batchReplaceTargetApplyButton')}
          </button>
          <datalist id="rule-list-batch-targets">
            {proxyTargetNames.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </div>
      )}

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
          onKeyDown={handleGridKeyDown}
          style={containerHeightProp !== undefined ? { height: containerHeightProp } : undefined}
        >
          <div
            className="rule-list__spacer"
            style={{ height: window_.topPadding }}
            aria-hidden="true"
          />
          {visibleRules.map((rule, offset) => {
            const index = window_.startIndex + offset;
            const isDragTarget =
              dragOverIndex === index && draggedIndex !== null && draggedIndex !== index;
            const rowClassName = [
              'rule-list__row',
              index === selectedIndex ? 'rule-list__row--selected' : '',
              draggedIndex === index ? 'rule-list__row--dragging' : '',
              isDragTarget ? 'rule-list__row--drag-over' : '',
            ]
              .filter(Boolean)
              .join(' ');
            return (
              <div
                key={index}
                role="row"
                aria-rowindex={index + 1}
                aria-selected={index === selectedIndex}
                aria-label={t('ruleList.rowLabel', { index: index + 1, text: rule })}
                tabIndex={0}
                draggable
                className={rowClassName}
                style={{ height: rowHeight }}
                onClick={() => setSelectedIndex(index)}
                onFocus={() => setSelectedIndex(index)}
                onDragStart={handleDragStart(index)}
                onDragOver={handleDragOver(index)}
                onDrop={handleDrop(index)}
                onDragEnd={handleDragEnd}
              >
                <input
                  type="checkbox"
                  className="rule-list__checkbox"
                  aria-label={t('ruleList.batchCheckboxLabel', { index: index + 1 })}
                  checked={checkedIndices.has(index)}
                  onChange={() => toggleChecked(index)}
                  onClick={(event) => event.stopPropagation()}
                />
                <span className="rule-list__index">{index + 1}</span>
                <span className="rule-list__text">{rule}</span>
                {isDragTarget && (
                  <span className="rule-list__drop-indicator" aria-hidden="true">
                    {t('ruleList.dropIndicator', { index: index + 1 })}
                  </span>
                )}
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
      <div className="rule-list-page__live-region" role="status" aria-live="polite">
        {announcement}
      </div>

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
