/**
 * Pure content checks over already-read build output — no filesystem access
 * here (`index.ts` owns reading `apps/web/dist/**`), same split as
 * `tools/egress-check`. Checks the *produced* `index.html`/`_headers`, never
 * the source `apps/web/index.html`/`apps/web/public/_headers` directly: a
 * source-level check could pass while a build plugin or a stray dependency
 * still injects something at bundle time (ADR-032's whole point).
 */
export type CspCheckIssueCode =
  | 'CSP_CHECK_MISSING_META'
  | 'CSP_CHECK_POLICY_MISMATCH'
  | 'CSP_CHECK_UNSAFE_EVAL'
  | 'CSP_CHECK_UNSAFE_INLINE_SCRIPT_OR_STYLE_ELEM'
  | 'CSP_CHECK_EXTERNAL_RESOURCE'
  | 'CSP_CHECK_MISSING_HEADERS_FILE'
  | 'CSP_CHECK_HEADERS_POLICY_MISMATCH'
  | 'CSP_CHECK_HEADERS_DRIFT';

export interface CspCheckIssue {
  readonly code: CspCheckIssueCode;
  readonly detail: string;
}

/**
 * ADR-032's strict policy, one directive per entry so `EXPECTED_META_CSP`/
 * `EXPECTED_HEADER_CSP` below can never hand-drift apart — both are derived
 * from this single list, never independently written out twice. Every
 * directive here exists because something real in the built app needs it
 * (documented in the ADR). Notably absent: `font-src` (this app ships no
 * `@font-face`/web font today — verified by scanning the built CSS,
 * 2026-08-29; add it back only alongside a real font, not speculatively) and
 * any `'unsafe-eval'`/`'unsafe-inline'` on `script-src` or `style-src-elem`
 * (ADR-008 already guarantees the schema validator never needs `eval`, and
 * the production build injects zero inline `<script>` or `<style>` elements
 * — verified against a real `vite build` output; the design tokens that used
 * to be injected via a `<style>` element are now applied through
 * `apps/web/src/theme/apply-css-variables.ts`, governed by `style-src-attr`
 * instead).
 */
const DIRECTIVES: ReadonlyArray<{ readonly name: string; readonly value: string }> = [
  { name: 'default-src', value: "'none'" },
  { name: 'script-src', value: "'self'" },
  { name: 'style-src-elem', value: "'self'" },
  { name: 'style-src-attr', value: "'unsafe-inline'" },
  { name: 'img-src', value: "'self' data:" },
  { name: 'connect-src', value: "'self'" },
  { name: 'worker-src', value: "'self'" },
  { name: 'manifest-src', value: "'self'" },
  { name: 'base-uri', value: "'self'" },
  { name: 'form-action', value: "'self'" },
  { name: 'frame-ancestors', value: "'none'" },
  { name: 'object-src', value: "'none'" },
];

/**
 * Every browser silently ignores `frame-ancestors` when a CSP is delivered
 * via `<meta>` (CSP spec; verified against a real Chrome build, 2026-08-29 —
 * it logs "The Content Security Policy directive 'frame-ancestors' is
 * ignored when delivered via a <meta> element"). Including it in the `<meta>`
 * tag would not just be inert, it would actively mislead a reader into
 * thinking clickjacking protection is active when it is not — so the `<meta>`
 * policy omits it, and only a real HTTP response (`_headers` / a
 * self-hoster's own server config, `docs/self-hosting-headers.md`) carries it.
 */
const META_ONLY_EXCLUDED_DIRECTIVES: ReadonlySet<string> = new Set(['frame-ancestors']);

function buildPolicy(directives: ReadonlyArray<{ name: string; value: string }>): string {
  return directives.map(({ name, value }) => `${name} ${value};`).join(' ');
}

export const EXPECTED_META_CSP = buildPolicy(
  DIRECTIVES.filter((d) => !META_ONLY_EXCLUDED_DIRECTIVES.has(d.name)),
);
export const EXPECTED_HEADER_CSP = buildPolicy(DIRECTIVES);

const META_TAG_PATTERN = /<meta\b[^>]*http-equiv=["']Content-Security-Policy["'][^>]*>/i;
// The CSP value itself is full of single quotes ('self', 'none', ...), so the
// capture group must only stop at the *delimiter* actually used for this
// attribute (this repo always double-quotes HTML attributes) — a `["']`
// class here would wrongly treat every `'self'` as closing the attribute.
const CONTENT_ATTR_PATTERN = /content="([^"]*)"/i;

function extractMetaCsp(html: string): string | null {
  const tag = META_TAG_PATTERN.exec(html)?.[0];
  if (!tag) return null;
  return CONTENT_ATTR_PATTERN.exec(tag)?.[1] ?? null;
}

function parseDirectives(csp: string): Map<string, readonly string[]> {
  const directives = new Map<string, readonly string[]>();
  for (const rawDirective of csp.split(';')) {
    const trimmed = rawDirective.trim();
    if (!trimmed) continue;
    const [name, ...sources] = trimmed.split(/\s+/);
    if (name) directives.set(name, sources);
  }
  return directives;
}

/** Independent of the exact policy text above — catches `'unsafe-eval'` creeping into *any* directive, including one a future edit adds. */
function checkNoUnsafeEval(directives: ReadonlyMap<string, readonly string[]>): CspCheckIssue[] {
  const issues: CspCheckIssue[] = [];
  for (const [name, sources] of directives) {
    if (sources.includes("'unsafe-eval'")) {
      issues.push({ code: 'CSP_CHECK_UNSAFE_EVAL', detail: `"${name}" allows 'unsafe-eval'` });
    }
  }
  return issues;
}

/** `style-src-attr 'unsafe-inline'` is the one deliberate, documented exception (ADR-032) — `script-src`/`style-src-elem` may never carry it. */
function checkNoUnsafeInlineOnScriptOrStyleElem(
  directives: ReadonlyMap<string, readonly string[]>,
): CspCheckIssue[] {
  const issues: CspCheckIssue[] = [];
  for (const name of ['script-src', 'style-src-elem']) {
    if (directives.get(name)?.includes("'unsafe-inline'")) {
      issues.push({
        code: 'CSP_CHECK_UNSAFE_INLINE_SCRIPT_OR_STYLE_ELEM',
        detail: `"${name}" allows 'unsafe-inline'`,
      });
    }
  }
  return issues;
}

const EXTERNAL_URL_PATTERN = /^(?:[a-z][a-z0-9+.-]*:)?\/\//i;
const SCRIPT_OR_LINK_PATTERN = /<(script|link)\b[^>]*>/gi;
const SRC_OR_HREF_PATTERN = /\b(?:src|href)=["']([^"']+)["']/i;

/** The machine expression of "no non-essential third-party script" — any `<script src>`/`<link href>` pointing off-origin fails, full stop. */
function checkNoExternalScriptOrLink(html: string): CspCheckIssue[] {
  const issues: CspCheckIssue[] = [];
  for (const tagMatch of html.matchAll(SCRIPT_OR_LINK_PATTERN)) {
    const tag = tagMatch[0];
    const url = SRC_OR_HREF_PATTERN.exec(tag)?.[1];
    if (url && EXTERNAL_URL_PATTERN.test(url)) {
      issues.push({
        code: 'CSP_CHECK_EXTERNAL_RESOURCE',
        detail: `${tagMatch[1]} references external URL "${url}"`,
      });
    }
  }
  return issues;
}

/** Checks (a)/(b)/(c)/(d) against a built `index.html`'s real content. */
export function checkIndexHtml(html: string): CspCheckIssue[] {
  const policy = extractMetaCsp(html);
  if (policy === null) {
    return [
      { code: 'CSP_CHECK_MISSING_META', detail: 'no Content-Security-Policy <meta> tag found' },
    ];
  }

  const issues: CspCheckIssue[] = [];
  if (policy !== EXPECTED_META_CSP) {
    issues.push({
      code: 'CSP_CHECK_POLICY_MISMATCH',
      detail: `expected "${EXPECTED_META_CSP}", got "${policy}"`,
    });
  }
  const directives = parseDirectives(policy);
  issues.push(...checkNoUnsafeEval(directives));
  issues.push(...checkNoUnsafeInlineOnScriptOrStyleElem(directives));
  issues.push(...checkNoExternalScriptOrLink(html));
  return issues;
}

const HEADERS_CSP_LINE_PATTERN = /^\s*Content-Security-Policy:\s*(.+?)\s*$/im;

function extractHeadersCsp(headersFile: string): string | null {
  return HEADERS_CSP_LINE_PATTERN.exec(headersFile)?.[1] ?? null;
}

/**
 * `_headers` (Netlify/Cloudflare Pages format) must declare the identical
 * policy a self-hoster's real server would otherwise need to set by hand —
 * checked against the constant and against the built `index.html`'s own
 * `<meta>` policy, so the two can never silently drift apart. The drift
 * check compares directive-by-directive rather than the two full strings:
 * `_headers` is *expected* to carry `frame-ancestors` while `index.html`
 * never does (see `META_ONLY_EXCLUDED_DIRECTIVES`), so plain string equality
 * would permanently — and wrongly — flag that one intentional difference.
 */
export function checkHeadersFile(
  headersFile: string,
  indexHtmlPolicy: string | null,
): CspCheckIssue[] {
  const policy = extractHeadersCsp(headersFile);
  if (policy === null) {
    return [
      {
        code: 'CSP_CHECK_MISSING_HEADERS_FILE',
        detail: 'no Content-Security-Policy line found in _headers',
      },
    ];
  }

  const issues: CspCheckIssue[] = [];
  if (policy !== EXPECTED_HEADER_CSP) {
    issues.push({
      code: 'CSP_CHECK_HEADERS_POLICY_MISMATCH',
      detail: `expected "${EXPECTED_HEADER_CSP}", got "${policy}"`,
    });
  }
  if (indexHtmlPolicy !== null) {
    const headerDirectives = parseDirectives(policy);
    const metaDirectives = parseDirectives(indexHtmlPolicy);
    for (const [name, sources] of metaDirectives) {
      const headerSources = headerDirectives.get(name);
      if (!headerSources || headerSources.join(' ') !== sources.join(' ')) {
        issues.push({
          code: 'CSP_CHECK_HEADERS_DRIFT',
          detail: `"${name}" differs between _headers and index.html's <meta> ("${headerSources?.join(' ') ?? '(missing)'}" vs "${sources.join(' ')}")`,
        });
      }
    }
    for (const name of headerDirectives.keys()) {
      if (!metaDirectives.has(name) && !META_ONLY_EXCLUDED_DIRECTIVES.has(name)) {
        issues.push({
          code: 'CSP_CHECK_HEADERS_DRIFT',
          detail: `"${name}" is in _headers but not in index.html's <meta>, and is not on the documented meta-only-excluded list`,
        });
      }
    }
  }
  return issues;
}

export interface CspCheckInput {
  readonly indexHtml: string;
  readonly headersFile: string;
}

/** Runs every check on one build's output, collecting every violation rather than stopping at the first. */
export function checkBuildOutput(input: CspCheckInput): CspCheckIssue[] {
  const indexIssues = checkIndexHtml(input.indexHtml);
  const indexHtmlPolicy = extractMetaCsp(input.indexHtml);
  const headersIssues = checkHeadersFile(input.headersFile, indexHtmlPolicy);
  return [...indexIssues, ...headersIssues];
}
