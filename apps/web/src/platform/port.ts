/**
 * Platform-agnostic file operations (ADR-026): the same UI code
 * (`ImportPanel.tsx`, `ExportDialog.tsx`) calls this port on both Web and
 * Android, and each platform supplies its own implementation
 * (`web.ts` here; `capacitor.ts`, added in v0.6.0 #3, on Android).
 */
export interface OpenDocumentOptions {
  /** File extensions the system picker should filter by, e.g. `['.yaml', '.yml']` — not enforced on the returned content, just a picker hint. */
  readonly acceptExtensions: readonly string[];
}

export type OpenDocumentOutcome =
  | { readonly kind: 'opened'; readonly text: string; readonly name: string }
  | { readonly kind: 'cancelled' };

export interface SaveDocumentOptions {
  readonly suggestedName: string;
  readonly content: string | Uint8Array;
  readonly mimeType: string;
}

/**
 * Three outcomes, not two — the version document's own framing: falling
 * back to a download is a *degradation the port reports*, not an error a
 * caller has to catch. `saved` (a real "save as", the user picked a
 * location) and `downloaded` (a browser download, no location choice) are
 * both success — only the UI copy differs (PRD §11.4).
 */
export type SaveDocumentOutcome =
  | { readonly kind: 'saved'; readonly name: string }
  | { readonly kind: 'downloaded'; readonly name: string }
  | { readonly kind: 'cancelled' };

export interface ShareDocumentOptions {
  readonly suggestedName: string;
  readonly content: string | Uint8Array;
  readonly mimeType: string;
}

/** `code` is a stable category, never a message/URI (NFR-SEC-03) — wired into the UI starting v0.6.0 #5. */
export type ShareDocumentOutcome =
  | { readonly kind: 'shared' }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'failed'; readonly code: string };

export interface PlatformCapabilities {
  /** Whether `saveDocument` can offer a true "save as" (`saved`) rather than always degrading to `downloaded` — lets the UI label the button correctly *before* the user clicks (PRD §11.4, v0.6.0 #7). */
  readonly canSaveViaSystemPicker: boolean;
  /** Whether `shareDocument` does anything at all. FR-AND-03 (system share sheet) is Android-only — false on Web until a platform actually implements it. */
  readonly canShare: boolean;
}

export interface PlatformFileService {
  readonly capabilities: PlatformCapabilities;
  openDocument(options: OpenDocumentOptions): Promise<OpenDocumentOutcome>;
  saveDocument(options: SaveDocumentOptions): Promise<SaveDocumentOutcome>;
  shareDocument(options: ShareDocumentOptions): Promise<ShareDocumentOutcome>;
}
