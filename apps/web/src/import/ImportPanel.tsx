import { useEffect, useState, type DragEvent, type ReactNode } from 'react';

import { t } from '../i18n/index.js';
import { resolvePlatformFileService } from '../platform/index.js';
import type { OpenDocumentOptions, OpenDocumentOutcome } from '../platform/index.js';
import type { IncomingDocument } from '../platform/incoming-document.js';
import { hasBlockingIssues } from '../worker/protocol.js';
import type { ParseResponse, PreviewProviderResponse } from '../worker/protocol.js';
import './ImportPanel.css';

/**
 * The narrow slice of `WorkerClient` this panel needs — a plain interface
 * rather than the concrete class, so tests can supply a trivial fake instead
 * of constructing a real (or fake) Worker.
 */
export interface ImportWorkerClient {
  parse(text: string): Promise<ParseResponse>;
  previewProvider(text: string): Promise<PreviewProviderResponse>;
}

type OpenDocument = (options: OpenDocumentOptions) => Promise<OpenDocumentOutcome>;

async function defaultOpenDocument(options: OpenDocumentOptions): Promise<OpenDocumentOutcome> {
  return resolvePlatformFileService().openDocument(options);
}

const YAML_ACCEPT_EXTENSIONS = ['.yaml', '.yml'];

export interface ImportPanelProps {
  readonly client: ImportWorkerClient;
  /** Called with the raw text once it has parsed without a blocking issue. */
  readonly onImport: (text: string) => void;
  /** Test-only override; production code leaves this unset so both file buttons resolve through the real platform port (`resolvePlatformFileService`, ADR-026). */
  readonly openDocument?: OpenDocument;
  /** FR-AND-07 (v0.6.0 #13): a document received via Android's share sheet while this panel was not mounted (or already consumed) — `undefined`/`null` when there is none pending. Owned by `ProjectPage`, not this component, because a share can arrive before any project is open. */
  readonly pendingIncomingDocument?: IncomingDocument | null;
  /** Called once a pending incoming document has been handed to `attemptImport`, so `ProjectPage` clears it and the same share does not replay on the next render. */
  readonly onIncomingDocumentConsumed?: () => void;
}

type Status = 'idle' | 'success' | 'error';
type ProviderPreviewStatus = 'idle' | 'success' | 'error';

/**
 * Three entry points for FR-YAML-01: the platform file picker (ADR-026's
 * `PlatformFileService.openDocument` — `<input type=file>` on Web,
 * Android's SAF picker from v0.6.0 #3 on), drag-and-drop, and a plain paste
 * box. Every path only ever *reads* the source and hands the text to the
 * Worker for parsing (#10) — there is no code path anywhere here that
 * requests a writable file handle or otherwise touches the original file,
 * which is what makes NFR-REL-04 (never overwrite the imported file) true
 * by construction rather than by a runtime check. The structural test in
 * `ImportPanel.test.tsx` asserts this file never mentions a write-capable
 * File System Access API, so a future edit that adds one cannot land
 * silently. Drag-and-drop keeps using `File.text()` directly — it is a
 * Web-only affordance (no Android drag source), harmless to leave as plain
 * DOM rather than routing through the port too.
 *
 * A fourth, unrelated entry point lives here too (PRD §8.11, ADR-005,
 * v0.3.0 #17): local Provider file preview. It shares this file because it
 * shares the exact same read-only path and the same NFR-REL-04
 * guarantee — but it never calls `onImport`, so a previewed Provider file
 * can never end up merged into the open project by accident. ADR-005 also
 * means this file must never gain a network request of its own for either
 * feature; `ImportPanel.test.tsx` has a matching structural scan for that.
 *
 * `pendingIncomingDocument` (FR-AND-07, v0.6.0 #13) is a fifth way text
 * reaches `attemptImport`, not a fifth independent path: Android's share
 * sheet is a *trigger*, not a new source, so it is fed through the exact
 * same function the paste box uses rather than duplicating the validate-
 * then-`onImport` logic a second time.
 */
export function ImportPanel({
  client,
  onImport,
  openDocument = defaultOpenDocument,
  pendingIncomingDocument,
  onIncomingDocumentConsumed,
}: ImportPanelProps): ReactNode {
  const [pasteText, setPasteText] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [providerPreviewStatus, setProviderPreviewStatus] = useState<ProviderPreviewStatus>('idle');
  const [providerPreview, setProviderPreview] = useState<PreviewProviderResponse['preview']>(null);

  async function attemptImport(text: string): Promise<void> {
    const response = await client.parse(text);
    if (hasBlockingIssues(response.issues)) {
      setStatus('error');
      return;
    }
    setStatus('success');
    setPasteText('');
    onImport(text);
  }

  // FR-AND-07 (v0.6.0 #13): a share intent reuses this exact same
  // attemptImport() — the same validation gate the file-open and
  // drag-and-drop entries already go through, not a parallel bypass.
  useEffect(() => {
    if (!pendingIncomingDocument) return;
    void attemptImport(pendingIncomingDocument.text).then(() => onIncomingDocumentConsumed?.());
    // Depends only on the document itself: ProjectPage hands this a fresh
    // object per real share, so this fires exactly once per share, not on
    // every unrelated re-render.
  }, [pendingIncomingDocument]);

  async function handleFile(file: File): Promise<void> {
    const text = await file.text();
    await attemptImport(text);
  }

  async function handleOpenFileClick(): Promise<void> {
    const outcome = await openDocument({ acceptExtensions: YAML_ACCEPT_EXTENSIONS });
    if (outcome.kind === 'opened') {
      await attemptImport(outcome.text);
    }
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault(); // required for the browser to allow a drop at all
  }

  function handleDrop(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file) void handleFile(file);
  }

  async function handleProviderPreview(text: string): Promise<void> {
    setProviderPreview(null);
    setProviderPreviewStatus('idle');
    const { preview } = await client.previewProvider(text);
    setProviderPreview(preview);
    setProviderPreviewStatus(preview ? 'success' : 'error');
  }

  async function handleOpenProviderFileClick(): Promise<void> {
    const outcome = await openDocument({ acceptExtensions: YAML_ACCEPT_EXTENSIONS });
    if (outcome.kind === 'opened') {
      await handleProviderPreview(outcome.text);
    }
  }

  return (
    <section className="import-panel" aria-label={t('import.title')}>
      <h2 className="import-panel__title">{t('import.title')}</h2>

      <div className="import-panel__dropzone" onDragOver={handleDragOver} onDrop={handleDrop}>
        <p className="import-panel__drop-hint">{t('import.dropHint')}</p>
        <button
          type="button"
          className="import-panel__file-button"
          onClick={() => void handleOpenFileClick()}
        >
          {t('import.fileButton')}
        </button>
      </div>

      <label className="import-panel__label" htmlFor="import-paste">
        {t('import.pasteLabel')}
      </label>
      <textarea
        id="import-paste"
        className="import-panel__textarea"
        value={pasteText}
        onChange={(event) => setPasteText(event.target.value)}
      />
      <button
        type="button"
        className="import-panel__paste-button"
        disabled={pasteText.trim() === ''}
        onClick={() => void attemptImport(pasteText)}
      >
        {t('import.pasteButton')}
      </button>

      {status === 'success' && (
        <p className="import-panel__status import-panel__status--success">
          {t('import.successMessage')}
        </p>
      )}
      {status === 'error' && (
        <p className="import-panel__status import-panel__status--error">
          {t('import.errorMessage')}
        </p>
      )}

      <section className="import-panel__provider-preview" aria-label={t('providerPreview.title')}>
        <h3 className="import-panel__subtitle">{t('providerPreview.title')}</h3>
        <p className="import-panel__provider-preview-notice">
          {t('providerPreview.notAppliedNotice')}
        </p>
        <button
          type="button"
          className="import-panel__file-button"
          onClick={() => void handleOpenProviderFileClick()}
        >
          {t('providerPreview.fileButton')}
        </button>

        {providerPreviewStatus === 'success' && providerPreview && (
          <div className="import-panel__provider-preview-result">
            <p>{t('providerPreview.nodeCount', { count: providerPreview.proxyCount })}</p>
            <ul className="import-panel__provider-preview-list">
              {providerPreview.nodes.map((node, index) => (
                <li key={index} className="import-panel__provider-preview-node">
                  <strong>{node.name ?? t('providerPreview.unnamedNode')}</strong>
                  {' — '}
                  <span>{node.proxyType ?? t('providerPreview.unknownType')}</span>
                  <div className="import-panel__provider-preview-fields">
                    {t('providerPreview.fieldsLabel')} {node.fieldKeys.join(', ')}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
        {providerPreviewStatus === 'error' && (
          <p className="import-panel__status import-panel__status--error">
            {t('providerPreview.errorMessage')}
          </p>
        )}
      </section>
    </section>
  );
}
