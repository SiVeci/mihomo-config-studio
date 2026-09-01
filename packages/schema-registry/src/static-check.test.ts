import { describe, expect, it } from 'vitest';

import {
  checkExtension,
  checkFile,
  checkFiles,
  checkJsonContent,
  checkNoUnstableFieldsForChannel,
} from './static-check.js';

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

describe('checkJsonContent / migration opcodes (ADR-025, FR-UPD-07, v0.5.0 #13)', () => {
  it('accepts every real closed-set opcode', () => {
    const content = JSON.stringify({
      migrations: [
        {
          from: '1.0.0',
          to: '2.0.0',
          operations: [
            { op: 'rename-field', path: 'a', to: 'b' },
            { op: 'move-field', path: 'a', to: 'b.c' },
            { op: 'set-default', path: 'd', value: 1 },
            { op: 'deprecate-field', path: 'e', sinceVersion: '2.0.0' },
            { op: 'remove-field', path: 'f' },
            { op: 'narrow-enum', path: 'g', allowed: ['x'] },
            { op: 'quarantine-field', path: 'h' },
          ],
        },
      ],
    });

    expect(checkJsonContent('module.json', content)).toBeNull();
  });

  it('rejects an operation-shaped object whose op is not in the closed set — the real gap this slice closes: a plain string alone previously passed', () => {
    const content = JSON.stringify({
      migrations: [{ from: '1.0.0', to: '2.0.0', operations: [{ op: 'run-script', path: 'x' }] }],
    });

    expect(checkJsonContent('module.json', content)).toEqual({
      code: 'SCHEMA_CLI_UNKNOWN_MIGRATION_OPCODE',
      path: 'module.json.migrations[0].operations[0].op',
    });
  });

  it('finds an unknown opcode nested anywhere inside a "migrations" subtree, wherever that subtree itself lives in the file', () => {
    const content = JSON.stringify({
      nested: { migrations: { deep: [{ op: 'eval-js', path: 'x' }] } },
    });

    expect(checkJsonContent('module.json', content)).toEqual({
      code: 'SCHEMA_CLI_UNKNOWN_MIGRATION_OPCODE',
      path: 'module.json.nested.migrations.deep[0].op',
    });
  });

  it('does not flag an object that merely has an "op" key without a sibling "path" (not migration-operation-shaped)', () => {
    const content = JSON.stringify({ migrations: { op: 'not-a-migration-operation' } });

    expect(checkJsonContent('module.json', content)).toBeNull();
  });

  it('does not flag a plain string value named "op" nested under an unrelated key', () => {
    const content = JSON.stringify({ migrations: { opcode: 'run-script' } });

    expect(checkJsonContent('module.json', content)).toBeNull();
  });

  it('does not flag an "op"+"path"-shaped object outside a "migrations" subtree — real false positive found against the shipping built-in modules: validation.rules.json\'s Condition objects (condition.ts) also carry op/path from their own, unrelated closed operator set', () => {
    const content = JSON.stringify({
      when: { op: 'eq', path: 'mode', value: 'rule' },
    });

    expect(checkJsonContent('validation.rules.json', content)).toBeNull();
  });

  it('still catches an unrelated Condition-shaped false alarm risk correctly: a real migrations entry sitting alongside an op/path Condition in the same file only flags the migrations one', () => {
    const content = JSON.stringify({
      when: { op: 'eq', path: 'mode', value: 'rule' },
      migrations: [{ from: '1.0.0', to: '2.0.0', operations: [{ op: 'run-script', path: 'x' }] }],
    });

    expect(checkJsonContent('module.json', content)).toEqual({
      code: 'SCHEMA_CLI_UNKNOWN_MIGRATION_OPCODE',
      path: 'module.json.migrations[0].operations[0].op',
    });
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

describe('checkNoUnstableFieldsForChannel (ADR-031)', () => {
  it('flags a field marked x-unstable anywhere in a Stable-channel file', () => {
    const files = new Map([
      [
        'config.schema.json',
        JSON.stringify({ properties: { newField: { type: 'string', 'x-unstable': true } } }),
      ],
    ]);

    expect(checkNoUnstableFieldsForChannel(files, 'stable')).toEqual([
      {
        code: 'SCHEMA_CLI_UNSTABLE_FIELD_IN_STABLE_CHANNEL',
        path: 'config.schema.json.properties.newField',
      },
    ]);
  });

  it('allows the exact same content when the channel is beta', () => {
    const files = new Map([
      [
        'config.schema.json',
        JSON.stringify({ properties: { newField: { type: 'string', 'x-unstable': true } } }),
      ],
    ]);

    expect(checkNoUnstableFieldsForChannel(files, 'beta')).toEqual([]);
  });

  it('finds the marker inside an array (e.g. an "anyOf" branch)', () => {
    const files = new Map([
      [
        'config.schema.json',
        JSON.stringify({ anyOf: [{ type: 'string' }, { 'x-unstable': true }] }),
      ],
    ]);

    expect(checkNoUnstableFieldsForChannel(files, 'stable')).toEqual([
      { code: 'SCHEMA_CLI_UNSTABLE_FIELD_IN_STABLE_CHANNEL', path: 'config.schema.json.anyOf[1]' },
    ]);
  });

  it('does not flag a field where "x-unstable" is merely a string, not the literal boolean true', () => {
    const files = new Map([
      ['config.schema.json', JSON.stringify({ properties: { f: { 'x-unstable': 'draft' } } })],
    ]);

    expect(checkNoUnstableFieldsForChannel(files, 'stable')).toEqual([]);
  });

  it('ignores non-.json files entirely, even ones containing the literal marker text', () => {
    const files = new Map([['notes.md', '"x-unstable": true']]);

    expect(checkNoUnstableFieldsForChannel(files, 'stable')).toEqual([]);
  });

  it('skips a file with invalid JSON rather than throwing — checkJsonContent already owns reporting that', () => {
    const files = new Map([['config.schema.json', '{not valid']]);

    expect(checkNoUnstableFieldsForChannel(files, 'stable')).toEqual([]);
  });

  it('collects one issue per offending file, not just the first', () => {
    const files = new Map([
      ['a.json', JSON.stringify({ 'x-unstable': true })],
      ['b.json', JSON.stringify({ 'x-unstable': true })],
      ['c.json', JSON.stringify({ ok: true })],
    ]);

    expect(checkNoUnstableFieldsForChannel(files, 'stable')).toEqual([
      { code: 'SCHEMA_CLI_UNSTABLE_FIELD_IN_STABLE_CHANNEL', path: 'a.json' },
      { code: 'SCHEMA_CLI_UNSTABLE_FIELD_IN_STABLE_CHANNEL', path: 'b.json' },
    ]);
  });
});
