// @vitest-environment jsdom
import { readMcsproj } from '@mcs/project-format';
import type { McsProjQuarantine, McsProjSchemaLock } from '@mcs/project-format';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { t } from '../i18n/index.js';
import type {
  SaveDocumentOptions,
  SaveDocumentOutcome,
  ShareDocumentOptions,
  ShareDocumentOutcome,
} from '../platform/index.js';
import type { ProjectRecord } from '../project/model.js';
import { ShareDialog } from './ShareDialog.js';

afterEach(() => {
  cleanup();
});

const PROJECT: ProjectRecord = {
  id: 'p1',
  name: 'My Project',
  description: 'desc',
  targetProfile: 'v1.19.29',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-02T00:00:00.000Z',
};

const SCHEMA_LOCK: McsProjSchemaLock = { bundleVersion: '0.5.0', compatibilityProfile: 'v1.19.29' };
const QUARANTINE: McsProjQuarantine = { fields: [] };

function fakeShareDocument(outcome: ShareDocumentOutcome): ReturnType<typeof vi.fn> & {
  (options: ShareDocumentOptions): Promise<ShareDocumentOutcome>;
} {
  return vi.fn(async () => outcome);
}

describe('ShareDialog / sharing (v0.6.0 #5, FR-AND-03)', () => {
  it('shares config.yaml verbatim and shows the shared notice on success', async () => {
    const shareDocument = fakeShareDocument({ kind: 'shared' });
    render(
      <ShareDialog
        project={PROJECT}
        schemaLock={SCHEMA_LOCK}
        quarantine={QUARANTINE}
        configText={'mode: rule\nport: 7890\n'}
        onClose={vi.fn()}
        shareDocument={shareDocument}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: t('share.yamlButton') }));

    await screen.findByText(t('share.sharedNotice'));
    expect(shareDocument).toHaveBeenCalledWith({
      suggestedName: 'My Project.yaml',
      content: 'mode: rule\nport: 7890\n',
      mimeType: 'text/yaml',
    });
  });

  it('shares a .mcsproj archive that reads back to the same config text', async () => {
    const shareDocument = fakeShareDocument({ kind: 'shared' });
    render(
      <ShareDialog
        project={PROJECT}
        schemaLock={SCHEMA_LOCK}
        quarantine={QUARANTINE}
        configText={'mode: rule\n'}
        onClose={vi.fn()}
        shareDocument={shareDocument}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: t('share.mcsprojButton') }));

    await screen.findByText(t('share.sharedNotice'));
    const [options] = shareDocument.mock.calls[0] as [ShareDocumentOptions];
    expect(options.suggestedName).toBe('My Project.mcsproj');
    expect(options.mimeType).toBe('application/zip');
    const read = await readMcsproj(options.content as Uint8Array);
    expect(read.configText).toBe('mode: rule\n');
  });

  it('closing calls onClose', () => {
    const onClose = vi.fn();
    render(
      <ShareDialog
        project={PROJECT}
        schemaLock={SCHEMA_LOCK}
        quarantine={QUARANTINE}
        configText={'mode: rule\n'}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: t('share.closeButton') }));

    expect(onClose).toHaveBeenCalled();
  });
});

describe('ShareDialog / cancel is not a failure (PRD §12)', () => {
  it('shows no failure banner and no error when the outcome is cancelled', async () => {
    const shareDocument = fakeShareDocument({ kind: 'cancelled' });
    render(
      <ShareDialog
        project={PROJECT}
        schemaLock={SCHEMA_LOCK}
        quarantine={QUARANTINE}
        configText={'mode: rule\n'}
        onClose={vi.fn()}
        shareDocument={shareDocument}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: t('share.yamlButton') }));
    await vi.waitFor(() => expect(shareDocument).toHaveBeenCalled());

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(t('share.failedNotice'))).toBeNull();
    expect(screen.queryByText(t('share.sharedNotice'))).toBeNull();
  });
});

describe('ShareDialog / failure handling — save instead + retry (PRD §12)', () => {
  function fakeSaveDocument(outcome: SaveDocumentOutcome): ReturnType<typeof vi.fn> & {
    (options: SaveDocumentOptions): Promise<SaveDocumentOutcome>;
  } {
    return vi.fn(async () => outcome);
  }

  it('shows the failure notice with never-lost wording, and both save-instead and retry actions', async () => {
    const shareDocument = fakeShareDocument({ kind: 'failed', code: 'SHARE_FAILED' });
    render(
      <ShareDialog
        project={PROJECT}
        schemaLock={SCHEMA_LOCK}
        quarantine={QUARANTINE}
        configText={'mode: rule\n'}
        onClose={vi.fn()}
        shareDocument={shareDocument}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: t('share.yamlButton') }));

    await screen.findByRole('alert');
    expect(screen.getByText(t('share.failedNotice'))).toBeDefined();
    expect(screen.getByRole('button', { name: t('share.saveInsteadButton') })).toBeDefined();
    expect(screen.getByRole('button', { name: t('share.retryButton') })).toBeDefined();
  });

  it('retry re-shares the exact same pending content', async () => {
    const shareDocument = vi
      .fn()
      .mockResolvedValueOnce({ kind: 'failed', code: 'SHARE_FAILED' })
      .mockResolvedValueOnce({ kind: 'shared' });
    render(
      <ShareDialog
        project={PROJECT}
        schemaLock={SCHEMA_LOCK}
        quarantine={QUARANTINE}
        configText={'mode: rule\nport: 7890\n'}
        onClose={vi.fn()}
        shareDocument={shareDocument}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: t('share.yamlButton') }));
    await screen.findByRole('alert');

    fireEvent.click(screen.getByRole('button', { name: t('share.retryButton') }));
    await screen.findByText(t('share.sharedNotice'));

    expect(shareDocument).toHaveBeenCalledTimes(2);
    expect(shareDocument.mock.calls[0]).toEqual(shareDocument.mock.calls[1]);
  });

  it('save instead writes the exact same pending content through saveDocument and reports the real saved name', async () => {
    const shareDocument = fakeShareDocument({ kind: 'failed', code: 'SHARE_FAILED' });
    const saveDocument = fakeSaveDocument({ kind: 'saved', name: 'My Project (1).yaml' });
    render(
      <ShareDialog
        project={PROJECT}
        schemaLock={SCHEMA_LOCK}
        quarantine={QUARANTINE}
        configText={'mode: rule\n'}
        onClose={vi.fn()}
        shareDocument={shareDocument}
        saveDocument={saveDocument}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: t('share.yamlButton') }));
    await screen.findByRole('alert');

    fireEvent.click(screen.getByRole('button', { name: t('share.saveInsteadButton') }));

    await screen.findByText(t('share.savedInsteadNotice', { name: 'My Project (1).yaml' }));
    expect(saveDocument).toHaveBeenCalledWith({
      suggestedName: 'My Project.yaml',
      content: 'mode: rule\n',
      mimeType: 'text/yaml',
    });
  });

  it('failure notice never contains any file content or the raw failure code, only stable UI copy', async () => {
    const shareDocument = fakeShareDocument({ kind: 'failed', code: 'SHARE_FAILED' });
    const secretConfigText = 'proxies:\n  - password: "correct-horse-battery-staple"\n';
    render(
      <ShareDialog
        project={PROJECT}
        schemaLock={SCHEMA_LOCK}
        quarantine={QUARANTINE}
        configText={secretConfigText}
        onClose={vi.fn()}
        shareDocument={shareDocument}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: t('share.yamlButton') }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).not.toContain('correct-horse-battery-staple');
    expect(alert.textContent).not.toContain('SHARE_FAILED');
  });
});

describe('ShareDialog / sensitivity warnings (NFR-SEC-08, reused from ExportDialog’s judgement)', () => {
  it('lists matched categories and never renders the matched secret value itself', () => {
    const secretPassword = 'correct-horse-battery-staple';
    render(
      <ShareDialog
        project={PROJECT}
        schemaLock={SCHEMA_LOCK}
        quarantine={QUARANTINE}
        configText={`proxies:\n  - password: "${secretPassword}"\n`}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText(t('export.sensitivity.password'))).toBeDefined();
    expect(screen.queryByText(secretPassword, { exact: false })).toBeNull();
  });
});
