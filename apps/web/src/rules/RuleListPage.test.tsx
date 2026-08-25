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
    onApplyBatch: vi.fn().mockResolvedValue(undefined),
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

describe('RuleListPage / drag and keyboard reorder (v0.4.0 #9, FR-RULE-02, NFR-A11Y)', () => {
  const THREE_RULES = ['MATCH,A', 'MATCH,B', 'MATCH,C'];

  it('clicking a row selects it (aria-selected)', () => {
    render(
      <RuleListPage
        {...baseProps({
          rules: THREE_RULES,
          rowHeight: ROW_HEIGHT,
          containerHeight: CONTAINER_HEIGHT,
        })}
      />,
    );
    const rows = screen.getAllByRole('row');
    fireEvent.click(rows[1] as HTMLElement);
    expect(rows[1]?.getAttribute('aria-selected')).toBe('true');
    expect(rows[0]?.getAttribute('aria-selected')).toBe('false');
  });

  it('focusing a row selects it too, so a keyboard-only user (no click at all) can still select', () => {
    render(
      <RuleListPage
        {...baseProps({
          rules: THREE_RULES,
          rowHeight: ROW_HEIGHT,
          containerHeight: CONTAINER_HEIGHT,
        })}
      />,
    );
    const rows = screen.getAllByRole('row');
    fireEvent.focus(rows[2] as HTMLElement);
    expect(rows[2]?.getAttribute('aria-selected')).toBe('true');
  });

  it('Alt+ArrowDown on the selected row moves it down one position via onApplyFix', async () => {
    const onApplyFix = vi.fn<(fix: IssueFix) => Promise<void>>().mockResolvedValue(undefined);
    render(
      <RuleListPage
        {...baseProps({
          rules: THREE_RULES,
          rowHeight: ROW_HEIGHT,
          containerHeight: CONTAINER_HEIGHT,
          onApplyFix,
        })}
      />,
    );
    const grid = screen.getByRole('grid');
    const rows = screen.getAllByRole('row');
    fireEvent.click(rows[0] as HTMLElement);
    fireEvent.keyDown(grid, { key: 'ArrowDown', altKey: true });

    await vi.waitFor(() => {
      expect(onApplyFix).toHaveBeenCalledExactlyOnceWith({
        kind: 'move',
        path: ['rules'],
        from: 0,
        to: 1,
      });
    });
  });

  it('Alt+End moves the selected row straight to the last position', async () => {
    const onApplyFix = vi.fn<(fix: IssueFix) => Promise<void>>().mockResolvedValue(undefined);
    render(
      <RuleListPage
        {...baseProps({
          rules: THREE_RULES,
          rowHeight: ROW_HEIGHT,
          containerHeight: CONTAINER_HEIGHT,
          onApplyFix,
        })}
      />,
    );
    const grid = screen.getByRole('grid');
    fireEvent.click(screen.getAllByRole('row')[0] as HTMLElement);
    fireEvent.keyDown(grid, { key: 'End', altKey: true });

    await vi.waitFor(() => {
      expect(onApplyFix).toHaveBeenCalledExactlyOnceWith({
        kind: 'move',
        path: ['rules'],
        from: 0,
        to: 2,
      });
    });
  });

  it('announces the move via the aria-live region after it completes', async () => {
    const onApplyFix = vi.fn<(fix: IssueFix) => Promise<void>>().mockResolvedValue(undefined);
    render(
      <RuleListPage
        {...baseProps({
          rules: THREE_RULES,
          rowHeight: ROW_HEIGHT,
          containerHeight: CONTAINER_HEIGHT,
          onApplyFix,
        })}
      />,
    );
    const grid = screen.getByRole('grid');
    fireEvent.click(screen.getAllByRole('row')[0] as HTMLElement);
    fireEvent.keyDown(grid, { key: 'ArrowDown', altKey: true });

    await screen.findByRole('status');
    expect(screen.getByRole('status').textContent).toBe(
      t('ruleList.movedAnnouncement', { index: 2 }),
    );
  });

  it('does nothing at the top boundary (Alt+ArrowUp on the first row is a no-op, no onApplyFix call)', () => {
    const onApplyFix = vi.fn<(fix: IssueFix) => Promise<void>>().mockResolvedValue(undefined);
    render(
      <RuleListPage
        {...baseProps({
          rules: THREE_RULES,
          rowHeight: ROW_HEIGHT,
          containerHeight: CONTAINER_HEIGHT,
          onApplyFix,
        })}
      />,
    );
    const grid = screen.getByRole('grid');
    fireEvent.click(screen.getAllByRole('row')[0] as HTMLElement);
    fireEvent.keyDown(grid, { key: 'ArrowUp', altKey: true });

    expect(onApplyFix).not.toHaveBeenCalled();
  });

  it('a plain arrow key without Alt does not reorder', () => {
    const onApplyFix = vi.fn<(fix: IssueFix) => Promise<void>>().mockResolvedValue(undefined);
    render(
      <RuleListPage
        {...baseProps({
          rules: THREE_RULES,
          rowHeight: ROW_HEIGHT,
          containerHeight: CONTAINER_HEIGHT,
          onApplyFix,
        })}
      />,
    );
    const grid = screen.getByRole('grid');
    fireEvent.click(screen.getAllByRole('row')[0] as HTMLElement);
    fireEvent.keyDown(grid, { key: 'ArrowDown' });

    expect(onApplyFix).not.toHaveBeenCalled();
  });

  it('Alt+ArrowDown with no row selected does nothing', () => {
    const onApplyFix = vi.fn<(fix: IssueFix) => Promise<void>>().mockResolvedValue(undefined);
    render(
      <RuleListPage
        {...baseProps({
          rules: THREE_RULES,
          rowHeight: ROW_HEIGHT,
          containerHeight: CONTAINER_HEIGHT,
          onApplyFix,
        })}
      />,
    );
    fireEvent.keyDown(screen.getByRole('grid'), { key: 'ArrowDown', altKey: true });

    expect(onApplyFix).not.toHaveBeenCalled();
  });

  /**
   * jsdom's drag-event support is limited (no real `DataTransfer` drag
   * feel) — per the plan, the core reorder-target assertions live on
   * `reorder.ts`'s pure function and the keyboard path above; this only
   * checks that the native HTML5 drag handlers are wired to the same
   * `handleMove` and fire with the right indices, not that a real drag
   * "feels" right.
   */
  it('dragging row 0 and dropping it on row 2 reorders via the same onApplyFix move call as the keyboard path', async () => {
    const onApplyFix = vi.fn<(fix: IssueFix) => Promise<void>>().mockResolvedValue(undefined);
    render(
      <RuleListPage
        {...baseProps({
          rules: THREE_RULES,
          rowHeight: ROW_HEIGHT,
          containerHeight: CONTAINER_HEIGHT,
          onApplyFix,
        })}
      />,
    );
    const rows = screen.getAllByRole('row');
    const dataTransfer = { effectAllowed: '' };
    fireEvent.dragStart(rows[0] as HTMLElement, { dataTransfer });
    fireEvent.dragOver(rows[2] as HTMLElement, { dataTransfer });
    fireEvent.drop(rows[2] as HTMLElement, { dataTransfer });

    await vi.waitFor(() => {
      expect(onApplyFix).toHaveBeenCalledExactlyOnceWith({
        kind: 'move',
        path: ['rules'],
        from: 0,
        to: 2,
      });
    });
  });

  it('shows the drop-target indicator with the position the dragged row will land at', () => {
    render(
      <RuleListPage
        {...baseProps({
          rules: THREE_RULES,
          rowHeight: ROW_HEIGHT,
          containerHeight: CONTAINER_HEIGHT,
        })}
      />,
    );
    const rows = screen.getAllByRole('row');
    const dataTransfer = { effectAllowed: '' };
    fireEvent.dragStart(rows[0] as HTMLElement, { dataTransfer });
    fireEvent.dragOver(rows[2] as HTMLElement, { dataTransfer });

    expect(rows[2]?.textContent).toContain(t('ruleList.dropIndicator', { index: 3 }));
  });

  it('dragging and dropping a row onto itself does not call onApplyFix', () => {
    const onApplyFix = vi.fn<(fix: IssueFix) => Promise<void>>().mockResolvedValue(undefined);
    render(
      <RuleListPage
        {...baseProps({
          rules: THREE_RULES,
          rowHeight: ROW_HEIGHT,
          containerHeight: CONTAINER_HEIGHT,
          onApplyFix,
        })}
      />,
    );
    const rows = screen.getAllByRole('row');
    const dataTransfer = { effectAllowed: '' };
    fireEvent.dragStart(rows[0] as HTMLElement, { dataTransfer });
    fireEvent.dragOver(rows[0] as HTMLElement, { dataTransfer });
    fireEvent.drop(rows[0] as HTMLElement, { dataTransfer });

    expect(onApplyFix).not.toHaveBeenCalled();
  });
});

describe('RuleListPage / batch actions (v0.4.0 #10, FR-RULE-03, ADR-023)', () => {
  const FOUR_RULES = ['MATCH,A', 'MATCH,B', 'MATCH,C', 'MATCH,D'];

  it('shows no batch action bar until at least one row is checked', () => {
    render(
      <RuleListPage
        {...baseProps({
          rules: FOUR_RULES,
          rowHeight: ROW_HEIGHT,
          containerHeight: CONTAINER_HEIGHT,
        })}
      />,
    );
    expect(screen.queryByRole('toolbar')).toBeNull();
  });

  it('checking a row shows the batch bar with the correct selected count', () => {
    render(
      <RuleListPage
        {...baseProps({
          rules: FOUR_RULES,
          rowHeight: ROW_HEIGHT,
          containerHeight: CONTAINER_HEIGHT,
        })}
      />,
    );
    fireEvent.click(
      screen.getByRole('checkbox', { name: t('ruleList.batchCheckboxLabel', { index: 1 }) }),
    );
    fireEvent.click(
      screen.getByRole('checkbox', { name: t('ruleList.batchCheckboxLabel', { index: 3 }) }),
    );

    expect(screen.getByRole('toolbar')).not.toBeNull();
    expect(screen.getByText(t('ruleList.batchSelectedCount', { count: 2 }))).not.toBeNull();
  });

  it('checking a checkbox does not also select the row for keyboard reorder', () => {
    render(
      <RuleListPage
        {...baseProps({
          rules: FOUR_RULES,
          rowHeight: ROW_HEIGHT,
          containerHeight: CONTAINER_HEIGHT,
        })}
      />,
    );
    fireEvent.click(
      screen.getByRole('checkbox', { name: t('ruleList.batchCheckboxLabel', { index: 1 }) }),
    );

    expect(screen.getAllByRole('row')[0]?.getAttribute('aria-selected')).toBe('false');
  });

  it('batch move up sends a single move patch for the checked block via onApplyBatch, then clears the selection', async () => {
    const onApplyBatch = vi
      .fn<(patches: IssueFix[]) => Promise<void>>()
      .mockResolvedValue(undefined);
    render(
      <RuleListPage
        {...baseProps({
          rules: FOUR_RULES,
          rowHeight: ROW_HEIGHT,
          containerHeight: CONTAINER_HEIGHT,
          onApplyBatch,
        })}
      />,
    );
    fireEvent.click(
      screen.getByRole('checkbox', { name: t('ruleList.batchCheckboxLabel', { index: 2 }) }),
    );
    fireEvent.click(
      screen.getByRole('checkbox', { name: t('ruleList.batchCheckboxLabel', { index: 3 }) }),
    );
    fireEvent.click(screen.getByRole('button', { name: t('ruleList.batchMoveUpButton') }));

    await vi.waitFor(() => {
      expect(onApplyBatch).toHaveBeenCalledExactlyOnceWith([
        { kind: 'move', path: ['rules'], from: 0, to: 2 },
      ]);
    });
    await vi.waitFor(() => {
      expect(screen.queryByRole('toolbar')).toBeNull();
    });
  });

  it('batch delete sends descending-order remove patches for the checked rows', async () => {
    const onApplyBatch = vi
      .fn<(patches: IssueFix[]) => Promise<void>>()
      .mockResolvedValue(undefined);
    render(
      <RuleListPage
        {...baseProps({
          rules: FOUR_RULES,
          rowHeight: ROW_HEIGHT,
          containerHeight: CONTAINER_HEIGHT,
          onApplyBatch,
        })}
      />,
    );
    fireEvent.click(
      screen.getByRole('checkbox', { name: t('ruleList.batchCheckboxLabel', { index: 1 }) }),
    );
    fireEvent.click(
      screen.getByRole('checkbox', { name: t('ruleList.batchCheckboxLabel', { index: 3 }) }),
    );
    fireEvent.click(screen.getByRole('button', { name: t('ruleList.batchDeleteButton') }));

    await vi.waitFor(() => {
      expect(onApplyBatch).toHaveBeenCalledExactlyOnceWith([
        { kind: 'remove', path: ['rules', 2] },
        { kind: 'remove', path: ['rules', 0] },
      ]);
    });
  });

  it('batch copy sends append + move patches for the checked rows', async () => {
    const onApplyBatch = vi
      .fn<(patches: IssueFix[]) => Promise<void>>()
      .mockResolvedValue(undefined);
    render(
      <RuleListPage
        {...baseProps({
          rules: FOUR_RULES,
          rowHeight: ROW_HEIGHT,
          containerHeight: CONTAINER_HEIGHT,
          onApplyBatch,
        })}
      />,
    );
    fireEvent.click(
      screen.getByRole('checkbox', { name: t('ruleList.batchCheckboxLabel', { index: 1 }) }),
    );
    fireEvent.click(screen.getByRole('button', { name: t('ruleList.batchCopyButton') }));

    await vi.waitFor(() => {
      expect(onApplyBatch).toHaveBeenCalledExactlyOnceWith([
        { kind: 'append', path: ['rules'], value: 'MATCH,A' },
        { kind: 'move', path: ['rules'], from: 4, to: 1 },
      ]);
    });
  });

  it('batch replace target is disabled until a target is typed, then sends set patches for the checked rows', async () => {
    const onApplyBatch = vi
      .fn<(patches: IssueFix[]) => Promise<void>>()
      .mockResolvedValue(undefined);
    render(
      <RuleListPage
        {...baseProps({
          rules: FOUR_RULES,
          rowHeight: ROW_HEIGHT,
          containerHeight: CONTAINER_HEIGHT,
          onApplyBatch,
        })}
      />,
    );
    fireEvent.click(
      screen.getByRole('checkbox', { name: t('ruleList.batchCheckboxLabel', { index: 1 }) }),
    );
    fireEvent.click(
      screen.getByRole('checkbox', { name: t('ruleList.batchCheckboxLabel', { index: 2 }) }),
    );

    const applyButton = screen.getByRole('button', {
      name: t('ruleList.batchReplaceTargetApplyButton'),
    });
    expect(applyButton).toHaveProperty('disabled', true);

    fireEvent.change(screen.getByLabelText(t('ruleList.batchReplaceTargetLabel')), {
      target: { value: 'PROXY' },
    });
    expect(applyButton).toHaveProperty('disabled', false);
    fireEvent.click(applyButton);

    await vi.waitFor(() => {
      expect(onApplyBatch).toHaveBeenCalledExactlyOnceWith([
        { kind: 'set', path: ['rules', 0], value: 'MATCH,PROXY' },
        { kind: 'set', path: ['rules', 1], value: 'MATCH,PROXY' },
      ]);
    });
  });
});
