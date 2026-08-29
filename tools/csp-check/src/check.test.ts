import { describe, expect, it } from 'vitest';

import {
  checkBuildOutput,
  checkHeadersFile,
  checkIndexHtml,
  EXPECTED_HEADER_CSP,
  EXPECTED_META_CSP,
} from './check.js';

function htmlWithCsp(policy: string): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="${policy}"
    />
    <script type="module" crossorigin src="/assets/main-abc123.js"></script>
    <link rel="stylesheet" crossorigin href="/assets/main-abc123.css">
  </head>
  <body></body>
</html>
`;
}

describe('EXPECTED_META_CSP / EXPECTED_HEADER_CSP', () => {
  it('the meta policy omits frame-ancestors — browsers ignore it via <meta> (verified against a real build)', () => {
    expect(EXPECTED_META_CSP).not.toContain('frame-ancestors');
  });

  it('the header policy includes frame-ancestors — only a real HTTP response can enforce it', () => {
    expect(EXPECTED_HEADER_CSP).toContain("frame-ancestors 'none';");
  });

  it('every other directive is identical between the two — frame-ancestors is the only intentional difference', () => {
    expect(EXPECTED_HEADER_CSP.replace("frame-ancestors 'none'; ", '')).toBe(EXPECTED_META_CSP);
  });
});

describe('checkIndexHtml', () => {
  it('passes cleanly for the exact expected meta policy and only same-origin script/link tags', () => {
    expect(checkIndexHtml(htmlWithCsp(EXPECTED_META_CSP))).toEqual([]);
  });

  it('parses the real multi-line <meta> attribute formatting this repo actually uses', () => {
    const html = `<meta\n  http-equiv="Content-Security-Policy"\n  content="${EXPECTED_META_CSP}"\n/>`;
    expect(checkIndexHtml(html)).toEqual([]);
  });

  it('flags a missing Content-Security-Policy meta tag entirely', () => {
    expect(checkIndexHtml('<html><head></head><body></body></html>')).toEqual([
      { code: 'CSP_CHECK_MISSING_META', detail: expect.any(String) },
    ]);
  });

  it('flags any deviation from the exact expected policy string', () => {
    const issues = checkIndexHtml(htmlWithCsp("default-src 'self';"));
    expect(issues).toContainEqual(expect.objectContaining({ code: 'CSP_CHECK_POLICY_MISMATCH' }));
  });

  it('flags frame-ancestors appearing in the meta policy too, as a plain policy mismatch — it must never be there', () => {
    const issues = checkIndexHtml(htmlWithCsp(EXPECTED_HEADER_CSP));
    expect(issues).toContainEqual(expect.objectContaining({ code: 'CSP_CHECK_POLICY_MISMATCH' }));
  });

  it("flags 'unsafe-eval' wherever it appears, independent of whether the rest matches the expected policy", () => {
    const withEval = EXPECTED_META_CSP.replace(
      "script-src 'self';",
      "script-src 'self' 'unsafe-eval';",
    );
    const issues = checkIndexHtml(htmlWithCsp(withEval));
    expect(issues).toContainEqual(
      expect.objectContaining({
        code: 'CSP_CHECK_UNSAFE_EVAL',
        detail: expect.stringContaining('script-src'),
      }),
    );
  });

  it("flags 'unsafe-inline' on script-src", () => {
    const withInline = EXPECTED_META_CSP.replace(
      "script-src 'self';",
      "script-src 'self' 'unsafe-inline';",
    );
    const issues = checkIndexHtml(htmlWithCsp(withInline));
    expect(issues).toContainEqual(
      expect.objectContaining({
        code: 'CSP_CHECK_UNSAFE_INLINE_SCRIPT_OR_STYLE_ELEM',
        detail: expect.stringContaining('script-src'),
      }),
    );
  });

  it("flags 'unsafe-inline' on style-src-elem", () => {
    const withInline = EXPECTED_META_CSP.replace(
      "style-src-elem 'self';",
      "style-src-elem 'self' 'unsafe-inline';",
    );
    const issues = checkIndexHtml(htmlWithCsp(withInline));
    expect(issues).toContainEqual(
      expect.objectContaining({
        code: 'CSP_CHECK_UNSAFE_INLINE_SCRIPT_OR_STYLE_ELEM',
        detail: expect.stringContaining('style-src-elem'),
      }),
    );
  });

  it("does NOT flag 'unsafe-inline' on style-src-attr — the one documented exception (ADR-032)", () => {
    expect(EXPECTED_META_CSP).toContain("style-src-attr 'unsafe-inline'");
    expect(checkIndexHtml(htmlWithCsp(EXPECTED_META_CSP))).toEqual([]);
  });

  it('flags a <script src> pointing at an external origin', () => {
    const html = htmlWithCsp(EXPECTED_META_CSP).replace(
      '<script type="module" crossorigin src="/assets/main-abc123.js"></script>',
      '<script type="module" src="https://cdn.example.com/evil.js"></script>',
    );
    expect(checkIndexHtml(html)).toContainEqual(
      expect.objectContaining({
        code: 'CSP_CHECK_EXTERNAL_RESOURCE',
        detail: expect.stringContaining('script'),
      }),
    );
  });

  it('flags a <link href> pointing at an external origin, including protocol-relative URLs', () => {
    const html = htmlWithCsp(EXPECTED_META_CSP).replace(
      '<link rel="stylesheet" crossorigin href="/assets/main-abc123.css">',
      '<link rel="stylesheet" href="//cdn.example.com/style.css">',
    );
    expect(checkIndexHtml(html)).toContainEqual(
      expect.objectContaining({
        code: 'CSP_CHECK_EXTERNAL_RESOURCE',
        detail: expect.stringContaining('link'),
      }),
    );
  });

  it('does not flag a same-origin absolute-path src/href', () => {
    expect(checkIndexHtml(htmlWithCsp(EXPECTED_META_CSP))).toEqual([]);
  });
});

describe('checkHeadersFile', () => {
  const headersWith = (policy: string) => `/*\n  Content-Security-Policy: ${policy}\n`;

  it('passes cleanly when the header matches EXPECTED_HEADER_CSP and only adds frame-ancestors versus the meta policy', () => {
    expect(checkHeadersFile(headersWith(EXPECTED_HEADER_CSP), EXPECTED_META_CSP)).toEqual([]);
  });

  it('flags a missing Content-Security-Policy line', () => {
    expect(checkHeadersFile('/*\n  X-Content-Type-Options: nosniff\n', EXPECTED_META_CSP)).toEqual([
      { code: 'CSP_CHECK_MISSING_HEADERS_FILE', detail: expect.any(String) },
    ]);
  });

  it('flags a policy that deviates from EXPECTED_HEADER_CSP', () => {
    const issues = checkHeadersFile(headersWith("default-src 'self';"), EXPECTED_META_CSP);
    expect(issues).toContainEqual(
      expect.objectContaining({ code: 'CSP_CHECK_HEADERS_POLICY_MISMATCH' }),
    );
  });

  it('does NOT flag drift for the one documented, intentional difference (frame-ancestors present only in _headers)', () => {
    expect(checkHeadersFile(headersWith(EXPECTED_HEADER_CSP), EXPECTED_META_CSP)).toEqual([]);
  });

  it('flags real drift: a directive whose value differs between _headers and index.html', () => {
    const headerPolicy = EXPECTED_HEADER_CSP.replace("script-src 'self';", "script-src 'none';");
    const issues = checkHeadersFile(headersWith(headerPolicy), EXPECTED_META_CSP);
    expect(issues).toContainEqual(
      expect.objectContaining({
        code: 'CSP_CHECK_HEADERS_DRIFT',
        detail: expect.stringContaining('script-src'),
      }),
    );
  });

  it('flags real drift: an extra directive in _headers that is not the documented meta-only-excluded one', () => {
    const headerPolicy = `${EXPECTED_HEADER_CSP} sandbox;`;
    const issues = checkHeadersFile(headersWith(headerPolicy), EXPECTED_META_CSP);
    expect(issues).toContainEqual(
      expect.objectContaining({
        code: 'CSP_CHECK_HEADERS_DRIFT',
        detail: expect.stringContaining('sandbox'),
      }),
    );
  });

  it('flags real drift: a directive present in index.html but entirely missing from _headers', () => {
    const headerPolicy = EXPECTED_HEADER_CSP.replace("manifest-src 'self'; ", '');
    expect(headerPolicy).not.toContain('manifest-src'); // guards against the replace silently no-op'ing
    const issues = checkHeadersFile(headersWith(headerPolicy), EXPECTED_META_CSP);
    expect(issues).toContainEqual(
      expect.objectContaining({
        code: 'CSP_CHECK_HEADERS_DRIFT',
        detail: expect.stringContaining('manifest-src'),
      }),
    );
  });

  it('skips the drift check when index.html had no policy to compare against at all', () => {
    expect(checkHeadersFile(headersWith(EXPECTED_HEADER_CSP), null)).toEqual([]);
  });
});

describe('checkBuildOutput', () => {
  it('collects issues from both files at once', () => {
    const issues = checkBuildOutput({
      indexHtml: '<html><head></head><body></body></html>',
      headersFile: '/*\n  X-Frame-Options: DENY\n',
    });
    expect(issues.map((issue) => issue.code)).toEqual([
      'CSP_CHECK_MISSING_META',
      'CSP_CHECK_MISSING_HEADERS_FILE',
    ]);
  });

  it('is clean end to end for matching, expected content in both files', () => {
    const issues = checkBuildOutput({
      indexHtml: htmlWithCsp(EXPECTED_META_CSP),
      headersFile: `/*\n  Content-Security-Policy: ${EXPECTED_HEADER_CSP}\n`,
    });
    expect(issues).toEqual([]);
  });
});
