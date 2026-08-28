import type {
  OpenDocumentOptions,
  OpenDocumentOutcome,
  PlatformFileService,
  SaveDocumentOptions,
  SaveDocumentOutcome,
  ShareDocumentOutcome,
} from './port.js';

// File System Access API types are WICG, not yet part of TypeScript's
// bundled `dom.d.ts` — declared narrowly here (only the shape this file
// actually calls) rather than pulling in a `@types/*` package for three
// methods.
interface FileSystemWritableFileStream {
  write(data: BufferSource | Blob | string): Promise<void>;
  close(): Promise<void>;
}
interface FileSystemFileHandle {
  readonly name: string;
  createWritable(): Promise<FileSystemWritableFileStream>;
}
type ShowSaveFilePicker = (options?: { suggestedName?: string }) => Promise<FileSystemFileHandle>;

function getShowSaveFilePicker(): ShowSaveFilePicker | undefined {
  return (window as unknown as { showSaveFilePicker?: ShowSaveFilePicker }).showSaveFilePicker;
}

/**
 * `<input type=file>` + `File.text()`, never the File System Access API's
 * *open* side (`showOpenFilePicker`) — NFR-REL-04's constructive guarantee
 * (no writable handle anywhere in the import path) depends on this, and
 * `ImportPanel.test.tsx`'s structural scan enforces it repo-wide.
 *
 * `cancel` (Chrome 113+/Firefox 106+) resolves the promise on an explicit
 * cancel; on an engine without it, a cancelled picker simply never settles
 * this promise, same as never opening the picker at all — no hang-shaped
 * regression, just no progress, matching this app's `build.target` baseline
 * (ADR-027) which already assumes a WebView new enough for most of that
 * range.
 */
function openViaInputElement(options: OpenDocumentOptions): Promise<OpenDocumentOutcome> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = options.acceptExtensions.join(',');
    input.style.display = 'none';

    function cleanup(): void {
      input.removeEventListener('change', handleChange);
      input.removeEventListener('cancel', handleCancel);
      input.remove();
    }

    function handleChange(): void {
      const file = input.files?.[0];
      cleanup();
      if (!file) {
        resolve({ kind: 'cancelled' });
        return;
      }
      void file.text().then((text) => resolve({ kind: 'opened', text, name: file.name }));
    }

    function handleCancel(): void {
      cleanup();
      resolve({ kind: 'cancelled' });
    }

    input.addEventListener('change', handleChange);
    input.addEventListener('cancel', handleCancel);
    document.body.appendChild(input);
    input.click();
  });
}

async function saveViaSystemPicker(
  options: SaveDocumentOptions,
  showSaveFilePicker: ShowSaveFilePicker,
): Promise<SaveDocumentOutcome> {
  let handle: FileSystemFileHandle;
  try {
    handle = await showSaveFilePicker({ suggestedName: options.suggestedName });
  } catch (error) {
    // AbortError is the spec's own signal for "the user dismissed the
    // picker" — an expected outcome, not a failure to report or retry.
    if (error instanceof DOMException && error.name === 'AbortError') {
      return { kind: 'cancelled' };
    }
    throw error;
  }
  const writable = await handle.createWritable();
  // Same `Uint8Array`-is-generically-`ArrayBufferLike` reasoning as
  // `downloadBlob` below: copy-construct to re-assert a plain `ArrayBuffer`
  // for TS 5.7's stricter `BufferSource`.
  const writeChunk =
    typeof options.content === 'string' ? options.content : new Uint8Array(options.content);
  await writable.write(writeChunk);
  await writable.close();
  return { kind: 'saved', name: handle.name };
}

/** Same Blob + `<a download>` path this app always used, now reached only when `showSaveFilePicker` does not exist rather than being the only path. */
function downloadBlob(content: string | Uint8Array, filename: string, mimeType: string): void {
  // `Blob`'s `BlobPart` wants an `ArrayBuffer`-backed view specifically;
  // `Uint8Array` alone is typed generically over `ArrayBufferLike` (which
  // also covers `SharedArrayBuffer`) since TS 5.7.
  const blobPart = typeof content === 'string' ? content : new Uint8Array(content);
  const blob = new Blob([blobPart], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function saveDocumentWeb(options: SaveDocumentOptions): Promise<SaveDocumentOutcome> {
  const showSaveFilePicker = getShowSaveFilePicker();
  if (showSaveFilePicker) {
    return saveViaSystemPicker(options, showSaveFilePicker);
  }
  downloadBlob(options.content, options.suggestedName, options.mimeType);
  return { kind: 'downloaded', name: options.suggestedName };
}

/** FR-AND-03 (system share sheet) is Android-only — `capabilities.canShare` is false on Web, so the UI never calls this; it exists only so the interface is total. */
async function shareDocumentWeb(): Promise<ShareDocumentOutcome> {
  return { kind: 'failed', code: 'UNSUPPORTED_PLATFORM' };
}

export function createWebPlatformFileService(): PlatformFileService {
  return {
    capabilities: {
      canSaveViaSystemPicker: typeof getShowSaveFilePicker() === 'function',
      canShare: false,
    },
    openDocument: openViaInputElement,
    saveDocument: saveDocumentWeb,
    shareDocument: shareDocumentWeb,
  };
}
