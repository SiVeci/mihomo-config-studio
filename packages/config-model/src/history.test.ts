import { MihomoYamlDocument } from '@mcs/yaml-engine';
import { describe, expect, it } from 'vitest';

import { HistoryStack } from './history.js';

function doc(text: string): MihomoYamlDocument {
  const result = MihomoYamlDocument.parse(text);
  if (!result.document) {
    throw new Error(
      `fixture failed to parse: ${result.issues.map((i) => i.messageKey).join('; ')}`,
    );
  }
  return result.document;
}

function fakeClock(start = 0): { now: () => number; advance: (ms: number) => void } {
  let current = start;
  return {
    now: () => current,
    advance: (ms) => {
      current += ms;
    },
  };
}

describe('HistoryStack (FR-PROJ-04)', () => {
  it('starts with nothing to undo or redo', () => {
    const stack = new HistoryStack();
    expect(stack.canUndo).toBe(false);
    expect(stack.canRedo).toBe(false);
  });

  it('undo on an empty stack is a no-op that returns null', () => {
    const stack = new HistoryStack();
    expect(stack.undo()).toBeNull();
    expect(stack.canUndo).toBe(false);
  });

  it('redo on an empty stack is a no-op that returns null', () => {
    const stack = new HistoryStack();
    expect(stack.redo()).toBeNull();
    expect(stack.canRedo).toBe(false);
  });

  it('records one edit and undo/redo restore the before/after text', () => {
    const stack = new HistoryStack();
    const document = doc('a: 1\n');

    stack.record(document, 'set a', () => document.setScalarIn(['a'], 2));

    expect(document.toText()).toBe('a: 2\n');
    expect(stack.canUndo).toBe(true);
    expect(stack.canRedo).toBe(false);

    expect(stack.undo()).toBe('a: 1\n');
    expect(stack.canUndo).toBe(false);
    expect(stack.canRedo).toBe(true);

    expect(stack.redo()).toBe('a: 2\n');
    expect(stack.canUndo).toBe(true);
    expect(stack.canRedo).toBe(false);
  });

  it('records nothing for a no-op mutation', () => {
    const stack = new HistoryStack();
    const document = doc('a: 1\n');

    stack.record(document, 'noop', () => {});

    expect(stack.canUndo).toBe(false);
  });

  it('does not record anything when mutate throws, and propagates the error', () => {
    const stack = new HistoryStack();
    const document = doc('a: 1\n');

    expect(() =>
      stack.record(document, 'boom', () => {
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(stack.canUndo).toBe(false);
  });

  it('collapses several document calls inside one record() into a single history item', () => {
    const stack = new HistoryStack();
    const document = doc('proxies:\n  - name: A\n    server: A\nrules:\n  - MATCH,A\n');
    const before = document.toText();

    stack.record(document, 'rename-entity', () => {
      document.setScalarIn(['proxies', 0, 'name'], 'B');
      document.setScalarIn(['proxies', 0, 'server'], 'B');
      document.setScalarIn(['rules', 0], 'MATCH,B');
    });

    expect(document.toText()).toContain('name: B');
    expect(document.toText()).toContain('MATCH,B');
    expect(stack.canRedo).toBe(false);

    // One undo() must return straight to the pre-rename text, not an
    // intermediate state reflecting only some of the three edits — a
    // cascading rename is one history item. See
    // packages/graph/src/history-integration.test.ts for the same assertion
    // driven by the real ReferenceIndex.rename().
    expect(stack.undo()).toBe(before);
    expect(stack.canUndo).toBe(false);
  });

  it('merges consecutive same-mergeKey edits inside the merge window into one entry', () => {
    const clock = fakeClock();
    const stack = new HistoryStack({ now: clock.now, mergeWindowMs: 1000 });
    const document = doc('a: 1\n');
    const initial = document.toText();

    stack.record(document, 'type', () => document.setScalarIn(['a'], 12), 'field:a');
    clock.advance(500);
    stack.record(document, 'type', () => document.setScalarIn(['a'], 123), 'field:a');

    expect(document.toText()).toBe('a: 123\n');
    // A single undo reverts straight to the pre-typing text: both edits were one entry.
    expect(stack.undo()).toBe(initial);
    expect(stack.canUndo).toBe(false);
  });

  it('does not merge edits outside the merge window', () => {
    const clock = fakeClock();
    const stack = new HistoryStack({ now: clock.now, mergeWindowMs: 1000 });
    const document = doc('a: 1\n');

    stack.record(document, 'type', () => document.setScalarIn(['a'], 12), 'field:a');
    clock.advance(1001);
    stack.record(document, 'type', () => document.setScalarIn(['a'], 123), 'field:a');

    expect(stack.undo()).toBe('a: 12\n');
    expect(stack.canUndo).toBe(true);
    expect(stack.undo()).toBe('a: 1\n');
    expect(stack.canUndo).toBe(false);
  });

  it('treats exactly the window boundary as still mergeable', () => {
    const clock = fakeClock();
    const stack = new HistoryStack({ now: clock.now, mergeWindowMs: 1000 });
    const document = doc('a: 1\n');
    const initial = document.toText();

    stack.record(document, 'type', () => document.setScalarIn(['a'], 12), 'field:a');
    clock.advance(1000);
    stack.record(document, 'type', () => document.setScalarIn(['a'], 123), 'field:a');

    expect(stack.undo()).toBe(initial);
  });

  it('does not merge edits with different merge keys even inside the window', () => {
    const clock = fakeClock();
    const stack = new HistoryStack({ now: clock.now, mergeWindowMs: 1000 });
    const document = doc('a: 1\nb: 1\n');

    stack.record(document, 'set a', () => document.setScalarIn(['a'], 2), 'field:a');
    stack.record(document, 'set b', () => document.setScalarIn(['b'], 2), 'field:b');

    expect(stack.undo()).toBe('a: 2\nb: 1\n');
    expect(stack.undo()).toBe('a: 1\nb: 1\n');
  });

  it('never merges edits that omit a mergeKey, even back to back', () => {
    const stack = new HistoryStack();
    const document = doc('proxies:\n  - name: A\nrules:\n  - MATCH,A\n');

    stack.record(document, 'rename 1', () => document.setScalarIn(['proxies', 0, 'name'], 'B'));
    stack.record(document, 'rename 2', () => document.setScalarIn(['rules', 0], 'MATCH,B'));

    expect(stack.undo()).not.toBeNull();
    expect(stack.canUndo).toBe(true); // second entry still available
    expect(stack.undo()).not.toBeNull();
    expect(stack.canUndo).toBe(false);
  });

  it('uses the real clock by default, so back-to-back same-key edits still merge', () => {
    const stack = new HistoryStack();
    const document = doc('a: 1\n');
    const initial = document.toText();

    stack.record(document, 'type', () => document.setScalarIn(['a'], 12), 'field:a');
    stack.record(document, 'type', () => document.setScalarIn(['a'], 123), 'field:a');

    expect(stack.undo()).toBe(initial);
  });

  it('discards the redo branch once a new edit is recorded after undo', () => {
    const stack = new HistoryStack();
    let document = doc('a: 1\n');

    stack.record(document, 'set a=2', () => document.setScalarIn(['a'], 2));
    stack.record(document, 'set a=3', () => document.setScalarIn(['a'], 3));

    const undone = stack.undo();
    expect(undone).toBe('a: 2\n');
    // The caller owns the document reference: after undo() returns text, it
    // re-parses to keep editing from the restored state.
    document = doc(undone!);
    expect(stack.canRedo).toBe(true);

    stack.record(document, 'set a=9', () => document.setScalarIn(['a'], 9));

    expect(stack.canRedo).toBe(false);
    expect(stack.redo()).toBeNull();
    // The stack is now [set a=2, set a=9] — the discarded "set a=3" entry is
    // gone, but "set a=2" is still a real, earlier entry to undo back to.
    expect(stack.undo()).toBe('a: 2\n');
    expect(stack.canUndo).toBe(true);
    expect(stack.undo()).toBe('a: 1\n');
    expect(stack.canUndo).toBe(false);
  });

  it('evicts the oldest entry once the stack exceeds maxEntries (FIFO)', () => {
    const stack = new HistoryStack({ maxEntries: 2 });
    const document = doc('a: 1\nb: 1\nc: 1\n');

    stack.record(document, 'set a', () => document.setScalarIn(['a'], 2), 'field:a');
    stack.record(document, 'set b', () => document.setScalarIn(['b'], 2), 'field:b');
    stack.record(document, 'set c', () => document.setScalarIn(['c'], 2), 'field:c');

    expect(stack.undo()).toBe('a: 2\nb: 2\nc: 1\n');
    expect(stack.canUndo).toBe(true);
    expect(stack.undo()).toBe('a: 2\nb: 1\nc: 1\n');
    expect(stack.canUndo).toBe(false);
    // The oldest edit (setting a) was evicted once the third edit pushed the
    // stack past maxEntries, so the original text is no longer recoverable.
    expect(stack.undo()).toBeNull();
  });
});
