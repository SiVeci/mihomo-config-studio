import { describe, expect, it } from 'vitest';

import { changedLineNumbers, diffLines } from './diff.js';

describe('diffLines (FR-YAML-06)', () => {
  it('reports identical texts as having no hunks', () => {
    const diff = diffLines('a\nb\nc\n', 'a\nb\nc\n');
    expect(diff).toMatchObject({ identical: true, added: 0, removed: 0, hunks: [] });
  });

  it('isolates a single changed line', () => {
    const diff = diffLines('a\nb\nc\n', 'a\nB\nc\n');
    expect(diff.added).toBe(1);
    expect(diff.removed).toBe(1);
    expect(changedLineNumbers(diff)).toEqual({ removed: [2], added: [2] });
    expect(diff.hunks).toHaveLength(1);
    expect(diff.hunks[0]).toMatchObject({ oldStart: 1, newStart: 1 });
  });

  it('detects pure insertions and deletions', () => {
    expect(diffLines('a\nc\n', 'a\nb\nc\n')).toMatchObject({ added: 1, removed: 0 });
    expect(diffLines('a\nb\nc\n', 'a\nc\n')).toMatchObject({ added: 0, removed: 1 });
  });

  it('splits distant edits into separate hunks', () => {
    const before = Array.from({ length: 40 }, (_, i) => `line${i}`).join('\n') + '\n';
    const after = before.replace('line2\n', 'LINE2\n').replace('line35\n', 'LINE35\n');
    const diff = diffLines(before, after, 2);
    expect(diff.hunks).toHaveLength(2);
    expect(changedLineNumbers(diff)).toEqual({ removed: [3, 36], added: [3, 36] });
  });

  it('handles empty inputs on either side', () => {
    expect(diffLines('', '')).toMatchObject({ identical: true, hunks: [] });
    expect(diffLines('', 'a\n')).toMatchObject({ added: 1, removed: 0 });
    expect(diffLines('a\n', '')).toMatchObject({ added: 0, removed: 1 });
  });

  it('flags a trailing-newline-only change that produces no hunks', () => {
    const diff = diffLines('a\nb', 'a\nb\n');
    expect(diff.hunks).toEqual([]);
    expect(diff.identical).toBe(false);
    expect(diff.trailingNewlineChanged).toBe(true);
    expect(diffLines('a\nb\n', 'a\nb\n').trailingNewlineChanged).toBe(false);
  });
});
