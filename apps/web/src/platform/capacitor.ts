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
interface SafFilePlugin {
  openDocument(): Promise<SafFileOpenResult>;
  createDocument(options: {
    suggestedName: string;
    contentBase64: string;
  }): Promise<SafFileSaveResult>;
  shareText(options: { contentBase64: string; filename: string }): Promise<void>;
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
 * `ACTION_SEND`'s chooser gives the calling app no reliable callback for
 * "the user backed out without picking a target" (a platform limitation,
 * not an oversight here) — cancel/failure distinction is v0.6.0 #5's job.
 * For now: the native call succeeding means the chooser was shown.
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
