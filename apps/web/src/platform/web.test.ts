// @vitest-environment jsdom
import { fireEvent } from '@testing-library/dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createWebPlatformFileService } from './web.js';

function captureCreatedInput(): () => HTMLInputElement {
  let captured: HTMLInputElement | undefined;
  const original = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
    const element = original(tagName);
    if (tagName === 'input') captured = element as HTMLInputElement;
    return element;
  });
  return () => {
    if (!captured) throw new Error('no <input> element was created');
    return captured;
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, 'showSaveFilePicker');
});

describe('createWebPlatformFileService — capabilities (ADR-026)', () => {
  it('reports canSaveViaSystemPicker true when showSaveFilePicker exists', () => {
    (window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = vi.fn();
    expect(createWebPlatformFileService().capabilities.canSaveViaSystemPicker).toBe(true);
  });

  it('reports canSaveViaSystemPicker false when showSaveFilePicker does not exist', () => {
    expect(createWebPlatformFileService().capabilities.canSaveViaSystemPicker).toBe(false);
  });

  it('reports canShare false — FR-AND-03 is Android-only', () => {
    expect(createWebPlatformFileService().capabilities.canShare).toBe(false);
  });
});

describe('openDocument (ADR-026) — <input type=file> + File.text(), never a writable handle', () => {
  it('resolves opened with the file text and name once a file is chosen', async () => {
    const getInput = captureCreatedInput();
    const promise = createWebPlatformFileService().openDocument({
      acceptExtensions: ['.yaml', '.yml'],
    });
    const input = getInput();
    expect(input.accept).toBe('.yaml,.yml');
    const file = new File(['mode: rule\n'], 'config.yaml', { type: 'text/yaml' });
    fireEvent.change(input, { target: { files: [file] } });

    await expect(promise).resolves.toEqual({
      kind: 'opened',
      text: 'mode: rule\n',
      name: 'config.yaml',
    });
  });

  it('resolves cancelled when the change event fires with no file selected', async () => {
    const getInput = captureCreatedInput();
    const promise = createWebPlatformFileService().openDocument({ acceptExtensions: ['.yaml'] });
    fireEvent.change(getInput(), { target: { files: [] } });

    await expect(promise).resolves.toEqual({ kind: 'cancelled' });
  });

  it('resolves cancelled on the native cancel event', async () => {
    const getInput = captureCreatedInput();
    const promise = createWebPlatformFileService().openDocument({ acceptExtensions: ['.yaml'] });
    fireEvent(getInput(), new Event('cancel'));

    await expect(promise).resolves.toEqual({ kind: 'cancelled' });
  });

  it('removes the transient input element from the document after settling', async () => {
    const getInput = captureCreatedInput();
    const promise = createWebPlatformFileService().openDocument({ acceptExtensions: ['.yaml'] });
    const input = getInput();
    expect(document.body.contains(input)).toBe(true);
    fireEvent(input, new Event('cancel'));
    await promise;

    expect(document.body.contains(input)).toBe(false);
  });
});

describe('saveDocument (ADR-026)', () => {
  it('uses showSaveFilePicker and returns saved with the real handle name when it exists', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn().mockResolvedValue(undefined);
    const createWritable = vi.fn().mockResolvedValue({ write, close });
    const showSaveFilePicker = vi.fn().mockResolvedValue({ name: 'config.yaml', createWritable });
    (window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = showSaveFilePicker;

    const outcome = await createWebPlatformFileService().saveDocument({
      suggestedName: 'config.yaml',
      content: 'mode: rule\n',
      mimeType: 'text/yaml',
    });

    expect(showSaveFilePicker).toHaveBeenCalledWith({ suggestedName: 'config.yaml' });
    expect(write).toHaveBeenCalledWith('mode: rule\n');
    expect(close).toHaveBeenCalled();
    expect(outcome).toEqual({ kind: 'saved', name: 'config.yaml' });
  });

  it('returns cancelled, not an error, when the picker is dismissed (AbortError)', async () => {
    const showSaveFilePicker = vi
      .fn()
      .mockRejectedValue(new DOMException('dismissed', 'AbortError'));
    (window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = showSaveFilePicker;

    const outcome = await createWebPlatformFileService().saveDocument({
      suggestedName: 'config.yaml',
      content: 'mode: rule\n',
      mimeType: 'text/yaml',
    });

    expect(outcome).toEqual({ kind: 'cancelled' });
  });

  it('propagates a non-abort error rather than silently downgrading to a download', async () => {
    const showSaveFilePicker = vi.fn().mockRejectedValue(new Error('disk full'));
    (window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = showSaveFilePicker;

    await expect(
      createWebPlatformFileService().saveDocument({
        suggestedName: 'config.yaml',
        content: 'mode: rule\n',
        mimeType: 'text/yaml',
      }),
    ).rejects.toThrow('disk full');
  });

  it('falls back to a Blob download and reports downloaded when showSaveFilePicker does not exist', async () => {
    const createObjectURL = vi.fn().mockReturnValue('blob:fake-url');
    const revokeObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    const outcome = await createWebPlatformFileService().saveDocument({
      suggestedName: 'config.yaml',
      content: 'mode: rule\n',
      mimeType: 'text/yaml',
    });

    expect(createObjectURL).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake-url');
    expect(outcome).toEqual({ kind: 'downloaded', name: 'config.yaml' });
  });
});

describe('shareDocument (ADR-026)', () => {
  it('reports failed/UNSUPPORTED_PLATFORM — never called by the UI since capabilities.canShare is false', async () => {
    const outcome = await createWebPlatformFileService().shareDocument({
      suggestedName: 'config.yaml',
      content: 'mode: rule\n',
      mimeType: 'text/yaml',
    });

    expect(outcome).toEqual({ kind: 'failed', code: 'UNSUPPORTED_PLATFORM' });
  });
});
