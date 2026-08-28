export interface PrecacheManifest {
  readonly buildId: string;
  readonly files: readonly string[];
}

/**
 * The manifest is fetched over the network at `sw.ts`'s `install` time
 * (ADR-029) rather than imported as a module, so nothing guarantees its
 * shape at that point — a corrupted or unexpectedly-shaped response must
 * not crash `install` and leave the previous cache in a half-replaced
 * state.
 */
export function isPrecacheManifest(value: unknown): value is PrecacheManifest {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.buildId === 'string' &&
    Array.isArray(candidate.files) &&
    candidate.files.every((file) => typeof file === 'string')
  );
}
