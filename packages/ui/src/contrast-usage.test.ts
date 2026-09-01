import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { CASES, EXEMPTIONS } from './contrast-cases.js';
import { COLORS, isFillOnly } from './tokens.js';
import type { ColorTokenName } from './tokens.js';

/**
 * v0.9.0 #12: the honest version of "cover every token combination". The
 * full (foreground, background) Cartesian product (~30 × ~12) is mostly
 * combinations that never occur in this product — asserting AA for each one
 * would be noise, not signal. What the version doc's "对比度断言真正覆盖
 * 实际被用到的令牌组合" actually requires is narrower and stronger: every
 * combination a real `.css` file *uses together* — same rule, `color` paired
 * with `background`/`background-color`, both design tokens — must already
 * have a row in `contrast-cases.ts`'s `CASES` table. A new stylesheet rule
 * pairing an unreviewed combination fails here immediately, the same way a
 * new `text-*` role or `-tint` failing `contrast.test.ts`'s own coverage
 * guard does — this is that same mechanism, extended from the token
 * declaration side to the usage side.
 */

const SCAN_ROOTS = ['apps/web/src', 'packages/ui/src'];

function repoRoot(): string {
  // packages/ui/src/contrast-usage.test.ts -> repo root is three levels up.
  return join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');
}

function listCssFilesRecursively(rootDir: string, currentRelative = ''): string[] {
  const absoluteDir = currentRelative ? join(rootDir, currentRelative) : rootDir;
  const entries = readdirSync(absoluteDir, { withFileTypes: true });
  const results: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory() && (entry.name === 'dist' || entry.name === 'node_modules')) continue;
    const relativePath = currentRelative ? `${currentRelative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      results.push(...listCssFilesRecursively(rootDir, relativePath));
    } else if (entry.isFile() && entry.name.endsWith('.css')) {
      results.push(relativePath);
    }
  }
  return results;
}

/** Comments never contain a real rule; stripping them first keeps a commented-out example from being scanned as real usage. */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * Recursively pulls out every *leaf* `{ ... }` block — one with no further
 * `{` inside it — which is exactly a real declaration list. An `@media`
 * block's own `{ }` is not a leaf (it contains nested selector blocks), so
 * this recurses into it rather than treating its whole span as one
 * declaration list, which would misattribute declarations across unrelated
 * nested selectors.
 */
function extractLeafDeclarationBlocks(css: string): string[] {
  const blocks: string[] = [];
  let depth = 0;
  let blockStart = -1;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === '{') {
      if (depth === 0) blockStart = i + 1;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && blockStart !== -1) {
        const content = css.slice(blockStart, i);
        if (content.includes('{')) {
          blocks.push(...extractLeafDeclarationBlocks(content));
        } else {
          blocks.push(content);
        }
        blockStart = -1;
      }
    }
  }
  return blocks;
}

interface UsagePair {
  readonly file: string;
  readonly foreground: string;
  readonly background: string;
}

interface FileBlock {
  readonly file: string;
  readonly block: string;
}

/** Every leaf declaration block across both scan roots, each tagged with the file it came from — read and parsed once, reused by every test below. */
function findAllBlocks(): FileBlock[] {
  const root = repoRoot();
  const blocks: FileBlock[] = [];
  for (const scanRoot of SCAN_ROOTS) {
    const absoluteScanRoot = join(root, scanRoot);
    for (const relativePath of listCssFilesRecursively(absoluteScanRoot)) {
      const file = `${scanRoot}/${relativePath}`;
      const css = stripComments(readFileSync(join(absoluteScanRoot, relativePath), 'utf8'));
      for (const block of extractLeafDeclarationBlocks(css)) {
        blocks.push({ file, block });
      }
    }
  }
  return blocks;
}

/** A single `prop: var(--mcs-<varPrefix>-X)` declaration's `X`, matched by exact prefix (post-`;`-split) — never a loose regex, since e.g. `\bcolor:` would also match inside `background-color:` (`-` is a non-word character on both sides of a `\b`). */
function findTokenValue(
  declarationBlock: string,
  property: string,
  varPrefix: string,
): string | undefined {
  const pattern = new RegExp(`^${property}:\\s*var\\(--mcs-${varPrefix}-([a-z0-9-]+)\\)$`);
  let found: string | undefined;
  for (const rawDeclaration of declarationBlock.split(';')) {
    const match = pattern.exec(rawDeclaration.trim());
    if (match) found = match[1];
  }
  return found;
}

function findColorPair(declarationBlock: string): {
  foreground: string | undefined;
  background: string | undefined;
} {
  return {
    foreground: findTokenValue(declarationBlock, 'color', 'color'),
    background:
      findTokenValue(declarationBlock, 'background-color', 'color') ??
      findTokenValue(declarationBlock, 'background', 'color'),
  };
}

function findUsagePairs(blocks: readonly FileBlock[]): UsagePair[] {
  const pairs: UsagePair[] = [];
  for (const { file, block } of blocks) {
    const { foreground, background } = findColorPair(block);
    if (foreground !== undefined && background !== undefined) {
      pairs.push({ file, foreground, background });
    }
  }
  return pairs;
}

function isKnownColorToken(name: string): name is ColorTokenName {
  return Object.hasOwn(COLORS, name);
}

describe('CSS token usage vs. the CASES coverage table (v0.9.0 #12)', () => {
  it('scans at least one real stylesheet — a passing empty scan would prove nothing', () => {
    expect(findAllBlocks().length).toBeGreaterThan(0);
  });

  it('every real (color, background) token pair a stylesheet actually uses is a known token on both sides', () => {
    for (const pair of findUsagePairs(findAllBlocks())) {
      expect(
        isKnownColorToken(pair.foreground),
        `${pair.file}: color var(--mcs-color-${pair.foreground})`,
      ).toBe(true);
      expect(
        isKnownColorToken(pair.background),
        `${pair.file}: background var(--mcs-color-${pair.background})`,
      ).toBe(true);
    }
  });

  it('every real (color, background) token pair a stylesheet actually uses has a reviewed row in contrast-cases.ts CASES or EXEMPTIONS', () => {
    const missing: string[] = [];
    for (const pair of findUsagePairs(findAllBlocks())) {
      if (!isKnownColorToken(pair.foreground) || !isKnownColorToken(pair.background)) continue;
      const covered =
        CASES.some(
          (testCase) =>
            testCase.foreground === pair.foreground && testCase.background === pair.background,
        ) ||
        EXEMPTIONS.some(
          (exemption) =>
            exemption.foreground === pair.foreground && exemption.background === pair.background,
        );
      if (!covered) {
        missing.push(`${pair.file}: ${pair.foreground} on ${pair.background}`);
      }
    }
    expect(missing).toEqual([]);
  });
});

/**
 * v0.9.0 #12: ADR-011 §2's two contrast corrections, re-verified as machine
 * assertions over real CSS usage rather than left as prose a future change
 * could quietly violate.
 */
describe('ADR-011 §2 corrections, re-verified over real CSS usage (v0.9.0 #12)', () => {
  it('never uses a fill-only color (primary/warning/success/accent-teal/accent-amber) as a text color', () => {
    const violations: string[] = [];
    for (const { file, block } of findAllBlocks()) {
      const foreground = findTokenValue(block, 'color', 'color');
      if (foreground !== undefined && isFillOnly(foreground as ColorTokenName)) {
        violations.push(`${file}: color var(--mcs-color-${foreground})`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('never pairs muted-soft text color with the 13px caption font size in the same rule', () => {
    const violations: string[] = [];
    for (const { file, block } of findAllBlocks()) {
      const foreground = findTokenValue(block, 'color', 'color');
      const fontSize = findTokenValue(block, 'font-size', 'font-size');
      if (foreground === 'muted-soft' && fontSize === 'caption') {
        violations.push(file);
      }
    }
    expect(violations).toEqual([]);
  });
});
