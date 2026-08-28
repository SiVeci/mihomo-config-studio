// @vitest-environment jsdom
import type { SnapshotDegradationSignal } from '@mcs/storage';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { t } from '../i18n/index.js';
import { StoragePressureNotice } from './StoragePressureNotice.js';

afterEach(() => {
  cleanup();
});

describe('StoragePressureNotice (NFR-REL-05, v0.6.0 #9)', () => {
  it('renders nothing when there is no signal yet', () => {
    const { container } = render(<StoragePressureNotice signal={null} onExportClick={vi.fn()} />);

    expect(container.firstChild).toBeNull();
  });

  it('renders nothing at the normal level', () => {
    const signal: SnapshotDegradationSignal = {
      level: 'normal',
      messageKey: 'storage.snapshot.normal',
      retainedCount: 50,
    };
    const { container } = render(<StoragePressureNotice signal={signal} onExportClick={vi.fn()} />);

    expect(container.firstChild).toBeNull();
  });

  it('shows a low-key notice at the reduced level, with no export button', () => {
    const signal: SnapshotDegradationSignal = {
      level: 'reduced',
      messageKey: 'storage.snapshot.reduced',
      retainedCount: 10,
    };
    render(<StoragePressureNotice signal={signal} onExportClick={vi.fn()} />);

    expect(screen.getByText(t('storage.snapshot.reduced'))).toBeDefined();
    expect(
      screen.queryByRole('button', { name: t('storage.snapshot.exportNowButton') }),
    ).toBeNull();
  });

  it('shows a prominent notice with an export button at the stopped level', () => {
    const onExportClick = vi.fn();
    const signal: SnapshotDegradationSignal = {
      level: 'stopped',
      messageKey: 'storage.snapshot.stopped',
      retainedCount: 0,
    };
    render(<StoragePressureNotice signal={signal} onExportClick={onExportClick} />);

    expect(screen.getByText(t('storage.snapshot.stopped'))).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: t('storage.snapshot.exportNowButton') }));
    expect(onExportClick).toHaveBeenCalledOnce();
  });
});
