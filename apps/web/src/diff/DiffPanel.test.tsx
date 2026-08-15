// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { t } from '../i18n/index.js';
import type { DiffResponse, TextDiff } from '../worker/protocol.js';
import { DiffPanel } from './DiffPanel.js';
import type { DiffPanelWorkerClient } from './DiffPanel.js';

afterEach(() => {
  cleanup();
});

const IDENTICAL_DIFF: TextDiff = {
  hunks: [],
  added: 0,
  removed: 0,
  identical: true,
  trailingNewlineChanged: false,
};

const TRAILING_NEWLINE_DIFF: TextDiff = {
  hunks: [],
  added: 0,
  removed: 0,
  identical: false,
  trailingNewlineChanged: true,
};

const CHANGED_DIFF: TextDiff = {
  hunks: [
    {
      oldStart: 1,
      oldLines: 2,
      newStart: 1,
      newLines: 2,
      lines: [
        { op: 'remove', oldLine: 1, newLine: null, text: 'port: 7890' },
        { op: 'add', oldLine: null, newLine: 1, text: 'port: 7891' },
        { op: 'context', oldLine: 2, newLine: 2, text: 'mode: rule' },
      ],
    },
  ],
  added: 1,
  removed: 1,
  identical: false,
  trailingNewlineChanged: false,
};

function fakeClient(diff: TextDiff): DiffPanelWorkerClient & { diff: ReturnType<typeof vi.fn> } {
  return {
    diff: vi.fn(
      async (baseline: string): Promise<DiffResponse> =>
        ({ type: 'diff', requestId: 'x', diff, baseline }) as unknown as DiffResponse,
    ),
  };
}

describe('DiffPanel / baseline selection', () => {
  it('diffs against the imported baseline by default', async () => {
    const client = fakeClient(IDENTICAL_DIFF);
    render(
      <DiffPanel
        importBaseline="imported text"
        savedBaseline="saved text"
        client={client}
        issues={[]}
      />,
    );

    await waitFor(() => expect(client.diff).toHaveBeenCalledWith('imported text'));
  });

  it('re-diffs against the saved baseline once the selector is switched', async () => {
    const client = fakeClient(IDENTICAL_DIFF);
    render(
      <DiffPanel
        importBaseline="imported text"
        savedBaseline="saved text"
        client={client}
        issues={[]}
      />,
    );
    await waitFor(() => expect(client.diff).toHaveBeenCalledWith('imported text'));

    fireEvent.change(screen.getByLabelText(t('diff.baselineLabel')), {
      target: { value: 'saved' },
    });

    await waitFor(() => expect(client.diff).toHaveBeenCalledWith('saved text'));
  });
});

describe('DiffPanel / rendering', () => {
  it('shows the empty-diff message when the baseline is identical', async () => {
    render(
      <DiffPanel
        importBaseline="same"
        savedBaseline="same"
        client={fakeClient(IDENTICAL_DIFF)}
        issues={[]}
      />,
    );

    await screen.findByText(t('diff.emptyState'));
  });

  it('shows a distinct note for a trailing-newline-only change instead of "no changes"', async () => {
    render(
      <DiffPanel
        importBaseline="a"
        savedBaseline={'a\n'}
        client={fakeClient(TRAILING_NEWLINE_DIFF)}
        issues={[]}
      />,
    );

    await screen.findByText(t('diff.trailingNewlineNote'));
    expect(screen.queryByText(t('diff.emptyState'))).toBeNull();
  });

  it('renders +/- symbols on changed lines, not just a color, and a context line with neither', async () => {
    render(
      <DiffPanel
        importBaseline="before"
        savedBaseline="after"
        client={fakeClient(CHANGED_DIFF)}
        issues={[]}
      />,
    );

    await screen.findByText('port: 7890');
    expect(screen.getByText('port: 7890').previousSibling?.textContent).toBe('-');
    expect(screen.getByText('port: 7891').previousSibling?.textContent).toBe('+');
    expect(screen.getByText('mode: rule').previousSibling?.textContent).toBe(' ');
  });

  it('renders the added/removed summary count', async () => {
    render(
      <DiffPanel
        importBaseline="before"
        savedBaseline="after"
        client={fakeClient(CHANGED_DIFF)}
        issues={[]}
      />,
    );

    await screen.findByText(t('diff.summary', { added: 1, removed: 1 }));
  });
});

describe('DiffPanel / Worker document readiness (regression)', () => {
  it('does not crash and shows nothing when the diff request rejects', async () => {
    const client: DiffPanelWorkerClient = {
      diff: vi.fn(async () => Promise.reject(new Error('no document'))),
    };

    expect(() =>
      render(<DiffPanel importBaseline="a" savedBaseline="b" client={client} issues={[]} />),
    ).not.toThrow();
    await waitFor(() => expect(client.diff).toHaveBeenCalled());
    expect(screen.queryByText(t('diff.emptyState'))).toBeNull();
  });

  it("retries once a fresh issues reference arrives, recovering from the very first diff() racing the Worker's first parse", async () => {
    // DiffPanel mounts and calls diff() immediately, but the Worker only has
    // a document to diff against once YamlEditor's own debounced parse()
    // completes — so the first call is expected to lose that race.
    const diffMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('NO_DOCUMENT'))
      .mockResolvedValueOnce({
        type: 'diff',
        requestId: 'x',
        diff: IDENTICAL_DIFF,
      } as DiffResponse);
    const client: DiffPanelWorkerClient = { diff: diffMock };

    const { rerender } = render(
      <DiffPanel importBaseline="a" savedBaseline="a" client={client} issues={[]} />,
    );
    await waitFor(() => expect(diffMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(t('diff.emptyState'))).toBeNull();

    // A new (even if content-identical) `issues` array is exactly what
    // YamlEditor's onIssuesChange reports after every parse, including the
    // first successful one — this is the retry trigger, not a content diff.
    rerender(<DiffPanel importBaseline="a" savedBaseline="a" client={client} issues={[]} />);

    await waitFor(() => expect(diffMock).toHaveBeenCalledTimes(2));
    await screen.findByText(t('diff.emptyState'));
  });
});
