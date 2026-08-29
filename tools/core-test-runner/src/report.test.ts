import { describe, expect, it } from 'vitest';

import type { KernelAsset, KernelPlatformKey } from './download.js';
import { allPassed, caseSucceeded, formatDryRunPreview, formatReport } from './report.js';
import type { CaseResult } from './report.js';

describe('caseSucceeded', () => {
  it('is true for an expect: pass case that exited 0', () => {
    expect(caseSucceeded({ exitCode: 0, expect: 'pass' })).toBe(true);
  });

  it('is false for an expect: pass case that exited non-zero', () => {
    expect(caseSucceeded({ exitCode: 1, expect: 'pass' })).toBe(false);
  });

  it('is true for an expect: fail case that exited non-zero — the kernel correctly rejected it', () => {
    expect(caseSucceeded({ exitCode: 1, expect: 'fail' })).toBe(true);
  });

  it('is false for an expect: fail case that exited 0 — the kernel unexpectedly accepted it (PRD §13.5 divergence signal)', () => {
    expect(caseSucceeded({ exitCode: 0, expect: 'fail' })).toBe(false);
  });
});

describe('allPassed', () => {
  it('is true for an empty result set', () => {
    expect(allPassed([])).toBe(true);
  });

  it('is true when every case behaved as it declared it would', () => {
    const results: CaseResult[] = [
      { id: 'template:basic-proxy', kind: 'template', expect: 'pass', exitCode: 0, stderr: '' },
      {
        id: 'module-example:dns:invalid',
        kind: 'module-example',
        expect: 'fail',
        exitCode: 1,
        stderr: 'bad',
      },
    ];
    expect(allPassed(results)).toBe(true);
  });

  it('is false as soon as one case misbehaves — no partial credit (PRD §13.5)', () => {
    const results: CaseResult[] = [
      { id: 'template:basic-proxy', kind: 'template', expect: 'pass', exitCode: 0, stderr: '' },
      {
        id: 'template:provider-auto-select',
        kind: 'template',
        expect: 'pass',
        exitCode: 1,
        stderr: 'invalid config',
      },
    ];
    expect(allPassed(results)).toBe(false);
  });
});

describe('formatReport', () => {
  it('summarises the overall pass count and marks a passing case PASS with no detail line', () => {
    const report = formatReport([
      { id: 'template:basic-proxy', kind: 'template', expect: 'pass', exitCode: 0, stderr: '' },
    ]);
    expect(report).toContain('1/1 case(s) behaved as expected');
    expect(report).toContain('PASS  template:basic-proxy');
    expect(report).not.toContain('FAIL');
  });

  it('marks a case that failed to meet its own expectation FAIL, with the expectation, actual exit code and stderr', () => {
    const report = formatReport([
      {
        id: 'module-example:proxy-groups:invalid',
        kind: 'module-example',
        expect: 'fail',
        exitCode: 0,
        stderr: '',
      },
    ]);
    expect(report).toContain('0/1 case(s) behaved as expected');
    expect(report).toContain(
      'FAIL  module-example:proxy-groups:invalid (expected a non-zero exit, got exit 0)',
    );
  });

  it('marks an expect: pass case that failed with its exit code and stderr detail', () => {
    const report = formatReport([
      {
        id: 'template:home-router',
        kind: 'template',
        expect: 'pass',
        exitCode: 2,
        stderr: 'unsupported field: foo\n',
      },
    ]);
    expect(report).toContain('FAIL  template:home-router (expected exit 0, got exit 2)');
    expect(report).toContain('unsupported field: foo');
  });

  it('groups results by kind, with a per-group pass fraction, in a fixed template/module-example/migration order', () => {
    const report = formatReport([
      {
        id: 'migration:dns:1.0.0->1.1.0',
        kind: 'migration',
        expect: 'pass',
        exitCode: 0,
        stderr: '',
      },
      { id: 'template:basic-proxy', kind: 'template', expect: 'pass', exitCode: 0, stderr: '' },
      {
        id: 'module-example:dns:valid',
        kind: 'module-example',
        expect: 'pass',
        exitCode: 0,
        stderr: '',
      },
    ]);
    const templateIndex = report.indexOf('built-in templates: 1/1');
    const exampleIndex = report.indexOf('module examples: 1/1');
    const migrationIndex = report.indexOf('migration results: 1/1');
    expect(templateIndex).toBeGreaterThan(-1);
    expect(exampleIndex).toBeGreaterThan(templateIndex);
    expect(migrationIndex).toBeGreaterThan(exampleIndex);
  });

  it('omits a kind heading entirely when no case of that kind is present', () => {
    const report = formatReport([
      { id: 'template:basic-proxy', kind: 'template', expect: 'pass', exitCode: 0, stderr: '' },
    ]);
    expect(report).not.toContain('module examples:');
    expect(report).not.toContain('migration results:');
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
    const preview = formatDryRunPreview(DIGESTS, []);
    expect(preview).toContain(
      'linux-amd64: mihomo-linux-amd64-v1.19.29.gz (17858765 bytes, sha256:abc123)',
    );
  });

  it('shows an unfilled row as explicitly unpinned, not silently omitted', () => {
    const preview = formatDryRunPreview(DIGESTS, []);
    expect(preview).toContain('linux-arm64: (no pinned digest yet)');
    expect(preview).toContain('darwin-arm64: (no pinned digest yet)');
    expect(preview).toContain('windows-amd64: (no pinned digest yet)');
  });

  it('lists the corpus grouped and counted by kind, each case with its own expectation', () => {
    const preview = formatDryRunPreview(DIGESTS, [
      { id: 'template:basic-proxy', kind: 'template', expect: 'pass' },
      { id: 'module-example:dns:invalid', kind: 'module-example', expect: 'fail' },
    ]);
    expect(preview).toContain('would run 2 kernel test case(s)');
    expect(preview).toContain('template: 1 case(s)');
    expect(preview).toContain('- template:basic-proxy (expect pass)');
    expect(preview).toContain('module-example: 1 case(s)');
    expect(preview).toContain('- module-example:dns:invalid (expect fail)');
  });

  it('never throws for an empty corpus', () => {
    expect(() => formatDryRunPreview(DIGESTS, [])).not.toThrow();
  });
});
