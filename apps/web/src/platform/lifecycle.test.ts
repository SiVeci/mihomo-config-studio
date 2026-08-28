// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

const { isNativePlatform, onAppStateChange } = vi.hoisted(() => ({
  isNativePlatform: vi.fn(() => false),
  onAppStateChange: vi.fn(),
}));
vi.mock('./capacitor.js', () => ({ isNativePlatform, onAppStateChange }));

import { registerBackgroundFlush } from './lifecycle.js';

function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: state });
}

afterEach(() => {
  vi.clearAllMocks();
  setVisibility('visible');
});

describe('registerBackgroundFlush (NFR-REL-02, v0.6.0 #8)', () => {
  it('flushes when the document becomes hidden', () => {
    const flush = vi.fn();
    registerBackgroundFlush(flush);
    setVisibility('hidden');

    document.dispatchEvent(new Event('visibilitychange'));

    expect(flush).toHaveBeenCalledOnce();
  });

  it('does not flush when visibilitychange fires but the document is still visible', () => {
    const flush = vi.fn();
    registerBackgroundFlush(flush);
    setVisibility('visible');

    document.dispatchEvent(new Event('visibilitychange'));

    expect(flush).not.toHaveBeenCalled();
  });

  it('flushes on beforeunload', () => {
    const flush = vi.fn();
    registerBackgroundFlush(flush);

    window.dispatchEvent(new Event('beforeunload'));

    expect(flush).toHaveBeenCalledOnce();
  });

  it('does not subscribe to appStateChange on a non-native platform', () => {
    isNativePlatform.mockReturnValue(false);

    registerBackgroundFlush(vi.fn());

    expect(onAppStateChange).not.toHaveBeenCalled();
  });

  it('flushes when appStateChange reports isActive: false, on a native platform', () => {
    isNativePlatform.mockReturnValue(true);
    let nativeCallback: ((isActive: boolean) => void) | undefined;
    onAppStateChange.mockImplementation((callback: (isActive: boolean) => void) => {
      nativeCallback = callback;
      return vi.fn();
    });
    const flush = vi.fn();

    registerBackgroundFlush(flush);
    nativeCallback?.(false);

    expect(flush).toHaveBeenCalledOnce();
  });

  it('does not flush when appStateChange reports isActive: true (the app coming back to the foreground)', () => {
    isNativePlatform.mockReturnValue(true);
    let nativeCallback: ((isActive: boolean) => void) | undefined;
    onAppStateChange.mockImplementation((callback: (isActive: boolean) => void) => {
      nativeCallback = callback;
      return vi.fn();
    });
    const flush = vi.fn();

    registerBackgroundFlush(flush);
    nativeCallback?.(true);

    expect(flush).not.toHaveBeenCalled();
  });

  it('the cleanup function removes both DOM listeners and the native subscription', () => {
    isNativePlatform.mockReturnValue(true);
    const unsubscribeNative = vi.fn();
    onAppStateChange.mockReturnValue(unsubscribeNative);
    const flush = vi.fn();

    const cleanup = registerBackgroundFlush(flush);
    cleanup();
    setVisibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('beforeunload'));

    expect(flush).not.toHaveBeenCalled();
    expect(unsubscribeNative).toHaveBeenCalledOnce();
  });
});
