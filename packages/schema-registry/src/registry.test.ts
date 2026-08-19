import type { SchemaModule } from '@mcs/schema-core';
import { describe, expect, it } from 'vitest';

import { createRegistry } from './registry.js';
import type { StoredBundle } from './store.js';

function encode(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

function bundleOf(entries: Record<string, unknown>): StoredBundle {
  const files = new Map<string, Uint8Array>();
  for (const [path, value] of Object.entries(entries)) {
    files.set(path, typeof value === 'string' ? new TextEncoder().encode(value) : encode(value));
  }
  // The manifest itself is irrelevant to createRegistry (verifyBundle already
  // ran); a minimal stand-in keeps the fixture focused on `files`.
  return { manifest: {} as StoredBundle['manifest'], files };
}

function module(id: string, overrides: Partial<SchemaModule['manifest']> = {}): SchemaModule {
  return {
    manifest: { id, root: [id], version: '1.0.0', ...overrides },
    schema: { type: 'object', properties: {} },
    ui: {},
  };
}

describe('discovery (FR-SCHEMA-05)', () => {
  it('exposes every well-formed module via modules()/resolve()/byRoot()', () => {
    const bundle = bundleOf({
      'modules/general.json': module('general'),
      'modules/dns.json': module('dns'),
    });
    const registry = createRegistry(bundle);

    expect(
      registry
        .modules()
        .map((m) => m.manifest.id)
        .sort(),
    ).toEqual(['dns', 'general']);
    expect(registry.resolve('general')?.manifest.id).toBe('general');
    expect(registry.resolve('missing')).toBeUndefined();
    expect(registry.byRoot(['dns'])?.manifest.id).toBe('dns');
    expect(registry.byRoot(['nope'])).toBeUndefined();
    expect(registry.issues()).toEqual([]);
  });

  it('never scans the filesystem — discovery comes entirely from the given StoredBundle', () => {
    // No fixture on disk is referenced anywhere in this test; an empty
    // bundle simply yields an empty registry, proving there is no implicit
    // directory scan happening underneath.
    const registry = createRegistry(bundleOf({}));
    expect(registry.modules()).toEqual([]);
  });
});

describe('malformed module content is excluded, not crashed on or silently included', () => {
  it('drops a file that is not valid JSON', () => {
    const bundle = bundleOf({ 'modules/broken.json': '{ not json' });
    const registry = createRegistry(bundle);

    expect(registry.modules()).toEqual([]);
    expect(registry.issues()).toEqual([
      { code: 'REGISTRY_INVALID_MODULE_JSON', moduleId: 'modules/broken.json' },
    ]);
  });

  it('drops valid JSON that is missing the required manifest/schema/ui shape', () => {
    const bundle = bundleOf({ 'modules/shapeless.json': { manifest: { id: 'x' } } });
    const registry = createRegistry(bundle);

    expect(registry.modules()).toEqual([]);
    expect(registry.issues()).toEqual([
      { code: 'REGISTRY_INVALID_MODULE_JSON', moduleId: 'modules/shapeless.json' },
    ]);
  });

  it('keeps well-formed modules even when a sibling file in the same bundle is broken', () => {
    const bundle = bundleOf({
      'modules/general.json': module('general'),
      'modules/broken.json': 'not json at all',
    });
    const registry = createRegistry(bundle);

    expect(registry.modules().map((m) => m.manifest.id)).toEqual(['general']);
    expect(registry.issues()).toEqual([
      { code: 'REGISTRY_INVALID_MODULE_JSON', moduleId: 'modules/broken.json' },
    ]);
  });
});

describe('version selection', () => {
  it('picks the highest SemVer among candidates satisfying the compatibility profile', () => {
    const bundle = bundleOf({
      'modules/general-1.json': module('general', {
        version: '1.0.0',
        mihomo: { minVersion: '1.0.0', maxTestedVersion: '1.19.29' },
      }),
      'modules/general-2.json': module('general', {
        version: '1.2.0',
        mihomo: { minVersion: '1.0.0', maxTestedVersion: '1.19.29' },
      }),
      'modules/general-3-too-new.json': module('general', {
        version: '2.0.0',
        mihomo: { minVersion: '1.20.0' },
      }),
    });
    const registry = createRegistry(bundle, { compatibilityProfile: '1.19.29' });

    expect(registry.resolve('general')?.manifest.version).toBe('1.2.0');
    expect(registry.issues()).toEqual([]);
  });

  it('fails explicitly instead of silently falling back when no version satisfies the profile', () => {
    const bundle = bundleOf({
      'modules/general.json': module('general', { mihomo: { minVersion: '2.0.0' } }),
    });
    const registry = createRegistry(bundle, { compatibilityProfile: '1.19.29' });

    expect(registry.resolve('general')).toBeUndefined();
    expect(registry.issues()).toEqual([
      { code: 'REGISTRY_NO_MATCHING_VERSION', moduleId: 'general' },
    ]);
  });

  it('skips mihomo-version filtering entirely when no compatibility profile is given', () => {
    const bundle = bundleOf({
      'modules/general.json': module('general', { mihomo: { minVersion: '99.0.0' } }),
    });
    const registry = createRegistry(bundle);

    expect(registry.resolve('general')?.manifest.id).toBe('general');
    expect(registry.issues()).toEqual([]);
  });
});

describe('dependsOn (first real consumer of this field)', () => {
  it('resolves a satisfied dependency without any issue', () => {
    const bundle = bundleOf({
      'modules/a.json': module('a', { dependsOn: ['b'] }),
      'modules/b.json': module('b'),
    });
    const registry = createRegistry(bundle);

    expect(
      registry
        .modules()
        .map((m) => m.manifest.id)
        .sort(),
    ).toEqual(['a', 'b']);
    expect(registry.issues()).toEqual([]);
  });

  it('returns modules() in dependency-first order', () => {
    const bundle = bundleOf({
      'modules/a.json': module('a', { dependsOn: ['b'] }),
      'modules/b.json': module('b', { dependsOn: ['c'] }),
      'modules/c.json': module('c'),
    });
    const registry = createRegistry(bundle);
    const order = registry.modules().map((m) => m.manifest.id);

    expect(order.indexOf('c')).toBeLessThan(order.indexOf('b'));
    expect(order.indexOf('b')).toBeLessThan(order.indexOf('a'));
  });

  it('excludes a module whose dependency does not exist in the bundle, reporting it explicitly', () => {
    const bundle = bundleOf({ 'modules/a.json': module('a', { dependsOn: ['missing'] }) });
    const registry = createRegistry(bundle);

    expect(registry.modules()).toEqual([]);
    expect(registry.issues()).toEqual([{ code: 'REGISTRY_MISSING_DEPENDENCY', moduleId: 'a' }]);
  });

  it('transitively excludes a module that depends on something itself excluded', () => {
    const bundle = bundleOf({
      'modules/a.json': module('a', { dependsOn: ['b'] }),
      'modules/b.json': module('b', { dependsOn: ['missing'] }),
    });
    const registry = createRegistry(bundle);

    expect(registry.modules()).toEqual([]);
    const codes = registry
      .issues()
      .map((issue) => issue.moduleId)
      .sort();
    expect(codes).toEqual(['a', 'b']);
  });

  it('reports and excludes every module in a dependency cycle, without infinite looping', () => {
    const bundle = bundleOf({
      'modules/a.json': module('a', { dependsOn: ['b'] }),
      'modules/b.json': module('b', { dependsOn: ['a'] }),
      'modules/c.json': module('c'), // unrelated, unaffected
    });
    const registry = createRegistry(bundle);

    expect(registry.modules().map((m) => m.manifest.id)).toEqual(['c']);
    const cycleIssues = registry
      .issues()
      .filter((issue) => issue.code === 'REGISTRY_DEPENDENCY_CYCLE');
    expect(cycleIssues.map((issue) => issue.moduleId).sort()).toEqual(['a', 'b']);
  });
});

describe('NFR-SEC-03: issues never carry module content', () => {
  it('only ever reports a stable code and a structural module id, nothing from the parsed content', () => {
    const secret = 'super-secret-schema-content-should-never-leak';
    const bundle = bundleOf({
      'modules/broken.json': `{"manifest": {"id": "x", "root": [], "version": "1.0.0", "secretComment": "${secret}"`, // truncated JSON
    });
    const registry = createRegistry(bundle);

    expect(JSON.stringify(registry.issues())).not.toContain(secret);
  });
});
