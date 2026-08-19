// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { t } from '../i18n/index.js';
import type { ValidationIssue } from '../worker/protocol.js';
import { YamlEditor } from './YamlEditor.js';
import type { YamlEditorHandle, YamlEditorWorkerClient } from './YamlEditor.js';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const BLOCKING_ISSUE: ValidationIssue = {
  severity: 'error',
  code: 'yaml.syntax.BAD_INDENT',
  module: 'yaml',
  messageKey: 'yaml.syntax.BAD_INDENT',
  blocking: true,
  range: { start: { offset: 5, line: 2, column: 3 }, end: { offset: 6, line: 2, column: 4 } },
};

function makeClient(issues: ValidationIssue[] = []): YamlEditorWorkerClient & {
  parse: ReturnType<typeof vi.fn>;
  serialize: ReturnType<typeof vi.fn>;
} {
  return {
    parse: vi.fn(async (_text: string) => ({
      type: 'parse' as const,
      requestId: 'x',
      issues,
      value: {},
    })),
    serialize: vi.fn(async () => ({
      type: 'serialize' as const,
      requestId: 'x',
      text: 'formatted\n',
    })),
  };
}

/**
 * Advances the fake clock and flushes the resulting `parse().then(setIssues)`
 * microtask chain inside `act()`: that state update is triggered from a timer
 * callback, not a React event handler, so React does not commit it
 * synchronously unless `act()` forces the flush — `advanceTimersByTimeAsync`
 * alone drains microtasks but knows nothing about React's own scheduling.
 */
async function advanceDebounce(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('YamlEditor / line numbers', () => {
  it('renders one gutter line per line of text', () => {
    render(<YamlEditor text={'a\nb\nc'} onChange={vi.fn()} client={makeClient()} />);

    expect(screen.getByText('1')).toBeDefined();
    expect(screen.getByText('2')).toBeDefined();
    expect(screen.getByText('3')).toBeDefined();
    expect(screen.queryByText('4')).toBeNull();
  });

  it('renders exactly one gutter line for empty text', () => {
    render(<YamlEditor text="" onChange={vi.fn()} client={makeClient()} />);

    expect(screen.getByText('1')).toBeDefined();
    expect(screen.queryByText('2')).toBeNull();
  });
});

describe('YamlEditor / editing', () => {
  it('calls onChange with the new text as the user types', () => {
    const onChange = vi.fn();
    render(<YamlEditor text="mode: rule" onChange={onChange} client={makeClient()} />);

    fireEvent.change(screen.getByLabelText(t('editor.title')), {
      target: { value: 'mode: direct' },
    });

    expect(onChange).toHaveBeenCalledWith('mode: direct');
  });

  it('keeps the line-number gutter scrolled in sync with the textarea', () => {
    render(<YamlEditor text={'a\nb\nc'} onChange={vi.fn()} client={makeClient()} />);
    const textarea = screen.getByLabelText<HTMLTextAreaElement>(t('editor.title'));
    const gutter = textarea.parentElement!.querySelector('.yaml-editor__gutter') as HTMLDivElement;

    Object.defineProperty(textarea, 'scrollTop', { value: 42, configurable: true });
    fireEvent.scroll(textarea);

    expect(gutter.scrollTop).toBe(42);
  });
});

describe('YamlEditor / debounced parse (NFR-PERF-03)', () => {
  it('does not parse before the debounce window elapses', async () => {
    const client = makeClient();
    render(<YamlEditor text="mode: rule" onChange={vi.fn()} client={client} />);

    await advanceDebounce(299);

    expect(client.parse).not.toHaveBeenCalled();
  });

  it('parses once the debounce window elapses', async () => {
    const client = makeClient();
    render(<YamlEditor text="mode: rule" onChange={vi.fn()} client={client} />);

    await advanceDebounce(300);

    expect(client.parse).toHaveBeenCalledWith('mode: rule');
  });

  it('a burst of prop changes within the window collapses into one parse call covering the latest text', async () => {
    const client = makeClient();
    const { rerender } = render(<YamlEditor text="a" onChange={vi.fn()} client={client} />);

    await advanceDebounce(100);
    rerender(<YamlEditor text="ab" onChange={vi.fn()} client={client} />);
    await advanceDebounce(100);
    rerender(<YamlEditor text="abc" onChange={vi.fn()} client={client} />);
    await advanceDebounce(300);

    expect(client.parse).toHaveBeenCalledTimes(1);
    expect(client.parse).toHaveBeenCalledWith('abc');
  });

  it('reports the parsed issues upward via onIssuesChange', async () => {
    const onIssuesChange = vi.fn();
    render(
      <YamlEditor
        text={'mode: rule\n  bad: 1'}
        onChange={vi.fn()}
        client={makeClient([BLOCKING_ISSUE])}
        onIssuesChange={onIssuesChange}
      />,
    );

    await advanceDebounce(300);

    expect(onIssuesChange).toHaveBeenCalledWith([BLOCKING_ISSUE]);
  });

  it('reports the parsed value upward via onValueChange (v0.3.0 #14)', async () => {
    const onValueChange = vi.fn();
    const client = makeClient();
    client.parse.mockResolvedValue({
      type: 'parse',
      requestId: 'x',
      issues: [],
      value: { mode: 'rule' },
    });
    render(
      <YamlEditor
        text={'mode: rule\n'}
        onChange={vi.fn()}
        client={client}
        onValueChange={onValueChange}
      />,
    );

    await advanceDebounce(300);

    expect(onValueChange).toHaveBeenCalledWith({ mode: 'rule' });
  });
});

describe('YamlEditor / jumpToRange handle', () => {
  it('exposes a ref that moves the textarea selection to the given range', () => {
    const ref = createRef<YamlEditorHandle>();
    render(
      <YamlEditor
        ref={ref}
        text={'mode: rule\nport: 7890'}
        onChange={vi.fn()}
        client={makeClient()}
      />,
    );

    ref.current?.jumpToRange({
      start: { offset: 11, line: 2, column: 1 },
      end: { offset: 15, line: 2, column: 5 },
    });

    const textarea = screen.getByLabelText<HTMLTextAreaElement>(t('editor.title'));
    expect(textarea.selectionStart).toBe(11);
    expect(textarea.selectionEnd).toBe(15);
    expect(document.activeElement).toBe(textarea);
  });
});

describe('YamlEditor / syntax error markers and freeze (FR-YAML-05)', () => {
  it('marks the gutter line matching a blocking issue range as an error', async () => {
    render(
      <YamlEditor
        text={'mode: rule\n  bad: 1'}
        onChange={vi.fn()}
        client={makeClient([BLOCKING_ISSUE])}
      />,
    );

    await advanceDebounce(300);

    expect(screen.getByText('2').className).toContain('yaml-editor__gutter-line--error');
    expect(screen.getByText('1').className).not.toContain('yaml-editor__gutter-line--error');
  });

  it('the structured view is not disabled and shows no frozen banner while the document is valid', async () => {
    render(<YamlEditor text="mode: rule" onChange={vi.fn()} client={makeClient()} />);

    await advanceDebounce(300);

    expect(
      screen.getByLabelText<HTMLFieldSetElement>(t('editor.structuredViewTitle')).disabled,
    ).toBe(false);
    expect(screen.queryByText(t('editor.frozenMessage'), { exact: false })).toBeNull();
  });

  it('freezes (disables) the structured view but keeps it visible when a blocking issue exists', async () => {
    render(
      <YamlEditor
        text={'mode: rule\n  bad: 1'}
        onChange={vi.fn()}
        client={makeClient([BLOCKING_ISSUE])}
      />,
    );

    await advanceDebounce(300);

    const fieldset = screen.getByLabelText<HTMLFieldSetElement>(t('editor.structuredViewTitle'));
    expect(fieldset.disabled).toBe(true);
    // "disabled, not hidden": the placeholder content must still be present.
    expect(screen.getByText(t('editor.structuredViewPlaceholder'))).toBeDefined();
  });

  it('the frozen prompt names the first error location and jumps the textarea selection there on click', async () => {
    render(
      <YamlEditor
        text={'mode: rule\n  bad: 1'}
        onChange={vi.fn()}
        client={makeClient([BLOCKING_ISSUE])}
      />,
    );
    await advanceDebounce(300);

    const banner = screen.getByText(t('editor.frozenLocation', { line: 2, column: 3 }), {
      exact: false,
    });
    fireEvent.click(banner);

    const textarea = screen.getByLabelText<HTMLTextAreaElement>(t('editor.title'));
    expect(textarea.selectionStart).toBe(5);
    expect(textarea.selectionEnd).toBe(6);
  });
});

describe('YamlEditor / find', () => {
  it('selects the first match when searching from the start', async () => {
    render(<YamlEditor text={'mode: rule\nport: 7890'} onChange={vi.fn()} client={makeClient()} />);

    fireEvent.change(screen.getByLabelText(t('editor.findPlaceholder')), {
      target: { value: 'port' },
    });
    fireEvent.click(screen.getByRole('button', { name: t('editor.findButton') }));

    const textarea = screen.getByLabelText<HTMLTextAreaElement>(t('editor.title'));
    const expected = 'mode: rule\nport: 7890'.indexOf('port');
    expect(textarea.selectionStart).toBe(expected);
    expect(textarea.selectionEnd).toBe(expected + 'port'.length);
  });

  it('wraps around to the first match when searching again past the last one', async () => {
    const text = 'port: 1\nport: 2';
    render(<YamlEditor text={text} onChange={vi.fn()} client={makeClient()} />);
    const searchInput = screen.getByLabelText(t('editor.findPlaceholder'));
    const findButton = screen.getByRole('button', { name: t('editor.findButton') });
    fireEvent.change(searchInput, { target: { value: 'port' } });
    fireEvent.click(findButton); // first match
    fireEvent.click(findButton); // second match
    fireEvent.click(findButton); // wraps back to the first

    const textarea = screen.getByLabelText<HTMLTextAreaElement>(t('editor.title'));
    expect(textarea.selectionStart).toBe(text.indexOf('port'));
  });

  it('shows a not-found message when the search term does not occur, and clears it on the next edit', async () => {
    render(<YamlEditor text="mode: rule" onChange={vi.fn()} client={makeClient()} />);
    const searchInput = screen.getByLabelText(t('editor.findPlaceholder'));
    fireEvent.change(searchInput, { target: { value: 'nope' } });

    fireEvent.click(screen.getByRole('button', { name: t('editor.findButton') }));
    expect(screen.getByText(t('editor.findNotFound'))).toBeDefined();

    fireEvent.change(searchInput, { target: { value: 'nope2' } });
    expect(screen.queryByText(t('editor.findNotFound'))).toBeNull();
  });

  it('does nothing when the search box is empty', () => {
    render(<YamlEditor text="mode: rule" onChange={vi.fn()} client={makeClient()} />);

    expect(() =>
      fireEvent.click(screen.getByRole('button', { name: t('editor.findButton') })),
    ).not.toThrow();
    expect(screen.queryByText(t('editor.findNotFound'))).toBeNull();
  });
});

describe('YamlEditor / format', () => {
  it('parses then serializes the current text, and applies the result via onChange', async () => {
    const client = makeClient();
    const onChange = vi.fn();
    render(<YamlEditor text="mode:   rule" onChange={onChange} client={client} />);

    fireEvent.click(screen.getByRole('button', { name: t('editor.formatButton') }));
    // Flushes the pending parse().then(serialize()).then(onChange) microtask
    // chain without advancing real time — fake timers are active in this
    // file for the debounce tests, and RTL's own `waitFor` polls via
    // `setTimeout`, which fake timers would otherwise stall.
    await vi.advanceTimersByTimeAsync(0);

    expect(onChange).toHaveBeenCalledWith('formatted\n');
    expect(client.parse).toHaveBeenCalledWith('mode:   rule');
    expect(client.serialize).toHaveBeenCalledWith({ lineWidth: 0, indent: 2 });
  });
});
