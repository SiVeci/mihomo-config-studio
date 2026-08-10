/**
 * Line-oriented diff used by the "changes since import / last save" panel
 * (FR-YAML-06) and by round-trip tests that assert an edit touched only the
 * expected lines.
 */

export type DiffOp = 'context' | 'add' | 'remove';

const NEWLINE = '\n';

export interface DiffLine {
  op: DiffOp;
  /** 1-based line number in the original text, or null for added lines. */
  oldLine: number | null;
  /** 1-based line number in the updated text, or null for removed lines. */
  newLine: number | null;
  text: string;
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface TextDiff {
  hunks: DiffHunk[];
  added: number;
  removed: number;
  /** True when the two texts are byte-identical. */
  identical: boolean;
  /**
   * A final-newline-only change produces no hunks, so the panel would otherwise
   * report "no changes" for a text that really did change. Surfaced separately.
   */
  trailingNewlineChanged: boolean;
}

function splitLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n');
  // A trailing newline produces a final empty element that is not a real line.
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/**
 * Longest-common-subsequence diff. Common prefix and suffix are trimmed first,
 * which keeps the quadratic core proportional to the size of the actual edit —
 * the dominant case for single-field form changes on large configs.
 */
export function diffLines(before: string, after: string, contextLines = 3): TextDiff {
  const a = splitLines(before);
  const b = splitLines(after);

  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix += 1;

  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const midA = a.slice(prefix, a.length - suffix);
  const midB = b.slice(prefix, b.length - suffix);

  const script = lcsScript(midA, midB, prefix);
  const added = script.filter((line) => line.op === 'add').length;
  const removed = script.filter((line) => line.op === 'remove').length;

  const trailingNewlineChanged = before.endsWith(NEWLINE) !== after.endsWith(NEWLINE);

  if (added === 0 && removed === 0) {
    return {
      hunks: [],
      added: 0,
      removed: 0,
      identical: before === after,
      trailingNewlineChanged,
    };
  }

  const full: DiffLine[] = [];
  for (let i = 0; i < prefix; i += 1) {
    full.push({ op: 'context', oldLine: i + 1, newLine: i + 1, text: a[i] as string });
  }
  full.push(...script);
  for (let i = 0; i < suffix; i += 1) {
    const oldIndex = a.length - suffix + i;
    const newIndex = b.length - suffix + i;
    full.push({
      op: 'context',
      oldLine: oldIndex + 1,
      newLine: newIndex + 1,
      text: a[oldIndex] as string,
    });
  }

  return {
    hunks: groupHunks(full, contextLines),
    added,
    removed,
    identical: false,
    trailingNewlineChanged,
  };
}

function lcsScript(a: string[], b: string[], offset: number): DiffLine[] {
  const n = a.length;
  const m = b.length;
  // dp[i][j] = LCS length of a[i..] and b[j..]
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    const row = dp[i] as number[];
    const next = dp[i + 1] as number[];
    for (let j = m - 1; j >= 0; j -= 1) {
      row[j] =
        a[i] === b[j]
          ? (next[j + 1] as number) + 1
          : Math.max(next[j] as number, row[j + 1] as number);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({
        op: 'context',
        oldLine: offset + i + 1,
        newLine: offset + j + 1,
        text: a[i] as string,
      });
      i += 1;
      j += 1;
    } else if ((dp[i + 1] as number[])[j]! >= (dp[i] as number[])[j + 1]!) {
      out.push({ op: 'remove', oldLine: offset + i + 1, newLine: null, text: a[i] as string });
      i += 1;
    } else {
      out.push({ op: 'add', oldLine: null, newLine: offset + j + 1, text: b[j] as string });
      j += 1;
    }
  }
  while (i < n) {
    out.push({ op: 'remove', oldLine: offset + i + 1, newLine: null, text: a[i] as string });
    i += 1;
  }
  while (j < m) {
    out.push({ op: 'add', oldLine: null, newLine: offset + j + 1, text: b[j] as string });
    j += 1;
  }
  return out;
}

function groupHunks(lines: DiffLine[], contextLines: number): DiffHunk[] {
  const changed = lines
    .map((line, index) => (line.op === 'context' ? -1 : index))
    .filter((index) => index >= 0);
  if (changed.length === 0) return [];

  const ranges: Array<[number, number]> = [];
  let start = Math.max(0, (changed[0] as number) - contextLines);
  let end = Math.min(lines.length - 1, (changed[0] as number) + contextLines);
  for (const index of changed.slice(1)) {
    if (index - contextLines <= end + 1) {
      end = Math.min(lines.length - 1, index + contextLines);
    } else {
      ranges.push([start, end]);
      start = Math.max(0, index - contextLines);
      end = Math.min(lines.length - 1, index + contextLines);
    }
  }
  ranges.push([start, end]);

  return ranges.map(([from, to]) => {
    const slice = lines.slice(from, to + 1);
    const oldNumbers = slice.map((line) => line.oldLine).filter((n): n is number => n != null);
    const newNumbers = slice.map((line) => line.newLine).filter((n): n is number => n != null);
    return {
      oldStart: oldNumbers[0] ?? 0,
      oldLines: oldNumbers.length,
      newStart: newNumbers[0] ?? 0,
      newLines: newNumbers.length,
      lines: slice,
    };
  });
}

/** Convenience for tests and CI assertions: which original lines changed. */
export function changedLineNumbers(diff: TextDiff): { removed: number[]; added: number[] } {
  const removed: number[] = [];
  const added: number[] = [];
  for (const hunk of diff.hunks) {
    for (const line of hunk.lines) {
      if (line.op === 'remove' && line.oldLine != null) removed.push(line.oldLine);
      if (line.op === 'add' && line.newLine != null) added.push(line.newLine);
    }
  }
  return { removed, added };
}
