/**
 * Zero-dependency ZIP reader/writer (decision D2): compression goes through
 * the platform's own `CompressionStream('deflate-raw')` /
 * `DecompressionStream('deflate-raw')` (raw DEFLATE, matching ZIP method 8 —
 * no zlib/gzip wrapper), and CRC-32 is hand-rolled since neither runtime
 * exposes it as a primitive. Same supply-chain stance as ADR-008.
 *
 * Byte output is deterministic — fixed entry order (caller-supplied),
 * a fixed DOS timestamp, no extra fields, no data descriptors — so exporting
 * the same entries twice produces byte-identical archives (see ADR-018).
 */

export type ProjectFormatErrorCode =
  | 'PROJECT_FORMAT_INVALID_ZIP'
  | 'PROJECT_FORMAT_CRC_MISMATCH'
  | 'PROJECT_FORMAT_MISSING_ENTRY'
  | 'PROJECT_FORMAT_INVALID_JSON'
  | 'PROJECT_FORMAT_INVALID_MANIFEST';

/**
 * Never embeds entry content: messages are built from entry names (fixed,
 * known filenames like `config.yaml`) and codes only, so a corrupted or
 * hostile `.mcsproj` never leaks configuration values into a log line
 * (NFR-SEC-03).
 */
export class ProjectFormatError extends Error {
  readonly code: ProjectFormatErrorCode;

  constructor(code: ProjectFormatErrorCode, message: string) {
    super(message);
    this.name = 'ProjectFormatError';
    this.code = code;
  }
}

export interface ZipEntry {
  readonly path: string;
  readonly data: Uint8Array;
}

const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const EOCD_SIGNATURE = 0x06054b50;

const VERSION_NEEDED = 20;
const VERSION_MADE_BY = 20;
/** Bit 11: filenames are UTF-8. */
const GENERAL_PURPOSE_FLAG_UTF8 = 0x0800;
const COMPRESSION_METHOD_DEFLATE = 8;

/**
 * A fixed MS-DOS timestamp (1980-01-01 00:00:00, the format's minimum date)
 * rather than the real wall-clock time — a clock-derived value would make
 * the same export produce different bytes on every run.
 */
const DOS_FIXED_TIME = 0;
const DOS_FIXED_DATE = (1 << 5) | 1;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const CRC32_TABLE = buildCrc32Table();

function buildCrc32Table(): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    crc = CRC32_TABLE[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function collectStream(readable: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = readable.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    length += value.length;
  }
  const out = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new CompressionStream('deflate-raw');
  const writer = stream.writable.getWriter();
  const collected = collectStream(stream.readable);
  await writer.write(data);
  await writer.close();
  return collected;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new DecompressionStream('deflate-raw');
  const writer = stream.writable.getWriter();
  const collected = collectStream(stream.readable);
  await writer.write(data);
  await writer.close();
  return collected;
}

class ByteWriter {
  #chunks: Uint8Array[] = [];
  #length = 0;

  get length(): number {
    return this.#length;
  }

  writeUint16(value: number): void {
    const buf = new Uint8Array(2);
    new DataView(buf.buffer).setUint16(0, value, true);
    this.#push(buf);
  }

  writeUint32(value: number): void {
    const buf = new Uint8Array(4);
    new DataView(buf.buffer).setUint32(0, value, true);
    this.#push(buf);
  }

  writeBytes(bytes: Uint8Array): void {
    this.#push(bytes);
  }

  toUint8Array(): Uint8Array {
    const out = new Uint8Array(this.#length);
    let offset = 0;
    for (const chunk of this.#chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }

  #push(bytes: Uint8Array): void {
    this.#chunks.push(bytes);
    this.#length += bytes.length;
  }
}

class ByteReader {
  #view: DataView;
  offset: number;

  constructor(bytes: Uint8Array, offset = 0) {
    this.#view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.offset = offset;
  }

  readUint16(): number {
    const value = this.#view.getUint16(this.offset, true);
    this.offset += 2;
    return value;
  }

  readUint32(): number {
    const value = this.#view.getUint32(this.offset, true);
    this.offset += 4;
    return value;
  }

  readBytes(length: number): Uint8Array {
    const bytes = new Uint8Array(
      this.#view.buffer,
      this.#view.byteOffset + this.offset,
      length,
    ).slice();
    this.offset += length;
    return bytes;
  }
}

export async function writeZip(entries: readonly ZipEntry[]): Promise<Uint8Array> {
  const local = new ByteWriter();
  const recorded: {
    nameBytes: Uint8Array;
    crc: number;
    compressedLength: number;
    uncompressedLength: number;
    localHeaderOffset: number;
  }[] = [];

  for (const entry of entries) {
    const localHeaderOffset = local.length;
    const nameBytes = textEncoder.encode(entry.path);
    const compressed = await deflateRaw(entry.data);
    const crc = crc32(entry.data);

    local.writeUint32(LOCAL_FILE_HEADER_SIGNATURE);
    local.writeUint16(VERSION_NEEDED);
    local.writeUint16(GENERAL_PURPOSE_FLAG_UTF8);
    local.writeUint16(COMPRESSION_METHOD_DEFLATE);
    local.writeUint16(DOS_FIXED_TIME);
    local.writeUint16(DOS_FIXED_DATE);
    local.writeUint32(crc);
    local.writeUint32(compressed.length);
    local.writeUint32(entry.data.length);
    local.writeUint16(nameBytes.length);
    local.writeUint16(0);
    local.writeBytes(nameBytes);
    local.writeBytes(compressed);

    recorded.push({
      nameBytes,
      crc,
      compressedLength: compressed.length,
      uncompressedLength: entry.data.length,
      localHeaderOffset,
    });
  }

  const central = new ByteWriter();
  for (const item of recorded) {
    central.writeUint32(CENTRAL_DIRECTORY_SIGNATURE);
    central.writeUint16(VERSION_MADE_BY);
    central.writeUint16(VERSION_NEEDED);
    central.writeUint16(GENERAL_PURPOSE_FLAG_UTF8);
    central.writeUint16(COMPRESSION_METHOD_DEFLATE);
    central.writeUint16(DOS_FIXED_TIME);
    central.writeUint16(DOS_FIXED_DATE);
    central.writeUint32(item.crc);
    central.writeUint32(item.compressedLength);
    central.writeUint32(item.uncompressedLength);
    central.writeUint16(item.nameBytes.length);
    central.writeUint16(0);
    central.writeUint16(0);
    central.writeUint16(0);
    central.writeUint16(0);
    central.writeUint32(0);
    central.writeUint32(item.localHeaderOffset);
    central.writeBytes(item.nameBytes);
  }

  const eocd = new ByteWriter();
  eocd.writeUint32(EOCD_SIGNATURE);
  eocd.writeUint16(0);
  eocd.writeUint16(0);
  eocd.writeUint16(recorded.length);
  eocd.writeUint16(recorded.length);
  eocd.writeUint32(central.length);
  eocd.writeUint32(local.length);
  eocd.writeUint16(0);

  const out = new ByteWriter();
  out.writeBytes(local.toUint8Array());
  out.writeBytes(central.toUint8Array());
  out.writeBytes(eocd.toUint8Array());
  return out.toUint8Array();
}

export async function readZip(bytes: Uint8Array): Promise<ZipEntry[]> {
  try {
    return await readZipUnsafe(bytes);
  } catch (error) {
    if (error instanceof ProjectFormatError) throw error;
    throw new ProjectFormatError(
      'PROJECT_FORMAT_INVALID_ZIP',
      'The archive is not a valid ZIP file.',
    );
  }
}

async function readZipUnsafe(bytes: Uint8Array): Promise<ZipEntry[]> {
  const eocdOffset = findEocdOffset(bytes);
  const eocd = new ByteReader(bytes, eocdOffset + 4);
  eocd.readUint16(); // disk number
  eocd.readUint16(); // central directory start disk
  eocd.readUint16(); // records on this disk
  const totalEntries = eocd.readUint16();
  eocd.readUint32(); // central directory size
  const centralOffset = eocd.readUint32();

  const entries: ZipEntry[] = [];
  const reader = new ByteReader(bytes, centralOffset);
  for (let i = 0; i < totalEntries; i += 1) {
    const signature = reader.readUint32();
    if (signature !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw new ProjectFormatError(
        'PROJECT_FORMAT_INVALID_ZIP',
        'Central directory signature mismatch.',
      );
    }
    reader.readUint16(); // version made by
    reader.readUint16(); // version needed
    reader.readUint16(); // general purpose flag
    reader.readUint16(); // compression method
    reader.readUint16(); // last mod time
    reader.readUint16(); // last mod date
    const crc = reader.readUint32();
    const compressedSize = reader.readUint32();
    const uncompressedSize = reader.readUint32();
    const nameLength = reader.readUint16();
    const extraLength = reader.readUint16();
    const commentLength = reader.readUint16();
    reader.readUint16(); // disk number start
    reader.readUint16(); // internal file attributes
    reader.readUint32(); // external file attributes
    const localHeaderOffset = reader.readUint32();
    const path = textDecoder.decode(reader.readBytes(nameLength));
    reader.offset += extraLength + commentLength;

    const compressed = readLocalEntryData(bytes, localHeaderOffset, compressedSize);
    const data = await inflateRaw(compressed);
    if (data.length !== uncompressedSize) {
      throw new ProjectFormatError(
        'PROJECT_FORMAT_INVALID_ZIP',
        `Entry "${path}" decompressed to an unexpected size.`,
      );
    }
    if (crc32(data) !== crc) {
      throw new ProjectFormatError(
        'PROJECT_FORMAT_CRC_MISMATCH',
        `Entry "${path}" failed its CRC-32 check.`,
      );
    }
    entries.push({ path, data });
  }
  return entries;
}

function readLocalEntryData(
  bytes: Uint8Array,
  localHeaderOffset: number,
  compressedSize: number,
): Uint8Array {
  const reader = new ByteReader(bytes, localHeaderOffset);
  const signature = reader.readUint32();
  if (signature !== LOCAL_FILE_HEADER_SIGNATURE) {
    throw new ProjectFormatError(
      'PROJECT_FORMAT_INVALID_ZIP',
      'Local file header signature mismatch.',
    );
  }
  reader.offset = localHeaderOffset + 26;
  const nameLength = reader.readUint16();
  const extraLength = reader.readUint16();
  const dataStart = localHeaderOffset + 30 + nameLength + extraLength;
  return bytes.slice(dataStart, dataStart + compressedSize);
}

/** ZIP comments (0–65535 bytes) sit after the EOCD signature, so it isn't always the last 22 bytes — scan backward for it, as any real unzip tool does. */
function findEocdOffset(bytes: Uint8Array): number {
  const minOffset = Math.max(0, bytes.length - 22 - 0xffff);
  for (let offset = bytes.length - 22; offset >= minOffset; offset -= 1) {
    if (
      bytes[offset] === 0x50 &&
      bytes[offset + 1] === 0x4b &&
      bytes[offset + 2] === 0x05 &&
      bytes[offset + 3] === 0x06
    ) {
      return offset;
    }
  }
  throw new ProjectFormatError(
    'PROJECT_FORMAT_INVALID_ZIP',
    'No end-of-central-directory record found.',
  );
}
