import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ModuleExample, SchemaModule } from '@mcs/schema-core';
import { BASIC_PROXY_TEMPLATE, BUILTIN_TEMPLATES } from '@mcs/templates';
import { MihomoYamlDocument } from '@mcs/yaml-engine';
import { applyMigration, loadMigrations, type SnapshotRecorder } from '@mcs/migration';

/** Injectable disk-read port: tests supply a fake, the real CLI (`index.ts`) supplies `readFileSync`. Kept synchronous — this is local repo content, never network. */
export type ReadTextFile = (path: string) => string;

/** `@mcs/templates`' own `templates/` directory, same relative-path reasoning `index.ts` previously carried (now centralised here, the corpus's own concern). */
export const TEMPLATES_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'packages',
  'templates',
  'templates',
);

/** `@mcs/schema-builtin`'s own `modules/` directory. `examples/*.yaml` are not part of that package's JS export (`packages/**` forbids `node:fs`), so this tool — like `schema-builtin/src/builtin.test.ts` — reaches them by relative path. */
export const SCHEMA_BUILTIN_MODULES_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'packages',
  'schema-builtin',
  'modules',
);

export type CorpusKind = 'template' | 'module-example' | 'migration';

/** One synthesised config text and what a real kernel is expected to do with it. */
export interface KernelTestCase {
  readonly id: string;
  readonly kind: CorpusKind;
  readonly configText: string;
  readonly expect: 'pass' | 'fail';
}

/**
 * `valid`/`edge` must be schema-valid, so a real kernel is expected to accept
 * them (`expect: 'pass'`). `invalid` is expected to be rejected. `unknown-fields`
 * is `'pass'`, verified rather than assumed (PRD §13.5 risk R8): mihomo's own
 * `common/yaml/yaml.go` (tag v1.19.29) is a thin wrapper over plain
 * `gopkg.in/yaml.v3` `Unmarshal` with no `KnownFields`/strict mode configured,
 * and the `common/structure` decoder it uses to build typed adapters
 * (proxies/groups/providers/...) out of the resulting `map[string]any` has no
 * `ErrorUnused` option at all — unused input keys are silently dropped
 * (`structure.go`'s `decodeMap`, verified at the same tag). Independently,
 * every one of this project's `unknown-fields` fixtures is itself a real,
 * documented Mihomo field this project's P0 schema deliberately excludes (see
 * each fixture's own header comment) — not a made-up key — so this is not a
 * decode-strictness edge case, it is a config the kernel is expected to fully
 * understand and accept. Verified against `MetaCubeX/mihomo` source at tag
 * v1.19.29, 2026-08-29.
 */
const EXAMPLE_KIND_EXPECTATION: Readonly<Record<ModuleExample['kind'], 'pass' | 'fail'>> = {
  valid: 'pass',
  edge: 'pass',
  invalid: 'fail',
  'unknown-fields': 'pass',
};

/**
 * How one module's example fragment (the parsed content of one of its
 * `examples/*.yaml` files) combines into a full document, keyed by structural
 * shape — the same per-module structural facts `schema-builtin/src/index.ts`
 * already documents in its own comments (`root: []` vs a single array/map
 * element vs a direct passthrough value), read here rather than re-derived
 * from the JSON Schema so a schema-shape refactor cannot silently change
 * kernel-matrix behaviour without a reviewer seeing this table too.
 */
type MergeStrategy =
  | { readonly type: 'spread-root' }
  | { readonly type: 'set-path' }
  | { readonly type: 'array-element' }
  | { readonly type: 'map-entry'; readonly syntheticKey: string };

const MERGE_STRATEGY: Readonly<Record<string, MergeStrategy>> = {
  general: { type: 'spread-root' },
  inbound: { type: 'spread-root' },
  dns: { type: 'set-path' },
  sniffer: { type: 'set-path' },
  rules: { type: 'set-path' },
  'sub-rules': { type: 'set-path' },
  proxies: { type: 'array-element' },
  'proxy-groups': { type: 'array-element' },
  'proxy-providers': { type: 'map-entry', syntheticKey: 'provider1' },
  'rule-providers': { type: 'map-entry', syntheticKey: 'rule1' },
};

function parseYamlValue(text: string, whatFor: string): unknown {
  const { document } = MihomoYamlDocument.parse(text);
  if (!document) {
    throw new Error(
      `${whatFor}: could not be parsed as YAML while building the kernel test corpus`,
    );
  }
  return document.toJS();
}

/**
 * The basic-proxy template plus a handful of extra, permanently-present
 * identifiers a few module examples reference by name (verified by scanning
 * every built-in module's `examples/*.yaml` for cross-references, 2026-08-29):
 * `proxy-groups/valid.yaml` lists member proxies `ss1`/`ss2`; `rules/valid.yaml`
 * and `sub-rules/valid.yaml` route to a proxy-group named `PROXY`; and
 * `rules/valid.yaml`'s `RULE-SET,cn-domain,DIRECT` needs a rule-provider named
 * `cn-domain`. These three additions are harmless for every other module's
 * cases (each overlay only ever replaces the specific key(s) the module under
 * test owns) and let each module's example be tested in true isolation
 * without per-module conditional skeleton logic.
 */
function buildBaselineSkeleton(basicProxyConfigText: string): MihomoYamlDocument {
  const { document } = MihomoYamlDocument.parse(basicProxyConfigText);
  if (!document) {
    throw new Error(
      'the basic-proxy template failed to parse while building the kernel test corpus baseline',
    );
  }
  document.appendIn(['proxies'], {
    name: 'ss1',
    type: 'ss',
    server: 'ss1.example.com',
    port: 8388,
    cipher: 'aes-128-gcm',
    password: 'CHANGE_ME',
  });
  document.appendIn(['proxies'], {
    name: 'ss2',
    type: 'ss',
    server: 'ss2.example.com',
    port: 8388,
    cipher: 'aes-128-gcm',
    password: 'CHANGE_ME',
  });
  document.setIn(
    ['proxy-groups'],
    [{ name: 'PROXY', type: 'select', proxies: ['my-server-1', 'my-server-2', 'ss1', 'ss2'] }],
  );
  document.setIn(['rule-providers'], {
    'cn-domain': {
      type: 'http',
      behavior: 'domain',
      format: 'yaml',
      url: 'https://example.com/rules/cn-domain.yaml',
      interval: 259200,
      path: './rule-providers/cn-domain.yaml',
    },
  });
  return document;
}

/** Overlays one module's example fragment onto a (mutable) baseline document, per its `MergeStrategy`. Returns the same document instance for convenience. */
function overlayExample(
  base: MihomoYamlDocument,
  module: SchemaModule,
  fragmentValue: unknown,
): MihomoYamlDocument {
  const strategy = MERGE_STRATEGY[module.manifest.id];
  if (!strategy) {
    throw new Error(
      `module "${module.manifest.id}" has no registered corpus merge strategy — add one to MERGE_STRATEGY`,
    );
  }

  switch (strategy.type) {
    case 'spread-root': {
      if (
        typeof fragmentValue !== 'object' ||
        fragmentValue === null ||
        Array.isArray(fragmentValue)
      ) {
        throw new Error(
          `module "${module.manifest.id}" (root: []) example fragment must be a map to spread at the document root`,
        );
      }
      for (const [key, value] of Object.entries(fragmentValue as Record<string, unknown>)) {
        base.setIn([key], value);
      }
      return base;
    }
    case 'set-path':
      base.setIn(module.manifest.root, fragmentValue);
      return base;
    case 'array-element':
      base.setIn(module.manifest.root, [fragmentValue]);
      return base;
    case 'map-entry':
      base.setIn(module.manifest.root, { [strategy.syntheticKey]: fragmentValue });
      return base;
  }
}

export function buildTemplateCases(readTextFile: ReadTextFile): KernelTestCase[] {
  return BUILTIN_TEMPLATES.map((template) => ({
    id: `template:${template.id}`,
    kind: 'template' as const,
    configText: readTextFile(join(TEMPLATES_ROOT, template.configPath)),
    expect: 'pass' as const,
  }));
}

export function buildModuleExampleCases(
  readTextFile: ReadTextFile,
  modules: readonly SchemaModule[],
  basicProxyConfigText: string,
): KernelTestCase[] {
  const cases: KernelTestCase[] = [];
  for (const module of modules) {
    for (const example of module.examples ?? []) {
      const examplePath = join(SCHEMA_BUILTIN_MODULES_ROOT, module.manifest.id, example.path);
      const exampleText = readTextFile(examplePath);
      const fragmentValue = parseYamlValue(exampleText, examplePath);
      const document = overlayExample(
        buildBaselineSkeleton(basicProxyConfigText),
        module,
        fragmentValue,
      );
      cases.push({
        id: `module-example:${module.manifest.id}:${example.kind}`,
        kind: 'module-example',
        configText: document.toText(),
        expect: EXAMPLE_KIND_EXPECTATION[example.kind],
      });
    }
  }
  return cases;
}

/**
 * Real migration products, per built-in module (PRD §13.3's "迁移结果").
 * Structurally real — this calls the same `loadMigrations`/`applyMigration`
 * a live upgrade flow uses — but produces zero cases today: every built-in
 * module is still at its first-ever version (`module.manifest.version:
 * "1.0.0"`, none declares a `migrations` array), so there is no real
 * migration product yet to run through the kernel. Recorded honestly rather
 * than fabricated (v0.9.0 plan #2's explicit instruction not to invent a fake
 * migration contract to pad this category) — `corpus.test.ts` proves this
 * function's own logic against a synthetic module instead. The first real
 * module version bump automatically starts contributing cases here, with no
 * further code change.
 */
export async function buildMigrationCases(
  modules: readonly SchemaModule[],
  basicProxyConfigText: string,
): Promise<KernelTestCase[]> {
  const noopSnapshots: SnapshotRecorder = {
    record: () =>
      Promise.resolve({ level: 'normal', messageKey: 'core-test-runner.noop', retainedCount: 0 }),
  };
  const cases: KernelTestCase[] = [];
  for (const module of modules) {
    const loaded = loadMigrations(module);
    if (!loaded.ok || loaded.plans.length === 0) continue;
    for (const plan of loaded.plans) {
      const { document } = MihomoYamlDocument.parse(basicProxyConfigText);
      if (!document) {
        throw new Error(
          'the basic-proxy template failed to parse while building a migration corpus case',
        );
      }
      const result = await applyMigration(plan, document, {
        snapshots: noopSnapshots,
        moduleRoot: module.manifest.root,
      });
      if (!result.ok) {
        throw new Error(
          `migration ${plan.from} -> ${plan.to} for module "${module.manifest.id}" failed to apply (${result.code}) while building the kernel test corpus`,
        );
      }
      cases.push({
        id: `migration:${module.manifest.id}:${plan.from}->${plan.to}`,
        kind: 'migration',
        configText: result.document.toText(),
        expect: 'pass',
      });
    }
  }
  return cases;
}

export async function buildCorpus(
  readTextFile: ReadTextFile,
  modules: readonly SchemaModule[],
): Promise<KernelTestCase[]> {
  const basicProxyConfigText = readTextFile(join(TEMPLATES_ROOT, BASIC_PROXY_TEMPLATE.configPath));
  const templateCases = buildTemplateCases(readTextFile);
  const exampleCases = buildModuleExampleCases(readTextFile, modules, basicProxyConfigText);
  const migrationCases = await buildMigrationCases(modules, basicProxyConfigText);
  return [...templateCases, ...exampleCases, ...migrationCases];
}
