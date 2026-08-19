import { DNS_MODULE, GENERAL_MODULE, INBOUND_MODULE } from '@mcs/schema-builtin';
import type { SchemaModule } from '@mcs/schema-core';
import { BUILTIN_BUNDLE, createRegistry, type StoredBundle } from '@mcs/schema-registry';
import { MihomoYamlDocument } from '@mcs/yaml-engine';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_STAGES,
  hasBlockingIssues,
  runPipeline,
  SCHEMA_STAGE_ID,
  schemaStage,
  SYNTAX_STAGE_ID,
  syntaxStage,
  VALIDATION_DEBOUNCE_MS,
} from './pipeline.js';
import type { PipelineContext, ValidationStage } from './pipeline.js';
import type { ValidationIssue } from './issue.js';
import { SECURITY_STAGE_ID, securityStage } from './security.js';

/**
 * `createRegistry` takes a `StoredBundle` (serialised module bytes, the
 * product of `verifyBundle`) — `BUILTIN_BUNDLE.modules` holds live
 * `SchemaModule` objects instead (`@mcs/schema-builtin`'s own assembly
 * step). Re-serialising here is the same conversion
 * `schema-registry/src/builtin.test.ts` already does to drive `verifyBundle`
 * against the same content; it is not a new pattern invented for this file.
 */
function builtinAsStoredBundle(): StoredBundle {
  const files = new Map<string, Uint8Array>(
    Object.entries(BUILTIN_BUNDLE.modules).map(([path, module]) => [
      path,
      new TextEncoder().encode(JSON.stringify(module)),
    ]),
  );
  return { manifest: BUILTIN_BUNDLE.manifest, files };
}

function blockingIssue(module: string): ValidationIssue {
  return { severity: 'error', code: 'x', module, messageKey: 'x', blocking: true };
}

describe('syntaxStage (FR-VAL-01)', () => {
  it('widens every YamlIssue from the parse result via fromYamlIssue', () => {
    const parse = MihomoYamlDocument.parse('a: 1\n  b: 2\n');
    const issues = syntaxStage.run({ parse });
    expect(issues.length).toBe(parse.issues.length);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((issue) => issue.module === 'yaml')).toBe(true);
  });

  it('produces no issues for syntactically valid input', () => {
    const parse = MihomoYamlDocument.parse('mode: rule\n');
    expect(syntaxStage.run({ parse })).toEqual([]);
  });
});

describe('schemaStage (FR-VAL-01, FR-VAL-05, v0.3.0 #12)', () => {
  it('produces nothing when no modules are resolved — omitted or explicitly empty, preserving v0.2.0\'s "no Schema module installed" closed loop', () => {
    const parse = MihomoYamlDocument.parse('mode: rule\n');
    expect(schemaStage.run({ parse })).toEqual([]);
    expect(schemaStage.run({ parse, modules: [] })).toEqual([]);
  });

  it('produces a blocking error for a real schema violation, addressed at the document-absolute path, with a real range', () => {
    const parse = MihomoYamlDocument.parse('dns:\n  enhanced-mode: turbo\n');
    const [issue] = schemaStage.run({ parse, modules: [DNS_MODULE] });
    expect(issue).toMatchObject({
      severity: 'error',
      module: 'dns',
      path: ['dns', 'enhanced-mode'],
      blocking: true,
    });
    expect(issue?.range?.start.line).toBe(2);
  });

  it('fires a real validation.rules.json cross-field rule (DNS fallback-filter, v0.3.0 #7), at the document-absolute path', () => {
    const parse = MihomoYamlDocument.parse(
      'dns:\n  fallback-filter:\n    geoip: false\n    geoip-code: CN\n',
    );
    const issues = schemaStage.run({ parse, modules: [DNS_MODULE] });
    const ruleIssue = issues.find((issue) => issue.code.startsWith('rule.'));
    expect(ruleIssue).toMatchObject({
      severity: 'warning',
      code: 'rule.fallback-filter-geoip-code-requires-geoip',
      module: 'dns',
      path: ['dns', 'fallback-filter', 'geoip-code'],
      blocking: false,
    });
  });

  it('flags a real, deliberately-unmodelled upstream field as info-severity "unknown-field", never blocking (FR-VAL-05)', () => {
    // "use-hosts" is DNS's own real, documented-but-out-of-P0-scope field
    // (packages/schema-builtin/modules/dns/examples/unknown-fields.yaml).
    const parse = MihomoYamlDocument.parse('dns:\n  enable: true\n  use-hosts: true\n');
    const issues = schemaStage.run({ parse, modules: [DNS_MODULE] });
    expect(issues).toEqual([
      {
        severity: 'info',
        code: 'unknown-field',
        module: 'schema',
        messageKey: 'unknown-field',
        path: ['dns', 'use-hosts'],
        range: expect.objectContaining({ start: expect.objectContaining({ line: 3 }) }),
        blocking: false,
      },
    ]);
    expect(hasBlockingIssues(issues)).toBe(false);
  });

  it('never blocks on unknown fields no matter how many — a config full of real P1/P2 protocol fields stays fully non-blocking', () => {
    const parse = MihomoYamlDocument.parse(
      [
        'proxies:',
        '  - name: snell1',
        '    type: snell',
        '    server: server',
        '    port: 1',
        '    psk: hunter2',
        '    version: 4',
        '    obfs-opts:',
        '      mode: http',
      ].join('\n'),
    );
    // "proxies" is document-rooted as a *list*; schemaStage validates one
    // resolved module's own scope (see PROXIES_MODULE's module doc comment
    // — array-of-entries planning is #14's job), so no module here claims
    // any of it and every leaf reads as an unknown field. That is exactly
    // the FR-VAL-05 case this test exists to prove non-blocking.
    const issues = schemaStage.run({ parse, modules: [DNS_MODULE] });
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((issue) => issue.severity === 'info')).toBe(true);
    expect(hasBlockingIssues(issues)).toBe(false);
  });

  it("does not let two modules sharing a document root (general/inbound, both root: []) falsely flag each other's fields as unknown", () => {
    const parse = MihomoYamlDocument.parse('mode: rule\nmixed-port: 7890\n');
    const issues = schemaStage.run({ parse, modules: [GENERAL_MODULE, INBOUND_MODULE] });
    expect(issues.filter((issue) => issue.code === 'unknown-field')).toEqual([]);
  });

  it("does not misread a module's entirely absent document section as a schema.type violation", () => {
    const parse = MihomoYamlDocument.parse('mode: rule\n');
    const issues = schemaStage.run({ parse, modules: [DNS_MODULE] });
    // No installed module claims "mode" here (only DNS is installed), so it
    // legitimately surfaces as an info-level unknown field — but critically
    // never as an error: DNS's own (absent) section must not read as
    // "expected object, got undefined".
    expect(issues.every((issue) => issue.severity !== 'error')).toBe(true);
    expect(issues).toContainEqual(
      expect.objectContaining({ code: 'unknown-field', path: ['mode'] }),
    );
  });

  it('never echoes a real secret value anywhere in the produced issues (NFR-SEC-03)', () => {
    const secretValue = 'sk-live-s3cr3t-do-not-leak';
    const parse = MihomoYamlDocument.parse(
      `secret: "${secretValue}"\nlog-level: not-a-real-level\n`,
    );
    const issues = schemaStage.run({ parse, modules: [GENERAL_MODULE] });
    expect(issues.length).toBeGreaterThan(0);
    expect(JSON.stringify(issues)).not.toContain(secretValue);
  });

  it('tolerates a module that omits `rules` entirely (an optional field — not every module declares one)', () => {
    const noRulesModule: SchemaModule = {
      manifest: { id: 'sample', root: ['sample'], version: '1.0.0' },
      schema: { type: 'object', properties: { flag: { type: 'boolean' } } },
      ui: {},
    };
    const parse = MihomoYamlDocument.parse('sample:\n  flag: true\n');
    expect(() => schemaStage.run({ parse, modules: [noRulesModule] })).not.toThrow();
    expect(schemaStage.run({ parse, modules: [noRulesModule] })).toEqual([]);
  });
});

describe('runPipeline', () => {
  it('runs the default stages and concatenates their issues', () => {
    const ctx: PipelineContext = { parse: MihomoYamlDocument.parse('mode: rule\n') };
    expect(runPipeline(ctx)).toEqual([]);
  });

  it('defaults to [syntaxStage, schemaStage, securityStage] in that order', () => {
    expect(DEFAULT_STAGES).toEqual([syntaxStage, schemaStage, securityStage]);
    expect(DEFAULT_STAGES.map((stage) => stage.id)).toEqual([
      SYNTAX_STAGE_ID,
      SCHEMA_STAGE_ID,
      SECURITY_STAGE_ID,
    ]);
  });

  it('short-circuits after a blocking syntax issue, skipping every later stage entirely', () => {
    let laterStageRan = false;
    const laterStage: ValidationStage = {
      id: 'schema',
      run: () => {
        laterStageRan = true;
        return [];
      },
    };
    const ctx: PipelineContext = { parse: MihomoYamlDocument.parse('a: 1\n  b: 2\n') };

    const issues = runPipeline(ctx, [syntaxStage, laterStage]);

    expect(hasBlockingIssues(issues)).toBe(true);
    expect(laterStageRan).toBe(false);
  });

  it('does not short-circuit for a blocking issue produced by a non-syntax stage', () => {
    let afterStageRan = false;
    const blockingStage: ValidationStage = { id: 'schema', run: () => [blockingIssue('sample')] };
    const afterStage: ValidationStage = {
      id: 'reference',
      run: () => {
        afterStageRan = true;
        return [];
      },
    };
    const ctx: PipelineContext = { parse: MihomoYamlDocument.parse('mode: rule\n') };

    const issues = runPipeline(ctx, [syntaxStage, blockingStage, afterStage]);

    expect(hasBlockingIssues(issues)).toBe(true);
    expect(afterStageRan).toBe(true);
  });

  it('runs every stage and reports no blocking issues when nothing blocks', () => {
    const quietStage: ValidationStage = { id: 'reference', run: () => [] };
    const ctx: PipelineContext = { parse: MihomoYamlDocument.parse('mode: rule\n') };

    const issues = runPipeline(ctx, [syntaxStage, quietStage]);

    expect(issues).toEqual([]);
    expect(hasBlockingIssues(issues)).toBe(false);
  });
});

describe('runPipeline with real schema-registry-resolved modules (FR-VAL-01, FR-VAL-05, v0.3.0 #12)', () => {
  // The actual production path: a verified StoredBundle -> createRegistry ->
  // PipelineContext.modules, not hand-picked module constants. Proves the
  // wiring works end to end, not just schemaStage in isolation.
  const modules = createRegistry(builtinAsStoredBundle()).modules();

  it('resolves all six built-in P0 modules with no registry issues', () => {
    expect(modules.map((module) => module.manifest.id).sort()).toEqual([
      'dns',
      'general',
      'inbound',
      'proxies',
      'proxy-providers',
      'sniffer',
    ]);
  });

  it('blocks export on a real cross-module document with one genuine schema violation', () => {
    const parse = MihomoYamlDocument.parse('mode: rule\ndns:\n  enhanced-mode: turbo\n');
    const ctx: PipelineContext = { parse, modules };

    const issues = runPipeline(ctx);

    expect(hasBlockingIssues(issues)).toBe(true);
    expect(issues).toContainEqual(
      expect.objectContaining({ severity: 'error', module: 'dns', path: ['dns', 'enhanced-mode'] }),
    );
  });

  it('does not block a fully valid, real-shaped multi-module document', () => {
    const parse = MihomoYamlDocument.parse(
      ['mode: rule', 'mixed-port: 7890', 'dns:', '  enable: true', '  enhanced-mode: fake-ip'].join(
        '\n',
      ),
    );
    const ctx: PipelineContext = { parse, modules };

    const issues = runPipeline(ctx);

    expect(hasBlockingIssues(issues)).toBe(false);
  });
});

describe('hasBlockingIssues (FR-YAML-07)', () => {
  it('is false for an empty list', () => {
    expect(hasBlockingIssues([])).toBe(false);
  });

  it('is false when every issue is a warning or info', () => {
    const issues: ValidationIssue[] = [
      { severity: 'warning', code: 'w', module: 'yaml', messageKey: 'w', blocking: false },
      { severity: 'info', code: 'i', module: 'yaml', messageKey: 'i', blocking: false },
    ];
    expect(hasBlockingIssues(issues)).toBe(false);
  });

  it('is true as soon as one issue blocks', () => {
    const issues: ValidationIssue[] = [
      { severity: 'warning', code: 'w', module: 'yaml', messageKey: 'w', blocking: false },
      blockingIssue('sample'),
    ];
    expect(hasBlockingIssues(issues)).toBe(true);
  });
});

describe('VALIDATION_DEBOUNCE_MS (NFR-PERF-03 contract)', () => {
  it('is the 300ms figure the Worker message layer (#10) must implement', () => {
    expect(VALIDATION_DEBOUNCE_MS).toBe(300);
  });
});
