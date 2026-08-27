import { readFixture } from '@mcs/test-fixtures';
import { describe, expect, it } from 'vitest';

import {
  describeSensitivity,
  MCSPROJ_FORMAT_VERSION,
  readMcsproj,
  writeMcsproj,
} from './mcsproj.js';
import type { McsProject } from './mcsproj.js';
import { ProjectFormatError, writeZip } from './zip.js';

function sampleProject(overrides: Partial<McsProject> = {}): McsProject {
  return {
    manifest: {
      formatVersion: MCSPROJ_FORMAT_VERSION,
      id: 'a1b2c3',
      name: 'My Project',
      description: 'A test project',
      targetProfile: 'v1.19.29',
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-02T00:00:00.000Z',
    },
    configText: 'mode: rule\nport: 7890\n',
    uiState: { collapsedGroups: ['proxies'], selectedEntityId: 'e1' },
    schemaLock: { bundleVersion: '1.0.0', compatibilityProfile: 'v1.19.29' },
    quarantine: { fields: [] },
    ...overrides,
  };
}

describe('writeMcsproj / readMcsproj round-trip', () => {
  it('round-trips manifest, uiState and schemaLock exactly', async () => {
    const project = sampleProject();

    const read = await readMcsproj(await writeMcsproj(project));

    expect(read).toEqual(project);
  });

  it('round-trips config.yaml byte for byte using a real golden fixture, without re-serialising it', async () => {
    const configText = readFixture('yaml/comprehensive.yaml');
    const project = sampleProject({ configText });

    const read = await readMcsproj(await writeMcsproj(project));

    expect(read.configText).toBe(configText);
  });

  it('round-trips an empty uiState bag', async () => {
    const project = sampleProject({ uiState: {} });

    const read = await readMcsproj(await writeMcsproj(project));

    expect(read.uiState).toEqual({});
  });

  it('round-trips quarantined fields exactly, including a non-primitive value (v0.5.0 #9)', async () => {
    const project = sampleProject({
      quarantine: {
        fields: [
          {
            path: 'dns.legacy-opt',
            value: { nested: ['a', 'b'], count: 2 },
            moduleId: 'dns',
            quarantinedAt: '2026-08-27T00:00:00.000Z',
          },
        ],
      },
    });

    const read = await readMcsproj(await writeMcsproj(project));

    expect(read.quarantine).toEqual(project.quarantine);
  });

  it('defaults quarantine to an empty list when reading a .mcsproj exported before v0.5.0 #9', async () => {
    const encoder = new TextEncoder();
    const project = sampleProject();
    // Manually built without quarantine.json — simulates every .mcsproj
    // exported by an earlier version of the app.
    const archive = await writeZip([
      { path: 'manifest.json', data: encoder.encode(JSON.stringify(project.manifest)) },
      { path: 'config.yaml', data: encoder.encode(project.configText) },
      { path: 'ui-state.json', data: encoder.encode(JSON.stringify(project.uiState)) },
      { path: 'schema-lock.json', data: encoder.encode(JSON.stringify(project.schemaLock)) },
    ]);

    const read = await readMcsproj(archive);

    expect(read.quarantine).toEqual({ fields: [] });
  });
});

describe('writeMcsproj determinism (decision D2)', () => {
  it('produces byte-identical output for the same project across two calls', async () => {
    const project = sampleProject();

    const first = await writeMcsproj(project);
    const second = await writeMcsproj(project);

    expect(first).toEqual(second);
  });

  it('produces byte-identical output regardless of the uiState object key insertion order', async () => {
    const inOrder = sampleProject({ uiState: { a: 1, b: 2, c: { x: 1, y: 2 } } });
    const reversed = sampleProject({ uiState: { c: { y: 2, x: 1 }, b: 2, a: 1 } });

    expect(await writeMcsproj(inOrder)).toEqual(await writeMcsproj(reversed));
  });
});

describe('readMcsproj error handling', () => {
  it('rejects a container missing config.yaml with a typed error', async () => {
    const archive = await writeZip([
      { path: 'manifest.json', data: new TextEncoder().encode('{}') },
    ]);

    await expect(readMcsproj(archive)).rejects.toMatchObject({
      code: 'PROJECT_FORMAT_MISSING_ENTRY',
    });
  });

  it('rejects a container that has config.yaml but is missing ui-state.json', async () => {
    const encoder = new TextEncoder();
    const archive = await writeZip([
      { path: 'manifest.json', data: encoder.encode(JSON.stringify(sampleProject().manifest)) },
      { path: 'config.yaml', data: encoder.encode('mode: rule\n') },
      {
        path: 'schema-lock.json',
        data: encoder.encode('{"bundleVersion":"1.0.0","compatibilityProfile":"v1"}'),
      },
    ]);

    await expect(readMcsproj(archive)).rejects.toMatchObject({
      code: 'PROJECT_FORMAT_MISSING_ENTRY',
    });
  });

  it('rejects a container whose manifest.json is not valid JSON', async () => {
    const encoder = new TextEncoder();
    const archive = await writeZip([
      { path: 'manifest.json', data: encoder.encode('{not json') },
      { path: 'config.yaml', data: encoder.encode('mode: rule\n') },
      { path: 'ui-state.json', data: encoder.encode('{}') },
      { path: 'schema-lock.json', data: encoder.encode('{}') },
    ]);

    await expect(readMcsproj(archive)).rejects.toMatchObject({
      code: 'PROJECT_FORMAT_INVALID_JSON',
    });
  });

  it('rejects a manifest.json missing a required field', async () => {
    const encoder = new TextEncoder();
    const archive = await writeZip([
      { path: 'manifest.json', data: encoder.encode('{"formatVersion":1,"id":"a"}') },
      { path: 'config.yaml', data: encoder.encode('mode: rule\n') },
      { path: 'ui-state.json', data: encoder.encode('{}') },
      {
        path: 'schema-lock.json',
        data: encoder.encode('{"bundleVersion":"1.0.0","compatibilityProfile":"v1"}'),
      },
    ]);

    await expect(readMcsproj(archive)).rejects.toMatchObject({
      code: 'PROJECT_FORMAT_INVALID_MANIFEST',
    });
  });

  it('propagates a corrupted ZIP as a ProjectFormatError rather than a native error', async () => {
    await expect(readMcsproj(new TextEncoder().encode('not a zip'))).rejects.toBeInstanceOf(
      ProjectFormatError,
    );
  });

  it('rejects a manifest.json field with the wrong type', async () => {
    const encoder = new TextEncoder();
    const archive = await writeZip([
      {
        path: 'manifest.json',
        data: encoder.encode(
          '{"formatVersion":"one","id":"a","name":"n","description":"d","targetProfile":"p","createdAt":"c","updatedAt":"u"}',
        ),
      },
      { path: 'config.yaml', data: encoder.encode('mode: rule\n') },
      { path: 'ui-state.json', data: encoder.encode('{}') },
      {
        path: 'schema-lock.json',
        data: encoder.encode('{"bundleVersion":"1.0.0","compatibilityProfile":"v1"}'),
      },
    ]);

    await expect(readMcsproj(archive)).rejects.toMatchObject({
      code: 'PROJECT_FORMAT_INVALID_MANIFEST',
    });
  });

  it('rejects a manifest.json that is not a JSON object', async () => {
    const encoder = new TextEncoder();
    const archive = await writeZip([
      { path: 'manifest.json', data: encoder.encode('"just a string"') },
      { path: 'config.yaml', data: encoder.encode('mode: rule\n') },
      { path: 'ui-state.json', data: encoder.encode('{}') },
      {
        path: 'schema-lock.json',
        data: encoder.encode('{"bundleVersion":"1.0.0","compatibilityProfile":"v1"}'),
      },
    ]);

    await expect(readMcsproj(archive)).rejects.toMatchObject({
      code: 'PROJECT_FORMAT_INVALID_MANIFEST',
    });
  });

  it('rejects a schema-lock.json that is not a JSON object', async () => {
    const encoder = new TextEncoder();
    const archive = await writeZip([
      { path: 'manifest.json', data: encoder.encode(JSON.stringify(sampleProject().manifest)) },
      { path: 'config.yaml', data: encoder.encode('mode: rule\n') },
      { path: 'ui-state.json', data: encoder.encode('{}') },
      { path: 'schema-lock.json', data: encoder.encode('null') },
    ]);

    await expect(readMcsproj(archive)).rejects.toMatchObject({
      code: 'PROJECT_FORMAT_INVALID_MANIFEST',
    });
  });

  it('rejects a ui-state.json that is an array instead of an object', async () => {
    const encoder = new TextEncoder();
    const archive = await writeZip([
      { path: 'manifest.json', data: encoder.encode(JSON.stringify(sampleProject().manifest)) },
      { path: 'config.yaml', data: encoder.encode('mode: rule\n') },
      { path: 'ui-state.json', data: encoder.encode('[1,2,3]') },
      {
        path: 'schema-lock.json',
        data: encoder.encode('{"bundleVersion":"1.0.0","compatibilityProfile":"v1"}'),
      },
    ]);

    await expect(readMcsproj(archive)).rejects.toMatchObject({
      code: 'PROJECT_FORMAT_INVALID_MANIFEST',
    });
  });

  function archiveWithQuarantine(quarantineJson: string): Promise<Uint8Array> {
    const encoder = new TextEncoder();
    const project = sampleProject();
    return writeZip([
      { path: 'manifest.json', data: encoder.encode(JSON.stringify(project.manifest)) },
      { path: 'config.yaml', data: encoder.encode(project.configText) },
      { path: 'ui-state.json', data: encoder.encode(JSON.stringify(project.uiState)) },
      { path: 'schema-lock.json', data: encoder.encode(JSON.stringify(project.schemaLock)) },
      { path: 'quarantine.json', data: encoder.encode(quarantineJson) },
    ]);
  }

  it('rejects a quarantine.json that is not a JSON object', async () => {
    const archive = await archiveWithQuarantine('[1,2,3]');

    await expect(readMcsproj(archive)).rejects.toMatchObject({
      code: 'PROJECT_FORMAT_INVALID_MANIFEST',
    });
  });

  it('rejects a quarantine.json whose fields is not an array', async () => {
    const archive = await archiveWithQuarantine('{"fields":"nope"}');

    await expect(readMcsproj(archive)).rejects.toMatchObject({
      code: 'PROJECT_FORMAT_INVALID_MANIFEST',
    });
  });

  it('rejects a quarantined field missing a required string field', async () => {
    const archive = await archiveWithQuarantine(
      '{"fields":[{"path":"a","value":1,"moduleId":"dns"}]}',
    );

    await expect(readMcsproj(archive)).rejects.toMatchObject({
      code: 'PROJECT_FORMAT_INVALID_MANIFEST',
    });
  });
});

describe('describeSensitivity (NFR-SEC-08 determination side)', () => {
  it('returns no findings for a config with none of the four categories', async () => {
    const project = sampleProject({ configText: 'mode: rule\nport: 7890\n' });

    expect(describeSensitivity(project)).toEqual([]);
  });

  it('flags password, uuid and subscription-url in a realistic config (golden fixture)', () => {
    const project = sampleProject({ configText: readFixture('yaml/comprehensive.yaml') });

    const findings = describeSensitivity(project);

    expect(findings).toContainEqual({ segment: 'config.yaml', kind: 'password' });
    expect(findings).toContainEqual({ segment: 'config.yaml', kind: 'uuid' });
    expect(findings).toContainEqual({ segment: 'config.yaml', kind: 'subscription-url' });
  });

  it('flags a PEM private-key block', () => {
    const project = sampleProject({
      configText:
        'tls:\n  private-key: |\n    -----BEGIN PRIVATE KEY-----\n    abcd\n    -----END PRIVATE KEY-----\n',
    });

    expect(describeSensitivity(project)).toContainEqual({
      segment: 'config.yaml',
      kind: 'private-key',
    });
  });

  it('flags a sensitive key that is the first key of a YAML list item, right after "- "', () => {
    // Realistic shape for `proxies:` entries — the key immediately follows
    // the list marker on the same line, not indented on its own line.
    const project = sampleProject({ configText: 'proxies:\n  - password: hunter2\n' });

    expect(describeSensitivity(project)).toContainEqual({
      segment: 'config.yaml',
      kind: 'password',
    });
  });

  it('never includes the matched secret value anywhere in the findings', () => {
    const secretToken = 'sk-live-do-not-leak-this-value';
    const project = sampleProject({ configText: `proxies:\n  - token: ${secretToken}\n` });

    const findings = describeSensitivity(project);

    expect(JSON.stringify(findings)).not.toContain(secretToken);
  });
});
