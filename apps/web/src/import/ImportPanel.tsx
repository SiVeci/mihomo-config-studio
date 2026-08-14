import { useState, type ChangeEvent, type DragEvent, type ReactNode } from 'react';

import { t } from '../i18n/index.js';
import { hasBlockingIssues } from '../worker/protocol.js';
import type { ParseResponse } from '../worker/protocol.js';
import './ImportPanel.css';

/**
 * The narrow slice of `WorkerClient` this panel needs — a plain interface
 * rather than the concrete class, so tests can supply a trivial fake instead
 * of constructing a real (or fake) Worker.
 */
export interface ImportWorkerClient {
  parse(text: string): Promise<ParseResponse>;
}

export interface ImportPanelProps {
  readonly client: ImportWorkerClient;
  /** Called with the raw text once it has parsed without a blocking issue. */
  readonly onImport: (text: string) => void;
}

type Status = 'idle' | 'success' | 'error';

/**
 * Three entry points for FR-YAML-01: file picker, drag-and-drop, and a plain
 * paste box. Every path only ever *reads* the source (`File.text()`) and
 * hands the text to the Worker for parsing (#10) — there is no code path
 * anywhere here that requests a writable file handle or otherwise touches
 * the original file, which is what makes NFR-REL-04 (never overwrite the
 * imported file) true by construction rather than by a runtime check. The
 * structural test in `ImportPanel.test.tsx` asserts this file never mentions
 * a write-capable File System Access API, so a future edit that adds one
 * cannot land silently.
 */
export function ImportPanel({ client, onImport }: ImportPanelProps): ReactNode {
  const [pasteText, setPasteText] = useState('');
  const [status, setStatus] = useState<Status>('idle');

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

  async function handleFile(file: File): Promise<void> {
    const text = await file.text();
    await attemptImport(text);
  }

  function handleFileInputChange(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0];
    event.target.value = ''; // allow re-selecting the same file name later
    if (file) void handleFile(file);
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault(); // required for the browser to allow a drop at all
  }

  function handleDrop(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file) void handleFile(file);
  }

  return (
    <section className="import-panel" aria-label={t('import.title')}>
      <h2 className="import-panel__title">{t('import.title')}</h2>

      <div className="import-panel__dropzone" onDragOver={handleDragOver} onDrop={handleDrop}>
        <p className="import-panel__drop-hint">{t('import.dropHint')}</p>
        <label className="import-panel__file-label" htmlFor="import-file-input">
          {t('import.fileButton')}
        </label>
        <input
          id="import-file-input"
          className="import-panel__file-input"
          type="file"
          accept=".yaml,.yml"
          onChange={handleFileInputChange}
        />
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
    </section>
  );
}
