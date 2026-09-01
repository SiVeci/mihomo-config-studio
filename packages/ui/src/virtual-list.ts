/**
 * Pure windowing math for a fixed-row-height virtualized list (ADR-022):
 * given how many items exist, how tall a row and the viewport are, and the
 * current scroll offset, which items actually need a DOM node right now.
 * No DOM, no React, no timers — precisely testable in Node for the
 * boundaries that matter at 10,000-row scale (first screen, last screen,
 * mid-scroll, a viewport taller than the whole list), which is far more
 * reliable than measuring real layout through jsdom.
 */
export interface VirtualWindowInput {
  readonly itemCount: number;
  readonly itemHeight: number;
  readonly containerHeight: number;
  readonly scrollTop: number;
  /** Extra rows rendered beyond the visible viewport on each side, to reduce blank flashes during fast scrolling. Defaults to 0. */
  readonly overscan?: number;
}

export interface VirtualWindow {
  /** First index that needs a real row, inclusive. */
  readonly startIndex: number;
  /** One past the last index that needs a real row (exclusive), so `endIndex - startIndex` is the row count to render. */
  readonly endIndex: number;
  /** Height of the empty spacer placed before the rendered rows, so the scrollbar reflects the full list even though most of it has no DOM node. */
  readonly topPadding: number;
  /** Height of the empty spacer placed after the rendered rows. */
  readonly bottomPadding: number;
  /** `itemCount * itemHeight` — the scrollable content's total height, for sizing the container. */
  readonly totalHeight: number;
}

const EMPTY_WINDOW: VirtualWindow = {
  startIndex: 0,
  endIndex: 0,
  topPadding: 0,
  bottomPadding: 0,
  totalHeight: 0,
};

/**
 * `startIndex`/`endIndex` never depend on which rows previously rendered —
 * only on `scrollTop`, so a caller re-deriving the visible range after a
 * jump (keyboard "scroll to row N", not just a mouse-wheel scroll) gets the
 * exact same answer a real scroll to that offset would, with no special
 * case for either.
 */
export function computeVirtualWindow(input: VirtualWindowInput): VirtualWindow {
  const { itemCount, itemHeight, containerHeight, scrollTop } = input;
  const overscan = input.overscan ?? 0;
  const totalHeight = itemCount * itemHeight;

  if (itemCount <= 0 || itemHeight <= 0) return EMPTY_WINDOW;

  const clampedScrollTop = Math.max(0, Math.min(scrollTop, Math.max(0, totalHeight - 1)));
  const firstVisible = Math.floor(clampedScrollTop / itemHeight);
  // +1 covers a partially-scrolled-into-view row at the bottom edge.
  const visibleCount = containerHeight > 0 ? Math.ceil(containerHeight / itemHeight) + 1 : 0;

  const startIndex = Math.max(0, firstVisible - overscan);
  const endIndex = Math.min(itemCount, firstVisible + visibleCount + overscan);

  return {
    startIndex,
    endIndex: Math.max(startIndex, endIndex),
    topPadding: startIndex * itemHeight,
    bottomPadding: Math.max(0, totalHeight - endIndex * itemHeight),
    totalHeight,
  };
}

export interface VariableVirtualWindowInput {
  /**
   * One entry per item, in order — real measured height once a caller has
   * rendered and measured it, an estimate for anything it hasn't reached
   * yet. Correctness only needs "roughly right" for not-yet-measured items:
   * a wrong estimate shifts *which* items land in the window by a little
   * until they are measured, it never produces an invalid window (v0.9.0
   * #11, ADR-022's own §"什么情况下应该 supersede" anticipated this exact
   * case — `SchemaArrayForm`'s entries are full sub-forms, never row-height
   * uniform the way rules are).
   */
  readonly itemHeights: readonly number[];
  readonly containerHeight: number;
  readonly scrollTop: number;
  readonly overscan?: number;
}

/**
 * Variable-height counterpart to `computeVirtualWindow` — same contract and
 * output shape, but indexes by a per-item height array instead of a single
 * `itemHeight`, via cumulative offsets. O(itemCount) per call (one pass to
 * build offsets, one to find the visible range): cheap arithmetic over
 * thousands of numbers, not per-item DOM work, so recomputing this on every
 * scroll event is not itself a long-task risk.
 */
export function computeVariableVirtualWindow(input: VariableVirtualWindowInput): VirtualWindow {
  const { itemHeights, containerHeight, scrollTop } = input;
  const overscan = input.overscan ?? 0;
  const itemCount = itemHeights.length;

  if (itemCount === 0) return EMPTY_WINDOW;

  // offsets[i] = sum of itemHeights[0..i-1]; offsets[itemCount] = totalHeight.
  const offsets = new Array<number>(itemCount + 1);
  offsets[0] = 0;
  for (let i = 0; i < itemCount; i++) {
    offsets[i + 1] = offsets[i]! + Math.max(0, itemHeights[i]!);
  }
  const totalHeight = offsets[itemCount]!;

  if (containerHeight <= 0) return { ...EMPTY_WINDOW, totalHeight };

  const clampedScrollTop = Math.max(0, Math.min(scrollTop, Math.max(0, totalHeight - 1)));

  // First index whose offset already exceeds the scroll position is one
  // past the first partially-or-fully visible row.
  let firstVisible = 0;
  while (firstVisible < itemCount && offsets[firstVisible + 1]! <= clampedScrollTop) {
    firstVisible++;
  }

  // `<=`, not `<`: matches `computeVirtualWindow`'s own "+1 partial-row"
  // allowance for an item whose top edge lands exactly on the bottom edge
  // (0px actually visible) — over-including by up to one item at that exact
  // boundary is the same deliberate safety margin, not an off-by-one bug.
  let lastVisible = firstVisible;
  while (lastVisible < itemCount && offsets[lastVisible]! <= clampedScrollTop + containerHeight) {
    lastVisible++;
  }

  const startIndex = Math.max(0, firstVisible - overscan);
  const endIndex = Math.min(itemCount, Math.max(firstVisible, lastVisible) + overscan);

  return {
    startIndex,
    endIndex: Math.max(startIndex, endIndex),
    topPadding: offsets[startIndex]!,
    bottomPadding: Math.max(0, totalHeight - offsets[endIndex]!),
    totalHeight,
  };
}
