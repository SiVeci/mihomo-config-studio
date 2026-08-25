import { describe, expect, it } from 'vitest';

import { computeReorderTarget } from './reorder.js';

describe('computeReorderTarget', () => {
  it('moves up by one from the middle', () => {
    expect(computeReorderTarget({ itemCount: 10, index: 5, operation: 'up' })).toBe(4);
  });

  it('moves down by one from the middle', () => {
    expect(computeReorderTarget({ itemCount: 10, index: 5, operation: 'down' })).toBe(6);
  });

  it('is a no-op moving up from the first index (top boundary)', () => {
    expect(computeReorderTarget({ itemCount: 10, index: 0, operation: 'up' })).toBe(0);
  });

  it('is a no-op moving down from the last index (bottom boundary)', () => {
    expect(computeReorderTarget({ itemCount: 10, index: 9, operation: 'down' })).toBe(9);
  });

  it('home jumps straight to index 0 from any position', () => {
    expect(computeReorderTarget({ itemCount: 10, index: 7, operation: 'home' })).toBe(0);
    expect(computeReorderTarget({ itemCount: 10, index: 0, operation: 'home' })).toBe(0);
    expect(computeReorderTarget({ itemCount: 10, index: 9, operation: 'home' })).toBe(0);
  });

  it('end jumps straight to the last index from any position', () => {
    expect(computeReorderTarget({ itemCount: 10, index: 2, operation: 'end' })).toBe(9);
    expect(computeReorderTarget({ itemCount: 10, index: 0, operation: 'end' })).toBe(9);
    expect(computeReorderTarget({ itemCount: 10, index: 9, operation: 'end' })).toBe(9);
  });

  it('is a no-op for every operation on a single-item list', () => {
    for (const operation of ['up', 'down', 'home', 'end'] as const) {
      expect(computeReorderTarget({ itemCount: 1, index: 0, operation })).toBe(0);
    }
  });

  it('is a no-op for every operation on an empty list', () => {
    for (const operation of ['up', 'down', 'home', 'end'] as const) {
      expect(computeReorderTarget({ itemCount: 0, index: 0, operation })).toBe(0);
    }
  });

  it('clamps an out-of-range index defensively instead of producing an out-of-bounds target', () => {
    expect(computeReorderTarget({ itemCount: 10, index: 999, operation: 'up' })).toBe(8);
    expect(computeReorderTarget({ itemCount: 10, index: -5, operation: 'down' })).toBe(1);
  });

  it('moving one step at a time across the whole valid index range never leaves that range', () => {
    const itemCount = 20;
    let index = 0;
    for (let step = 0; step < itemCount * 2; step += 1) {
      index = computeReorderTarget({ itemCount, index, operation: 'down' });
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(itemCount);
    }
    expect(index).toBe(itemCount - 1);
  });
});
