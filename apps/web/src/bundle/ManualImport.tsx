import {
  checkFiles,
  installUntrustedBundle,
  type BundleInstallErrorCode,
  type BundleStore,
  type StaticCheckIssueCode,
} from '@mcs/schema-registry';
import { useState, type ReactNode } from 'react';

import { t, type TranslationKey } from '../i18n/index.js';
import { resolvePlatformFileService } from '../platform/index.js';
import type { OpenDocumentOptions, OpenDocumentOutcome } from '../platform/index.js';
import { CURRENT_APP_VERSION, MAX_FORMAT_VERSION, MIN_FORMAT_VERSION } from './verify-options.js';
import './ManualImport.css';

type OpenDocument = (options: OpenDocumentOptions) => Promise<OpenDocumentOutcome>;

async function defaultOpenDocument(options: OpenDocumentOptions): Promise<OpenDocumentOutcome> {
  return resolvePlatformFileService().openDocument(options);
}

const IMPORT_ACCEPT_EXTENSIONS = ['.json'];

export interface ManualImportProps {
  readonly store: BundleStore;
  /** Called after a successful import so the caller can refresh whatever it displays (`BundlePage`'s own `refresh`). */
  readonly onImported: () => void;
  /** Test-only override; production code leaves this unset so it resolves through the real platform port (ADR-026), same as `ImportPanel`. */
  readonly openDocument?: OpenDocument;
}

type ImportErrorCode = BundleInstallErrorCode | StaticCheckIssueCode;

type Outcome =
  | { readonly kind: 'success' }
  | { readonly kind: 'invalid-container' }
  | { readonly kind: 'error'; readonly code: ImportErrorCode; readonly path: string };

/**
 * A manually-imported community Bundle is one JSON text file — not the
 * manifest-plus-separately-fetched-files shape `updater.ts`'s `fetchBundle`
 * uses, because `PlatformFileService.openDocument` (ADR-026, the same
 * cross-platform Web/Android port `ImportPanel.tsx` already uses) only ever
 * returns one file's text at a time. Everything a Bundle needs — the
 * manifest and every module file's content — is already JSON-shaped, so a
 * single container document loses nothing a multi-file picker would have
 * given.
 */
interface ImportContainer {
  readonly manifest: unknown;
  readonly files: Record<string, string>;
}

function isImportContainer(value: unknown): value is ImportContainer {
  if (value === null || typeof value !== 'object') return false;
  const { manifest, files } = value as Record<string, unknown>;
  return (
    manifest !== undefined &&
    manifest !== null &&
    files !== null &&
    typeof files === 'object' &&
    !Array.isArray(files)
  );
}

// Codes `BundlePage.tsx`'s own install flow can already produce reuse its
// existing `bundle.error.*` translation — the same failure means the same
// thing regardless of which flow hit it, so this never introduces a second,
// independently-driftable copy of that wording. Only codes unique to this
// flow (the Stable-channel hard block, and every `checkFiles` static-check
// code, which never had UI-facing text before — `schema-cli` only ever
// printed them to a console) get a new `manualImport.error.*` key.
const REUSES_BUNDLE_ERROR_NAMESPACE: ReadonlySet<ImportErrorCode> = new Set([
  'BUNDLE_MANIFEST_MISSING_FIELD',
  'BUNDLE_MANIFEST_INVALID_TYPE',
  'BUNDLE_FORMAT_UNSUPPORTED',
  'BUNDLE_APP_TOO_OLD',
  'BUNDLE_HASH_MISMATCH',
]);

const KNOWN_MANUAL_IMPORT_ERROR_CODES: ReadonlySet<ImportErrorCode> = new Set([
  'BUNDLE_UNTRUSTED_STABLE_CHANNEL',
  'SCHEMA_CLI_DISALLOWED_EXTENSION',
  'SCHEMA_CLI_INVALID_JSON',
  'SCHEMA_CLI_EXECUTABLE_CONTENT',
  'SCHEMA_CLI_UNKNOWN_MIGRATION_OPCODE',
  'SCHEMA_CLI_UNSTABLE_FIELD_IN_STABLE_CHANNEL',
]);

function errorMessageKey(code: ImportErrorCode): TranslationKey {
  if (REUSES_BUNDLE_ERROR_NAMESPACE.has(code)) return `bundle.error.${code}` as TranslationKey;
  if (KNOWN_MANUAL_IMPORT_ERROR_CODES.has(code)) {
    return `manualImport.error.${code}` as TranslationKey;
  }
  return 'bundle.error.unknown';
}

/**
 * FR-UPD-09 (v0.9.0 #17): lets a user install a community Bundle this app
 * never fetched from a configured update source. "Untrusted" names exactly
 * one gap — nobody vouched for who signed it — not a general safety
 * downgrade: every other check `installBundle` runs (shape, format version,
 * app-version compatibility, per-file hash) still applies unchanged here,
 * plus the same static content check `schema-cli` runs at pack time
 * (`checkFiles`, relocated to `@mcs/schema-registry` this same slice so the
 * browser can run it too). A Stable-channel manifest is hard-rejected by
 * `installUntrustedBundle` itself, regardless of what it claims about
 * itself — this component never re-implements that boundary.
 */
export function ManualImport({
  store,
  onImported,
  openDocument = defaultOpenDocument,
}: ManualImportProps): ReactNode {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | undefined>(undefined);

  async function handleImportClick(): Promise<void> {
    const picked = await openDocument({ acceptExtensions: IMPORT_ACCEPT_EXTENSIONS });
    if (picked.kind !== 'opened') return;

    setBusy(true);
    setOutcome(undefined);
    try {
      let parsed: unknown;
      try {
        parsed = JSON.parse(picked.text);
      } catch {
        setOutcome({ kind: 'invalid-container' });
        return;
      }
      if (!isImportContainer(parsed)) {
        setOutcome({ kind: 'invalid-container' });
        return;
      }

      const fileTexts = new Map(Object.entries(parsed.files));
      const staticIssues = checkFiles(fileTexts);
      const [firstStaticIssue] = staticIssues;
      if (firstStaticIssue) {
        setOutcome({ kind: 'error', code: firstStaticIssue.code, path: firstStaticIssue.path });
        return;
      }

      const fileBytes = new Map(
        [...fileTexts].map(([path, text]) => [path, new TextEncoder().encode(text)] as const),
      );
      const result = await installUntrustedBundle(store, parsed.manifest, fileBytes, {
        currentAppVersion: CURRENT_APP_VERSION,
        minFormatVersion: MIN_FORMAT_VERSION,
        maxFormatVersion: MAX_FORMAT_VERSION,
      });
      if (!result.ok) {
        setOutcome({ kind: 'error', code: result.code, path: result.path });
        return;
      }
      setOutcome({ kind: 'success' });
      onImported();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="manual-import" aria-labelledby="manual-import-heading">
      <h2 id="manual-import-heading">{t('manualImport.heading')}</h2>
      <p className="manual-import__description">{t('manualImport.description')}</p>
      <button
        type="button"
        className="manual-import__button"
        disabled={busy}
        onClick={() => void handleImportClick()}
      >
        {busy ? t('manualImport.importing') : t('manualImport.fileButton')}
      </button>
      {outcome && (
        <p role="status" className="manual-import__outcome">
          {outcome.kind === 'success' && t('manualImport.successMessage')}
          {outcome.kind === 'invalid-container' && t('manualImport.invalidContainer')}
          {outcome.kind === 'error' &&
            `${t(errorMessageKey(outcome.code))} ${t('bundle.error.path', { path: outcome.path })}`}
        </p>
      )}
    </section>
  );
}
