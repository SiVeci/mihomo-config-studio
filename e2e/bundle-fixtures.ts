import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  BUILTIN_MANIFEST,
  bytesToHex,
  canonicalManifestJson,
  sha256Hex,
  type BundleChannel,
  type BundleManifest,
} from '@mcs/schema-registry';
import type { Page } from '@playwright/test';

/**
 * The update-line E2E's own signing helper (v0.9.0 #8), added as a real
 * workspace member (`e2e/package.json`, `pnpm-workspace.yaml`) specifically
 * so it can depend on `@mcs/schema-registry` directly, rather than
 * reimplementing `canonicalManifestJson` — `verify.ts`'s own doc comment on
 * that function is explicit that the signer must use the exact same
 * function as the verifier, or a byte-level drift becomes an unexplainable
 * false-negative signature failure. Key generation itself is the one part
 * kept local (not imported from `apps/web/src/testing/signed-bundle.ts` /
 * `packages/schema-registry/src/testing/keys.ts`) — both of those already
 * establish the same precedent for it: every consumer of this pattern
 * defines its own copy, since it is a handful of lines with no shared
 * "one true implementation" concern the way canonical JSON serialization has.
 */
interface TestKeyPair {
  readonly publicKeyHex: string;
  sign(message: Uint8Array): Promise<Uint8Array>;
}

async function generateTestKeyPair(): Promise<TestKeyPair> {
  const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  if (!('publicKey' in pair) || !('privateKey' in pair)) {
    throw new Error('Ed25519 key generation did not return a key pair');
  }
  const { publicKey, privateKey } = pair;
  const publicKeyRaw = new Uint8Array(await crypto.subtle.exportKey('raw', publicKey));
  return {
    publicKeyHex: bytesToHex(publicKeyRaw),
    async sign(message: Uint8Array): Promise<Uint8Array> {
      const signature = await crypto.subtle.sign(
        { name: 'Ed25519' },
        privateKey,
        message as BufferSource,
      );
      return new Uint8Array(signature);
    },
  };
}

const TEST_MODULE_PATH = 'modules/e2e-test-module.json';
const TEST_MODULE_BYTES = new TextEncoder().encode(
  JSON.stringify({
    manifest: { id: 'e2e-test-module', root: [], version: '1.0.0' },
    schema: {},
    ui: {},
  }),
);

export interface SerializedBundle {
  readonly manifest: BundleManifest;
  /** Manifest file `path` -> base64-encoded bytes. */
  readonly files: Record<string, string>;
}

interface SignTestBundleOptions {
  readonly keyPair: TestKeyPair;
  readonly version: string;
  readonly requiresApp?: string;
  readonly channel?: BundleChannel;
}

async function signTestBundle(options: SignTestBundleOptions): Promise<SerializedBundle> {
  const unsigned: BundleManifest = {
    bundleId: 'e2e-test-bundle',
    version: options.version,
    channel: options.channel ?? 'stable',
    formatVersion: 1,
    requiresApp: options.requiresApp ?? '0.1.0',
    mihomo: {
      minVersion: '1.19.29',
      maxTestedVersion: '1.19.29',
      upstreamCommit: 'e26714a181ac0e2fa803453c0a8e9a9ce94e31cb',
      docsSnapshot: '2026-08-19',
    },
    files: [{ path: TEST_MODULE_PATH, sha256: await sha256Hex(TEST_MODULE_BYTES) }],
    signature: '',
    signedAt: '2026-08-30T00:00:00Z',
  };
  const message = new TextEncoder().encode(canonicalManifestJson(unsigned));
  const signature = await options.keyPair.sign(message);
  return {
    manifest: { ...unsigned, signature: bytesToHex(signature) },
    files: { [TEST_MODULE_PATH]: Buffer.from(TEST_MODULE_BYTES).toString('base64') },
  };
}

/**
 * Every fixture below must outrank the *real* built-in bundle's version, or
 * `planUpdate()` rejects it as `NOT_NEWER` before `handleCheckAndInstall`
 * ever calls `applyUpdate`/`installBundle` — the signature/app-version
 * rejections this file tests would never even be reached. Deriving these
 * from the real `BUILTIN_MANIFEST.version` (rather than hardcoding a
 * literal like `'0.6.0'`) is what keeps this file working across the next
 * bootstrap re-issue: `packages/schema-registry/src/builtin.ts`'s own doc
 * comment already documents this as a routinely-repeated event (~10 prior
 * instances as of v0.9.0 #17's own re-issue), and a hardcoded literal here
 * silently stops exercising the real rejection paths the moment the
 * built-in version catches up to it (confirmed: this exact fixture set is
 * what regressed when #13 bumped the built-in manifest from 0.5.0 to 0.9.0).
 */
function nextMinorVersion(base: string, bump: number): string {
  const [major, minor] = base.split('.').map(Number);
  return `${major}.${(minor ?? 0) + bump}.0`;
}

export interface BundleFixtureSet {
  readonly trustedPublicKeyHex: string;
  /** One minor version above the real built-in — the plain "install this" candidate (scenario 安装, and the first of two installs in 回滚). */
  readonly install: SerializedBundle;
  /** Two minor versions above the real built-in, newer than `install` — the second install in 回滚, so rolling back has `install` to land on. */
  readonly rollbackNext: SerializedBundle;
  /** One minor version above the real built-in, signed by a key never added to the trust anchor override — real `BUNDLE_SIGNATURE_INVALID` (scenario 签名失败). */
  readonly wrongSignature: SerializedBundle;
  /** One minor version above the real built-in, trusted signer, `requiresApp` far above `CURRENT_APP_VERSION` — real `BUNDLE_APP_TOO_OLD` (scenario 应用版本不足). */
  readonly appTooOld: SerializedBundle;
}

export async function generateBundleFixtureSet(): Promise<BundleFixtureSet> {
  const trusted = await generateTestKeyPair();
  const untrusted = await generateTestKeyPair();
  const installVersion = nextMinorVersion(BUILTIN_MANIFEST.version, 1);
  const rollbackNextVersion = nextMinorVersion(BUILTIN_MANIFEST.version, 2);
  const [install, rollbackNext, wrongSignature, appTooOld] = await Promise.all([
    signTestBundle({ keyPair: trusted, version: installVersion }),
    signTestBundle({ keyPair: trusted, version: rollbackNextVersion }),
    signTestBundle({ keyPair: untrusted, version: installVersion }),
    signTestBundle({ keyPair: trusted, version: installVersion, requiresApp: '99.0.0' }),
  ]);
  return {
    trustedPublicKeyHex: trusted.publicKeyHex,
    install,
    rollbackNext,
    wrongSignature,
    appTooOld,
  };
}

/**
 * Handed from `playwright.config.ts` (which generates the keypairs — it
 * alone needs the public half early enough to bake into
 * `MCS_TRUST_ANCHOR_OVERRIDES_JSON` before `vite build` runs) to the test
 * workers (separate OS processes, per Playwright's own process model — a
 * module-level singleton generated in the config process is simply absent
 * in a worker process, not shared) via a small generated file rather than
 * an env var: several KB of manifest + module bytes across four bundles is
 * more legible as JSON on disk than as one long serialized string.
 */
const GENERATED_DIR = path.join(process.cwd(), 'e2e', '.generated');
const FIXTURE_SET_PATH = path.join(GENERATED_DIR, 'bundle-fixtures.json');

function writeBundleFixtureSet(fixtures: BundleFixtureSet): void {
  mkdirSync(GENERATED_DIR, { recursive: true });
  writeFileSync(FIXTURE_SET_PATH, JSON.stringify(fixtures));
}

export function loadBundleFixtureSet(): BundleFixtureSet {
  return JSON.parse(readFileSync(FIXTURE_SET_PATH, 'utf8')) as BundleFixtureSet;
}

/**
 * `playwright.config.ts`'s `webServer.reuseExistingServer` (true outside
 * CI) can hand a test run a `vite preview` process built on a *previous*
 * run's trust anchor — regenerating a fresh keypair on every config load
 * would then mismatch the already-running server's baked-in
 * `MCS_TRUST_ANCHOR_OVERRIDES_JSON`, breaking the very scenarios that are
 * supposed to succeed. Reusing whatever is already on disk keeps repeated
 * local runs consistent with whichever build is actually serving; deleting
 * `e2e/.generated/` (or letting a fresh CI checkout start with none) is
 * what forces a real regeneration.
 */
export async function loadOrGenerateBundleFixtureSet(): Promise<BundleFixtureSet> {
  try {
    return loadBundleFixtureSet();
  } catch {
    const fixtures = await generateBundleFixtureSet();
    writeBundleFixtureSet(fixtures);
    return fixtures;
  }
}

/** Baked into `MCS_BUNDLE_UPDATE_SOURCES_JSON`'s `stable` entry by `playwright.config.ts`; `serveBundleAt` below intercepts every request under it. */
export const BUNDLE_SOURCE_BASE_PATH = '/e2e-bundle';

export interface BundleRouteHandle {
  /** Swaps which bundle the already-registered route serves — needed mid-test for 回滚 (install `install`, then re-point at `rollbackNext` before the second "check and install" click). */
  setBundle(bundle: SerializedBundle): void;
}

/**
 * Real, same-origin network requests (`fetchBundle`'s real `fetch`, CSP's
 * `connect-src 'self'` unaffected — Playwright intercepts after the browser
 * has already decided the request is allowed), just answered from an
 * in-memory fixture instead of a file `vite build` actually emitted. One
 * route registration per test; `setBundle` mutates a closure variable
 * rather than re-registering, since Playwright evaluates same-pattern route
 * handlers most-recently-added-first and a stale second registration would
 * be harder to reason about than a single mutable handler.
 */
export async function serveBundleAt(
  page: Page,
  initial: SerializedBundle,
): Promise<BundleRouteHandle> {
  let current = initial;
  await page.route(`**${BUNDLE_SOURCE_BASE_PATH}/**`, async (route) => {
    const url = new URL(route.request().url());
    const relativePath = url.pathname.slice(BUNDLE_SOURCE_BASE_PATH.length + 1);
    if (relativePath === 'manifest.json') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(current.manifest),
      });
      return;
    }
    const base64 = current.files[relativePath];
    if (base64 === undefined) {
      await route.fulfill({ status: 404, body: '' });
      return;
    }
    await route.fulfill({
      contentType: 'application/octet-stream',
      body: Buffer.from(base64, 'base64'),
    });
  });
  return {
    setBundle(bundle: SerializedBundle): void {
      current = bundle;
    },
  };
}
