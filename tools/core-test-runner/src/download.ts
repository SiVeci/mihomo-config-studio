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

// ---------------------------------------------------------------------------
// Beta track (ADR-031): follows GitHub's own `latest` release rather than a
// pinned tag, so — unlike the Stable table above — there is no constant to
// compare against. The digest used for verification is resolved at run time
// from GitHub's own API response for that specific asset, not a value a
// human has reviewed in advance. This is a real, deliberate trust downgrade
// from the Stable track (recorded in ADR-031, not hidden): it still catches
// transit corruption, but not a compromised release published upstream.
// This is a network call from `tools/**`, not `packages/**` — `no-network-egress`
// only scans `packages/**` and is unaffected; keep it that way; never move
// this logic into a `packages/**` import graph.
// ---------------------------------------------------------------------------

export class BetaAssetResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BetaAssetResolutionError';
  }
}

/** Injectable JSON-fetch port, parallel to `FetchBytes` — kept separate because it returns parsed JSON, not raw bytes. */
export type FetchJson = (url: string) => Promise<unknown>;

export const MIHOMO_LATEST_RELEASE_API_URL =
  'https://api.github.com/repos/MetaCubeX/mihomo/releases/latest';

/**
 * A real GitHub release, upstream's own `latest` — resolved once per run,
 * never cached across runs. `tag`/`digest` are logged by the caller
 * (ADR-031 point (a)) so a CI reader can always see exactly which upstream
 * build a Beta run actually exercised.
 */
export interface LatestKernelAsset {
  readonly tag: string;
  readonly asset: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly downloadUrl: string;
}

interface GitHubReleaseAsset {
  readonly name: string;
  readonly size: number;
  /** `"sha256:<hex>"`, when GitHub reports one for this asset — not guaranteed for every asset on every release. */
  readonly digest?: string;
  readonly browser_download_url: string;
}

interface GitHubRelease {
  readonly tag_name: string;
  readonly assets: readonly GitHubReleaseAsset[];
}

/**
 * Matches only the plain per-platform build (e.g. `mihomo-linux-amd64-v1.19.30.gz`)
 * — the same asset flavour the Stable table pins. Verified against a real
 * `releases/latest` response (2026-08-29): a single release ships dozens of
 * `linux-amd64`-containing assets (`-compatible`, `-v1-`/`-v2-`/`-v3-`
 * GOAMD64 variants, several pinned Go toolchain builds, `.deb`/`.rpm`/
 * `.pkg.tar.zst` packages) — an unanchored substring match on `linux-amd64`
 * would non-deterministically pick whichever of those sorts first in the API
 * response, not the intended plain build. Anchored front and back so only
 * the exact `mihomo-<os>-<arch>-<version>.gz` shape matches.
 */
function latestAssetPattern(platformKey: KernelPlatformKey): RegExp {
  const [os, arch] = platformKey.split('-');
  return new RegExp(`^mihomo-${os}-${arch}-v\\d+\\.\\d+\\.\\d+\\.gz$`);
}

/**
 * Resolves the Beta track's asset for the current platform from GitHub's
 * `releases/latest` (never a cached/pinned value — that is the whole point
 * of "Beta"). Throws rather than falling back to any other asset when the
 * expected plain build or its digest is missing, matching the Stable path's
 * own "never guess" posture.
 */
export async function resolveLatestAsset(
  fetchJson: FetchJson,
  platformKey: KernelPlatformKey | null,
): Promise<LatestKernelAsset> {
  if (platformKey !== 'linux-amd64') {
    throw new BetaAssetResolutionError(
      `Beta track only resolves "linux-amd64" today; got ${platformKey === null ? 'an unrecognised platform' : `"${platformKey}"`}.`,
    );
  }
  const release = (await fetchJson(MIHOMO_LATEST_RELEASE_API_URL)) as GitHubRelease;
  const pattern = latestAssetPattern(platformKey);
  const asset = release.assets.find((candidate) => pattern.test(candidate.name));
  if (!asset) {
    throw new BetaAssetResolutionError(
      `No asset matching "${pattern.source}" found in upstream release "${release.tag_name}".`,
    );
  }
  if (!asset.digest?.startsWith('sha256:')) {
    throw new BetaAssetResolutionError(
      `Upstream release "${release.tag_name}" asset "${asset.name}" has no GitHub-reported sha256 digest to verify against.`,
    );
  }
  return {
    tag: release.tag_name,
    asset: asset.name,
    sha256: asset.digest.slice('sha256:'.length),
    bytes: asset.size,
    downloadUrl: asset.browser_download_url,
  };
}

/** Resolves the Beta track's latest asset, fetches it through the injected port, and verifies the bytes against GitHub's own reported digest for that specific asset (see the trust-model note above `BetaAssetResolutionError`). */
export async function downloadAndVerifyLatestKernel(
  fetchJson: FetchJson,
  fetchBytes: FetchBytes,
  platformKey: KernelPlatformKey | null,
): Promise<{ bytes: Uint8Array; resolved: LatestKernelAsset }> {
  const resolved = await resolveLatestAsset(fetchJson, platformKey);
  const bytes = await fetchBytes(resolved.downloadUrl);
  verifyKernelBytes(bytes, {
    asset: resolved.asset,
    sha256: resolved.sha256,
    bytes: resolved.bytes,
  });
  return { bytes, resolved };
}
