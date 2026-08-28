// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useNarrowViewport } from './useNarrowViewport.js';

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'matchMedia');
});

/** Minimal fake `MediaQueryList` — enough for `addEventListener('change', ...)`/`removeEventListener` and a mutable `.matches`. */
function fakeMatchMedia(initialMatches: boolean): {
  install: () => void;
  fireChange: (matches: boolean) => void;
} {
  let matches = initialMatches;
  const listeners = new Set<() => void>();
  const mql = {
    get matches() {
      return matches;
    },
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  };
  return {
    install: () => {
      (window as unknown as { matchMedia: (query: string) => typeof mql }).matchMedia = () => mql;
    },
    fireChange: (next: boolean) => {
      matches = next;
      for (const listener of listeners) listener();
    },
  };
}

describe('useNarrowViewport (v0.6.0 #6, PRD §7.3)', () => {
  it('returns false when window.matchMedia is unavailable (plain jsdom, no mock) — same as every existing test assumed before this hook existed', () => {
    const { result } = renderHook(() => useNarrowViewport());
    expect(result.current).toBe(false);
  });

  it('reflects the initial matchMedia() result', () => {
    fakeMatchMedia(true).install();
    const { result } = renderHook(() => useNarrowViewport());
    expect(result.current).toBe(true);
  });

  it('updates when the media query change event fires', () => {
    const media = fakeMatchMedia(false);
    media.install();
    const { result } = renderHook(() => useNarrowViewport());
    expect(result.current).toBe(false);

    act(() => media.fireChange(true));

    expect(result.current).toBe(true);
  });

  it('removes its change listener on unmount', () => {
    const removeEventListener = vi.fn();
    (window as unknown as { matchMedia: (query: string) => object }).matchMedia = () => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener,
    });
    const { unmount } = renderHook(() => useNarrowViewport());

    unmount();

    expect(removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
  });
});
