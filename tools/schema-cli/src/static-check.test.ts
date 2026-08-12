import { describe, expect, it } from 'vitest';

import { checkExtension, checkFile, checkFiles, checkJsonContent } from './static-check.js';

describe('checkExtension (FR-UPD-07)', () => {
  it('allows .json, .yaml and .md', () => {
    expect(checkExtension('schemas/general.json')).toBeNull();
    expect(checkExtension('schemas/general.yaml')).toBeNull();
    expect(checkExtension('README.md')).toBeNull();
  });

  it('rejects everything else, including native and script extensions', () => {
    for (const path of [
      'payload.js',
      'lib.wasm',
      'native.so',
      'plugin.dll',
      'notes.txt',
      'noext',
    ]) {
      expect(checkExtension(path)).toEqual({ code: 'SCHEMA_CLI_DISALLOWED_EXTENSION', path });
    }
  });

  it('is case-insensitive on the extension', () => {
    expect(checkExtension('SCHEMA.JSON')).toBeNull();
    expect(checkExtension('payload.JS')).toEqual({
      code: 'SCHEMA_CLI_DISALLOWED_EXTENSION',
      path: 'payload.JS',
    });
  });
});

describe('checkJsonContent (FR-UPD-07, NFR-SEC-05)', () => {
  it('rejects text that is not valid JSON', () => {
    expect(checkJsonContent('bad.json', '{not valid')).toEqual({
      code: 'SCHEMA_CLI_INVALID_JSON',
      path: 'bad.json',
    });
  });

  it('accepts realistic schema content: labels, descriptions, patterns, docs URLs', () => {
    const content = JSON.stringify({
      schema: {
        type: 'object',
        properties: {
          mode: { type: 'string', enum: ['rule', 'global', 'direct'], default: 'rule' },
          hostname: { type: 'string', pattern: '^[a-z0-9.-]+$' },
        },
      },
      ui: {
        fields: {
          mode: {
            label: 'field.mode',
            help: 'The function of this field is to select the routing mode.',
            docs: 'https://wiki.metacubex.one/config/general/',
          },
        },
      },
    });

    expect(checkJsonContent('module.json', content)).toBeNull();
  });

  it('rejects a function declaration nested at the top level', () => {
    const content = JSON.stringify({ validate: 'function (v) { return v.length > 0; }' });
    expect(checkJsonContent('bad.json', content)).toEqual({
      code: 'SCHEMA_CLI_EXECUTABLE_CONTENT',
      path: 'bad.json.validate',
    });
  });

  it('rejects an arrow function nested inside an array', () => {
    const content = JSON.stringify({ hooks: ['ok', '(v) => v.trim()'] });
    expect(checkJsonContent('bad.json', content)).toEqual({
      code: 'SCHEMA_CLI_EXECUTABLE_CONTENT',
      path: 'bad.json.hooks[1]',
    });
  });

  it('rejects a direct call to eval/Function/require/import', () => {
    for (const call of ["eval('1')", 'new Function("return 1")', "require('fs')", "import('fs')"]) {
      expect(checkJsonContent('bad.json', JSON.stringify({ x: call }))).toEqual({
        code: 'SCHEMA_CLI_EXECUTABLE_CONTENT',
        path: 'bad.json.x',
      });
    }
  });

  it('rejects a value shaped like a module specifier', () => {
    for (const specifier of [
      './payload.js',
      '../lib/plugin.mjs',
      'node:child_process',
      'npm:left-pad',
    ]) {
      expect(checkJsonContent('bad.json', JSON.stringify({ x: specifier }))).toEqual({
        code: 'SCHEMA_CLI_EXECUTABLE_CONTENT',
        path: 'bad.json.x',
      });
    }
  });

  it('rejects executable content nested deep inside an object', () => {
    const content = JSON.stringify({ ui: { fields: { mode: { fields: { nested: 'x => x' } } } } });
    expect(checkJsonContent('bad.json', content)).toEqual({
      code: 'SCHEMA_CLI_EXECUTABLE_CONTENT',
      path: 'bad.json.ui.fields.mode.fields.nested',
    });
  });

  it('does not flag non-string values', () => {
    const content = JSON.stringify({ count: 42, enabled: true, empty: null });
    expect(checkJsonContent('ok.json', content)).toBeNull();
  });
});

describe('checkFile', () => {
  it('rejects on extension before ever parsing the content', () => {
    expect(checkFile('payload.js', 'not even json')).toEqual({
      code: 'SCHEMA_CLI_DISALLOWED_EXTENSION',
      path: 'payload.js',
    });
  });

  it('does not content-check non-JSON files, even if their text looks executable', () => {
    expect(checkFile('README.md', 'Example: `(v) => v.trim()`')).toBeNull();
  });

  it('content-checks .json files', () => {
    expect(checkFile('bad.json', JSON.stringify({ x: 'function () {}' }))).toEqual({
      code: 'SCHEMA_CLI_EXECUTABLE_CONTENT',
      path: 'bad.json.x',
    });
  });
});

describe('checkFiles', () => {
  it('collects every violation instead of stopping at the first', () => {
    const files = new Map([
      ['a.js', 'irrelevant'],
      ['b.json', JSON.stringify({ x: 'function () {}' })],
      ['c.json', JSON.stringify({ ok: true })],
    ]);

    const issues = checkFiles(files);

    expect(issues).toEqual([
      { code: 'SCHEMA_CLI_DISALLOWED_EXTENSION', path: 'a.js' },
      { code: 'SCHEMA_CLI_EXECUTABLE_CONTENT', path: 'b.json.x' },
    ]);
  });

  it('returns no issues for an all-clean file set', () => {
    const files = new Map([
      ['a.json', JSON.stringify({ ok: true })],
      ['b.md', '# Notes'],
    ]);

    expect(checkFiles(files)).toEqual([]);
  });
});
