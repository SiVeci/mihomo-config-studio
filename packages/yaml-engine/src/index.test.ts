import { describe, expect, it } from 'vitest';

import * as api from './index.js';

/**
 * The package entry point is the contract other packages compile against.
 * A missing re-export is a build break for every consumer, so assert it here.
 */
describe('public API surface', () => {
  it('exports the documented runtime members', () => {
    expect(Object.keys(api).sort()).toEqual([
      'DEFAULT_YAML_LIMITS',
      'MihomoYamlDocument',
      'YamlEngineError',
      'changedLineNumbers',
      'diffLines',
      'formatPath',
      'fromPointer',
      'isPathPrefix',
      'pathsEqual',
      'resolveLimits',
      'toPointer',
      'utf8ByteLength',
    ]);
  });

  it('parses and serialises through the entry point', () => {
    const { document } = api.MihomoYamlDocument.parse('mode: rule # keep me\n');
    expect(document?.toText()).toBe('mode: rule # keep me\n');
  });
});
