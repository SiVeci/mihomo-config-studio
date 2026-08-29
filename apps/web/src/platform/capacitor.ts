import { App } from '@capacitor/app';
import { Capacitor, registerPlugin } from '@capacitor/core';

import type {
  OpenDocumentOptions,
  OpenDocumentOutcome,
  PlatformFileService,
  SaveDocumentOptions,
  SaveDocumentOutcome,
  ShareDocumentOptions,
  ShareDocumentOutcome,
} from './port.js';

/**
 * The repo's single `@capacitor/*` import point (ADR-026, v0.6.0 engineering
 * constraints) — `packages/**` and the rest of `apps/web` reach Android
 * capabilities only through `PlatformFileService`, never this package
 * directly. `index.ts` decides Web vs. this implementation via
 * `isNativePlatform()` below, so it never has to import `@capacitor/core`
 * itself either.
 */
export function isNativePlatform(): boolean {
  return Capacitor.isNativePlatform();
}

/**
 * v0.6.0 #8: the second flush signal `lifecycle.ts` needs alongside
 * `visibilitychange` (NFR-REL-02) — `App.addListener` registers
 * asynchronously (it returns `Promise<PluginListenerHandle>`, a bridge
 * round-trip), but callers need a synchronous unsubscribe function to
 * return from a `useEffect` cleanup, so the promise is chained onto rather
 * than awaited here.
 */
export function onAppStateChange(callback: (isActive: boolean) => void): () => void {
  const handle = App.addListener('appStateChange', (state) => callback(state.isActive));
  return () => {
    void handle.then((listener) => listener.remove());
  };
}

/** Matches `SafFilePlugin.kt`'s `openDocument`/`createDocument` result shape exactly. */
interface SafFileOpenResult {
  readonly cancelled: boolean;
  readonly name?: string;
  readonly contentBase64?: string;
}
interface SafFileSaveResult {
  readonly cancelled: boolean;
  readonly name?: string;
}
interface IncomingDocumentResult {
  readonly name: string;
  readonly contentBase64: string;
}
interface SafFilePlugin {
  openDocument(): Promise<SafFileOpenResult>;
  createDocument(options: {
    suggestedName: string;
    contentBase64: string;
  }): Promise<SafFileSaveResult>;
  shareText(options: { contentBase64: string; filename: string }): Promise<void>;
  addListener(
    eventName: 'incomingDocument',
    listenerFunc: (result: IncomingDocumentResult) => void,
  ): Promise<{ remove: () => Promise<void> }>;
}

const SafFile = registerPlugin<SafFilePlugin>('SafFile');

/**
 * Content crosses the Capacitor bridge as base64, uniformly for text (YAML)
 * and binary (`.mcsproj`, a ZIP) payloads: the bridge only carries JSON, and
 * a `.mcsproj`'s raw bytes are not valid UTF-8, so decoding a binary export
 * as text on the native side would silently corrupt it (`SafFilePlugin.kt`
 * has the matching comment on its side of this contract).
 */
function toBase64(content: string | Uint8Array): string {
  const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Every `openDocument` caller today only ever imports YAML text (no `.mcsproj` *import* UI exists yet) — decoding straight to a UTF-8 string matches that, not a general binary-safe read. */
function base64ToText(base64: string): string {
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/**
 * FR-AND-07 (v0.6.0 #13): mirrors `onAppStateChange`'s async-handle
 * unsubscribe shape exactly — `addListener` is itself a bridge round-trip
 * (`Promise<{ remove }>`), but a `useEffect` cleanup needs a synchronous
 * function back, so the removal is chained onto rather than awaited here.
 * `SafFilePlugin.handleOnNewIntent` sends this with `retainUntilConsumed`,
 * so a share received before this listener attaches (always true on a cold
 * start) still arrives once it does.
 */
export function onIncomingDocument(
  callback: (doc: { name: string; text: string }) => void,
): () => void {
  const handle = SafFile.addListener('incomingDocument', (result) => {
    callback({ name: result.name, text: base64ToText(result.contentBase64) });
  });
  return () => {
    void handle.then((listener) => listener.remove());
  };
}

async function openDocumentCapacitor(_options: OpenDocumentOptions): Promise<OpenDocumentOutcome> {
  const result = await SafFile.openDocument();
  if (result.cancelled || result.name === undefined || result.contentBase64 === undefined) {
    return { kind: 'cancelled' };
  }
  return { kind: 'opened', text: base64ToText(result.contentBase64), name: result.name };
}

async function saveDocumentCapacitor(options: SaveDocumentOptions): Promise<SaveDocumentOutcome> {
  const result = await SafFile.createDocument({
    suggestedName: options.suggestedName,
    contentBase64: toBase64(options.content),
  });
  if (result.cancelled || result.name === undefined) {
    return { kind: 'cancelled' };
  }
  return { kind: 'saved', name: result.name };
}

/**
 * v0.6.0 #5's considered decision on `shareDocument`'s failure/cancel split
 * (revisiting the placeholder #3 left here): `ACTION_SEND`'s chooser gives
 * the calling app no reliable signal for "the user backed out without
 * picking a target" — not `startActivityForResult`'s result code (the
 * chooser typically finishes without ever calling `setResult` once it has
 * launched a target, so `RESULT_CANCELED` cannot be trusted to mean
 * "nothing was picked"), and not a `PendingIntent`-based chooser callback
 * either (that fires only once a target is *chosen*, never on a plain
 * back-out, so it cannot positively confirm cancellation any more than
 * silence can). Building a `BroadcastReceiver`-based "was anything picked"
 * signal was considered and rejected: it only narrows the ambiguity, adds
 * real lifecycle-management risk (receiver registration tied to the
 * hosting `Activity`), and the one thing that actually matters per PRD §12
 * — "cancelling is not a failure, never show an error for it" — already
 * holds today without it, because this function only ever resolves
 * `failed` for a genuine thrown error, never for silence. A future
 * WorkManager/JobIntentService-based completion signal could close this
 * gap properly if it ever becomes worth the complexity; nothing here rules
 * that out.
 */
async function shareDocumentCapacitor(
  options: ShareDocumentOptions,
): Promise<ShareDocumentOutcome> {
  try {
    await SafFile.shareText({
      contentBase64: toBase64(options.content),
      filename: options.suggestedName,
    });
    return { kind: 'shared' };
  } catch {
    return { kind: 'failed', code: 'SHARE_FAILED' };
  }
}

export function createCapacitorPlatformFileService(): PlatformFileService {
  return {
    capabilities: {
      canSaveViaSystemPicker: true,
      canShare: true,
    },
    openDocument: openDocumentCapacitor,
    saveDocument: saveDocumentCapacitor,
    shareDocument: shareDocumentCapacitor,
  };
}
