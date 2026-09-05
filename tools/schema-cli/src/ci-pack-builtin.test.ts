import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { BUILTIN_MODULE_FILES } from '@mcs/schema-builtin';
import {
  checkFiles,
  checkNoUnstableFieldsForChannel,
  sha256Hex,
  type BundleChannel,
  type BundleFileEntry,
  type BundleManifest,
} from '@mcs/schema-registry';
import { describe, expect, it } from 'vitest';

/**
 * CI-only glue (v1.0.0 #10): `schema-release.yml`'s `build-unsigned` job runs
 * this via `pnpm exec vitest run`, not plain `node` — every package this
 * touches is an ADR-007 source export, and plain `node` cannot resolve the
 * `.js`-suffixed relative imports inside those `.ts` files
 * (`ERR_MODULE_NOT_FOUND`, confirmed empirically while executing this slice:
 * `node tools/schema-cli/dist/index.js check ...` fails the same way
 * `preview` already does). This is a different, still-open problem from the
 * `ERR_UNKNOWN_FILE_EXTENSION` one ADR-030's Node version bump fixed — that
 * one was about Node refusing to *parse* a `.ts` file at all; this one is
 * about a `.js` import specifier never resolving to a sibling `.ts` file
 * when there is no compiled output. Vitest's own transform pipeline handles
 * it; this file exists to be run *by* vitest, not to assert vitest-specific
 * behavior — same pattern `CONTRIBUTING.md`'s "Schema 预览" section already
 * documents for `preview.test.ts`.
 *
 * Reuses `BUILTIN_MODULE_FILES` directly rather than re-deriving modules
 * from the raw multi-file source tree under `packages/schema-builtin/
 * modules/<id>/`: `tools/schema-cli`'s own `pack`/`packDirectory` hashes
 * every file it finds under a source directory verbatim, which is correct
 * for a directory that already holds one assembled file per module, but
 * that raw source tree is not that — it is `@mcs/schema-builtin`'s own
 * seven-file-per-module *authoring* layout (ADR-020). Pointing `pack`
 * directly at it (as `schema-release.yml` did before this fix) hashes 96
 * scattered component files instead of 10 assembled modules; a client
 * installing that Bundle would find zero files shaped like a real
 * `SchemaModule` (`registry.ts`'s `isModuleShape` requires `.manifest`/
 * `.schema`/`.ui` together in one blob) and end up with zero usable
 * modules. The one already-tested, always-correct assembly of that source
 * layout into real `SchemaModule` objects is `@mcs/schema-builtin`'s own
 * `index.ts` — importing its output here avoids re-implementing that
 * assembly a second time (and getting it wrong for `rules`/`sub-rules`,
 * whose `schema`/`ui` are inline TS literals with no on-disk file to read
 * at all).
 */
describe('CI: pack the real built-in Bundle content (unsigned)', () => {
  it('assembles, static-checks, hashes, and writes an unsigned manifest + module files', async () => {
    const outDir = process.env.CI_PACK_OUT_DIR;
    if (!outDir) {
      // Not a CI invocation — e.g. a stray match under a broader `vitest run`
      // glob. No-op rather than fail; this file is also excluded from the
      // default suite (`vitest.config.ts`) so it should never get here.
      return;
    }

    const bundleId = requireEnv('CI_BUNDLE_ID');
    const version = requireEnv('CI_BUNDLE_VERSION');
    const channel = requireEnv('CI_BUNDLE_CHANNEL') as BundleChannel;
    const formatVersion = Number(requireEnv('CI_FORMAT_VERSION'));
    const requiresApp = requireEnv('CI_REQUIRES_APP');
    const mihomoMinVersion = requireEnv('CI_MIHOMO_MIN_VERSION');
    const mihomoMaxTestedVersion = requireEnv('CI_MIHOMO_MAX_TESTED_VERSION');
    const mihomoUpstreamCommit = requireEnv('CI_MIHOMO_UPSTREAM_COMMIT');
    const mihomoDocsSnapshot = requireEnv('CI_MIHOMO_DOCS_SNAPSHOT');

    // Flat, slash-free keys (`dns.json`, not `modules/dns.json`) —
    // deliberately different from `builtin.ts`'s own embedded manifest,
    // whose `files[].path` values are never fetched over HTTP so nesting
    // costs nothing there. This manifest's files *are* fetched, one at a
    // time, as `${fileBaseUrl}/${entry.path}` (`updater.ts`), and a GitHub
    // Release asset has no directory structure — an asset cannot be named
    // `modules/dns.json`. Flattening here is what keeps that URL join
    // pointing at a real, individually-downloadable asset.
    const jsonByPath = new Map<string, string>();
    for (const [path, module] of Object.entries(BUILTIN_MODULE_FILES)) {
      jsonByPath.set(basename(path), JSON.stringify(module));
    }

    const staticIssues = [
      ...checkFiles(jsonByPath),
      ...checkNoUnstableFieldsForChannel(jsonByPath, channel),
    ];
    expect(staticIssues).toEqual([]);

    const files: BundleFileEntry[] = [];
    for (const [path, text] of jsonByPath) {
      const sha256 = await sha256Hex(new TextEncoder().encode(text));
      files.push({ path, sha256 });
    }
    files.sort((a, b) => a.path.localeCompare(b.path));

    const manifest: BundleManifest = {
      bundleId,
      version,
      channel,
      formatVersion,
      requiresApp,
      mihomo: {
        minVersion: mihomoMinVersion,
        maxTestedVersion: mihomoMaxTestedVersion,
        upstreamCommit: mihomoUpstreamCommit,
        docsSnapshot: mihomoDocsSnapshot,
      },
      files,
      signature: '',
      signedAt: new Date().toISOString(),
    };

    mkdirSync(outDir, { recursive: true });
    for (const [path, text] of jsonByPath) {
      writeFileSync(join(outDir, path), text);
    }
    writeFileSync(join(outDir, 'unsigned-manifest.json'), JSON.stringify(manifest, null, 2));
  });
});

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}
