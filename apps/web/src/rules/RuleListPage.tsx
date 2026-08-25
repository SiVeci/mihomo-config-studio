import { computeVirtualWindow } from '@mcs/ui';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { t } from '../i18n/index.js';
import './RuleListPage.css';

const DEFAULT_ROW_HEIGHT = 32;
const DEFAULT_CONTAINER_HEIGHT = 480;
const OVERSCAN = 6;

export interface RuleListPageProps {
  /** The `rules:` array, exactly as it lives in the document — this component never parses or reorders a line itself (that is #8/#9's job). */
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
}

/**
 * Sequence-numbered, virtualized rule list (ADR-022): renders only the rows
 * near the current scroll position, regardless of how many thousands of
 * rules exist, while every row still shows its true position in the full
 * list (`index + 1`, computed from `computeVirtualWindow`'s `startIndex`,
 * never from DOM order — jsdom or a real browser scrolled to row 9000 shows
 * "9001" on the first rendered row either way).
 *
 * Read-only in this slice: structured editing (#8), drag/keyboard reorder
 * (#9) and batch selection (#10) all render through this same virtualized
 * shell later, not a replacement for it.
 */
export function RuleListPage({
  rules,
  rowHeight = DEFAULT_ROW_HEIGHT,
  containerHeight: containerHeightProp,
}: RuleListPageProps): ReactNode {
  const containerRef = useRef<HTMLDivElement>(null);
  const [measuredHeight, setMeasuredHeight] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);

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

  if (rules.length === 0) {
    return <p className="rule-list__empty">{t('ruleList.emptyState')}</p>;
  }

  const visibleRules = rules.slice(window_.startIndex, window_.endIndex);

  return (
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
          </div>
        );
      })}
      <div
        className="rule-list__spacer"
        style={{ height: window_.bottomPadding }}
        aria-hidden="true"
      />
    </div>
  );
}
