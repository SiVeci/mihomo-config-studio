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
