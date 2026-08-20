import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
  currentPlatformKey,
  downloadAndVerifyKernel,
  KERNEL_DIGESTS,
  KernelDownloadError,
  kernelDownloadUrl,
  resolveKernelAsset,
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
