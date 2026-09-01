import { describe, expect, it } from 'vitest';

import { computeVariableVirtualWindow, computeVirtualWindow } from './virtual-list.js';

const ITEM_HEIGHT = 32;
const CONTAINER_HEIGHT = 320; // 10 rows visible
const ITEM_COUNT = 10_000;

describe('computeVirtualWindow (ADR-022)', () => {
  it('returns an empty window for a zero-item list', () => {
    expect(
      computeVirtualWindow({
        itemCount: 0,
        itemHeight: ITEM_HEIGHT,
        containerHeight: CONTAINER_HEIGHT,
        scrollTop: 0,
      }),
    ).toEqual({ startIndex: 0, endIndex: 0, topPadding: 0, bottomPadding: 0, totalHeight: 0 });
  });

  it('returns an empty window when itemHeight is zero or negative (guards a bad measurement, never throws)', () => {
    expect(
      computeVirtualWindow({
        itemCount: ITEM_COUNT,
        itemHeight: 0,
        containerHeight: CONTAINER_HEIGHT,
        scrollTop: 0,
      }).endIndex,
    ).toBe(0);
  });

  it('first screen: scrollTop 0 starts at index 0', () => {
    const window = computeVirtualWindow({
      itemCount: ITEM_COUNT,
      itemHeight: ITEM_HEIGHT,
      containerHeight: CONTAINER_HEIGHT,
      scrollTop: 0,
    });
    expect(window.startIndex).toBe(0);
    expect(window.topPadding).toBe(0);
    // Visible rows (10) plus the +1 partial-row allowance.
    expect(window.endIndex).toBe(11);
    expect(window.bottomPadding).toBe((ITEM_COUNT - 11) * ITEM_HEIGHT);
  });

  it('mid-scroll: scrolled exactly to row 9000 starts the window at index 9000', () => {
    const window = computeVirtualWindow({
      itemCount: ITEM_COUNT,
      itemHeight: ITEM_HEIGHT,
      containerHeight: CONTAINER_HEIGHT,
      scrollTop: 9000 * ITEM_HEIGHT,
    });
    expect(window.startIndex).toBe(9000);
    expect(window.topPadding).toBe(9000 * ITEM_HEIGHT);
  });

  it('last screen: scrolled to the maximum offset never lets endIndex exceed itemCount', () => {
    const totalHeight = ITEM_COUNT * ITEM_HEIGHT;
    const window = computeVirtualWindow({
      itemCount: ITEM_COUNT,
      itemHeight: ITEM_HEIGHT,
      containerHeight: CONTAINER_HEIGHT,
      scrollTop: totalHeight, // one row past the real max, a caller might still pass this
    });
    expect(window.endIndex).toBe(ITEM_COUNT);
    expect(window.bottomPadding).toBe(0);
    expect(window.startIndex).toBeLessThan(ITEM_COUNT);
  });

  it('a container taller than the whole list renders every item with no padding', () => {
    const window = computeVirtualWindow({
      itemCount: 5,
      itemHeight: ITEM_HEIGHT,
      containerHeight: 10_000, // far taller than 5 rows
      scrollTop: 0,
    });
    expect(window.startIndex).toBe(0);
    expect(window.endIndex).toBe(5);
    expect(window.topPadding).toBe(0);
    expect(window.bottomPadding).toBe(0);
  });

  it('a zero-height container (not yet measured) renders nothing but still reports the true total height', () => {
    const window = computeVirtualWindow({
      itemCount: ITEM_COUNT,
      itemHeight: ITEM_HEIGHT,
      containerHeight: 0,
      scrollTop: 0,
    });
    expect(window.endIndex - window.startIndex).toBe(0);
    expect(window.totalHeight).toBe(ITEM_COUNT * ITEM_HEIGHT);
  });

  it('overscan extends the window symmetrically without changing the reported totalHeight', () => {
    const withoutOverscan = computeVirtualWindow({
      itemCount: ITEM_COUNT,
      itemHeight: ITEM_HEIGHT,
      containerHeight: CONTAINER_HEIGHT,
      scrollTop: 5000 * ITEM_HEIGHT,
    });
    const withOverscan = computeVirtualWindow({
      itemCount: ITEM_COUNT,
      itemHeight: ITEM_HEIGHT,
      containerHeight: CONTAINER_HEIGHT,
      scrollTop: 5000 * ITEM_HEIGHT,
      overscan: 3,
    });
    expect(withOverscan.startIndex).toBe(withoutOverscan.startIndex - 3);
    expect(withOverscan.endIndex).toBe(withoutOverscan.endIndex + 3);
    expect(withOverscan.totalHeight).toBe(withoutOverscan.totalHeight);
  });

  it('never lets overscan push startIndex below 0 near the top of the list', () => {
    const window = computeVirtualWindow({
      itemCount: ITEM_COUNT,
      itemHeight: ITEM_HEIGHT,
      containerHeight: CONTAINER_HEIGHT,
      scrollTop: 0,
      overscan: 20,
    });
    expect(window.startIndex).toBe(0);
  });

  it('topPadding + rendered rows + bottomPadding always reconstructs the exact totalHeight', () => {
    for (const scrollTop of [0, 12345, 250_000, 319_968]) {
      const window = computeVirtualWindow({
        itemCount: ITEM_COUNT,
        itemHeight: ITEM_HEIGHT,
        containerHeight: CONTAINER_HEIGHT,
        scrollTop,
        overscan: 4,
      });
      const renderedHeight = (window.endIndex - window.startIndex) * ITEM_HEIGHT;
      expect(window.topPadding + renderedHeight + window.bottomPadding).toBe(window.totalHeight);
    }
  });

  it('is a pure function: the same input always produces the same output, independent of call order', () => {
    const input = {
      itemCount: ITEM_COUNT,
      itemHeight: ITEM_HEIGHT,
      containerHeight: CONTAINER_HEIGHT,
      scrollTop: 4321 * ITEM_HEIGHT,
    };
    expect(computeVirtualWindow(input)).toEqual(computeVirtualWindow(input));
  });
});

describe('computeVariableVirtualWindow (v0.9.0 #11, ADR-022)', () => {
  it('returns an empty window for a zero-item list', () => {
    expect(
      computeVariableVirtualWindow({ itemHeights: [], containerHeight: 500, scrollTop: 0 }),
    ).toEqual({ startIndex: 0, endIndex: 0, topPadding: 0, bottomPadding: 0, totalHeight: 0 });
  });

  it('reduces to the same answer as the fixed-height function when every item shares one height', () => {
    const itemHeights = Array.from({ length: 200 }, () => ITEM_HEIGHT);
    const fixed = computeVirtualWindow({
      itemCount: 200,
      itemHeight: ITEM_HEIGHT,
      containerHeight: CONTAINER_HEIGHT,
      scrollTop: 50 * ITEM_HEIGHT,
    });
    const variable = computeVariableVirtualWindow({
      itemHeights,
      containerHeight: CONTAINER_HEIGHT,
      scrollTop: 50 * ITEM_HEIGHT,
    });
    expect(variable).toEqual(fixed);
  });

  it('a zero-height container (not yet measured) renders nothing but still reports the true total height', () => {
    const itemHeights = [100, 200, 150];
    const window = computeVariableVirtualWindow({ itemHeights, containerHeight: 0, scrollTop: 0 });
    expect(window.endIndex - window.startIndex).toBe(0);
    expect(window.totalHeight).toBe(450);
  });

  it('mixed heights: the window lands on the right index by real cumulative offset, not an average height guess', () => {
    // Items 0-2 are short (50 each, 150 total), item 3 is very tall (900),
    // items 4+ are short again — a naive "totalHeight / itemCount" average
    // would misplace the window; cumulative offsets must not.
    const itemHeights = [50, 50, 50, 900, 50, 50, 50, 50];
    const window = computeVariableVirtualWindow({
      itemHeights,
      containerHeight: 100,
      scrollTop: 160, // just past item 3's start (offset 150)
    });
    expect(window.startIndex).toBe(3);
    expect(window.topPadding).toBe(150);
  });

  it('a container taller than the whole (mixed-height) list renders every item with no padding', () => {
    const itemHeights = [80, 300, 40, 500];
    const window = computeVariableVirtualWindow({
      itemHeights,
      containerHeight: 10_000,
      scrollTop: 0,
    });
    expect(window.startIndex).toBe(0);
    expect(window.endIndex).toBe(4);
    expect(window.topPadding).toBe(0);
    expect(window.bottomPadding).toBe(0);
  });

  it('last screen: scrolled to the maximum offset never lets endIndex exceed itemCount', () => {
    const itemHeights = Array.from({ length: 50 }, (_, i) => 40 + i);
    const totalHeight = itemHeights.reduce((sum, h) => sum + h, 0);
    const window = computeVariableVirtualWindow({
      itemHeights,
      containerHeight: 200,
      scrollTop: totalHeight,
    });
    expect(window.endIndex).toBe(50);
    expect(window.bottomPadding).toBe(0);
  });

  it('overscan extends the window on both sides without changing totalHeight', () => {
    const itemHeights = Array.from({ length: 100 }, () => 30);
    const withoutOverscan = computeVariableVirtualWindow({
      itemHeights,
      containerHeight: 200,
      scrollTop: 1500,
    });
    const withOverscan = computeVariableVirtualWindow({
      itemHeights,
      containerHeight: 200,
      scrollTop: 1500,
      overscan: 3,
    });
    expect(withOverscan.startIndex).toBe(withoutOverscan.startIndex - 3);
    expect(withOverscan.endIndex).toBe(withoutOverscan.endIndex + 3);
    expect(withOverscan.totalHeight).toBe(withoutOverscan.totalHeight);
  });

  it('never lets overscan push startIndex below 0 near the top of the list', () => {
    const itemHeights = Array.from({ length: 100 }, () => 30);
    const window = computeVariableVirtualWindow({
      itemHeights,
      containerHeight: 200,
      scrollTop: 0,
      overscan: 20,
    });
    expect(window.startIndex).toBe(0);
  });

  it('topPadding + rendered items + bottomPadding always reconstructs the exact totalHeight', () => {
    const itemHeights = Array.from({ length: 3182 }, (_, i) => 120 + (i % 7) * 30);
    const totalHeight = itemHeights.reduce((sum, h) => sum + h, 0);
    for (const scrollTop of [0, 12_345, totalHeight / 2, totalHeight - 1]) {
      const window = computeVariableVirtualWindow({
        itemHeights,
        containerHeight: 480,
        scrollTop,
        overscan: 4,
      });
      const renderedHeight = itemHeights
        .slice(window.startIndex, window.endIndex)
        .reduce((sum, h) => sum + h, 0);
      expect(window.topPadding + renderedHeight + window.bottomPadding).toBe(window.totalHeight);
    }
  });

  it('at 3,182 real-scale items, the rendered window is a small slice of the total — the whole point of virtualizing', () => {
    const itemHeights = Array.from({ length: 3182 }, () => 220);
    const window = computeVariableVirtualWindow({
      itemHeights,
      containerHeight: 480,
      scrollTop: 0,
      overscan: 6,
    });
    expect(window.endIndex - window.startIndex).toBeLessThan(20);
  });

  it('is a pure function: the same input always produces the same output, independent of call order', () => {
    const input = {
      itemHeights: Array.from({ length: 500 }, (_, i) => 100 + (i % 3) * 10),
      containerHeight: 480,
      scrollTop: 12_345,
    };
    expect(computeVariableVirtualWindow(input)).toEqual(computeVariableVirtualWindow(input));
  });
});
