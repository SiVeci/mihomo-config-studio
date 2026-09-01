import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { SchemaModule } from '@mcs/schema-core';
import { afterEach, describe, expect, it } from 'vitest';

import {
  buildModulePreview,
  loadModuleFromDirectory,
  renderModulePreviewText,
  type ModulePreview,
} from './preview.js';

const tempDirs: string[] = [];

function makeModuleDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'schema-cli-preview-test-'));
  tempDirs.push(dir);
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = join(dir, relativePath);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, content);
  }
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const MINIMAL_MANIFEST = JSON.stringify({ id: 'test-module', root: ['test'], version: '1.0.0' });

describe('loadModuleFromDirectory (FR-SCHEMA-07)', () => {
  it('reads a real minimal module directory into a SchemaModule', () => {
    const dir = makeModuleDir({
      'module.manifest.json': MINIMAL_MANIFEST,
      'config.schema.json': JSON.stringify({
        type: 'object',
        properties: { mode: { type: 'string' } },
      }),
      'ui.schema.json': JSON.stringify({ fields: { mode: { label: 'field.mode' } } }),
    });

    const result = loadModuleFromDirectory(dir);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.module.manifest.id).toBe('test-module');
    expect(result.module.schema.properties?.mode).toEqual({ type: 'string' });
    expect(result.module.ui.fields?.mode).toEqual({ label: 'field.mode' });
  });

  it('reports a clear error when module.manifest.json is missing, naming which file', () => {
    const dir = makeModuleDir({
      'config.schema.json': '{}',
      'ui.schema.json': '{}',
    });

    const result = loadModuleFromDirectory(dir);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('module.manifest.json');
  });

  it('reports a clear error when a file is not valid JSON, naming which file', () => {
    const dir = makeModuleDir({
      'module.manifest.json': MINIMAL_MANIFEST,
      'config.schema.json': '{not valid',
      'ui.schema.json': '{}',
    });

    const result = loadModuleFromDirectory(dir);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('config.schema.json');
  });
});

describe('buildModulePreview / renderModulePreviewText (FR-SCHEMA-07)', () => {
  const module: SchemaModule = {
    manifest: { id: 'preview-demo', root: ['demo'], version: '1.0.0' },
    schema: {
      type: 'object',
      required: ['mode'],
      properties: {
        mode: { type: 'string' },
        token: { type: 'string' },
        legacyFlag: { type: 'boolean', deprecated: true },
        inbound: {
          type: 'object',
          properties: {
            port: { type: 'number' },
          },
        },
        target: {
          type: 'object',
          anyOf: [
            {
              properties: {
                kind: { const: 'a' },
                aOnlyField: { type: 'string' },
              },
            },
            {
              properties: {
                kind: { const: 'b' },
                bOnlyField: { type: 'string' },
              },
            },
          ],
        },
      },
    },
    ui: {
      fields: {
        token: { sensitive: true },
        inbound: {},
        'inbound.port': { advanced: true },
        target: { control: 'variant' },
      },
    },
  };

  function fieldByPath(preview: ModulePreview, path: string) {
    return preview.fields.find((field) => field.path === path);
  }

  it('reports required, sensitive and deprecated flags from the real buildFormPlan', () => {
    const preview = buildModulePreview(module);

    expect(fieldByPath(preview, 'demo.mode')?.required).toBe(true);
    expect(fieldByPath(preview, 'demo.token')?.sensitive).toBe(true);
    expect(fieldByPath(preview, 'demo.legacyFlag')?.deprecated).toBe(true);
  });

  it("nests a plain object field's children under it, not flattened alongside it", () => {
    const preview = buildModulePreview(module);

    const inbound = fieldByPath(preview, 'demo.inbound');
    expect(inbound?.children?.map((child) => child.path)).toEqual(['demo.inbound.port']);
    // The child itself must not also appear as a separate top-level entry.
    expect(fieldByPath(preview, 'demo.inbound.port')).toBeUndefined();
  });

  it('expands every declared variant branch, each via a real, separately re-planned buildFormPlan call (E4: never invents data to make a branch "fit")', () => {
    const preview = buildModulePreview(module);

    const target = fieldByPath(preview, 'demo.target');
    expect(target?.control).toBe('variant');
    const branchValues = target?.variantBranches?.map((branch) => branch.value).sort();
    expect(branchValues).toEqual(['a', 'b']);

    const branchA = target?.variantBranches?.find((branch) => branch.value === 'a');
    expect(branchA?.fields.map((field) => field.path)).toContain('demo.target.aOnlyField');
    const branchB = target?.variantBranches?.find((branch) => branch.value === 'b');
    expect(branchB?.fields.map((field) => field.path)).toContain('demo.target.bOnlyField');
    // Branch A's own fields must never leak into branch B's report — each
    // branch is planned independently.
    expect(branchB?.fields.map((field) => field.path)).not.toContain('demo.target.aOnlyField');
  });

  it('renders plain text with one line per field, nesting children and variant branches by indentation', () => {
    const preview = buildModulePreview(module);

    const text = renderModulePreviewText(preview);

    expect(text).toContain('module: preview-demo');
    expect(text).toContain('demo.mode  type=string control=text [required]');
    expect(text).toContain('demo.token  type=string control=secret [sensitive]');
    expect(text).toMatch(/demo\.inbound {2}type=object control=\w+\n {2}demo\.inbound\.port/);
    expect(text).toContain('variant: "a"');
    expect(text).toContain('variant: "b"');
  });
});

describe('preview against the real, shipping built-in modules (FR-SCHEMA-07, exit condition 8 acceptance)', () => {
  it('loads and previews every form-shaped real module (8 of the 10 P0 modules) with zero exceptions — a cheap Schema health check as much as a feature test', () => {
    const modulesDir = join(
      dirname(fileURLToPath(import.meta.url)),
      '../../../packages/schema-builtin/modules',
    );
    const moduleIds = readdirSync(modulesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);

    expect(moduleIds.length).toBe(10);

    // `rules`/`sub-rules` are rule-*line* modules (a YAML array of strings
    // like `DOMAIN,example.com,DIRECT`), not object-shaped config — real,
    // verified fact: neither directory has a `config.schema.json`/
    // `ui.schema.json` at all, only `rule-types.json` (a rule-type catalog,
    // a different concept `rule-catalog.ts`/`rule-explain.ts` consume, not
    // `buildFormPlan`). `RuleEditor`/`RuleListPage` render them, never
    // `SchemaForm` — there is no form for this tool to preview, by
    // architecture, not a gap in it.
    const formShapedModuleIds = moduleIds.filter((id) => id !== 'rules' && id !== 'sub-rules');
    expect(formShapedModuleIds.length).toBe(8);

    for (const moduleId of formShapedModuleIds) {
      const loaded = loadModuleFromDirectory(join(modulesDir, moduleId));
      expect(loaded.ok, `${moduleId}: ${!loaded.ok ? loaded.error : ''}`).toBe(true);
      if (!loaded.ok) continue;

      expect(() => {
        const preview = buildModulePreview(loaded.module);
        renderModulePreviewText(preview);
      }, `${moduleId} threw while building/rendering its preview`).not.toThrow();
    }
  });
});
