import { describe, expect, it } from 'vitest';

import { computeVirtualWindow } from './virtual-list.js';

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
