// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { t } from '../i18n/index.js';
import type { TextRange, ValidationIssue } from '../worker/protocol.js';
import { IssuePanel } from './IssuePanel.js';
import type { IssuePanelWorkerClient } from './IssuePanel.js';

afterEach(() => {
  cleanup();
});

const RANGE_A: TextRange = {
  start: { offset: 0, line: 1, column: 1 },
  end: { offset: 4, line: 1, column: 5 },
};

const SYNTAX_ISSUE: ValidationIssue = {
  severity: 'error',
  code: 'yaml.syntax.BAD_INDENT',
  module: 'yaml',
  messageKey: 'yaml.syntax.BAD_INDENT',
  blocking: true,
  range: RANGE_A,
};

const SIZE_LIMIT_ISSUE: ValidationIssue = {
  severity: 'error',
  code: 'yaml.limit.size',
  module: 'yaml',
  messageKey: 'yaml.limit.size',
  messageParams: { bytes: 9_000_000, maxBytes: 8_000_000 },
  blocking: true,
  // No range and no path: this is a genuine shape produced by document.ts today.
};

const PATH_ONLY_ISSUE: ValidationIssue = {
  severity: 'warning',
  code: 'schema.example',
  module: 'general',
  messageKey: 'schema.example',
  blocking: false,
  path: ['proxies', 0, 'name'],
};

function fakeClient(range: TextRange | null = null): IssuePanelWorkerClient & {
  locate: ReturnType<typeof vi.fn>;
} {
  return {
    locate: vi.fn(async () => ({ type: 'locate' as const, requestId: 'x', range })),
  };
}

describe('IssuePanel / empty state', () => {
  it('shows an empty-state message when there are no issues', () => {
    render(<IssuePanel issues={[]} client={fakeClient()} onJump={vi.fn()} />);

    expect(screen.getByText(t('issues.emptyState'))).toBeDefined();
  });
});

describe('IssuePanel / grouping and non-color severity marks', () => {
  it('groups issues by severity with a count in each group heading', () => {
    render(
      <IssuePanel
        issues={[SYNTAX_ISSUE, SIZE_LIMIT_ISSUE, PATH_ONLY_ISSUE]}
        client={fakeClient()}
        onJump={vi.fn()}
      />,
    );

    expect(screen.getByText(`${t('issues.severityError')} (2)`, { exact: false })).toBeDefined();
    expect(screen.getByText(`${t('issues.severityWarning')} (1)`, { exact: false })).toBeDefined();
  });

  it('every severity renders its own non-color glyph, not just a CSS color', () => {
    const issues: ValidationIssue[] = [
      { ...SYNTAX_ISSUE, severity: 'error' },
      { ...SYNTAX_ISSUE, severity: 'warning' },
      { ...SYNTAX_ISSUE, severity: 'info' },
    ];
    render(<IssuePanel issues={issues} client={fakeClient()} onJump={vi.fn()} />);

    expect(screen.getAllByText('✕').length).toBeGreaterThan(0);
    expect(screen.getAllByText('▲').length).toBeGreaterThan(0);
    expect(screen.getAllByText('ℹ').length).toBeGreaterThan(0);
  });

  it('does not render an empty group for a severity with no issues', () => {
    render(<IssuePanel issues={[SYNTAX_ISSUE]} client={fakeClient()} onJump={vi.fn()} />);

    expect(screen.queryByText(t('issues.severityWarning'), { exact: false })).toBeNull();
    expect(screen.queryByText(t('issues.severityInfo'), { exact: false })).toBeNull();
  });
});

describe('IssuePanel / module filter', () => {
  it('hides the module filter when every issue shares one module', () => {
    render(
      <IssuePanel
        issues={[SYNTAX_ISSUE, SIZE_LIMIT_ISSUE]}
        client={fakeClient()}
        onJump={vi.fn()}
      />,
    );

    expect(screen.queryByLabelText(t('issues.moduleFilterLabel'))).toBeNull();
  });

  it('filters the list down to the selected module', () => {
    render(
      <IssuePanel
        issues={[SYNTAX_ISSUE, PATH_ONLY_ISSUE]}
        client={fakeClient()}
        onJump={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText(t('issues.moduleFilterLabel')), {
      target: { value: 'general' },
    });

    expect(screen.queryByText(t('issues.severityError'), { exact: false })).toBeNull();
    expect(screen.getByText(t('issues.severityWarning'), { exact: false })).toBeDefined();
  });

  it('"all" shows every module again', () => {
    render(
      <IssuePanel
        issues={[SYNTAX_ISSUE, PATH_ONLY_ISSUE]}
        client={fakeClient()}
        onJump={vi.fn()}
      />,
    );
    const select = screen.getByLabelText(t('issues.moduleFilterLabel'));

    fireEvent.change(select, { target: { value: 'general' } });
    fireEvent.change(select, { target: { value: 'all' } });

    expect(screen.getByText(t('issues.severityError'), { exact: false })).toBeDefined();
    expect(screen.getByText(t('issues.severityWarning'), { exact: false })).toBeDefined();
  });
});

describe('IssuePanel / message rendering (ADR-016 first real i18n-key consumer)', () => {
  it('renders a known messageKey with its interpolated params', () => {
    render(<IssuePanel issues={[SIZE_LIMIT_ISSUE]} client={fakeClient()} onJump={vi.fn()} />);

    expect(
      screen.getByText(t('yaml.limit.size', { bytes: 9_000_000, maxBytes: 8_000_000 })),
    ).toBeDefined();
  });

  it('stringifies a non-primitive messageParam (e.g. a ConfigPath) rather than dropping it', () => {
    // Exploits `t()`'s fallback-to-raw-key behaviour (the key itself becomes
    // the interpolation template when untranslated) so the stringified value
    // is actually observable in the rendered text, rather than asserting
    // against a real key whose template happens not to reference the param.
    const withPathParam: ValidationIssue = {
      severity: 'error',
      code: 'yaml.custom.x',
      module: 'yaml',
      messageKey: 'yaml.custom.{offendingPath}',
      messageParams: { offendingPath: ['proxies', 0, 'name'] },
      blocking: true,
      range: RANGE_A,
    };
    render(<IssuePanel issues={[withPathParam]} client={fakeClient()} onJump={vi.fn()} />);

    expect(screen.getByText(`yaml.custom.${JSON.stringify(['proxies', 0, 'name'])}`)).toBeDefined();
  });

  it('falls back to the raw key for a messageKey with no translated resource entry', () => {
    const unknown: ValidationIssue = {
      severity: 'error',
      code: 'yaml.syntax.SOME_FUTURE_CODE',
      module: 'yaml',
      messageKey: 'yaml.syntax.SOME_FUTURE_CODE',
      blocking: true,
      range: RANGE_A,
    };
    render(<IssuePanel issues={[unknown]} client={fakeClient()} onJump={vi.fn()} />);

    expect(screen.getByText('yaml.syntax.SOME_FUTURE_CODE')).toBeDefined();
  });
});

describe('IssuePanel / jump (FR-VAL-02)', () => {
  it('jumps directly using issue.range without calling client.locate', async () => {
    const client = fakeClient();
    const onJump = vi.fn();
    render(<IssuePanel issues={[SYNTAX_ISSUE]} client={client} onJump={onJump} />);

    fireEvent.click(screen.getByRole('button'));

    expect(onJump).toHaveBeenCalledWith(RANGE_A);
    expect(client.locate).not.toHaveBeenCalled();
  });

  it('falls back to client.locate(issue.path) when range is missing, then jumps with the resolved range', async () => {
    const resolvedRange: TextRange = {
      start: { offset: 20, line: 3, column: 1 },
      end: { offset: 24, line: 3, column: 5 },
    };
    const client = fakeClient(resolvedRange);
    const onJump = vi.fn();
    render(<IssuePanel issues={[PATH_ONLY_ISSUE]} client={client} onJump={onJump} />);

    fireEvent.click(screen.getByRole('button'));

    expect(client.locate).toHaveBeenCalledWith(['proxies', 0, 'name']);
    await waitFor(() => expect(onJump).toHaveBeenCalledWith(resolvedRange));
  });

  it('does not call onJump when locate resolves to a null range', async () => {
    const client = fakeClient(null);
    const onJump = vi.fn();
    render(<IssuePanel issues={[PATH_ONLY_ISSUE]} client={client} onJump={onJump} />);

    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => expect(client.locate).toHaveBeenCalled());
    expect(onJump).not.toHaveBeenCalled();
  });

  it('renders an issue with neither range nor path as non-interactive, not a dead button', () => {
    render(<IssuePanel issues={[SIZE_LIMIT_ISSUE]} client={fakeClient()} onJump={vi.fn()} />);

    expect(screen.queryByRole('button')).toBeNull();
    expect(
      screen.getByText(t('yaml.limit.size', { bytes: 9_000_000, maxBytes: 8_000_000 })),
    ).toBeDefined();
  });
});
