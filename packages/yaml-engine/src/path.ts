/**
 * Addressing inside a YAML document.
 *
 * A `ConfigPath` is the single addressing currency shared by the YAML engine,
 * the schema layer, the validator and the UI (FR-VAL-01, FR-VAL-02): every
 * issue, patch and form field is anchored to one.
 */

export type PathSegment = string | number;
export type ConfigPath = readonly PathSegment[];

const PLAIN_KEY = /^[A-Za-z_][A-Za-z0-9_-]*$/;

/** Human readable form used in the UI and in issue messages: `proxies[0].name`. */
export function formatPath(path: ConfigPath): string {
  let out = '';
  for (const segment of path) {
    if (typeof segment === 'number') {
      out += `[${segment}]`;
    } else if (PLAIN_KEY.test(segment)) {
      out += out === '' ? segment : `.${segment}`;
    } else {
      out += `[${JSON.stringify(segment)}]`;
    }
  }
  return out === '' ? '$' : out;
}

/** RFC 6901 JSON Pointer, used as a stable machine-readable key. */
export function toPointer(path: ConfigPath): string {
  if (path.length === 0) return '';
  return path
    .map((segment) => `/${String(segment).replace(/~/g, '~0').replace(/\//g, '~1')}`)
    .join('');
}

export function fromPointer(pointer: string): ConfigPath {
  if (pointer === '') return [];
  if (!pointer.startsWith('/')) {
    throw new Error(`Invalid JSON Pointer: ${pointer}`);
  }
  return pointer
    .slice(1)
    .split('/')
    .map((raw) => {
      const decoded = raw.replace(/~1/g, '/').replace(/~0/g, '~');
      return /^(0|[1-9][0-9]*)$/.test(decoded) ? Number(decoded) : decoded;
    });
}

export function pathsEqual(a: ConfigPath, b: ConfigPath): boolean {
  if (a.length !== b.length) return false;
  return a.every((segment, index) => segment === b[index]);
}

export function isPathPrefix(prefix: ConfigPath, path: ConfigPath): boolean {
  if (prefix.length > path.length) return false;
  return prefix.every((segment, index) => segment === path[index]);
}
