// @vitest-environment jsdom
import { readMcsproj } from '@mcs/project-format';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { t } from '../i18n/index.js';
import type { ProjectRecord } from '../project/model.js';
import type { ValidationIssue } from '../worker/protocol.js';
import { ExportDialog } from './ExportDialog.js';

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

const BLOCKING_ISSUE: ValidationIssue = {
  severity: 'error',
  code: 'yaml.syntax.x',
  module: 'yaml',
  messageKey: 'yaml.syntax.x',
  blocking: true,
};

describe('ExportDialog / normal export (no blocking issues)', () => {
  it('exports config.yaml verbatim, not through any re-serialisation', () => {
    const downloadFile = vi.fn();
    render(
      <ExportDialog
        project={PROJECT}
        configText={'mode: rule\nport: 7890\n'}
        issues={[]}
        onClose={vi.fn()}
        downloadFile={downloadFile}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: t('export.yamlButton') }));

    expect(downloadFile).toHaveBeenCalledWith(
      'mode: rule\nport: 7890\n',
      'My Project.yaml',
      'text/yaml',
    );
  });

  it('exports a .mcsproj archive that reads back to the same config text and project metadata', async () => {
    const downloadFile = vi.fn();
    render(
      <ExportDialog
        project={PROJECT}
        configText={'mode: rule\n'}
        issues={[]}
        onClose={vi.fn()}
        downloadFile={downloadFile}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: t('export.mcsprojButton') }));

    await vi.waitFor(() => expect(downloadFile).toHaveBeenCalled());
    const [bytes, filename, mimeType] = downloadFile.mock.calls[0] as [Uint8Array, string, string];
    expect(filename).toBe('My Project.mcsproj');
    expect(mimeType).toBe('application/zip');
    const read = await readMcsproj(bytes);
    expect(read.configText).toBe('mode: rule\n');
    expect(read.manifest.id).toBe('p1');
    expect(read.manifest.name).toBe('My Project');
    expect(read.schemaLock.compatibilityProfile).toBe('v1.19.29');
  });

  it('does not render a draft-export button', () => {
    render(
      <ExportDialog project={PROJECT} configText={'mode: rule\n'} issues={[]} onClose={vi.fn()} />,
    );

    expect(screen.queryByRole('button', { name: t('export.draftButton') })).toBeNull();
  });

  it('closing calls onClose', () => {
    const onClose = vi.fn();
    render(
      <ExportDialog project={PROJECT} configText={'mode: rule\n'} issues={[]} onClose={onClose} />,
    );

    fireEvent.click(screen.getByRole('button', { name: t('export.closeButton') }));

    expect(onClose).toHaveBeenCalled();
  });
});

describe('ExportDialog / blocking issues (FR-YAML-07 mutually exclusive exports)', () => {
  it('disables both normal export buttons and shows the draft notice', () => {
    render(
      <ExportDialog
        project={PROJECT}
        configText={'mode: rule\n  bad: indent'}
        issues={[BLOCKING_ISSUE]}
        onClose={vi.fn()}
      />,
    );

    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: t('export.yamlButton') }).disabled,
    ).toBe(true);
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: t('export.mcsprojButton') }).disabled,
    ).toBe(true);
    expect(screen.getByText(t('export.draftNotice'))).toBeDefined();
  });

  it('exports the raw (invalid) text with a draft-marked filename, distinct from the normal export name', () => {
    const downloadFile = vi.fn();
    render(
      <ExportDialog
        project={PROJECT}
        configText={'mode: rule\n  bad: indent'}
        issues={[BLOCKING_ISSUE]}
        onClose={vi.fn()}
        downloadFile={downloadFile}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: t('export.draftButton') }));

    expect(downloadFile).toHaveBeenCalledWith(
      'mode: rule\n  bad: indent',
      'My Project.invalid-draft.yaml',
      'text/yaml',
    );
  });
});

describe('ExportDialog / sensitivity warnings (NFR-SEC-08)', () => {
  it('shows no sensitivity section for a config with none of the four categories', () => {
    render(
      <ExportDialog
        project={PROJECT}
        configText={'mode: rule\nport: 7890\n'}
        issues={[]}
        onClose={vi.fn()}
      />,
    );

    expect(screen.queryByText(t('export.sensitivityTitle'))).toBeNull();
  });

  it('lists the matched categories for a config containing password, uuid and a subscription url', () => {
    const configText = [
      'proxies:',
      '  - password: "hunter2"',
      '    uuid: 00000000-0000-0000-0000-000000000000',
      'proxy-providers:',
      '  main:',
      '    url: "https://example.com/subscription"',
    ].join('\n');
    render(
      <ExportDialog project={PROJECT} configText={configText} issues={[]} onClose={vi.fn()} />,
    );

    expect(screen.getByText(t('export.sensitivityTitle'))).toBeDefined();
    expect(screen.getByText(t('export.sensitivity.password'))).toBeDefined();
    expect(screen.getByText(t('export.sensitivity.uuid'))).toBeDefined();
    expect(screen.getByText(t('export.sensitivity.subscriptionUrl'))).toBeDefined();
  });

  it('never renders the matched secret value itself, only the category label', () => {
    const secretPassword = 'correct-horse-battery-staple';
    const configText = `proxies:\n  - password: "${secretPassword}"\n`;
    render(
      <ExportDialog project={PROJECT} configText={configText} issues={[]} onClose={vi.fn()} />,
    );

    expect(screen.getByText(t('export.sensitivity.password'))).toBeDefined();
    expect(screen.queryByText(secretPassword, { exact: false })).toBeNull();
  });
});
