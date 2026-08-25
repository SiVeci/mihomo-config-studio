// @vitest-environment jsdom
import type { RuleTypeSpec } from '@mcs/schema-core';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { t } from '../i18n/index.js';
import type { IssueFix } from '../worker/protocol.js';
import { RuleListPage } from './RuleListPage.js';
import type { RuleListPageProps } from './RuleListPage.js';

afterEach(() => {
  cleanup();
});

const ROW_HEIGHT = 32;
const CONTAINER_HEIGHT = 320; // 10 rows visible

const MATCH: RuleTypeSpec = {
  type: 'MATCH',
  payloadKind: 'none',
  needsPayload: false,
  params: [],
  safety: 'safe',
};
const CATALOG: readonly RuleTypeSpec[] = [MATCH];

function manyRules(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `DOMAIN-SUFFIX,rule-${i}.example.com,DIRECT`);
}

function baseProps(overrides: Partial<RuleListPageProps> = {}): RuleListPageProps {
  return {
    rules: [],
    catalog: CATALOG,
    proxyTargetNames: [],
    ruleProviderNames: [],
    subRuleGroupNames: [],
    onApplyFix: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('RuleListPage (ADR-022, sequence numbers always visible)', () => {
  it('shows an empty state for an empty rules list', () => {
    render(<RuleListPage {...baseProps()} />);
    expect(screen.getByText(t('ruleList.emptyState'))).not.toBeNull();
  });

  it('renders every row for a small list, each with its 1-based sequence number and raw text', () => {
    render(
      <RuleListPage
        {...baseProps({
          rules: ['DOMAIN-SUFFIX,a.com,DIRECT', 'MATCH,PROXY'],
          rowHeight: ROW_HEIGHT,
          containerHeight: CONTAINER_HEIGHT,
        })}
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
        {...baseProps({
          rules: manyRules(10_000),
          rowHeight: ROW_HEIGHT,
          containerHeight: CONTAINER_HEIGHT,
        })}
      />,
    );
    const grid = screen.getByRole('grid');
    expect(grid.getAttribute('aria-rowcount')).toBe('10000');
  });

  it('renders far fewer DOM rows than the total item count at 10,000-row scale (virtualization is active)', () => {
    render(
      <RuleListPage
        {...baseProps({
          rules: manyRules(10_000),
          rowHeight: ROW_HEIGHT,
          containerHeight: CONTAINER_HEIGHT,
        })}
      />,
    );
    const rows = screen.getAllByRole('row');
    expect(rows.length).toBeLessThan(100);
    expect(rows.length).toBeGreaterThan(0);
  });

  it('shows row 9001 (index 9000) among the rendered rows after scrolling exactly to row 9000 — the number comes from data, not DOM order', () => {
    render(
      <RuleListPage
        {...baseProps({
          rules: manyRules(10_000),
          rowHeight: ROW_HEIGHT,
          containerHeight: CONTAINER_HEIGHT,
        })}
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
        {...baseProps({
          rules: manyRules(10_000),
          rowHeight: ROW_HEIGHT,
          containerHeight: CONTAINER_HEIGHT,
        })}
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
        {...baseProps({
          rules: manyRules(10_000),
          rowHeight: ROW_HEIGHT,
          containerHeight: CONTAINER_HEIGHT,
        })}
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

describe('RuleListPage / create and edit wiring (v0.4.0 #8, FR-RULE-01)', () => {
  it('opens the create dialog from the toolbar button and appends via onApplyFix when the list already has rules', async () => {
    const onApplyFix = vi.fn<(fix: IssueFix) => Promise<void>>().mockResolvedValue(undefined);
    render(
      <RuleListPage
        {...baseProps({
          rules: ['MATCH,DIRECT'],
          rowHeight: ROW_HEIGHT,
          containerHeight: CONTAINER_HEIGHT,
          onApplyFix,
        })}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: t('ruleList.addButton') }));
    expect(screen.getByRole('dialog')).not.toBeNull();

    fireEvent.change(screen.getByLabelText(t('ruleEditor.targetLabel')), {
      target: { value: 'REJECT' },
    });
    fireEvent.click(screen.getByRole('button', { name: t('ruleEditor.saveButton') }));

    await vi.waitFor(() => {
      expect(onApplyFix).toHaveBeenCalledExactlyOnceWith({
        kind: 'append',
        path: ['rules'],
        value: 'MATCH,REJECT',
      });
    });
    await vi.waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('writes the whole one-item array in a single set when the list is empty, instead of seeding [] then appending', async () => {
    const onApplyFix = vi.fn<(fix: IssueFix) => Promise<void>>().mockResolvedValue(undefined);
    render(<RuleListPage {...baseProps({ onApplyFix })} />);

    fireEvent.click(screen.getByRole('button', { name: t('ruleList.addButton') }));
    fireEvent.change(screen.getByLabelText(t('ruleEditor.targetLabel')), {
      target: { value: 'DIRECT' },
    });
    fireEvent.click(screen.getByRole('button', { name: t('ruleEditor.saveButton') }));

    await vi.waitFor(() => {
      expect(onApplyFix).toHaveBeenCalledExactlyOnceWith({
        kind: 'set',
        path: ['rules'],
        value: ['MATCH,DIRECT'],
      });
    });
  });

  it('opens the edit dialog for a specific row pre-filled with its text, and writes back via a set at that index', async () => {
    const onApplyFix = vi.fn<(fix: IssueFix) => Promise<void>>().mockResolvedValue(undefined);
    render(
      <RuleListPage
        {...baseProps({
          rules: ['MATCH,DIRECT', 'MATCH,REJECT'],
          rowHeight: ROW_HEIGHT,
          containerHeight: CONTAINER_HEIGHT,
          onApplyFix,
        })}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: t('ruleList.editButton', { index: 2 }) }));
    expect(screen.getByLabelText(t('ruleEditor.targetLabel'))).toHaveProperty('value', 'REJECT');

    fireEvent.change(screen.getByLabelText(t('ruleEditor.targetLabel')), {
      target: { value: 'PROXY' },
    });
    fireEvent.click(screen.getByRole('button', { name: t('ruleEditor.saveButton') }));

    await vi.waitFor(() => {
      expect(onApplyFix).toHaveBeenCalledExactlyOnceWith({
        kind: 'set',
        path: ['rules', 1],
        value: 'MATCH,PROXY',
      });
    });
  });

  it('closes the create dialog on Cancel without calling onApplyFix', () => {
    const onApplyFix = vi.fn<(fix: IssueFix) => Promise<void>>().mockResolvedValue(undefined);
    render(<RuleListPage {...baseProps({ rules: ['MATCH,DIRECT'], onApplyFix })} />);

    fireEvent.click(screen.getByRole('button', { name: t('ruleList.addButton') }));
    fireEvent.click(screen.getByRole('button', { name: t('ruleEditor.cancelButton') }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onApplyFix).not.toHaveBeenCalled();
  });
});
