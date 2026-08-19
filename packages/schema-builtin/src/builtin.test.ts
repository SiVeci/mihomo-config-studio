import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildFormPlan,
  validateModuleShape,
  validateValue,
  type JsonSchema,
} from '@mcs/schema-core';
import { UPSTREAM_P0_FIELDS } from '@mcs/test-fixtures';
import { MihomoYamlDocument } from '@mcs/yaml-engine';
import { describe, expect, it } from 'vitest';

import { GENERAL_MODULE } from './index.js';

const MODULE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'modules', 'general');

function readExample(relativePath: string): string {
  return readFileSync(join(MODULE_DIR, relativePath), 'utf8');
}

/** Parses one of this module's own example files into the plain value `validateValue`/`buildFormPlan` expect. */
function parseExample(relativePath: string): unknown {
  const { document, issues } = MihomoYamlDocument.parse(readExample(relativePath));
  expect(issues, `${relativePath} must itself be syntactically valid YAML`).toEqual([]);
  return document?.toJS();
}

/** Every `properties` path in a JSON Schema, descending into nested objects — the same dot-path shape `UPSTREAM_P0_FIELDS` uses. */
function collectSchemaPaths(schema: JsonSchema, prefix = ''): string[] {
  const paths: string[] = [];
  for (const [key, propSchema] of Object.entries(schema.properties ?? {})) {
    const path = prefix ? `${prefix}.${key}` : key;
    paths.push(path);
    if (propSchema.type === 'object' && propSchema.properties) {
      paths.push(...collectSchemaPaths(propSchema, path));
    }
  }
  return paths;
}

describe('GENERAL_MODULE shape (v0.3.0 #6)', () => {
  it('has no shape issues (rules/examples/i18n)', () => {
    expect(validateModuleShape(GENERAL_MODULE)).toEqual([]);
  });

  it('declares a version and a root scoped to the document root (no wrapping "general" key upstream)', () => {
    expect(GENERAL_MODULE.manifest.id).toBe('general');
    expect(GENERAL_MODULE.manifest.root).toEqual([]);
  });
});

describe('field coverage against the frozen upstream inventory (v0.3.0 #3)', () => {
  it('declares exactly the P0 fields UPSTREAM_P0_FIELDS.general lists — no more, no less', () => {
    const declared = new Set(collectSchemaPaths(GENERAL_MODULE.schema));
    const upstream = new Set(UPSTREAM_P0_FIELDS.general.map((record) => record.path));

    const declaredNotUpstream = [...declared].filter((path) => !upstream.has(path));
    const upstreamNotDeclared = [...upstream].filter((path) => !declared.has(path));

    expect(declaredNotUpstream).toEqual([]);
    expect(upstreamNotDeclared).toEqual([]);
  });

  it('gives every declared field a UI entry with docs + safety metadata (head start on FR-SCHEMA-04, full assertion in #18)', () => {
    const missing: string[] = [];
    for (const path of collectSchemaPaths(GENERAL_MODULE.schema)) {
      const segments = path.split('.');
      let fields = GENERAL_MODULE.ui.fields ?? {};
      let spec: (typeof fields)[string] | undefined;
      for (const segment of segments) {
        spec = fields[segment];
        if (!spec) break;
        fields = spec.fields ?? {};
      }
      if (!spec?.docs || !spec.safety) missing.push(path);
    }
    expect(missing).toEqual([]);
  });
});

describe('NFR-SEC-02 re-verified on a real field', () => {
  it('infers the Controller secret as a secret control without any explicit UI override', () => {
    expect(GENERAL_MODULE.ui.fields?.secret?.control).toBeUndefined();

    const plan = buildFormPlan(GENERAL_MODULE, { secret: 'hunter2' }, { mode: 'advanced' });
    const secretField = plan.fields.find((field) => field.key === 'secret');
    expect(secretField?.control).toBe('secret');
  });
});

describe('examples (exit condition 4: valid/invalid/edge/unknown-fields per module)', () => {
  it('lists all four kinds with a path that exists on disk', () => {
    const kinds = GENERAL_MODULE.examples?.map((example) => example.kind).sort();
    expect(kinds).toEqual(['edge', 'invalid', 'unknown-fields', 'valid']);

    for (const example of GENERAL_MODULE.examples ?? []) {
      expect(() => readExample(example.path)).not.toThrow();
    }
  });

  it('valid.yaml has no schema violations', () => {
    const value = parseExample('examples/valid.yaml');
    expect(validateValue(value, GENERAL_MODULE.schema)).toEqual([]);
  });

  it('invalid.yaml has schema violations on every field its own comment claims', () => {
    const value = parseExample('examples/invalid.yaml');
    const issues = validateValue(value, GENERAL_MODULE.schema);
    const paths = issues.map((issue) => issue.path.join('.'));

    expect(paths).toContain('mode');
    expect(paths).toContain('log-level');
    expect(paths).toContain('geo-update-interval');
  });

  it('edge.yaml has no schema violations (boundary values are still valid values)', () => {
    const value = parseExample('examples/edge.yaml');
    expect(validateValue(value, GENERAL_MODULE.schema)).toEqual([]);
  });

  it('unknown-fields.yaml plans its undeclared field as unknown instead of dropping it', () => {
    const value = parseExample('examples/unknown-fields.yaml');
    const plan = buildFormPlan(GENERAL_MODULE, value, { mode: 'advanced' });
    expect(plan.unknownFields.map((field) => field.key)).toContain('brand-new-mihomo-flag');
  });
});

describe('docs links (NFR-SEC-03 boundary, head start on #18)', () => {
  it('every docs URL is on the official wiki domain and carries no query string', () => {
    const offenders: string[] = [];
    for (const [key, spec] of Object.entries(GENERAL_MODULE.ui.fields ?? {})) {
      if (!spec.docs) continue;
      const url = new URL(spec.docs);
      const onOfficialDomain = url.hostname === 'wiki.metacubex.one';
      const hasNoQuery = url.search === '';
      if (!onOfficialDomain || !hasNoQuery) offenders.push(key);
    }
    expect(offenders).toEqual([]);
  });
});
