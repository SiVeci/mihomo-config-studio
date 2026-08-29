import { isNativePlatform, onIncomingDocument } from './capacitor.js';

export interface IncomingDocument {
  readonly name: string;
  readonly text: string;
}

/**
 * FR-AND-07 (v0.6.0 #13): Android-only, same `isNativePlatform()` gating
 * `lifecycle.ts` uses for `onAppStateChange` — Web has no share-target
 * registration (out of scope), so this is a no-op subscription there.
 */
export function registerIncomingDocumentHandler(
  onDocument: (doc: IncomingDocument) => void,
): () => void {
  if (!isNativePlatform()) return () => {};
  return onIncomingDocument(onDocument);
}
