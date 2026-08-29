// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createCapacitorPlatformFileService,
  isNativePlatform,
  onAppStateChange,
  onIncomingDocument,
} from './capacitor.js';

// `vi.mock`'s factory is hoisted above ordinary `const` declarations, so the
// mock fns it closes over must be created through `vi.hoisted` too — a plain
// `const openDocument = vi.fn()` above `vi.mock` would still throw a
// temporal-dead-zone ReferenceError at import time.
const {
  openDocument,
  createDocument,
  shareText,
  safFileAddListener,
  isNativePlatformMock,
  addListener,
} = vi.hoisted(() => ({
  openDocument: vi.fn(),
  createDocument: vi.fn(),
  shareText: vi.fn(),
  safFileAddListener: vi.fn(),
  isNativePlatformMock: vi.fn(() => false),
  addListener: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => isNativePlatformMock() },
  registerPlugin: () => ({
    openDocument,
    createDocument,
    shareText,
    addListener: safFileAddListener,
  }),
}));

vi.mock('@capacitor/app', () => ({
  App: { addListener },
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe("isNativePlatform (ADR-026) — the repo's single @capacitor/* import point", () => {
  it('delegates to Capacitor.isNativePlatform()', () => {
    isNativePlatformMock.mockReturnValueOnce(false);
    expect(isNativePlatform()).toBe(false);
    isNativePlatformMock.mockReturnValueOnce(true);
    expect(isNativePlatform()).toBe(true);
  });
});

describe('createCapacitorPlatformFileService — capabilities', () => {
  it('reports both canSaveViaSystemPicker and canShare true — Android always has SAF and a share sheet', () => {
    const capabilities = createCapacitorPlatformFileService().capabilities;
    expect(capabilities.canSaveViaSystemPicker).toBe(true);
    expect(capabilities.canShare).toBe(true);
  });
});

describe('openDocument (ADR-026) — base64 content decoded back to UTF-8 text', () => {
  it('resolves opened with the decoded text and name', async () => {
    openDocument.mockResolvedValueOnce({
      cancelled: false,
      name: 'config.yaml',
      contentBase64: btoa('mode: rule\n'),
    });

    const outcome = await createCapacitorPlatformFileService().openDocument({
      acceptExtensions: ['.yaml'],
    });

    expect(outcome).toEqual({ kind: 'opened', text: 'mode: rule\n', name: 'config.yaml' });
  });

  it('resolves cancelled when the native side reports cancelled', async () => {
    openDocument.mockResolvedValueOnce({ cancelled: true });

    const outcome = await createCapacitorPlatformFileService().openDocument({
      acceptExtensions: ['.yaml'],
    });

    expect(outcome).toEqual({ kind: 'cancelled' });
  });
});

describe('saveDocument (ADR-026) — content sent as base64, safe for binary payloads', () => {
  it('base64-encodes string content and returns saved with the real name', async () => {
    createDocument.mockResolvedValueOnce({ cancelled: false, name: 'My Project.yaml' });

    const outcome = await createCapacitorPlatformFileService().saveDocument({
      suggestedName: 'My Project.yaml',
      content: 'mode: rule\n',
      mimeType: 'text/yaml',
    });

    expect(createDocument).toHaveBeenCalledWith({
      suggestedName: 'My Project.yaml',
      contentBase64: btoa('mode: rule\n'),
    });
    expect(outcome).toEqual({ kind: 'saved', name: 'My Project.yaml' });
  });

  it('round-trips arbitrary binary content (a .mcsproj ZIP) through base64 without corruption', async () => {
    createDocument.mockResolvedValueOnce({ cancelled: false, name: 'My Project.mcsproj' });
    const binaryContent = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff, 0x80, 0x7f]);

    await createCapacitorPlatformFileService().saveDocument({
      suggestedName: 'My Project.mcsproj',
      content: binaryContent,
      mimeType: 'application/zip',
    });

    const sentBase64 = (createDocument.mock.calls[0] as [{ contentBase64: string }])[0]
      .contentBase64;
    const roundTripped = Uint8Array.from(atob(sentBase64), (char) => char.charCodeAt(0));
    expect(roundTripped).toEqual(binaryContent);
  });

  it('resolves cancelled when the native side reports cancelled', async () => {
    createDocument.mockResolvedValueOnce({ cancelled: true });

    const outcome = await createCapacitorPlatformFileService().saveDocument({
      suggestedName: 'config.yaml',
      content: 'mode: rule\n',
      mimeType: 'text/yaml',
    });

    expect(outcome).toEqual({ kind: 'cancelled' });
  });
});

describe('shareDocument (ADR-026)', () => {
  it('reports shared once the native chooser call resolves', async () => {
    shareText.mockResolvedValueOnce(undefined);

    const outcome = await createCapacitorPlatformFileService().shareDocument({
      suggestedName: 'config.yaml',
      content: 'mode: rule\n',
      mimeType: 'text/yaml',
    });

    expect(outcome).toEqual({ kind: 'shared' });
  });

  it('reports failed/SHARE_FAILED when the native call throws, never the underlying error message', async () => {
    shareText.mockRejectedValueOnce(new Error('FileProvider could not create the cache file'));

    const outcome = await createCapacitorPlatformFileService().shareDocument({
      suggestedName: 'config.yaml',
      content: 'mode: rule\n',
      mimeType: 'text/yaml',
    });

    expect(outcome).toEqual({ kind: 'failed', code: 'SHARE_FAILED' });
  });
});

describe('onAppStateChange (v0.6.0 #8, NFR-REL-02) — the second flush signal lifecycle.ts wires in alongside visibilitychange', () => {
  it('forwards isActive from the native AppState payload to the callback', () => {
    let nativeCallback: ((state: { isActive: boolean }) => void) | undefined;
    addListener.mockImplementation((_eventName: string, callback: typeof nativeCallback) => {
      nativeCallback = callback;
      return Promise.resolve({ remove: vi.fn() });
    });
    const callback = vi.fn();

    onAppStateChange(callback);
    nativeCallback?.({ isActive: false });

    expect(callback).toHaveBeenCalledWith(false);
  });

  it('registers for the appStateChange event specifically', () => {
    addListener.mockReturnValue(Promise.resolve({ remove: vi.fn() }));

    onAppStateChange(vi.fn());

    expect(addListener).toHaveBeenCalledWith('appStateChange', expect.any(Function));
  });

  it('returns a synchronous unsubscribe function that removes the listener once the async registration resolves', async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    addListener.mockReturnValue(Promise.resolve({ remove }));

    const unsubscribe = onAppStateChange(vi.fn());
    unsubscribe();
    await Promise.resolve();
    await Promise.resolve();

    expect(remove).toHaveBeenCalledOnce();
  });
});

describe('onIncomingDocument (FR-AND-07, v0.6.0 #13) — decodes the base64 payload SafFilePlugin.kt sends', () => {
  it('registers for the incomingDocument event specifically', () => {
    safFileAddListener.mockReturnValue(Promise.resolve({ remove: vi.fn() }));

    onIncomingDocument(vi.fn());

    expect(safFileAddListener).toHaveBeenCalledWith('incomingDocument', expect.any(Function));
  });

  it('forwards the name and decodes contentBase64 back to UTF-8 text', () => {
    let nativeCallback: ((result: { name: string; contentBase64: string }) => void) | undefined;
    safFileAddListener.mockImplementation((_eventName: string, callback: typeof nativeCallback) => {
      nativeCallback = callback;
      return Promise.resolve({ remove: vi.fn() });
    });
    const callback = vi.fn();

    onIncomingDocument(callback);
    nativeCallback?.({ name: 'shared.yaml', contentBase64: btoa('mode: rule\n') });

    expect(callback).toHaveBeenCalledWith({ name: 'shared.yaml', text: 'mode: rule\n' });
  });

  it('returns a synchronous unsubscribe function that removes the listener once the async registration resolves', async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    safFileAddListener.mockReturnValue(Promise.resolve({ remove }));

    const unsubscribe = onIncomingDocument(vi.fn());
    unsubscribe();
    await Promise.resolve();
    await Promise.resolve();

    expect(remove).toHaveBeenCalledOnce();
  });
});
