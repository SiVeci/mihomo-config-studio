import { describe, expect, it } from 'vitest';

import type { KernelAsset, KernelPlatformKey } from './download.js';
import { allPassed, formatDryRunPreview, formatReport } from './report.js';
import type { TemplateTestResult } from './report.js';

describe('allPassed', () => {
  it('is true for an empty result set', () => {
    expect(allPassed([])).toBe(true);
  });

  it('is true when every result exited 0', () => {
    const results: TemplateTestResult[] = [
      { templateId: 'basic-proxy', exitCode: 0, stderr: '' },
      { templateId: 'provider-auto-select', exitCode: 0, stderr: '' },
    ];
    expect(allPassed(results)).toBe(true);
  });

  it('is false as soon as one result has a non-zero exit code — no partial credit (PRD §13.5)', () => {
    const results: TemplateTestResult[] = [
      { templateId: 'basic-proxy', exitCode: 0, stderr: '' },
      { templateId: 'provider-auto-select', exitCode: 1, stderr: 'invalid config' },
    ];
    expect(allPassed(results)).toBe(false);
  });
});

describe('formatReport', () => {
  it('summarises the pass count and marks a passing template PASS with no detail line', () => {
    const report = formatReport([{ templateId: 'basic-proxy', exitCode: 0, stderr: '' }]);
    expect(report).toContain('1/1 template(s) passed');
    expect(report).toContain('PASS  basic-proxy');
    expect(report).not.toContain('FAIL');
  });

  it('marks a failing template FAIL with its exit code and stderr detail', () => {
    const report = formatReport([
      { templateId: 'provider-auto-select', exitCode: 2, stderr: 'unsupported field: foo\n' },
    ]);
    expect(report).toContain('0/1 template(s) passed');
    expect(report).toContain('FAIL  provider-auto-select (exit 2)');
    expect(report).toContain('unsupported field: foo');
  });

  it('marks a failing template FAIL with no detail line when stderr is empty', () => {
    const report = formatReport([{ templateId: 'basic-proxy', exitCode: 1, stderr: '' }]);
    expect(report).toContain('FAIL  basic-proxy (exit 1)');
    // Exactly one line for this result: no dangling detail line underneath.
    expect(report.split('\n')).toHaveLength(2);
  });

  it('reports a mixed pass/fail set with the correct fraction', () => {
    const report = formatReport([
      { templateId: 'basic-proxy', exitCode: 0, stderr: '' },
      { templateId: 'provider-auto-select', exitCode: 1, stderr: 'bad' },
    ]);
    expect(report).toContain('1/2 template(s) passed');
  });
});

describe('formatDryRunPreview', () => {
  const PINNED: KernelAsset = {
    asset: 'mihomo-linux-amd64-v1.19.29.gz',
    sha256: 'abc123',
    bytes: 17858765,
  };
  const DIGESTS: Record<KernelPlatformKey, KernelAsset | null> = {
    'linux-amd64': PINNED,
    'linux-arm64': null,
    'darwin-arm64': null,
    'windows-amd64': null,
  };

  it('shows the pinned row with its asset name, size and digest', () => {
    const preview = formatDryRunPreview(DIGESTS, ['basic-proxy']);
    expect(preview).toContain(
      'linux-amd64: mihomo-linux-amd64-v1.19.29.gz (17858765 bytes, sha256:abc123)',
    );
  });

  it('shows an unfilled row as explicitly unpinned, not silently omitted', () => {
    const preview = formatDryRunPreview(DIGESTS, ['basic-proxy']);
    expect(preview).toContain('linux-arm64: (no pinned digest yet)');
    expect(preview).toContain('darwin-arm64: (no pinned digest yet)');
    expect(preview).toContain('windows-amd64: (no pinned digest yet)');
  });

  it('lists every template id that would be tested', () => {
    const preview = formatDryRunPreview(DIGESTS, ['basic-proxy', 'provider-auto-select']);
    expect(preview).toContain('would run 2 template(s)');
    expect(preview).toContain('basic-proxy, provider-auto-select');
  });

  it('never throws for an empty template list', () => {
    expect(() => formatDryRunPreview(DIGESTS, [])).not.toThrow();
  });
});
