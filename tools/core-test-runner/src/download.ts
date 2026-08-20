import { createHash } from 'node:crypto';

/**
 * One platform's pinned Mihomo v1.19.29 release asset (ADR-012, D-003).
 * Upstream publishes no SHASUMS/`.sha256` asset for this release (verified,
 * D-003) — `sha256` here is the digest GitHub itself reports for the asset,
 * fixed once and never recomputed at run time. A mismatch is always treated
 * as a real integrity failure: no retry, no falling back to an unverified
 * download.
 */
export interface KernelAsset {
  readonly asset: string;
  readonly sha256: string;
  readonly bytes: number;
}

export type KernelPlatformKey = 'linux-amd64' | 'linux-arm64' | 'darwin-arm64' | 'windows-amd64';

export const KERNEL_RELEASE_TAG = 'v1.19.29';

/**
 * A multi-architecture table from day one (E2), not a single constant: only
 * `linux-amd64` (this CI's own runner) is filled in this version. The other
 * three stay `null` and fail loudly (`resolveKernelAsset` throws) rather
 * than silently falling back to the amd64 row — adding a macOS/Windows
 * runner later is then purely a data change, not a structural one.
 */
export const KERNEL_DIGESTS: Record<KernelPlatformKey, KernelAsset | null> = {
  'linux-amd64': {
    // Value and provenance: GitHub's own reported asset digest for this
    // release (upstream ships no checksum manifest, D-003), not independently
    // re-derived — recorded here so a future reader can judge trust, not
    // just trust it blindly.
    asset: 'mihomo-linux-amd64-v1.19.29.gz',
    sha256: '60de76a35a6cbf7b4fa4a20f5c257c24345d1d635ab1aa3877022a1997ef413c',
    bytes: 17858765,
  },
  'linux-arm64': null,
  'darwin-arm64': null,
  'windows-amd64': null,
};

export class KernelDownloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KernelDownloadError';
  }
}

/** `null` for any (platform, arch) combination this table has no row for at all — never guessed at. */
export function currentPlatformKey(
  platform: NodeJS.Platform,
  arch: string,
): KernelPlatformKey | null {
  if (platform === 'linux' && arch === 'x64') return 'linux-amd64';
  if (platform === 'linux' && arch === 'arm64') return 'linux-arm64';
  if (platform === 'darwin' && arch === 'arm64') return 'darwin-arm64';
  if (platform === 'win32' && arch === 'x64') return 'windows-amd64';
  return null;
}

/** Throws — never returns a fallback asset — for an unrecognised platform or one with no pinned digest yet. */
export function resolveKernelAsset(platformKey: KernelPlatformKey | null): KernelAsset {
  if (!platformKey) {
    throw new KernelDownloadError(
      'unrecognised (platform, arch) combination — no Mihomo kernel asset mapping exists for it',
    );
  }
  const asset = KERNEL_DIGESTS[platformKey];
  if (!asset) {
    throw new KernelDownloadError(
      `no pinned digest for "${platformKey}" yet — add one to KERNEL_DIGESTS rather than falling back to another platform's asset`,
    );
  }
  return asset;
}

/** Pure: verifies already-downloaded bytes against the pinned digest. Never fetches anything itself. */
export function verifyKernelBytes(bytes: Uint8Array, asset: KernelAsset): void {
  if (bytes.byteLength !== asset.bytes) {
    throw new KernelDownloadError(
      `size mismatch for ${asset.asset}: expected ${asset.bytes} bytes, got ${bytes.byteLength}`,
    );
  }
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== asset.sha256) {
    throw new KernelDownloadError(
      `digest mismatch for ${asset.asset}: expected sha256:${asset.sha256}, got sha256:${actual}`,
    );
  }
}

/** Injectable fetch port: tests supply a fake, the real CLI (`index.ts`) supplies one backed by the real `fetch`. */
export type FetchBytes = (url: string) => Promise<Uint8Array>;

export function kernelDownloadUrl(asset: KernelAsset): string {
  return `https://github.com/MetaCubeX/mihomo/releases/download/${KERNEL_RELEASE_TAG}/${asset.asset}`;
}

/** Resolves the right asset for the current platform, fetches it through the injected port, and verifies it before returning. */
export async function downloadAndVerifyKernel(
  fetchBytes: FetchBytes,
  platformKey: KernelPlatformKey | null,
): Promise<Uint8Array> {
  const asset = resolveKernelAsset(platformKey);
  const bytes = await fetchBytes(kernelDownloadUrl(asset));
  verifyKernelBytes(bytes, asset);
  return bytes;
}
