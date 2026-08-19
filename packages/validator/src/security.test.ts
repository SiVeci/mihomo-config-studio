import { MihomoYamlDocument } from '@mcs/yaml-engine';
import { describe, expect, it } from 'vitest';

import { hasBlockingIssues } from './pipeline.js';
import { SECURITY_STAGE_ID, securityStage } from './security.js';

function run(yaml: string) {
  const parse = MihomoYamlDocument.parse(yaml);
  return securityStage.run({ parse });
}

describe('securityStage — allow-lan + wildcard bind-address (FR-VAL-04)', () => {
  it('fires when allow-lan is true and bind-address is explicitly "*"', () => {
    const issues = run('allow-lan: true\nbind-address: "*"\n');
    expect(issues).toEqual([
      expect.objectContaining({
        severity: 'warning',
        code: 'security.allowLanWildcardBind',
        module: 'security',
        messageKey: 'security.allowLanWildcardBind',
        path: ['bind-address'],
        blocking: false,
      }),
    ]);
  });

  it('fires when bind-address is entirely absent (its own schema default is "*")', () => {
    const issues = run('allow-lan: true\n');
    expect(issues.some((issue) => issue.code === 'security.allowLanWildcardBind')).toBe(true);
  });

  it('does not fire when bind-address is a specific, non-wildcard address', () => {
    const issues = run('allow-lan: true\nbind-address: "192.168.1.1"\n');
    expect(issues.some((issue) => issue.code === 'security.allowLanWildcardBind')).toBe(false);
  });

  it('does not fire when allow-lan is false', () => {
    const issues = run('allow-lan: false\nbind-address: "*"\n');
    expect(issues.some((issue) => issue.code === 'security.allowLanWildcardBind')).toBe(false);
  });

  it('does not fire when allow-lan is absent entirely', () => {
    const issues = run('mode: rule\n');
    expect(issues.some((issue) => issue.code === 'security.allowLanWildcardBind')).toBe(false);
  });

  it('locates a real range at bind-address', () => {
    const issues = run('allow-lan: true\nbind-address: "*"\n');
    const issue = issues.find((candidate) => candidate.code === 'security.allowLanWildcardBind');
    expect(issue?.range?.start.line).toBe(2);
  });
});

describe('securityStage — external-controller without a secret (FR-VAL-04)', () => {
  it('fires when external-controller is set and secret is absent', () => {
    const issues = run('external-controller: 127.0.0.1:9090\n');
    expect(issues).toEqual([
      expect.objectContaining({
        severity: 'warning',
        code: 'security.controllerWithoutSecret',
        module: 'security',
        path: ['secret'],
        blocking: false,
      }),
    ]);
  });

  it('fires when secret is present but an empty string', () => {
    const issues = run('external-controller: 127.0.0.1:9090\nsecret: ""\n');
    expect(issues.some((issue) => issue.code === 'security.controllerWithoutSecret')).toBe(true);
  });

  it('fires for external-controller-tls too, not just the plain variant', () => {
    const issues = run('external-controller-tls: 127.0.0.1:9443\n');
    expect(issues.some((issue) => issue.code === 'security.controllerWithoutSecret')).toBe(true);
  });

  it('does not fire when a real, non-empty secret is set', () => {
    const issues = run('external-controller: 127.0.0.1:9090\nsecret: "hunter2"\n');
    expect(issues.some((issue) => issue.code === 'security.controllerWithoutSecret')).toBe(false);
  });

  it('does not fire when neither controller field is set', () => {
    const issues = run('mode: rule\n');
    expect(issues.some((issue) => issue.code === 'security.controllerWithoutSecret')).toBe(false);
  });

  it('never echoes the real controller address anywhere in the issue (NFR-SEC-03)', () => {
    const issues = run('external-controller: 10.0.0.42:9999\n');
    expect(JSON.stringify(issues)).not.toContain('10.0.0.42');
  });
});

describe('securityStage — skip-cert-verify on a real proxy/provider entry (FR-VAL-04)', () => {
  it('fires for a proxies[] entry with skip-cert-verify: true, addressed at that array index', () => {
    const issues = run(
      [
        'proxies:',
        '  - name: safe',
        '    type: http',
        '    server: s',
        '    port: 1',
        '  - name: risky',
        '    type: http',
        '    server: s',
        '    port: 1',
        '    skip-cert-verify: true',
      ].join('\n'),
    );
    expect(issues).toEqual([
      expect.objectContaining({
        severity: 'warning',
        code: 'security.skipCertVerify',
        module: 'security',
        path: ['proxies', 1, 'skip-cert-verify'],
        blocking: false,
      }),
    ]);
  });

  it('fires once per proxies[] entry that sets it, not just the first', () => {
    const issues = run(
      [
        'proxies:',
        '  - name: a',
        '    type: http',
        '    server: s',
        '    port: 1',
        '    skip-cert-verify: true',
        '  - name: b',
        '    type: http',
        '    server: s',
        '    port: 1',
        '    skip-cert-verify: true',
      ].join('\n'),
    );
    const paths = issues
      .filter((issue) => issue.code === 'security.skipCertVerify')
      .map((issue) => issue.path);
    expect(paths).toEqual([
      ['proxies', 0, 'skip-cert-verify'],
      ['proxies', 1, 'skip-cert-verify'],
    ]);
  });

  it("fires for a proxy-providers entry's override.skip-cert-verify, addressed by provider name", () => {
    const issues = run(
      [
        'proxy-providers:',
        '  sub1:',
        '    type: http',
        '    url: "https://example.com/sub"',
        '    override:',
        '      skip-cert-verify: true',
      ].join('\n'),
    );
    expect(issues).toEqual([
      expect.objectContaining({
        code: 'security.skipCertVerify',
        path: ['proxy-providers', 'sub1', 'override', 'skip-cert-verify'],
        blocking: false,
      }),
    ]);
  });

  it('does not fire when skip-cert-verify is false or absent', () => {
    const issues = run(
      [
        'proxies:',
        '  - name: a',
        '    type: http',
        '    server: s',
        '    port: 1',
        '    skip-cert-verify: false',
        '  - name: b',
        '    type: http',
        '    server: s',
        '    port: 1',
      ].join('\n'),
    );
    expect(issues.some((issue) => issue.code === 'security.skipCertVerify')).toBe(false);
  });

  it('does not fire when proxies/proxy-providers are absent entirely, and does not throw on a malformed shape', () => {
    expect(() => run('mode: rule\nproxies: not-a-list\n')).not.toThrow();
    expect(run('mode: rule\n').some((issue) => issue.code === 'security.skipCertVerify')).toBe(
      false,
    );
  });

  it('never echoes the real proxy name anywhere in the issue (NFR-SEC-03)', () => {
    const issues = run(
      [
        'proxies:',
        '  - name: my-personal-vpn-node',
        '    type: http',
        '    server: s',
        '    port: 1',
        '    skip-cert-verify: true',
      ].join('\n'),
    );
    expect(JSON.stringify(issues)).not.toContain('my-personal-vpn-node');
  });
});

describe('securityStage general behavior', () => {
  it('produces nothing when the document failed to compose at all (document: null)', () => {
    const trulyUnparseable = { document: null, issues: [] };
    expect(securityStage.run({ parse: trulyUnparseable })).toEqual([]);
  });

  it('still runs against a document with a syntax error elsewhere, as long as it composed', () => {
    // A bad-indentation error later in the document still yields a composed
    // document (MihomoYamlDocument's best-effort recovery) with the earlier,
    // unrelated keys intact — securityStage does not need the document to be
    // otherwise clean, only non-null.
    const parse = MihomoYamlDocument.parse(
      'allow-lan: true\nbind-address: "*"\nextra:\n  bad: 1\n   worse: 2\n',
    );
    expect(parse.document).not.toBeNull();
    expect(parse.issues.length).toBeGreaterThan(0);
    expect(
      securityStage.run({ parse }).some((issue) => issue.code === 'security.allowLanWildcardBind'),
    ).toBe(true);
  });

  it('is always warning severity and never blocking, even with all three checks firing at once', () => {
    const issues = run(
      [
        'allow-lan: true',
        'external-controller: 127.0.0.1:9090',
        'proxies:',
        '  - name: a',
        '    type: http',
        '    server: s',
        '    port: 1',
        '    skip-cert-verify: true',
      ].join('\n'),
    );
    expect(issues.length).toBe(3);
    expect(issues.every((issue) => issue.severity === 'warning')).toBe(true);
    expect(hasBlockingIssues(issues)).toBe(false);
  });

  it('has the stage id "security", matching KERNEL_MODULES', () => {
    expect(securityStage.id).toBe(SECURITY_STAGE_ID);
    expect(SECURITY_STAGE_ID).toBe('security');
  });
});
