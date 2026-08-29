import { readFixture } from '@mcs/test-fixtures';
import { describe, expect, it } from 'vitest';

import { redact } from './index.js';

describe('redact — rule 1: multi-line text is discarded wholesale', () => {
  it('collapses a two-line string to a line-count marker', () => {
    expect(redact('mode: rule\nlog-level: info')).toBe('<redacted:2 lines>');
  });

  it('never leaks a single byte of a real, multi-line Mihomo config (golden fixture)', () => {
    const config = readFixture('yaml/comprehensive.yaml');
    expect(config.split('\n').length).toBeGreaterThan(1); // sanity: the fixture really is multi-line
    const result = redact(config);
    expect(result).toBe(`<redacted:${String(config.split(/\r\n|\r|\n/).length)} lines>`);
    // The real secrets this fixture carries — none may survive anywhere in the output.
    expect(result).not.toContain('s3cr3t-token');
    expect(result).not.toContain('pass-word');
    expect(result).not.toContain('00000000-0000-0000-0000-000000000000');
    expect(result).not.toContain('example.com/subscription');
    expect(result).not.toContain('BEGIN CERTIFICATE');
  });

  it('treats \\r\\n and lone \\r line endings as multi-line too', () => {
    expect(redact('a: 1\r\nb: 2')).toBe('<redacted:2 lines>');
    expect(redact('a: 1\rb: 2')).toBe('<redacted:2 lines>');
  });
});

describe('redact — rule 2: a single "key: value" line keeps only the key', () => {
  it('redacts the value, keeping the key name readable', () => {
    expect(redact('password: hunter2')).toBe('password: <redacted>');
  });

  it('keeps the key even when the value itself looks like a URL, UUID or long token', () => {
    expect(redact('subscription-url: https://sub.example.com/a/b?token=xyz')).toBe(
      'subscription-url: <redacted>',
    );
    expect(redact('id: 00000000-0000-0000-0000-000000000000')).toBe('id: <redacted>');
  });

  it('accepts dots, dashes and underscores in the key, matching real Mihomo/module field names', () => {
    expect(redact('proxy-groups.0.password: x')).toBe('proxy-groups.0.password: <redacted>');
    expect(redact('module_name: dns')).toBe('module_name: <redacted>');
  });
});

describe('redact — rule 3: prose lines redact known credential-shaped substrings in place', () => {
  it('keeps only scheme + host of a full URL, dropping path and query — the actual secret-bearing part', () => {
    expect(redact('failed to fetch https://sub.example.com/a/b?token=xyz')).toBe(
      'failed to fetch https://sub.example.com/<redacted>',
    );
  });

  it('redacts a bare UUID mentioned in prose', () => {
    expect(redact('session 3fa85f64-5717-4562-b3fc-2c963f66afa6 expired')).toBe(
      'session <redacted> expired',
    );
  });

  it('redacts a long Base64-ish run mentioned in prose', () => {
    const token = 'QWxhZGRpbjpvcGVuIHNlc2FtZS1sb25nZXItdG9rZW4'; // 43 chars, no padding
    expect(token.length).toBeGreaterThanOrEqual(32);
    expect(redact(`bearer token ${token} rejected`)).toBe('bearer token <redacted> rejected');
  });

  it('redacts from a PEM block header to the end of the line', () => {
    expect(redact('-----BEGIN PRIVATE KEY----- MIIBVQ...')).toBe('<redacted>');
  });

  it('leaves a plain, secret-free prose line completely untouched', () => {
    expect(redact('parse failed at module "dns"')).toBe('parse failed at module "dns"');
  });

  it('leaves a short token (under the Base64 length floor) untouched, e.g. an error code', () => {
    expect(redact('exit code E_INVALID_REF')).toBe('exit code E_INVALID_REF');
  });

  it('drops a URL-shaped-but-unparsable match outright rather than guessing at scheme/host', () => {
    // A malformed IPv6 host ("[::not-valid" never closes its bracket) is
    // URL-shaped enough to match FULL_URL but rejected by the WHATWG URL
    // parser itself (verified: `new URL(...)` throws "Invalid URL").
    expect(redact('connect to http://[::not-valid failed')).toBe('connect to <redacted> failed');
  });
});

describe('redact — does not over-redact: diagnostic value survives', () => {
  it('an error code, path, field name and module name are all still readable after redaction', () => {
    expect(redact('YAML_PARSE_FAILED at dns.nameserver (module: dns)')).toBe(
      'YAML_PARSE_FAILED at dns.nameserver (module: dns)',
    );
  });

  it('an empty string round-trips as an empty string, not a redaction marker', () => {
    expect(redact('')).toBe('');
  });
});
