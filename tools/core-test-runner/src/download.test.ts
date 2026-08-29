import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
  BetaAssetResolutionError,
  currentPlatformKey,
  downloadAndVerifyKernel,
  downloadAndVerifyLatestKernel,
  KERNEL_DIGESTS,
  KernelDownloadError,
  kernelDownloadUrl,
  MIHOMO_LATEST_RELEASE_API_URL,
  resolveKernelAsset,
  resolveLatestAsset,
  verifyKernelBytes,
} from './download.js';

const LINUX_AMD64_ASSET = KERNEL_DIGESTS['linux-amd64']!;

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

describe('currentPlatformKey (multi-architecture table, E2)', () => {
  it('maps the only currently-pinned combination: linux/x64', () => {
    expect(currentPlatformKey('linux', 'x64')).toBe('linux-amd64');
  });

  it('maps the other three known combinations, even though none has a pinned digest yet', () => {
    expect(currentPlatformKey('linux', 'arm64')).toBe('linux-arm64');
    expect(currentPlatformKey('darwin', 'arm64')).toBe('darwin-arm64');
    expect(currentPlatformKey('win32', 'x64')).toBe('windows-amd64');
  });

  it('is null for a combination this table has no row for at all — never guessed at', () => {
    expect(currentPlatformKey('darwin', 'x64')).toBeNull();
    expect(currentPlatformKey('freebsd', 'x64')).toBeNull();
  });
});

describe('resolveKernelAsset', () => {
  it('resolves the one pinned row (linux-amd64)', () => {
    expect(resolveKernelAsset('linux-amd64')).toBe(LINUX_AMD64_ASSET);
  });

  it('throws — does not fall back to another platform — for a row with no pinned digest yet', () => {
    expect(() => resolveKernelAsset('linux-arm64')).toThrow(KernelDownloadError);
    expect(() => resolveKernelAsset('darwin-arm64')).toThrow(/no pinned digest/);
  });

  it('throws for an unrecognised platform key (null)', () => {
    expect(() => resolveKernelAsset(null)).toThrow(KernelDownloadError);
  });
});

describe('verifyKernelBytes (pure — never fetches anything)', () => {
  it('accepts bytes matching both the expected size and digest', () => {
    const bytes = new Uint8Array(LINUX_AMD64_ASSET.bytes).fill(7);
    const asset = { ...LINUX_AMD64_ASSET, sha256: sha256Hex(bytes) };
    expect(() => verifyKernelBytes(bytes, asset)).not.toThrow();
  });

  it('rejects a size mismatch — no retry, no partial acceptance', () => {
    const bytes = new Uint8Array(LINUX_AMD64_ASSET.bytes - 1);
    expect(() => verifyKernelBytes(bytes, LINUX_AMD64_ASSET)).toThrow(/size mismatch/);
  });

  it('rejects a digest mismatch even when the size happens to be correct', () => {
    const bytes = new Uint8Array(LINUX_AMD64_ASSET.bytes).fill(1);
    expect(() => verifyKernelBytes(bytes, LINUX_AMD64_ASSET)).toThrow(/digest mismatch/);
  });
});

describe('kernelDownloadUrl', () => {
  it('builds the real GitHub release asset URL, pinned to the release tag', () => {
    expect(kernelDownloadUrl(LINUX_AMD64_ASSET)).toBe(
      'https://github.com/MetaCubeX/mihomo/releases/download/v1.19.29/mihomo-linux-amd64-v1.19.29.gz',
    );
  });
});

describe('downloadAndVerifyKernel (injected fetch port — this test never touches the network)', () => {
  it('calls the injected fetch with the resolved asset’s real download URL', async () => {
    const fetchBytes = vi.fn(async () => new Uint8Array(LINUX_AMD64_ASSET.bytes));

    // These injected bytes are all zeros, so verification will fail (they do
    // not hash to the real pinned digest — this test cannot know the real
    // kernel binary's bytes without actually downloading it, which is
    // exactly what unit tests must not do). Wiring is what this test checks:
    // fetchBytes must have been called with the correct URL before that
    // rejection.
    await expect(downloadAndVerifyKernel(fetchBytes, 'linux-amd64')).rejects.toThrow(
      KernelDownloadError,
    );
    expect(fetchBytes).toHaveBeenCalledWith(kernelDownloadUrl(LINUX_AMD64_ASSET));
  });

  it('propagates a digest mismatch from the injected fetch rather than swallowing it', async () => {
    const wrongBytes = new Uint8Array(LINUX_AMD64_ASSET.bytes).fill(9);
    const fetchBytes = vi.fn(async () => wrongBytes);

    await expect(downloadAndVerifyKernel(fetchBytes, 'linux-amd64')).rejects.toThrow(
      /digest mismatch/,
    );
  });

  it('never calls fetchBytes at all when the platform has no pinned digest — fails before any network attempt', async () => {
    const fetchBytes = vi.fn(async () => new Uint8Array());

    await expect(downloadAndVerifyKernel(fetchBytes, 'darwin-arm64')).rejects.toThrow(
      /no pinned digest/,
    );
    expect(fetchBytes).not.toHaveBeenCalled();
  });
});

/**
 * Fixture shaped like a real `GET /repos/MetaCubeX/mihomo/releases/latest`
 * response (verified against the real API, 2026-08-29, tag v1.19.30): a
 * single release genuinely ships dozens of assets whose name contains
 * "linux-amd64" — GOAMD64 microarchitecture variants (`-v1-`/`-v2-`/`-v3-`),
 * `-compatible`, several pinned-Go-toolchain builds, and non-`.gz` package
 * formats. The intended plain build (`mihomo-linux-amd64-<version>.gz`) sorts
 * *after* several of the decoys in the real API response, which is exactly
 * what an unanchored substring match would get wrong — these fixtures keep
 * that real ordering so the test would fail loudly if `latestAssetPattern`
 * regressed to something looser.
 */
const REAL_SHAPE_DECOY_ASSETS = [
  { name: 'mihomo-linux-amd64-compatible-v1.19.30.gz', size: 1, browser_download_url: 'x' },
  { name: 'mihomo-linux-amd64-v1-go120-v1.19.30.gz', size: 1, browser_download_url: 'x' },
  { name: 'mihomo-linux-amd64-v1-go123-v1.19.30.gz', size: 1, browser_download_url: 'x' },
  { name: 'mihomo-linux-amd64-v1-v1.19.30.deb', size: 1, browser_download_url: 'x' },
  { name: 'mihomo-linux-amd64-v1-v1.19.30.gz', size: 1, browser_download_url: 'x' },
  { name: 'mihomo-linux-amd64-v1-v1.19.30.pkg.tar.zst', size: 1, browser_download_url: 'x' },
  { name: 'mihomo-linux-amd64-v1-v1.19.30.rpm', size: 1, browser_download_url: 'x' },
];

const REAL_PLAIN_ASSET = {
  name: 'mihomo-linux-amd64-v1.19.30.gz',
  size: 18868732,
  digest: 'sha256:cf06ce2c7d1421bdbda14ee4a5b6046672dc35ebf8eecd8e77504ec3c0ed9a84',
  browser_download_url:
    'https://github.com/MetaCubeX/mihomo/releases/download/v1.19.30/mihomo-linux-amd64-v1.19.30.gz',
};

describe('resolveLatestAsset (Beta track, ADR-031 — injected JSON fetch, never touches the network)', () => {
  it('picks the plain build among real-shaped decoys, ignoring GOAMD64/compatible/package-format variants', async () => {
    const fetchJson = vi.fn(async () => ({
      tag_name: 'v1.19.30',
      assets: [...REAL_SHAPE_DECOY_ASSETS, REAL_PLAIN_ASSET],
    }));

    const resolved = await resolveLatestAsset(fetchJson, 'linux-amd64');

    expect(fetchJson).toHaveBeenCalledWith(MIHOMO_LATEST_RELEASE_API_URL);
    expect(resolved).toEqual({
      tag: 'v1.19.30',
      asset: 'mihomo-linux-amd64-v1.19.30.gz',
      sha256: 'cf06ce2c7d1421bdbda14ee4a5b6046672dc35ebf8eecd8e77504ec3c0ed9a84',
      bytes: 18868732,
      downloadUrl: REAL_PLAIN_ASSET.browser_download_url,
    });
  });

  it('throws for a platform other than linux-amd64 without making any request', async () => {
    const fetchJson = vi.fn();
    await expect(resolveLatestAsset(fetchJson, 'darwin-arm64')).rejects.toThrow(
      BetaAssetResolutionError,
    );
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it('throws for a null platform key without making any request', async () => {
    const fetchJson = vi.fn();
    await expect(resolveLatestAsset(fetchJson, null)).rejects.toThrow(BetaAssetResolutionError);
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it('throws when no asset matches the plain build pattern at all', async () => {
    const fetchJson = vi.fn(async () => ({
      tag_name: 'v1.19.30',
      assets: REAL_SHAPE_DECOY_ASSETS,
    }));
    await expect(resolveLatestAsset(fetchJson, 'linux-amd64')).rejects.toThrow(/No asset matching/);
  });

  it('throws when the matched asset has no GitHub-reported digest to verify against', async () => {
    const fetchJson = vi.fn(async () => ({
      tag_name: 'v1.19.30',
      assets: [{ ...REAL_PLAIN_ASSET, digest: undefined }],
    }));
    await expect(resolveLatestAsset(fetchJson, 'linux-amd64')).rejects.toThrow(
      /no GitHub-reported sha256 digest/,
    );
  });
});

describe('downloadAndVerifyLatestKernel (Beta track — both injected ports, never touches the network)', () => {
  it('resolves, downloads from the resolved URL, and accepts bytes matching the resolved digest', async () => {
    const bytes = new Uint8Array(REAL_PLAIN_ASSET.size).fill(3);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const fetchJson = vi.fn(async () => ({
      tag_name: 'v1.19.30',
      assets: [{ ...REAL_PLAIN_ASSET, digest: `sha256:${sha256}` }],
    }));
    const fetchBytes = vi.fn(async () => bytes);

    const { bytes: got, resolved } = await downloadAndVerifyLatestKernel(
      fetchJson,
      fetchBytes,
      'linux-amd64',
    );

    expect(got).toBe(bytes);
    expect(resolved.tag).toBe('v1.19.30');
    expect(fetchBytes).toHaveBeenCalledWith(REAL_PLAIN_ASSET.browser_download_url);
  });

  it('rejects a digest mismatch against the digest resolved from the latest release, not any pinned value', async () => {
    const fetchJson = vi.fn(async () => ({ tag_name: 'v1.19.30', assets: [REAL_PLAIN_ASSET] }));
    const fetchBytes = vi.fn(async () => new Uint8Array(REAL_PLAIN_ASSET.size).fill(9));

    await expect(
      downloadAndVerifyLatestKernel(fetchJson, fetchBytes, 'linux-amd64'),
    ).rejects.toThrow(/digest mismatch/);
  });
});
