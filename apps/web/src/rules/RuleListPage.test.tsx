// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { t } from '../i18n/index.js';
import { RuleListPage } from './RuleListPage.js';

afterEach(() => {
  cleanup();
});

const ROW_HEIGHT = 32;
const CONTAINER_HEIGHT = 320; // 10 rows visible

function manyRules(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `DOMAIN-SUFFIX,rule-${i}.example.com,DIRECT`);
}

describe('RuleListPage (ADR-022, sequence numbers always visible)', () => {
  it('shows an empty state for an empty rules list', () => {
    render(<RuleListPage rules={[]} />);
    expect(screen.getByText(t('ruleList.emptyState'))).not.toBeNull();
  });

  it('renders every row for a small list, each with its 1-based sequence number and raw text', () => {
    render(
      <RuleListPage
        rules={['DOMAIN-SUFFIX,a.com,DIRECT', 'MATCH,PROXY']}
        rowHeight={ROW_HEIGHT}
        containerHeight={CONTAINER_HEIGHT}
      />,
    );
    const rows = screen.getAllByRole('row');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain('1');
    expect(rows[0]?.textContent).toContain('DOMAIN-SUFFIX,a.com,DIRECT');
    expect(rows[1]?.textContent).toContain('2');
    expect(rows[1]?.textContent).toContain('MATCH,PROXY');
  });

  it('declares the true total row count via aria-rowcount, not the number of DOM rows', () => {
    render(
      <RuleListPage
        rules={manyRules(10_000)}
        rowHeight={ROW_HEIGHT}
        containerHeight={CONTAINER_HEIGHT}
      />,
    );
    const grid = screen.getByRole('grid');
    expect(grid.getAttribute('aria-rowcount')).toBe('10000');
  });

  it('renders far fewer DOM rows than the total item count at 10,000-row scale (virtualization is active)', () => {
    render(
      <RuleListPage
        rules={manyRules(10_000)}
        rowHeight={ROW_HEIGHT}
        containerHeight={CONTAINER_HEIGHT}
      />,
    );
    const rows = screen.getAllByRole('row');
    expect(rows.length).toBeLessThan(100);
    expect(rows.length).toBeGreaterThan(0);
  });

  it('shows row 9001 (index 9000) among the rendered rows after scrolling exactly to row 9000 — the number comes from data, not DOM order', () => {
    render(
      <RuleListPage
        rules={manyRules(10_000)}
        rowHeight={ROW_HEIGHT}
        containerHeight={CONTAINER_HEIGHT}
      />,
    );
    const grid = screen.getByRole('grid');
    fireEvent.scroll(grid, { target: { scrollTop: 9000 * ROW_HEIGHT } });

    const rows = screen.getAllByRole('row');
    const scrolledToRow = rows.find((row) => row.getAttribute('aria-rowindex') === '9001');
    expect(scrolledToRow).toBeDefined();
    expect(scrolledToRow?.textContent).toContain('9001');
    expect(scrolledToRow?.textContent).toContain('rule-9000');

    // Every rendered row's visible number matches its own aria-rowindex —
    // never a DOM-position-derived count that would drift under overscan.
    for (const row of rows) {
      const rowIndex = row.getAttribute('aria-rowindex');
      expect(row.textContent?.startsWith(rowIndex as string)).toBe(true);
    }
  });

  it('shows the last row (10000) when scrolled to the very bottom', () => {
    render(
      <RuleListPage
        rules={manyRules(10_000)}
        rowHeight={ROW_HEIGHT}
        containerHeight={CONTAINER_HEIGHT}
      />,
    );
    const grid = screen.getByRole('grid');
    fireEvent.scroll(grid, { target: { scrollTop: 10_000 * ROW_HEIGHT } });

    const rows = screen.getAllByRole('row');
    const lastRow = rows[rows.length - 1];
    expect(lastRow?.getAttribute('aria-rowindex')).toBe('10000');
  });

  it('keeps the scrollable spacer sized to the full list, not just the rendered rows (topPadding + rows + bottomPadding = total)', () => {
    const { container } = render(
      <RuleListPage
        rules={manyRules(10_000)}
        rowHeight={ROW_HEIGHT}
        containerHeight={CONTAINER_HEIGHT}
      />,
    );
    const grid = container.querySelector('.rule-list');
    const spacers = grid?.querySelectorAll('.rule-list__spacer') ?? [];
    const rows = screen.getAllByRole('row');

    const topHeight = Number((spacers[0] as HTMLElement).style.height.replace('px', ''));
    const bottomHeight = Number((spacers[1] as HTMLElement).style.height.replace('px', ''));
    const rowsHeight = rows.length * ROW_HEIGHT;

    expect(topHeight + rowsHeight + bottomHeight).toBe(10_000 * ROW_HEIGHT);
  });
});
