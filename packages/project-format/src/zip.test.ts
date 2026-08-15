import { describe, expect, it } from 'vitest';

import { ProjectFormatError, readZip, writeZip } from './zip.js';
import type { ZipEntry } from './zip.js';

const encoder = new TextEncoder();

describe('writeZip / readZip round-trip', () => {
  it('round-trips a single entry with its path and content intact', async () => {
    const entries: ZipEntry[] = [{ path: 'config.yaml', data: encoder.encode('mode: rule\n') }];

    const archive = await writeZip(entries);
    const read = await readZip(archive);

    expect(read).toEqual(entries);
  });

  it('round-trips multiple entries and preserves their order', async () => {
    const entries: ZipEntry[] = [
      { path: 'manifest.json', data: encoder.encode('{"a":1}') },
      { path: 'config.yaml', data: encoder.encode('mode: rule\n') },
      { path: 'ui-state.json', data: encoder.encode('{}') },
      { path: 'schema-lock.json', data: encoder.encode('{"b":2}') },
    ];

    const read = await readZip(await writeZip(entries));

    expect(read.map((entry) => entry.path)).toEqual(entries.map((entry) => entry.path));
    expect(read).toEqual(entries);
  });

  it('round-trips a zero-byte entry', async () => {
    const entries: ZipEntry[] = [{ path: 'empty.txt', data: new Uint8Array(0) }];

    const read = await readZip(await writeZip(entries));

    expect(read).toEqual(entries);
  });

  it('round-trips non-ASCII UTF-8 content byte for byte', async () => {
    const text = '模式: 规则\n# 注释：订阅地址已省略\n';
    const entries: ZipEntry[] = [{ path: 'config.yaml', data: encoder.encode(text) }];

    const read = await readZip(await writeZip(entries));

    expect(new TextDecoder().decode(read[0]!.data)).toBe(text);
  });

  it('round-trips an archive with no entries', async () => {
    const read = await readZip(await writeZip([]));

    expect(read).toEqual([]);
  });
});

describe('writeZip determinism (decision D2)', () => {
  it('produces byte-identical output for the same entries across two calls', async () => {
    const entries: ZipEntry[] = [
      { path: 'manifest.json', data: encoder.encode('{"a":1}') },
      { path: 'config.yaml', data: encoder.encode('mode: rule\nport: 7890\n') },
    ];

    const first = await writeZip(entries);
    const second = await writeZip(entries);

    expect(first).toEqual(second);
  });

  it('produces different output when entry order differs, proving order is not incidentally normalised', async () => {
    const a: ZipEntry = { path: 'a.txt', data: encoder.encode('a') };
    const b: ZipEntry = { path: 'b.txt', data: encoder.encode('b') };

    const forward = await writeZip([a, b]);
    const backward = await writeZip([b, a]);

    expect(forward).not.toEqual(backward);
  });
});

/**
 * `readZip` validates each entry's decompressed bytes against the CRC-32
 * stored in its *central directory* record, not the local header's copy —
 * so a corruption test has to target that field specifically. Its offset
 * depends on the compressed size (which depends on the platform's DEFLATE
 * implementation), so this locates it structurally via the EOCD trailer
 * (last 22 bytes for a single, comment-less archive) rather than assuming a
 * fixed byte offset: EOCD-relative offset 16 is "central directory start".
 *
 * Central directory record layout (see `writeZip`), relative to its own
 * start: signature(4)=0, versionMadeBy(2)=4, versionNeeded(2)=6, flags(2)=8,
 * method(2)=10, time(2)=12, date(2)=14, crc32(4)=16, compressedSize(4)=20,
 * uncompressedSize(4)=24, nameLength(2)=28, ..., localHeaderOffset(4)=42.
 */
function readCentralDirectoryOffset(archive: Uint8Array): number {
  const eocdOffset = archive.length - 22;
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  return view.getUint32(eocdOffset + 16, true);
}

function centralDirectoryCrcOffset(archive: Uint8Array): number {
  return readCentralDirectoryOffset(archive) + 16;
}

function patchUint32(archive: Uint8Array, offset: number, value: number): void {
  new DataView(archive.buffer, archive.byteOffset, archive.byteLength).setUint32(
    offset,
    value,
    true,
  );
}

/** A bare, hand-built 22-byte EOCD record (no local entries, no central directory bytes of its own). */
function bareEocd(totalEntries: number, centralOffset: number): Uint8Array {
  const bytes = new Uint8Array(22);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(8, totalEntries, true);
  view.setUint16(10, totalEntries, true);
  view.setUint32(12, 0, true);
  view.setUint32(16, centralOffset, true);
  return bytes;
}

describe('readZip error handling', () => {
  it('rejects input that is not a ZIP file with a typed error', async () => {
    await expect(readZip(encoder.encode('not a zip file'))).rejects.toMatchObject({
      code: 'PROJECT_FORMAT_INVALID_ZIP',
    });
  });

  it('rejects an empty buffer with a typed error, not a native RangeError', async () => {
    await expect(readZip(new Uint8Array(0))).rejects.toBeInstanceOf(ProjectFormatError);
  });

  it('rejects an entry whose declared CRC-32 does not match its content', async () => {
    const archive = await writeZip([{ path: 'a.txt', data: encoder.encode('hello') }]);
    const corrupted = archive.slice();
    const crcOffset = centralDirectoryCrcOffset(corrupted);
    corrupted[crcOffset] = (corrupted[crcOffset]! ^ 0xff) & 0xff;

    await expect(readZip(corrupted)).rejects.toMatchObject({ code: 'PROJECT_FORMAT_CRC_MISMATCH' });
  });

  it('never echoes entry content in a thrown error message', async () => {
    const secret = 'super-secret-token-value';
    const archive = await writeZip([{ path: 'a.txt', data: encoder.encode(secret) }]);
    const corrupted = archive.slice();
    const crcOffset = centralDirectoryCrcOffset(corrupted);
    corrupted[crcOffset] = (corrupted[crcOffset]! ^ 0xff) & 0xff;

    try {
      await readZip(corrupted);
      expect.unreachable('expected readZip to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).not.toContain(secret);
    }
  });

  it('rejects a central directory record whose signature does not match', async () => {
    // centralOffset 0 points the reader back at the EOCD's own signature
    // bytes — a validly in-bounds read, just the wrong 4 bytes — so this
    // exercises the mismatch guard specifically, not a bounds error.
    const archive = bareEocd(1, 0);

    await expect(readZip(archive)).rejects.toMatchObject({ code: 'PROJECT_FORMAT_INVALID_ZIP' });
  });

  it('wraps an out-of-bounds read (a truncated or hostile archive) as a typed error, not a native RangeError', async () => {
    const archive = bareEocd(1, 1000);

    const error: unknown = await readZip(archive).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ProjectFormatError);
    expect((error as ProjectFormatError).code).toBe('PROJECT_FORMAT_INVALID_ZIP');
  });

  it('rejects an entry whose declared uncompressed size does not match what it actually decompresses to', async () => {
    const archive = (await writeZip([{ path: 'a.txt', data: encoder.encode('hello') }])).slice();
    const centralOffset = readCentralDirectoryOffset(archive);
    patchUint32(archive, centralOffset + 24, 999);

    await expect(readZip(archive)).rejects.toMatchObject({ code: 'PROJECT_FORMAT_INVALID_ZIP' });
  });

  it('rejects a local file header whose signature does not match', async () => {
    const archive = (await writeZip([{ path: 'a.txt', data: encoder.encode('hello') }])).slice();
    const centralOffset = readCentralDirectoryOffset(archive);
    // Point "local header offset" at the central directory record itself —
    // a validly in-bounds location, just the wrong kind of record.
    patchUint32(archive, centralOffset + 42, centralOffset);

    await expect(readZip(archive)).rejects.toMatchObject({ code: 'PROJECT_FORMAT_INVALID_ZIP' });
  });
});
