/**
 * Resource limits for untrusted YAML input (NFR-SEC-06).
 *
 * Every limit is enforced before the document is handed to the rest of the
 * application, so a hostile file fails fast with a diagnostic instead of
 * exhausting memory or wedging the UI thread.
 */
export interface YamlLimits {
  /** Maximum UTF-8 size of the source text. */
  maxBytes: number;
  /** Maximum nesting depth of the composed node tree. */
  maxDepth: number;
  /** Maximum number of alias resolutions during materialisation (billion laughs). */
  maxAliasCount: number;
  /** Maximum number of documents in a single stream. */
  maxDocuments: number;
}

export const DEFAULT_YAML_LIMITS: YamlLimits = {
  maxBytes: 8 * 1024 * 1024,
  maxDepth: 64,
  maxAliasCount: 200,
  maxDocuments: 4,
};

export function resolveLimits(overrides?: Partial<YamlLimits>): YamlLimits {
  return { ...DEFAULT_YAML_LIMITS, ...overrides };
}

/** UTF-8 byte length without allocating an encoded copy of the whole string. */
export function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      // Surrogate pair -> one 4-byte code point.
      bytes += 4;
      i += 1;
    } else {
      bytes += 3;
    }
  }
  return bytes;
}
