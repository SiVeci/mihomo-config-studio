/**
 * NFR-SEC-03: log and crash text must never contain YAML content or a
 * complete URL. Same stance as ADR-018's `describeSensitivity` (a different
 * surface — export findings, not logs) applied here: over-redacting is
 * always acceptable, under-redacting never is. Zero dependencies, zero IO —
 * `packages/**` already forbids `node:fs`; this module doesn't even reach
 * for `node:crypto`, since redaction is about discarding, not hashing.
 *
 * Rules apply in this order, first match wins:
 *  1. The text has more than one line → discarded wholesale as
 *     `<redacted:N lines>`. A real Mihomo config is essentially always
 *     multi-line; rejecting by *shape* is far more reliable than trying to
 *     recognise every YAML key that might appear in it.
 *  2. A single line shaped like `key: value` → only the key survives
 *     (`key: <redacted>`), regardless of what the value looks like.
 *  3. Otherwise (free-form prose) → known credential-shaped substrings are
 *     redacted in place: a full URL keeps only `scheme://host` (NFR-SEC-03
 *     asks for no *complete* URL — the host alone is worth keeping for
 *     troubleshooting; the path/query is where a real secret usually is),
 *     and UUIDs / long Base64-ish runs / PEM block headers are replaced
 *     outright.
 */

const KEY_VALUE_LINE = /^\s*([A-Za-z_][\w.-]*)\s*:\s*(.+?)\s*$/;
const FULL_URL = /\b[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s"'<>]+/g;
/** `data:` URLs have no `//` authority part (so `FULL_URL` never matches them) and no host to preserve — the whole payload after the scheme is redacted outright, not just path/query. */
const DATA_URL = /\bdata:[^\s"'<>]+/g;
const UUID = /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g;
/** Base64/Base64url-ish runs of 32+ characters — long enough that a real word or identifier essentially never matches by accident. */
const LONG_BASE64_ISH = /\b[A-Za-z0-9+/_-]{32,}={0,2}\b/g;
const PEM_BLOCK_HEADER = /-----BEGIN [^-]+-----/;

function redactUrlMatch(match: string): string {
  try {
    const url = new URL(match);
    return `${url.protocol}//${url.host}/<redacted>`;
  } catch {
    // Looked URL-shaped but `URL` couldn't parse it (e.g. a truncated or
    // malformed value) — safer to drop it entirely than to guess.
    return '<redacted>';
  }
}

function redactProseLine(line: string): string {
  let result = line.replace(FULL_URL, redactUrlMatch);
  result = result.replace(DATA_URL, 'data:<redacted>');
  result = result.replace(UUID, '<redacted>');
  result = result.replace(LONG_BASE64_ISH, '<redacted>');
  const pemStart = result.search(PEM_BLOCK_HEADER);
  if (pemStart !== -1) {
    result = `${result.slice(0, pemStart)}<redacted>`;
  }
  return result;
}

/** The single entry point every log level (`createLogger`) routes through — there is no way to log text that skips this. */
export function redact(text: string): string {
  if (text === '') return text;

  const lines = text.split(/\r\n|\r|\n/);
  if (lines.length > 1) {
    return `<redacted:${String(lines.length)} lines>`;
  }

  const line = lines[0]!;
  const keyValue = KEY_VALUE_LINE.exec(line);
  if (keyValue) {
    return `${keyValue[1]}: <redacted>`;
  }
  return redactProseLine(line);
}
