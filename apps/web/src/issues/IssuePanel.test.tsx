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

const RANGE_AND_PATH_ISSUE: ValidationIssue = {
  severity: 'warning',
  code: 'schema.both',
  module: 'general',
  messageKey: 'schema.both',
  blocking: false,
  range: RANGE_A,
  path: ['dns', 'nameserver'],
};

/**
 * `getByRole('button', { name: string, exact: false })` does not reliably
 * substring-match an `aria-label` containing this project's mixed CJK/Latin
 * button labels in this environment (confirmed via a throwaway scratch test:
 * the exact same string, matched with a `RegExp` instead, finds the element
 * every time) — a `RegExp` sidesteps whatever `exact: false` string matching
 * is doing differently here. `text` never contains regex metacharacters (the
 * i18n strings this is used with are plain CJK/Latin words), so no escaping.
 */
function byButtonName(text: string): RegExp {
  return new RegExp(text);
}

function fakeClient(range: TextRange | null = null): IssuePanelWorkerClient & {
  locate: ReturnType<typeof vi.fn>;
} {
  return {
    locate: vi.fn(async () => ({ type: 'locate' as const, requestId: 'x', range })),
  };
}

describe('IssuePanel / empty state', () => {
  it('shows an empty-state message when there are no issues', () => {
    render(
      <IssuePanel issues={[]} client={fakeClient()} onJump={vi.fn()} onJumpToField={vi.fn()} />,
    );

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
        onJumpToField={vi.fn()}
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
    render(
      <IssuePanel issues={issues} client={fakeClient()} onJump={vi.fn()} onJumpToField={vi.fn()} />,
    );

    expect(screen.getAllByText('✕').length).toBeGreaterThan(0);
    expect(screen.getAllByText('▲').length).toBeGreaterThan(0);
    expect(screen.getAllByText('ℹ').length).toBeGreaterThan(0);
  });

  it('does not render an empty group for a severity with no issues', () => {
    render(
      <IssuePanel
        issues={[SYNTAX_ISSUE]}
        client={fakeClient()}
        onJump={vi.fn()}
        onJumpToField={vi.fn()}
      />,
    );

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
        onJumpToField={vi.fn()}
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
        onJumpToField={vi.fn()}
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
        onJumpToField={vi.fn()}
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
    render(
      <IssuePanel
        issues={[SIZE_LIMIT_ISSUE]}
        client={fakeClient()}
        onJump={vi.fn()}
        onJumpToField={vi.fn()}
      />,
    );

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
    render(
      <IssuePanel
        issues={[withPathParam]}
        client={fakeClient()}
        onJump={vi.fn()}
        onJumpToField={vi.fn()}
      />,
    );

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
    render(
      <IssuePanel
        issues={[unknown]}
        client={fakeClient()}
        onJump={vi.fn()}
        onJumpToField={vi.fn()}
      />,
    );

    expect(screen.getByText('yaml.syntax.SOME_FUTURE_CODE')).toBeDefined();
  });
});

describe('IssuePanel / jump (FR-VAL-02)', () => {
  it('jumps directly using issue.range without calling client.locate', async () => {
    const client = fakeClient();
    const onJump = vi.fn();
    render(
      <IssuePanel
        issues={[SYNTAX_ISSUE]}
        client={client}
        onJump={onJump}
        onJumpToField={vi.fn()}
      />,
    );

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
    render(
      <IssuePanel
        issues={[PATH_ONLY_ISSUE]}
        client={client}
        onJump={onJump}
        onJumpToField={vi.fn()}
      />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: byButtonName(t('issues.jumpToLineLabel')) }),
    );

    expect(client.locate).toHaveBeenCalledWith(['proxies', 0, 'name']);
    await waitFor(() => expect(onJump).toHaveBeenCalledWith(resolvedRange));
  });

  it('does not call onJump when locate resolves to a null range', async () => {
    const client = fakeClient(null);
    const onJump = vi.fn();
    render(
      <IssuePanel
        issues={[PATH_ONLY_ISSUE]}
        client={client}
        onJump={onJump}
        onJumpToField={vi.fn()}
      />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: byButtonName(t('issues.jumpToLineLabel')) }),
    );

    await waitFor(() => expect(client.locate).toHaveBeenCalled());
    expect(onJump).not.toHaveBeenCalled();
  });

  it('renders an issue with neither range nor path as non-interactive, not a dead button', () => {
    render(
      <IssuePanel
        issues={[SIZE_LIMIT_ISSUE]}
        client={fakeClient()}
        onJump={vi.fn()}
        onJumpToField={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button')).toBeNull();
    expect(
      screen.getByText(t('yaml.limit.size', { bytes: 9_000_000, maxBytes: 8_000_000 })),
    ).toBeDefined();
  });
});

describe('IssuePanel / jump to form field (FR-VAL-02, v0.3.0 #16)', () => {
  it('an issue with only a path offers a form-field jump button that calls onJumpToField directly, not client.locate', () => {
    const client = fakeClient();
    const onJumpToField = vi.fn();
    render(
      <IssuePanel
        issues={[PATH_ONLY_ISSUE]}
        client={client}
        onJump={vi.fn()}
        onJumpToField={onJumpToField}
      />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: byButtonName(t('issues.jumpToFieldLabel')) }),
    );

    expect(onJumpToField).toHaveBeenCalledWith(['proxies', 0, 'name']);
    expect(client.locate).not.toHaveBeenCalled();
  });

  it('an issue with only a range offers no form-field jump button — path is what jump-to-field needs, not range', () => {
    render(
      <IssuePanel
        issues={[SYNTAX_ISSUE]}
        client={fakeClient()}
        onJump={vi.fn()}
        onJumpToField={vi.fn()}
      />,
    );

    expect(
      screen.queryByRole('button', { name: byButtonName(t('issues.jumpToFieldLabel')) }),
    ).toBeNull();
  });

  it('an issue with both range and path offers both entry points, independently — neither is a fallback for the other', () => {
    const client = fakeClient();
    const onJump = vi.fn();
    const onJumpToField = vi.fn();
    render(
      <IssuePanel
        issues={[RANGE_AND_PATH_ISSUE]}
        client={client}
        onJump={onJump}
        onJumpToField={onJumpToField}
      />,
    );

    const lineButton = screen.getByRole('button', {
      name: byButtonName(t('issues.jumpToLineLabel')),
    });
    const fieldButton = screen.getByRole('button', {
      name: byButtonName(t('issues.jumpToFieldLabel')),
    });

    fireEvent.click(lineButton);
    expect(onJump).toHaveBeenCalledWith(RANGE_A);
    expect(client.locate).not.toHaveBeenCalled();
    expect(onJumpToField).not.toHaveBeenCalled();

    fireEvent.click(fieldButton);
    expect(onJumpToField).toHaveBeenCalledWith(['dns', 'nameserver']);
  });
});
