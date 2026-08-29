// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

const { isNativePlatform, onIncomingDocument } = vi.hoisted(() => ({
  isNativePlatform: vi.fn(() => false),
  onIncomingDocument: vi.fn(),
}));
vi.mock('./capacitor.js', () => ({ isNativePlatform, onIncomingDocument }));

import { registerIncomingDocumentHandler } from './incoming-document.js';

afterEach(() => {
  vi.clearAllMocks();
});

describe('registerIncomingDocumentHandler (FR-AND-07, v0.6.0 #13)', () => {
  it('does not subscribe on a non-native platform, and returns a harmless no-op unsubscribe', () => {
    isNativePlatform.mockReturnValue(false);
    const onDocument = vi.fn();

    const unsubscribe = registerIncomingDocumentHandler(onDocument);
    unsubscribe();

    expect(onIncomingDocument).not.toHaveBeenCalled();
  });

  it('forwards a received document to the callback, on a native platform', () => {
    isNativePlatform.mockReturnValue(true);
    let nativeCallback: ((doc: { name: string; text: string }) => void) | undefined;
    onIncomingDocument.mockImplementation((callback: typeof nativeCallback) => {
      nativeCallback = callback;
      return vi.fn();
    });
    const onDocument = vi.fn();

    registerIncomingDocumentHandler(onDocument);
    nativeCallback?.({ name: 'shared.yaml', text: 'mode: rule\n' });

    expect(onDocument).toHaveBeenCalledWith({ name: 'shared.yaml', text: 'mode: rule\n' });
  });

  it('delegates the returned unsubscribe function to the native one, on a native platform', () => {
    isNativePlatform.mockReturnValue(true);
    const unsubscribeNative = vi.fn();
    onIncomingDocument.mockReturnValue(unsubscribeNative);

    const unsubscribe = registerIncomingDocumentHandler(vi.fn());
    unsubscribe();

    expect(unsubscribeNative).toHaveBeenCalledOnce();
  });
});
