import { createWebPlatformFileService } from './web.js';
import type { PlatformFileService } from './port.js';

export type {
  OpenDocumentOptions,
  OpenDocumentOutcome,
  PlatformCapabilities,
  PlatformFileService,
  SaveDocumentOptions,
  SaveDocumentOutcome,
  ShareDocumentOptions,
  ShareDocumentOutcome,
} from './port.js';

/**
 * Chooses the real implementation (ADR-026): today this always returns the
 * Web one. v0.6.0 #3 adds `capacitor.ts` — the repo's single `@capacitor/*`
 * import point (`packages/**`/rest of `apps/web` may not import it directly)
 * — and this function grows a `Capacitor.isNativePlatform()` branch then.
 * Resolved fresh per call rather than cached at module load so tests never
 * have to reset a module-level singleton between cases.
 */
export function resolvePlatformFileService(): PlatformFileService {
  return createWebPlatformFileService();
}
