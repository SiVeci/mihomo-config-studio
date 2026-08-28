import { createCapacitorPlatformFileService, isNativePlatform } from './capacitor.js';
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
 * Chooses the real implementation (ADR-026). `isNativePlatform()` is
 * `capacitor.ts`'s own export precisely so this file never has to import
 * `@capacitor/core` itself — `capacitor.ts` stays the repo's single
 * `@capacitor/*` import point. Resolved fresh per call rather than cached at
 * module load so tests never have to reset a module-level singleton between
 * cases.
 */
export function resolvePlatformFileService(): PlatformFileService {
  return isNativePlatform() ? createCapacitorPlatformFileService() : createWebPlatformFileService();
}
